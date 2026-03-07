import { describe, expect, test } from "bun:test";
import { EventBus } from "@spaceskit/core";
import { GatewayServer } from "../src/gateway-server.js";

function randomPort(): number {
  return 34_000 + Math.floor(Math.random() * 4_000);
}

/** Open a WebSocket connection to the given server and wait for it to be ready. */
function connectWs(port: number): Promise<WebSocket> {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", (e) => reject(e));
  });
}

describe("GatewayServer per-IP connection cap", () => {
  test("allows connections up to the cap", async () => {
    const port = randomPort();
    const server = new GatewayServer({
      port,
      host: "127.0.0.1",
      skipAuth: true,
      eventBus: new EventBus(),
      onMessage: async () => null,
      maxConnectionsPerIp: 3,
    });

    const sockets: WebSocket[] = [];
    try {
      server.start();

      // Open 3 connections — all should succeed
      for (let i = 0; i < 3; i++) {
        sockets.push(await connectWs(port));
      }

      expect(sockets.length).toBe(3);
      expect(sockets.every((s) => s.readyState === WebSocket.OPEN)).toBe(true);
    } finally {
      for (const ws of sockets) ws.close();
      await server.stop();
    }
  });

  test("rejects connections that exceed the cap with 429", async () => {
    const port = randomPort();
    const server = new GatewayServer({
      port,
      host: "127.0.0.1",
      skipAuth: true,
      eventBus: new EventBus(),
      onMessage: async () => null,
      maxConnectionsPerIp: 2,
    });

    const sockets: WebSocket[] = [];
    try {
      server.start();

      // Fill the cap
      sockets.push(await connectWs(port));
      sockets.push(await connectWs(port));

      // The 3rd connection should be rejected — Bun's WebSocket constructor
      // will receive a non-101 response, which surfaces as an error/close.
      // We verify by doing a raw HTTP upgrade request and checking the status.
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        headers: {
          "Upgrade": "websocket",
          "Connection": "Upgrade",
          "Sec-WebSocket-Key": btoa(crypto.randomUUID()),
          "Sec-WebSocket-Version": "13",
        },
      });
      expect(res.status).toBe(429);
      const body = await res.text();
      expect(body).toContain("Too many connections");
    } finally {
      for (const ws of sockets) ws.close();
      await server.stop();
    }
  });

  test("allows new connection after one closes (slot freed)", async () => {
    const port = randomPort();
    const server = new GatewayServer({
      port,
      host: "127.0.0.1",
      skipAuth: true,
      eventBus: new EventBus(),
      onMessage: async () => null,
      maxConnectionsPerIp: 2,
    });

    const sockets: WebSocket[] = [];
    try {
      server.start();

      // Fill the cap
      const ws1 = await connectWs(port);
      sockets.push(ws1);
      sockets.push(await connectWs(port));

      // Close one connection and wait for the server to process it
      const closed = new Promise<void>((resolve) => {
        ws1.addEventListener("close", () => resolve());
      });
      ws1.close();
      await closed;

      // Small delay to ensure the server-side close handler has run
      await new Promise((r) => setTimeout(r, 50));

      // Now a new connection should succeed
      const ws3 = await connectWs(port);
      sockets.push(ws3);
      expect(ws3.readyState).toBe(WebSocket.OPEN);
    } finally {
      for (const ws of sockets) ws.close();
      await server.stop();
    }
  });

  test("defaults to cap of 10 when maxConnectionsPerIp is not set", async () => {
    const port = randomPort();
    const server = new GatewayServer({
      port,
      host: "127.0.0.1",
      skipAuth: true,
      eventBus: new EventBus(),
      onMessage: async () => null,
      // maxConnectionsPerIp intentionally omitted — should default to 10
    });

    const sockets: WebSocket[] = [];
    try {
      server.start();

      // Open 10 connections — all should succeed
      for (let i = 0; i < 10; i++) {
        sockets.push(await connectWs(port));
      }

      expect(sockets.length).toBe(10);

      // The 11th should be rejected
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        headers: {
          "Upgrade": "websocket",
          "Connection": "Upgrade",
          "Sec-WebSocket-Key": btoa(crypto.randomUUID()),
          "Sec-WebSocket-Version": "13",
        },
      });
      expect(res.status).toBe(429);
    } finally {
      for (const ws of sockets) ws.close();
      await server.stop();
    }
  });
});
