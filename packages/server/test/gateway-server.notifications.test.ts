import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { EventBus } from "@spaceskit/core";
import { GatewayServer } from "../src/gateway-server.js";
import { MessageTypes } from "../src/protocol.js";

function randomPort(): number {
  return 30_000 + Math.floor(Math.random() * 2_000);
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

describe("GatewayServer notification subscription routing", () => {
  test("routes subscribe and unsubscribe notification messages to the handler", async () => {
    const subscribed: Array<{ clientId: string; categories: string[] }> = [];
    const unsubscribed: Array<{ clientId: string; categories: string[] }> = [];

    const server = new GatewayServer({
      port: randomPort(),
      host: "127.0.0.1",
      eventBus: new EventBus(),
      skipAuth: true,
      notificationHandler: {
        registerClient: async () => {},
        unregisterClient: async () => {},
        subscribeClient: async (clientId: string, categories: string[]) => {
          subscribed.push({ clientId, categories });
          return categories;
        },
        unsubscribeClient: async (clientId: string, categories: string[]) => {
          unsubscribed.push({ clientId, categories });
          return categories;
        },
      } as any,
    });

    try {
      server.start();
      const ws = await openWs(`ws://127.0.0.1:${server.port}`);

      const subscribeId = randomUUID();
      ws.send(JSON.stringify({
        type: MessageTypes.SUBSCRIBE_NOTIFICATIONS,
        id: subscribeId,
        ts: nowIso(),
        payload: {
          categories: ["feedback.requested", "*"],
        },
      }));

      const subscribeResponse = await nextMessage(ws);
      expect(subscribeResponse.type).toBe(MessageTypes.SUBSCRIBE_NOTIFICATIONS);
      expect(subscribeResponse.replyTo).toBe(subscribeId);
      expect(subscribeResponse.payload.categories).toEqual(["feedback.requested", "*"]);
      expect(subscribed).toHaveLength(1);
      expect(subscribed[0]?.categories).toEqual(["feedback.requested", "*"]);

      const unsubscribeId = randomUUID();
      ws.send(JSON.stringify({
        type: MessageTypes.UNSUBSCRIBE_NOTIFICATIONS,
        id: unsubscribeId,
        ts: nowIso(),
        payload: {
          categories: ["*"],
        },
      }));

      const unsubscribeResponse = await nextMessage(ws);
      expect(unsubscribeResponse.type).toBe(MessageTypes.UNSUBSCRIBE_NOTIFICATIONS);
      expect(unsubscribeResponse.replyTo).toBe(unsubscribeId);
      expect(unsubscribeResponse.payload.categories).toEqual(["*"]);
      expect(unsubscribed).toHaveLength(1);
      expect(unsubscribed[0]?.categories).toEqual(["*"]);

      ws.close();
    } finally {
      await server.stop();
    }
  });

  test("sendToIdentity prefers the exact device and falls back to principal-wide delivery", () => {
    const server = new GatewayServer({
      port: 0,
      host: "127.0.0.1",
      eventBus: new EventBus(),
      skipAuth: true,
    });

    const sentTo: string[] = [];
    server.send = ((clientId: string) => {
      sentTo.push(clientId);
    }) as GatewayServer["send"];

    (server as any).clients = new Map([
      ["session-1", { authenticated: true, publicKey: "principal-1", deviceId: "device-a" }],
      ["session-2", { authenticated: true, publicKey: "principal-1", deviceId: "device-b" }],
      ["session-3", { authenticated: true, publicKey: "principal-2", deviceId: "device-a" }],
    ]);

    const exactDelivered = server.sendToIdentity("principal-1", "device-a", {
      type: MessageTypes.APP_NAVIGATE,
      id: "msg-1",
      ts: nowIso(),
      payload: { destination: "overview" },
    });
    expect(exactDelivered).toBe(1);
    expect(sentTo).toEqual(["session-1"]);

    sentTo.length = 0;

    const fallbackDelivered = server.sendToIdentity("principal-1", "device-missing", {
      type: MessageTypes.APP_NAVIGATE,
      id: "msg-2",
      ts: nowIso(),
      payload: { destination: "overview" },
    });
    expect(fallbackDelivered).toBe(2);
    expect(sentTo.sort()).toEqual(["session-1", "session-2"]);
  });

  test("sendToIdentity delivers app.concierge_action_request notifications", () => {
    const server = new GatewayServer({
      port: 0,
      host: "127.0.0.1",
      eventBus: new EventBus(),
      skipAuth: true,
    });

    const sentMessages: any[] = [];
    server.send = ((clientId: string, msg: any) => {
      sentMessages.push({ clientId, msg });
    }) as GatewayServer["send"];

    (server as any).clients = new Map([
      ["session-1", { authenticated: true, publicKey: "principal-1", deviceId: "device-a" }],
      ["session-2", { authenticated: true, publicKey: "principal-2", deviceId: "device-b" }],
    ]);

    const delivered = server.sendToIdentity("principal-1", "device-a", {
      type: MessageTypes.APP_CONCIERGE_ACTION_REQUEST,
      id: "msg-action-1",
      ts: nowIso(),
      payload: {
        requestId: "request-1",
        action: "open_workspace",
        gatewayId: "gateway-1",
      },
    });

    expect(delivered).toBe(1);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.clientId).toBe("session-1");
    expect(sentMessages[0]?.msg.type).toBe(MessageTypes.APP_CONCIERGE_ACTION_REQUEST);
    expect(sentMessages[0]?.msg.payload.requestId).toBe("request-1");
  });
});
