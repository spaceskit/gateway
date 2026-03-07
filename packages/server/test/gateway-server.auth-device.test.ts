import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { EventBus } from "@spaceskit/core";
import { GatewayServer } from "../src/gateway-server.js";

function randomPort(): number {
  return 26_000 + Math.floor(Math.random() * 4_000);
}

function nowIso(): string {
  return new Date().toISOString();
}

async function generateEd25519(): Promise<{
  privateKey: CryptoKey;
  publicKeyBase64: string;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" } as any,
    true,
    ["sign", "verify"],
  );

  const rawPublic = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  return {
    privateKey: keyPair.privateKey,
    publicKeyBase64: Buffer.from(rawPublic).toString("base64"),
  };
}

async function signBase64(challengeBase64: string, privateKey: CryptoKey): Promise<string> {
  const challengeBytes = Buffer.from(challengeBase64, "base64");
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" } as any,
    privateKey,
    challengeBytes,
  );
  return Buffer.from(signature).toString("base64");
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

async function waitForClose(ws: WebSocket): Promise<{ code?: number; reason?: string }> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket close timeout")), 2_000);
    ws.addEventListener("close", (event) => {
      clearTimeout(timer);
      resolve({
        code: event.code,
        reason: event.reason,
      });
    }, { once: true });
  });
}

function send(ws: WebSocket, type: string, payload: Record<string, unknown>): void {
  ws.send(JSON.stringify({
    type,
    id: randomUUID(),
    ts: nowIso(),
    payload,
  }));
}

describe("GatewayServer auth device strict mode", () => {
  test("rejects auth when device validator is configured but no device fields provided", async () => {
    const authKey = await generateEd25519();
    let validateCalls = 0;

    const server = new GatewayServer({
      port: randomPort(),
      host: "127.0.0.1",
      eventBus: new EventBus(),
      validateDeviceIdentity: () => {
        validateCalls += 1;
        return { allowed: true };
      },
      onMessage: async () => null,
    });

    try {
      server.start();
      const ws = await openWs(`ws://127.0.0.1:${server.port}`);
      const challengeMsg = await nextMessage(ws);
      expect(challengeMsg.type).toBe("auth_challenge");
      const challenge = challengeMsg.payload?.challenge as string;
      expect(typeof challenge).toBe("string");

      const principalSignature = await signBase64(challenge, authKey.privateKey);
      send(ws, "authenticate", {
        publicKey: authKey.publicKeyBase64,
        signature: principalSignature,
        clientType: "test-client",
        clientVersion: "1.0.0",
      });

      const result = await nextMessage(ws);
      expect(result.type).toBe("auth_result");
      expect(result.payload?.success).toBe(false);
      expect(String(result.payload?.reason ?? "")).toContain("device auth fields required");
      expect(validateCalls).toBe(0);
      ws.close();
    } finally {
      await server.stop();
    }
  });

  test("supersedes older authenticated session for same client identity", async () => {
    const authKey = await generateEd25519();
    const server = new GatewayServer({
      port: randomPort(),
      host: "127.0.0.1",
      eventBus: new EventBus(),
      onMessage: async () => null,
    });

    try {
      server.start();

      const ws1 = await openWs(`ws://127.0.0.1:${server.port}`);
      const challenge1 = await nextMessage(ws1);
      expect(challenge1.type).toBe("auth_challenge");
      const signature1 = await signBase64(challenge1.payload.challenge, authKey.privateKey);
      send(ws1, "authenticate", {
        publicKey: authKey.publicKeyBase64,
        signature: signature1,
        clientType: "test-client",
        clientVersion: "1.0.0",
      });
      const result1 = await nextMessage(ws1);
      expect(result1.type).toBe("auth_result");
      expect(result1.payload?.success).toBe(true);

      const ws1Closed = waitForClose(ws1);

      const ws2 = await openWs(`ws://127.0.0.1:${server.port}`);
      const challenge2 = await nextMessage(ws2);
      expect(challenge2.type).toBe("auth_challenge");
      const signature2 = await signBase64(challenge2.payload.challenge, authKey.privateKey);
      send(ws2, "authenticate", {
        publicKey: authKey.publicKeyBase64,
        signature: signature2,
        clientType: "test-client",
        clientVersion: "1.0.0",
      });

      const result2 = await nextMessage(ws2);
      expect(result2.type).toBe("auth_result");
      expect(result2.payload?.success).toBe(true);

      const closed = await ws1Closed;
      expect(closed.reason).toBe("Session superseded by newer connection");

      ws2.close();
    } finally {
      await server.stop();
    }
  });
});
