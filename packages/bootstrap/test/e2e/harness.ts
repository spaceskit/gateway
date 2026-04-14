/**
 * E2E Test Harness
 *
 * Reusable helpers for starting in-process gateways with real client-ts clients.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startGateway } from "../../src/index.js";
import {
  GatewayClient,
  generateAuthKeyPair,
  type GatewayClientOptions,
} from "../../../../../client-ts/src/gateway-client.ts";
import {
  GatewayAdapterClient,
  type GatewayAdapterClientOptions,
  type AdapterProviderRegistration,
} from "../../../../../client-ts/src/adapter-client.ts";

export type GatewayInstance = Awaited<ReturnType<typeof startGateway>>;

export const E2E_TIMEOUT = 30_000;

export function randomPort(): number {
  return 20_000 + Math.floor(Math.random() * 20_000);
}

export function removeDbArtifacts(dbPath: string): void {
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
}

export interface TestGateway {
  instance: GatewayInstance;
  port: number;
  wsUrl: string;
  httpUrl: string;
  dbPath: string;
  cleanup: () => Promise<void>;
}

export interface CreateTestGatewayOptions {
  gatewayProfile?: "embedded" | "external";
  env?: Record<string, string | undefined>;
}

export async function createTestGateway(
  overrides?: Record<string, unknown>,
  options: CreateTestGatewayOptions = {},
): Promise<TestGateway> {
  const port = randomPort();
  const dbPath = join(
    tmpdir(),
    `spaceskit-e2e-${crypto.randomUUID()}.db`,
  );
  const spacesRoot = mkdtempSync(join(tmpdir(), "spaceskit-e2e-spaces-"));
  const gatewayProfile = options.gatewayProfile ?? "embedded";
  const envOverrides = {
    SPACESKIT_GATEWAY_PROFILE: gatewayProfile,
    SPACESKIT_SPACES_ROOT: spacesRoot,
    ...(options.env ?? {}),
  };
  const previousEnv = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(envOverrides)) {
    previousEnv.set(key, Bun.env[key]);
    if (value === undefined) {
      delete Bun.env[key];
    } else {
      Bun.env[key] = value;
    }
  }

  let instance: GatewayInstance;
  try {
    instance = await startGateway({
      port,
      host: "127.0.0.1",
      dbPath,
      logLevel: "error",
      runtimeGeneration: `e2e_${crypto.randomUUID().slice(0, 8)}`,
      mainSpaceId: `e2e-main-${crypto.randomUUID().slice(0, 8)}`,
      mainProfileId: `e2e-profile-${crypto.randomUUID().slice(0, 8)}`,
      mainAgentId: `e2e-agent-${crypto.randomUUID().slice(0, 8)}`,
      spacesRoot,
      ...(gatewayProfile === "external"
        ? {
            gatewayProfile: "external",
            archFreezeEnforced: false,
            httpPrincipalAuthHs256Secret: `e2e-http-secret-${crypto.randomUUID().slice(0, 8)}`,
          }
        : {
            skipAuth: true,
            a2aRequireAuth: false,
            syncRequireSecret: false,
          }),
      ...overrides,
    } as Record<string, unknown>);
  } finally {
    for (const [key, value] of previousEnv.entries()) {
      if (value === undefined) {
        delete Bun.env[key];
      } else {
        Bun.env[key] = value;
      }
    }
  }

  const cleanup = async () => {
    try {
      await instance.shutdown();
    } catch {}
    removeDbArtifacts(dbPath);
    rmSync(spacesRoot, { recursive: true, force: true });
  };

  return {
    instance,
    port,
    wsUrl: `ws://127.0.0.1:${port}`,
    httpUrl: `http://127.0.0.1:${port}`,
    dbPath,
    cleanup,
  };
}

export async function createTestClient(
  wsUrl: string,
  opts?: Partial<GatewayClientOptions>,
): Promise<GatewayClient> {
  const keyPair = await generateAuthKeyPair();
  const deviceId = `e2e-device-${crypto.randomUUID().slice(0, 8)}`;
  const client = new GatewayClient({
    url: wsUrl,
    reconnect: false,
    requestTimeoutMs: 10_000,
    deviceId,
    devicePublicKey: keyPair.publicKeyBase64,
    ...opts,
  });
  client.setAuthKeyPair(keyPair);
  await client.connect();
  await waitForAuth(client);
  return client;
}

export async function createTestAdapterClient(
  wsUrl: string,
  registrations?: AdapterProviderRegistration[],
  opts?: Partial<GatewayAdapterClientOptions>,
  gateway?: GatewayInstance,
): Promise<GatewayAdapterClient> {
  const keyPair = await generateAuthKeyPair();
  const deviceId = `e2e-adapter-${crypto.randomUUID().slice(0, 8)}`;
  const adapter = new GatewayAdapterClient({
    url: wsUrl,
    reconnect: false,
    requestTimeoutMs: 10_000,
    authKeyPair: keyPair,
    deviceId,
    devicePublicKey: keyPair.publicKeyBase64,
    ...opts,
  });

  // Subscribe to auth event BEFORE connecting to avoid race conditions
  const authPromise = gateway
    ? waitForClientAuth(gateway)
    : null;

  // Connect — the adapter's connect() will try to register capabilities
  // but auth might not have completed yet for skipAuth=false gateways
  await adapter.connect();

  // Wait for auth to complete
  if (authPromise) {
    await authPromise;
  }

  // Register providers after auth — registerProviders calls registerCapabilities
  // on the server since the client is already connected
  if (registrations) {
    await adapter.registerProviders(registrations);
  }

  return adapter;
}

/**
 * Wait for auth to complete by polling ping with retries.
 */
