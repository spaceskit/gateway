import {
  GatewayClient,
  generateAuthKeyPair,
} from "../client.js";
import type { Layer, ScenarioContext } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeClient(wsUrl: string): Promise<GatewayClient> {
  const keyPair = await generateAuthKeyPair();
  const client = new GatewayClient({
    url: wsUrl,
    reconnect: false,
    requestTimeoutMs: 10_000,
    deviceId: `bench-${crypto.randomUUID().slice(0, 8)}`,
    devicePublicKey: keyPair.publicKeyBase64,
  });
  client.setAuthKeyPair(keyPair);
  await client.connect();

  // Wait for auth handshake to complete
  const start = Date.now();
  while (Date.now() - start < 5000) {
    await new Promise(r => setTimeout(r, 100));
    try {
      await client.ping();
      return client;
    } catch {
      // Not ready yet — retry
    }
  }
  throw new Error("Auth timeout");
}

// ---------------------------------------------------------------------------
// Layer 1 — Chat roundtrip
// ---------------------------------------------------------------------------

export const chatRoundtripLayer: Layer = {
  name: "chat-roundtrip",
  scenarios: [
    {
      name: "create-space",
      run: async (ctx: ScenarioContext) => {
        const client = await makeClient(ctx.wsUrl);
        try {
          const space = await client.createSpace({
            idempotencyKey: `workbench:chat-roundtrip:create-space:${crypto.randomUUID()}`,
            name: "bench-chat-test",
            resourceId: `resource:bench-${crypto.randomUUID().slice(0, 8)}`,
            capabilities: ["lists"],
          });
          ctx.registerSpace?.(space.id);
          if (!space.id) {
            throw new Error("Space creation did not return an id");
          }
        } finally {
          await client.disconnect();
        }
      },
    },
    {
      name: "send-message-ack",
      run: async (ctx: ScenarioContext) => {
        const client = await makeClient(ctx.wsUrl);
        try {
          const space = await client.createSpace({
            idempotencyKey: `workbench:chat-roundtrip:send-message-ack:${crypto.randomUUID()}`,
            name: "bench-msg-test",
            resourceId: `resource:bench-${crypto.randomUUID().slice(0, 8)}`,
            capabilities: ["lists"],
          });
          ctx.registerSpace?.(space.id);

          await client.subscribe([space.id]);

          const result = await client.executeTurn(
            space.spaceUid ?? space.id,
            "hello",
          );
          if (!result.turnId) {
            throw new Error("executeTurn did not return a turnId");
          }
          ctx.registerTurn?.(space.id, result.turnId);
        } finally {
          await client.disconnect();
        }
      },
    },
    {
      name: "health-check",
      run: async (ctx: ScenarioContext) => {
        const response = await fetch(`${ctx.httpUrl}/health`);
        // 200 = healthy, 503 = degraded (no model provider) — both mean server is running
        if (response.status !== 200 && response.status !== 503) {
          throw new Error(`Health check returned HTTP ${response.status}`);
        }
        const body = await response.json();
        if (!body || typeof body !== "object") {
          throw new Error("Health check did not return JSON");
        }
      },
    },
  ],
};
