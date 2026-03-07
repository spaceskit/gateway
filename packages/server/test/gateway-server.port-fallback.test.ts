import { describe, expect, test } from "bun:test";
import { EventBus } from "@spaceskit/core";
import { GatewayServer } from "../src/gateway-server.js";

function randomPort(): number {
  return 30_000 + Math.floor(Math.random() * 4_000);
}

describe("GatewayServer port fallback", () => {
  test("binds to another port when requested port is occupied and fallback is enabled", async () => {
    const occupiedPort = randomPort();
    const blocker = Bun.serve({
      port: occupiedPort,
      hostname: "127.0.0.1",
      fetch: () => new Response("occupied"),
    });

    const server = new GatewayServer({
      port: occupiedPort,
      host: "127.0.0.1",
      allowPortFallback: true,
      portFallbackRange: 20,
      skipAuth: true,
      eventBus: new EventBus(),
      onMessage: async () => null,
    });

    try {
      server.start();
      expect(server.port).toBeGreaterThan(occupiedPort);
      expect(server.port).toBeLessThanOrEqual(occupiedPort + 20);

      const health = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(health.status).toBe(200);
    } finally {
      await server.stop();
      blocker.stop();
    }
  });

  test("throws when requested port is occupied and fallback is disabled", async () => {
    const occupiedPort = randomPort();
    const blocker = Bun.serve({
      port: occupiedPort,
      hostname: "127.0.0.1",
      fetch: () => new Response("occupied"),
    });

    const server = new GatewayServer({
      port: occupiedPort,
      host: "127.0.0.1",
      allowPortFallback: false,
      skipAuth: true,
      eventBus: new EventBus(),
      onMessage: async () => null,
    });

    try {
      expect(() => server.start()).toThrow();
    } finally {
      await server.stop();
      blocker.stop();
    }
  });

  test("includes health metadata when provided by healthCheck callback", async () => {
    const server = new GatewayServer({
      port: randomPort(),
      host: "127.0.0.1",
      skipAuth: true,
      eventBus: new EventBus(),
      onMessage: async () => null,
      healthCheck: async () => ({
        status: "ok",
        uptime: 1,
        clients: 0,
        subsystems: {
          test: { status: "ok" },
        },
        metadata: {
          gatewayId: "resource:main",
          gatewayProfile: "embedded",
          mainSpaceId: "main-space",
          mainSpaceName: "Embedded Main Space",
          mainSpaceResourceId: "resource:main",
          mainAgentId: "main-agent",
          mainProfileId: "main-profile",
          mainAgentStatus: "healthy",
        },
      }),
    });

    try {
      server.start();
      const response = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.metadata.gatewayId).toBe("resource:main");
      expect(payload.metadata.gatewayProfile).toBe("embedded");
      expect(payload.metadata.mainSpaceId).toBe("main-space");
      expect(payload.metadata.mainSpaceName).toBe("Embedded Main Space");
      expect(payload.metadata.mainSpaceResourceId).toBe("resource:main");
      expect(payload.metadata.mainAgentId).toBe("main-agent");
      expect(payload.metadata.mainProfileId).toBe("main-profile");
      expect(payload.metadata.mainAgentStatus).toBe("healthy");
    } finally {
      await server.stop();
    }
  });

  test("passes debug query flag through to healthCheck", async () => {
    let sawDebugFlag = false;
    const server = new GatewayServer({
      port: randomPort(),
      host: "127.0.0.1",
      skipAuth: true,
      eventBus: new EventBus(),
      onMessage: async () => null,
      healthCheck: async (context) => {
        sawDebugFlag = context?.debug === true;
        return {
          status: "degraded",
          uptime: 1,
          clients: 0,
          subsystems: {
            modelRouter: { status: "degraded", detail: "No model runtime configured" },
          },
          degradation: {
            reasons: [
              {
                subsystem: "modelRouter",
                status: "degraded",
                detail: "No model runtime configured",
              },
            ],
          },
          debug: context?.debug ? { requestedViaQuery: true } : undefined,
        };
      },
    });

    try {
      server.start();
      const response = await fetch(`http://127.0.0.1:${server.port}/health?debug=1`);
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(sawDebugFlag).toBe(true);
      expect(payload.debug.requestedViaQuery).toBe(true);
      expect(payload.degradation.reasons[0].subsystem).toBe("modelRouter");
    } finally {
      await server.stop();
    }
  });
});
