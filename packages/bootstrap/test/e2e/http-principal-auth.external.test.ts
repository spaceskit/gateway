import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startGateway } from "../../src/index.js";
import {
  GatewayClient,
  generateAuthKeyPair,
} from "../../../../../client-ts/src/gateway-client.ts";
import { E2E_TIMEOUT, randomPort, removeDbArtifacts, waitForAuth } from "./harness.js";

function bearerHeaders(token: string, extra?: Record<string, string>): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

async function expectRestUnauthenticated(response: Response): Promise<void> {
  expect(response.status).toBe(401);
  const body = await response.json() as { code?: string };
  expect(body.code).toBe("UNAUTHENTICATED");
}

async function expectMcpUnauthenticated(response: Response): Promise<void> {
  expect(response.status).toBe(401);
  const body = await response.json() as { error?: { data?: { code?: string } } };
  expect(body.error?.data?.code).toBe("UNAUTHENTICATED");
}

describe("external HTTP principal auth", () => {
  test("issues signed bearer tokens and rejects forged or unsigned callers on protected HTTP routes", {
    timeout: E2E_TIMEOUT,
  }, async () => {
    const port = randomPort();
    const dbPath = join(tmpdir(), `spaceskit-http-principal-${crypto.randomUUID()}.db`);
    const previousMasterKey = Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY;

    let instance: Awaited<ReturnType<typeof startGateway>> | null = null;
    let client: GatewayClient | null = null;

    try {
      Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY = "test-http-principal-master-key";
      instance = await startGateway({
        port,
        host: "127.0.0.1",
        dbPath,
        logLevel: "error",
        gatewayProfile: "external",
        archFreezeEnforced: false,
        httpPrincipalAuthHs256Secret: "test-http-principal-secret",
        mainAdminMcpEnabled: true,
        shareRelayBaseUrl: "https://relay.example.test",
        runtimeGeneration: "e2e_http_principal_auth",
        mainSpaceId: `main-space-${crypto.randomUUID().slice(0, 8)}`,
        mainProfileId: `main-profile-${crypto.randomUUID().slice(0, 8)}`,
        mainAgentId: `main-agent-${crypto.randomUUID().slice(0, 8)}`,
      });

      const keyPair = await generateAuthKeyPair();
      const deviceId = `http-auth-device-${crypto.randomUUID().slice(0, 8)}`;
      client = new GatewayClient({
        url: `ws://127.0.0.1:${port}`,
        reconnect: false,
        requestTimeoutMs: 10_000,
        deviceId,
        devicePublicKey: keyPair.publicKeyBase64,
      });
      client.setAuthKeyPair(keyPair);
      await client.connect();
      await waitForAuth(client);

      const issued = await client.issueHttpPrincipalToken({ ttlSeconds: 300 });
      expect(issued.tokenType).toBe("Bearer");
      expect(issued.principalId).toBe(keyPair.publicKeyBase64);
      expect(typeof issued.token).toBe("string");
      expect(issued.token.length).toBeGreaterThan(20);

      const spaceId = instance.config.mainSpaceId;
      const httpBaseUrl = `http://127.0.0.1:${port}`;

      const invite = await client.createSpaceShareInvite({
        spaceId,
        mode: "read_only",
      });
      const relayInviteId = invite.inviteLink?.relayInviteId;
      expect(relayInviteId).toBeDefined();

      const spacesHeaderOnly = await fetch(`${httpBaseUrl}/v1/spaces/${spaceId}/usage`, {
        method: "GET",
        headers: {
          "x-spaceskit-principal-id": keyPair.publicKeyBase64,
        },
      });
      await expectRestUnauthenticated(spacesHeaderOnly);

      const spacesRawBearer = await fetch(`${httpBaseUrl}/v1/spaces/${spaceId}/usage`, {
        method: "GET",
        headers: {
          Authorization: issued.token,
        },
      });
      await expectRestUnauthenticated(spacesRawBearer);

      const spacesSigned = await fetch(`${httpBaseUrl}/v1/spaces/${spaceId}/usage`, {
        method: "GET",
        headers: bearerHeaders(issued.token),
      });
      expect(spacesSigned.status).toBe(200);
      const spacesBody = await spacesSigned.json() as Record<string, unknown>;
      expect(typeof spacesBody).toBe("object");
      expect(spacesBody).not.toBeNull();

      const relayHeaderOnly = await fetch(`${httpBaseUrl}/v1/share/relay/resolve`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-spaceskit-principal-id": keyPair.publicKeyBase64,
        },
        body: JSON.stringify({
          relayInviteId,
          directReachable: true,
        }),
      });
      await expectRestUnauthenticated(relayHeaderOnly);

      const relaySigned = await fetch(`${httpBaseUrl}/v1/share/relay/resolve`, {
        method: "POST",
        headers: bearerHeaders(issued.token, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          relayInviteId,
          directReachable: true,
        }),
      });
      expect(relaySigned.status).toBe(200);
      const relayBody = await relaySigned.json() as { relaySessionToken?: string };
      expect(relayBody.relaySessionToken).toBeDefined();

      const adminHeaderOnly = await fetch(`${httpBaseUrl}/mcp/spaces-admin`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-spaceskit-principal-id": keyPair.publicKeyBase64,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        }),
      });
      await expectMcpUnauthenticated(adminHeaderOnly);

      const adminSigned = await fetch(`${httpBaseUrl}/mcp/spaces-admin`, {
        method: "POST",
        headers: bearerHeaders(issued.token, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
        }),
      });
      expect(adminSigned.status).toBe(200);
      const adminBody = await adminSigned.json() as {
        result?: { tools?: Array<{ name?: string }> };
      };
      expect(Array.isArray(adminBody.result?.tools)).toBe(true);
      expect(adminBody.result?.tools?.some((tool) => tool.name === "spaces.admin.list_spaces")).toBe(true);

      const observabilityHeaderOnly = await fetch(`${httpBaseUrl}/v1/observability/summary`, {
        method: "GET",
        headers: {
          "x-spaceskit-principal-id": keyPair.publicKeyBase64,
        },
      });
      await expectRestUnauthenticated(observabilityHeaderOnly);

      const observabilitySigned = await fetch(`${httpBaseUrl}/v1/observability/summary`, {
        method: "GET",
        headers: bearerHeaders(issued.token),
      });
      expect(observabilitySigned.status).toBe(200);
      const observabilityBody = await observabilitySigned.json() as { generatedAt?: string };
      expect(typeof observabilityBody.generatedAt).toBe("string");
    } finally {
      try {
        await client?.disconnect();
      } catch {}
      try {
        await instance?.shutdown();
      } catch {}
      removeDbArtifacts(dbPath);
      if (previousMasterKey === undefined) {
        delete Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY;
      } else {
        Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY = previousMasterKey;
      }
    }
  });
});