export async function waitForAuth(
  client: GatewayClient,
  maxWaitMs = 5_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      await client.ping();
      return;
    } catch {
      // Auth not done yet, keep waiting
    }
  }
  throw new Error("Auth did not complete within timeout");
}

/**
 * Wait for a client.authenticated event on the gateway's event bus.
 */
export function waitForClientAuth(
  gateway: GatewayInstance,
  timeoutMs = 5_000,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error("Client auth did not complete within timeout"));
    }, timeoutMs);

    const unsub = gateway.eventBus.on("client.authenticated", () => {
      clearTimeout(timer);
      unsub();
      resolve();
    });
  });
}

/**
 * Wait for a specific event from a client's event handler.
 * Returns the event payload or throws on timeout.
 */
export function waitForEvent<T>(
  subscribe: (handler: (event: T) => void) => () => void,
  timeoutMs = 5_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`waitForEvent timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const unsub = subscribe((event: T) => {
      clearTimeout(timer);
      unsub();
      resolve(event);
    });
  });
}

/**
 * Read the next SSE event from a streaming response body.
 */
export async function readNextSseEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Record<string, unknown>> {
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      throw new Error("Stream ended before next SSE event");
    }
    buffer += new TextDecoder().decode(value);
    const delimiterIndex = buffer.indexOf("\n\n");
    if (delimiterIndex >= 0) {
      const chunk = buffer.slice(0, delimiterIndex);
      const dataLine = chunk
        .split("\n")
        .find((line) => line.startsWith("data: "));
      if (!dataLine) {
        throw new Error(`Missing data line in chunk: ${chunk}`);
      }
      return JSON.parse(dataLine.slice("data: ".length)) as Record<
        string,
        unknown
      >;
    }
  }
}

/**
 * Post JSON to an HTTP endpoint and return parsed response.
 */
export async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: T }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new Error(
      `POST ${url} returned non-JSON (${response.status}): ${text}`,
    );
  }
  return { status: response.status, data };
}

/**
 * GET JSON from an HTTP endpoint.
 */
export async function getJson<T>(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: T }> {
  const response = await fetch(url, { headers });
  const text = await response.text();
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new Error(
      `GET ${url} returned non-JSON (${response.status}): ${text}`,
    );
  }
  return { status: response.status, data };
}
