import { describe, expect, test } from "bun:test";
import { EventBus } from "@spaceskit/core";
import { GatewayServer } from "../src/gateway-server.js";

function randomPort(): number {
  return 31_000 + Math.floor(Math.random() * 5_000);
}

describe("GatewayServer custom HTTP handler", () => {
  test("routes custom HTTP responses before websocket upgrade", async () => {
    const server = new GatewayServer({
      port: randomPort(),
      host: "127.0.0.1",
      eventBus: new EventBus(),
      httpHandler: async (_req, url) => {
        if (url.pathname === "/v1/ping") {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return null;
      },
    });

    try {
      server.start();
      const response = await fetch(`http://127.0.0.1:${server.port}/v1/ping`);
      expect(response.status).toBe(200);
      const body = await response.json() as { ok?: boolean };
      expect(body.ok).toBe(true);
    } finally {
      await server.stop();
    }
  });
});
