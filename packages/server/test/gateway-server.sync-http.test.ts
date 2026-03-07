import { describe, expect, test } from "bun:test";
import { EventBus } from "@spaceskit/core";
import { GatewayServer } from "../src/gateway-server.js";

function randomPort(): number {
  return 24_000 + Math.floor(Math.random() * 8_000);
}

describe("GatewayServer sync HTTP routes", () => {
  test("routes /sync/query and forwards sync secret header", async () => {
    let receivedSecret: string | undefined;
    let receivedPeerId: string | undefined;

    const server = new GatewayServer({
      port: randomPort(),
      host: "127.0.0.1",
      eventBus: new EventBus(),
      syncHttpHandler: {
        announce: async () => ({
          peerId: "peer-1",
          resourceId: "resource-main",
          gatewayVersion: "v1",
          syncEnabled: true,
          announcedAt: new Date().toISOString(),
        }),
        query: async (payload, authSecret) => {
          receivedSecret = authSecret;
          receivedPeerId = payload.peerId;
          return {
            resources: [],
            nextCursor: "next-page",
          };
        },
        pull: async () => ({
          resources: [],
          denied: [],
          appliedCount: 0,
          skippedCount: 0,
        }),
      },
    });

    try {
      server.start();

      const response = await fetch(`http://127.0.0.1:${server.port}/sync/query`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-spaceskit-sync-secret": "super-secret",
        },
        body: JSON.stringify({ peerId: "peer-1" }),
      });

      expect(response.status).toBe(200);
      const body = await response.json() as { nextCursor?: string };
      expect(body.nextCursor).toBe("next-page");
      expect(receivedSecret).toBe("super-secret");
      expect(receivedPeerId).toBe("peer-1");
    } finally {
      await server.stop();
    }
  });

  test("maps sync handler typed errors to HTTP status", async () => {
    const server = new GatewayServer({
      port: randomPort(),
      host: "127.0.0.1",
      eventBus: new EventBus(),
      syncHttpHandler: {
        announce: async () => {
          return {
            peerId: "peer-1",
            resourceId: "resource-main",
            gatewayVersion: "v1",
            syncEnabled: true,
            announcedAt: new Date().toISOString(),
          };
        },
        query: async () => {
          const error = new Error("blocked by sync policy") as Error & { code?: string };
          error.code = "PERMISSION_DENIED";
          throw error;
        },
        pull: async () => ({
          resources: [],
          denied: [],
          appliedCount: 0,
          skippedCount: 0,
        }),
      },
    });

    try {
      server.start();

      const response = await fetch(`http://127.0.0.1:${server.port}/sync/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ peerId: "peer-1" }),
      });

      expect(response.status).toBe(403);
      const body = await response.json() as { code?: string; message?: string };
      expect(body.code).toBe("PERMISSION_DENIED");
      expect(body.message).toBe("blocked by sync policy");
    } finally {
      await server.stop();
    }
  });

  test("returns INVALID_ARGUMENT for malformed sync JSON", async () => {
    const server = new GatewayServer({
      port: randomPort(),
      host: "127.0.0.1",
      eventBus: new EventBus(),
      syncHttpHandler: {
        announce: async () => ({
          peerId: "peer-1",
          resourceId: "resource-main",
          gatewayVersion: "v1",
          syncEnabled: true,
          announcedAt: new Date().toISOString(),
        }),
        query: async () => ({
          resources: [],
          nextCursor: undefined,
        }),
        pull: async () => ({
          resources: [],
          denied: [],
          appliedCount: 0,
          skippedCount: 0,
        }),
      },
    });

    try {
      server.start();

      const response = await fetch(`http://127.0.0.1:${server.port}/sync/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{invalid-json",
      });

      expect(response.status).toBe(400);
      const body = await response.json() as { code?: string };
      expect(body.code).toBe("INVALID_ARGUMENT");
    } finally {
      await server.stop();
    }
  });

  test("returns denied resource reasons from /sync/pull payloads", async () => {
    const server = new GatewayServer({
      port: randomPort(),
      host: "127.0.0.1",
      eventBus: new EventBus(),
      syncHttpHandler: {
        announce: async () => ({
          peerId: "peer-1",
          resourceId: "resource-main",
          gatewayVersion: "v1",
          syncEnabled: true,
          announcedAt: new Date().toISOString(),
        }),
        query: async () => ({
          resources: [],
          nextCursor: undefined,
        }),
        pull: async () => ({
          resources: [],
          denied: [
            {
              ref: {
                resourceType: "artifact",
                resourceId: "artifact-note-1",
              },
              reason: "Sync artifacts are restricted to basic.md by default",
            },
          ],
          appliedCount: 0,
          skippedCount: 0,
        }),
      },
    });

    try {
      server.start();

      const response = await fetch(`http://127.0.0.1:${server.port}/sync/pull`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          peerId: "peer-1",
          idempotencyKey: "idem-1",
          refs: [{ resourceType: "artifact", resourceId: "artifact-note-1" }],
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json() as {
        denied?: Array<{ reason?: string }>;
        appliedCount?: number;
      };
      expect(body.appliedCount).toBe(0);
      expect(body.denied?.length).toBe(1);
      expect(body.denied?.[0]?.reason).toContain("basic.md");
    } finally {
      await server.stop();
    }
  });
});
