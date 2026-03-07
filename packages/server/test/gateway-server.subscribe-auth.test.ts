import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { EventBus } from "@spaceskit/core";
import { GatewayServer } from "../src/gateway-server.js";

function randomPort(): number {
  return 28_000 + Math.floor(Math.random() * 2_000);
}

function nowIso(): string {
  return new Date().toISOString();
}

async function openWs(url: string): Promise<WebSocket> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error("WebSocket open timeout"));
    }, 2_000);

    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(ws);
    }, { once: true });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("WebSocket open error"));
    }, { once: true });
  });
}

async function nextMessage(ws: WebSocket): Promise<any> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket message timeout")), 2_000);
    ws.addEventListener("message", (event) => {
      clearTimeout(timer);
      const raw = typeof event.data === "string"
        ? event.data
        : Buffer.from(event.data as ArrayBuffer).toString("utf-8");
      resolve(JSON.parse(raw));
    }, { once: true });
  });
}

function sendSubscribe(ws: WebSocket, payload: { spaceUids: string[] }): string {
  const id = randomUUID();
  ws.send(JSON.stringify({
    type: "subscribe",
    id,
    ts: nowIso(),
    payload,
  }));
  return id;
}

describe("GatewayServer subscribe authorization", () => {
  test("authorizes each requested space and returns subscribe ack", async () => {
    const server = new GatewayServer({
      port: randomPort(),
      host: "127.0.0.1",
      eventBus: new EventBus(),
      skipAuth: true,
      authorizeSubscribe: ({ spaceUid }) => {
        if (spaceUid === "space-private") {
          return { allowed: false, reason: "read access denied" };
        }
        return { allowed: true };
      },
    });

    try {
      server.start();
      const ws = await openWs(`ws://127.0.0.1:${server.port}`);
      const requestId = sendSubscribe(ws, {
        spaceUids: ["space-public", "space-private"],
      });

      const response = await nextMessage(ws);
      expect(response.type).toBe("subscribe");
      expect(response.replyTo).toBe(requestId);
      expect(response.payload?.subscribedSpaceUids).toEqual(["space-public"]);
      expect(response.payload?.denied).toEqual([
        { spaceUid: "space-private", reason: "read access denied" },
      ]);

      const sessions = (server as any).clients as Map<string, { subscribedSpaces: Set<string> }>;
      const session = Array.from(sessions.values())[0];
      expect(session.subscribedSpaces.has("space-public")).toBe(true);
      expect(session.subscribedSpaces.has("space-private")).toBe(false);

      ws.close();
    } finally {
      await server.stop();
    }
  });
});
