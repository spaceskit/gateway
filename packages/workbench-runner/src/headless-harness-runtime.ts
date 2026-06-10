import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  GatewayAdapterClient,
  GatewayClient,
  generateAuthKeyPair,
  type AdapterProviderRegistration,
  type GatewayClientOptions,
} from "@spaceskit/client";
import type {
  HarnessMode,
  HarnessOptions,
  HarnessRuntime,
  HeadlessGatewayInstance,
  ProvisioningStrategy,
} from "./headless-harness-types.js";
import { sleep } from "./headless-harness-utils.js";

interface GatewayTeardownState {
  previousSecretRefMasterKey?: string;
  hadSecretRefMasterKey: boolean;
}

export function resolveProvisioningStrategy(
  mode: HarnessMode,
  requested: ProvisioningStrategy,
): ProvisioningStrategy {
  if (mode !== "external" && requested === "built-in-mcp-admin") {
    throw new Error("built-in-mcp-admin provisioning is only supported in external mode");
  }
  return requested;
}

export function deriveHttpUrlFromWsUrl(wsUrl: string): string {
  if (wsUrl.startsWith("ws://")) {
    return `http://${wsUrl.slice("ws://".length)}`;
  }
  if (wsUrl.startsWith("wss://")) {
    return `https://${wsUrl.slice("wss://".length)}`;
  }
  throw new Error(`Cannot derive HTTP URL from WebSocket URL: ${wsUrl}`);
}

export async function createAuthedClient(
  wsUrl: string,
  suffix: string,
  overrides: Partial<GatewayClientOptions> = {},
): Promise<GatewayClient> {
  const keyPair = await generateAuthKeyPair();
  const client = new GatewayClient({
    url: wsUrl,
    reconnect: false,
    requestTimeoutMs: 10_000,
    deviceId: `headless-${suffix}-${crypto.randomUUID().slice(0, 8)}`,
    devicePublicKey: keyPair.publicKeyBase64,
    ...overrides,
  });
  client.setAuthKeyPair(keyPair);
  await client.connect();
  await waitForAuth(client);
  return client;
}

export async function createAdapterClient(wsUrl: string): Promise<GatewayAdapterClient> {
  const keyPair = await generateAuthKeyPair();
  const adapter = new GatewayAdapterClient({
    url: wsUrl,
    reconnect: false,
    requestTimeoutMs: 10_000,
    authKeyPair: keyPair,
    deviceId: `headless-adapter-${crypto.randomUUID().slice(0, 8)}`,
    devicePublicKey: keyPair.publicKeyBase64,
  });
  await adapter.connect();
  await sleep(250);
  await adapter.registerProviders(buildAdapterRegistrations());
  return adapter;
}

export async function resolveRuntime(options: HarnessOptions): Promise<HarnessRuntime> {
  if (options.mode === "in-process") {
    return startInProcessRuntime(options);
  }

  const wsUrl = options.wsUrl ?? Bun.env.SPACESKIT_EXTERNAL_GATEWAY_WS_URL ?? "ws://127.0.0.1:9321";
  const httpUrl = options.httpUrl
    ?? Bun.env.SPACESKIT_EXTERNAL_GATEWAY_HTTP_URL
    ?? deriveHttpUrlFromWsUrl(wsUrl);
  return {
    wsUrl,
    httpUrl,
    cleanup: async () => undefined,
  };
}

function randomPort(): number {
  return 26_000 + Math.floor(Math.random() * 10_000);
}

function removeDbArtifacts(dbPath: string): void {
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
}

function createGatewayTeardownState(): GatewayTeardownState {
  return {
    previousSecretRefMasterKey: Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY,
    hadSecretRefMasterKey: Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY !== undefined,
  };
}

function restoreGatewayTeardownState(state: GatewayTeardownState): void {
  if (state.hadSecretRefMasterKey) {
    Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY = state.previousSecretRefMasterKey;
  } else {
    delete Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY;
  }
}

function buildAdapterRegistrations(): AdapterProviderRegistration[] {
  return [
    {
      provider: {
        id: "headless.echo",
        name: "Headless Echo",
        source: "adapter",
        capabilityType: "lists",
        operations: ["echo", "delay"],
      },
      handlers: {
        echo: async (args: Record<string, unknown>) => ({
          echoed: args,
        }),
        delay: async (args: Record<string, unknown>) => {
          const ms = typeof args.ms === "number" ? args.ms : 25;
          await sleep(ms);
          return { delayed: ms };
        },
      },
    },
  ];
}

async function waitForAuth(client: GatewayClient, maxWaitMs = 5_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxWaitMs) {
    await sleep(100);
    try {
      await client.ping();
      return;
    } catch {
      // Keep polling until auth is usable.
    }
  }
  throw new Error("Client authentication did not complete within timeout");
}

async function startInProcessRuntime(options: HarnessOptions): Promise<HarnessRuntime> {
  const startGateway = options.startGateway;
  if (!startGateway) {
    throw new Error("In-process headless harness mode requires a startGateway implementation");
  }

  const port = randomPort();
  const dbPath = resolve(tmpdir(), `spaceskit-headless-${crypto.randomUUID()}.db`);
  const spacesRoot = resolve(tmpdir(), `spaceskit-headless-spaces-${crypto.randomUUID()}`);
  const teardownState = createGatewayTeardownState();
  Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY = "headless-space-harness-master-key";

  let gateway: HeadlessGatewayInstance | null = null;
  try {
    gateway = await startGateway({
      port,
      host: "127.0.0.1",
      dbPath,
      spacesRoot,
      logLevel: "error",
      gatewayProfile: "external",
      archFreezeEnforced: false,
      skipAuth: false,
      httpPrincipalAuthHs256Secret: "headless-space-harness-http-secret",
      mainAdminMcpEnabled: true,
      gatewayCapabilityGrants: ["lists.read", "lists.write", "lists.execute"],
      runtimeGeneration: `headless_${crypto.randomUUID().slice(0, 8)}`,
      mainSpaceId: `headless-main-space-${crypto.randomUUID().slice(0, 8)}`,
      mainProfileId: `headless-main-profile-${crypto.randomUUID().slice(0, 8)}`,
      mainAgentId: `headless-main-agent-${crypto.randomUUID().slice(0, 8)}`,
    });
  } catch (error) {
    restoreGatewayTeardownState(teardownState);
    removeDbArtifacts(dbPath);
    throw error;
  }

  const wsUrl = `ws://127.0.0.1:${port}`;
  const httpUrl = `http://127.0.0.1:${port}`;

  return {
    wsUrl,
    httpUrl,
    cleanup: async () => {
      try {
        await gateway?.shutdown();
      } finally {
        restoreGatewayTeardownState(teardownState);
        removeDbArtifacts(dbPath);
        rmSync(spacesRoot, { recursive: true, force: true });
      }
    },
  };
}
