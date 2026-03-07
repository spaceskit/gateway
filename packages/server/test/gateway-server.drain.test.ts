import { describe, expect, test } from "bun:test";
import { EventBus } from "@spaceskit/core";
import { GatewayServer } from "../src/gateway-server.js";

function randomPort(): number {
  return 34_000 + Math.floor(Math.random() * 4_000);
}

function createServer(): GatewayServer {
  return new GatewayServer({
    port: randomPort(),
    host: "127.0.0.1",
    skipAuth: true,
    eventBus: new EventBus(),
    onMessage: async () => null,
  });
}

describe("GatewayServer turn-aware drain", () => {
  test("drain resolves immediately when no active turns and no clients", async () => {
    const server = createServer();
    try {
      server.start();
      expect(server.activeTurnCount).toBe(0);

      const start = Date.now();
      await server.drain(5000);
      const elapsed = Date.now() - start;

      // Should resolve near-instantly, not wait for timeout
      expect(elapsed).toBeLessThan(500);
    } finally {
      await server.stop();
    }
  });

  test("drain resolves early when all active turns complete before timeout", async () => {
    const server = createServer();
    try {
      server.start();

      server.registerActiveTurn("turn-1");
      expect(server.activeTurnCount).toBe(1);

      const drainPromise = server.drain(10000);

      // Complete the turn after a short delay
      setTimeout(() => server.completeTurn("turn-1"), 50);

      const start = Date.now();
      await drainPromise;
      const elapsed = Date.now() - start;

      // Should resolve quickly after the turn completes, not wait for full timeout
      expect(elapsed).toBeLessThan(2000);
      expect(server.activeTurnCount).toBe(0);
    } finally {
      await server.stop();
    }
  });

  test("drain times out when turns do not complete within timeout", async () => {
    const server = createServer();
    try {
      server.start();

      server.registerActiveTurn("stuck-turn");
      expect(server.activeTurnCount).toBe(1);

      const start = Date.now();
      await server.drain(200);
      const elapsed = Date.now() - start;

      // Should wait close to the timeout duration
      expect(elapsed).toBeGreaterThanOrEqual(180);
      // Turn still active after timeout
      expect(server.activeTurnCount).toBe(1);
    } finally {
      await server.stop();
    }
  });

  test("turn completed after drain timeout does not cause errors", async () => {
    const server = createServer();
    try {
      server.start();

      server.registerActiveTurn("late-turn");
      await server.drain(100);

      // Completing turn after drain has resolved should not throw
      expect(() => server.completeTurn("late-turn")).not.toThrow();
      expect(server.activeTurnCount).toBe(0);
    } finally {
      await server.stop();
    }
  });

  test("multiple turns: drain waits for all, resolves when last completes", async () => {
    const server = createServer();
    try {
      server.start();

      server.registerActiveTurn("turn-a");
      server.registerActiveTurn("turn-b");
      server.registerActiveTurn("turn-c");
      expect(server.activeTurnCount).toBe(3);

      const drainPromise = server.drain(10000);

      // Complete turns one by one
      setTimeout(() => server.completeTurn("turn-a"), 30);
      setTimeout(() => server.completeTurn("turn-b"), 60);
      setTimeout(() => server.completeTurn("turn-c"), 90);

      const start = Date.now();
      await drainPromise;
      const elapsed = Date.now() - start;

      // Should resolve after last turn completes, not at timeout
      expect(elapsed).toBeLessThan(2000);
      expect(server.activeTurnCount).toBe(0);
    } finally {
      await server.stop();
    }
  });
});
