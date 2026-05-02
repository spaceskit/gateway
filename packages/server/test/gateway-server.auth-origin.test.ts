import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { EventBus } from "@spaceskit/core";
import { GatewayServer } from "../src/gateway-server.js";

function randomPort(): number {
  return 29_000 + Math.floor(Math.random() * 4_000);
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

function send(ws: WebSocket, type: string, payload: Record<string, unknown>): void {
  ws.send(JSON.stringify({
    type,
    id: randomUUID(),
    ts: nowIso(),
    payload,
  }));
}

describe("GatewayServer auth origin policy", () => {
  test("loopback origin without device fields succeeds when no device validator is configured", async () => {
    const authKey = await generateEd25519();
    const server = new GatewayServer({
      port: randomPort(),
      host: "127.0.0.1",
      eventBus: new EventBus(),
      onMessage: async () => null,
    });

    try {
      server.start();
      const ws = await openWs(`ws://127.0.0.1:${server.port}`);
      const challengeMsg = await nextMessage(ws);
      expect(challengeMsg.type).toBe("auth_challenge");

      const principalSignature = await signBase64(challengeMsg.payload.challenge, authKey.privateKey);
      send(ws, "authenticate", {
        publicKey: authKey.publicKeyBase64,
        signature: principalSignature,
        clientType: "test-client",
        clientVersion: "1.0.0",
      });

      const result = await nextMessage(ws);
      expect(result.type).toBe("auth_result");
      expect(result.payload?.success).toBe(true);
      ws.close();
    } finally {
      await server.stop();
    }
  });

  test("remote origin without device fields is rejected with explicit-device-required reason", async () => {
    const authKey = await generateEd25519();
    let validateCalls = 0;
    const server = new GatewayServer({
      port: randomPort(),
      host: "127.0.0.1",
      eventBus: new EventBus(),
      // Simulate a remote (non-loopback) origin via Tailscale
      resolveClientIp: () => "100.101.102.103",
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

      const principalSignature = await signBase64(challengeMsg.payload.challenge, authKey.privateKey);
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

  test("remote origin with partial device fields is rejected with required-together reason", async () => {
    const authKey = await generateEd25519();
    const server = new GatewayServer({
      port: randomPort(),
      host: "127.0.0.1",
      eventBus: new EventBus(),
      resolveClientIp: () => "100.101.102.103",
      onMessage: async () => null,
    });

    try {
      server.start();
      const ws = await openWs(`ws://127.0.0.1:${server.port}`);
      const challengeMsg = await nextMessage(ws);
      expect(challengeMsg.type).toBe("auth_challenge");

      const principalSignature = await signBase64(challengeMsg.payload.challenge, authKey.privateKey);
      send(ws, "authenticate", {
        publicKey: authKey.publicKeyBase64,
        signature: principalSignature,
        clientType: "test-client",
        clientVersion: "1.0.0",
        deviceId: "iphone-1",
        // missing devicePublicKey + deviceProofSignature
      });

      const result = await nextMessage(ws);
      expect(result.type).toBe("auth_result");
      expect(result.payload?.success).toBe(false);
      expect(String(result.payload?.reason ?? "")).toContain("required together");
      ws.close();
    } finally {
      await server.stop();
    }
  });

  test("remote origin with full device proof passes through validateDeviceIdentity hook", async () => {
    const authKey = await generateEd25519();
    const deviceKey = await generateEd25519();
    let validateCalls = 0;
    const server = new GatewayServer({
      port: randomPort(),
      host: "127.0.0.1",
      eventBus: new EventBus(),
      resolveClientIp: () => "100.101.102.103",
      validateDeviceIdentity: ({ deviceId, devicePublicKey }) => {
        validateCalls += 1;
        expect(deviceId).toBe("iphone-1");
        expect(devicePublicKey).toBe(deviceKey.publicKeyBase64);
        return { allowed: true };
      },
      onMessage: async () => null,
    });

    try {
      server.start();
      const ws = await openWs(`ws://127.0.0.1:${server.port}`);
      const challengeMsg = await nextMessage(ws);
      expect(challengeMsg.type).toBe("auth_challenge");
      const challenge = challengeMsg.payload.challenge as string;

      const principalSignature = await signBase64(challenge, authKey.privateKey);
      const deviceProof = await signBase64(challenge, deviceKey.privateKey);
      send(ws, "authenticate", {
        publicKey: authKey.publicKeyBase64,
        signature: principalSignature,
        clientType: "test-client",
        clientVersion: "1.0.0",
        deviceId: "iphone-1",
        devicePublicKey: deviceKey.publicKeyBase64,
        deviceProofSignature: deviceProof,
      });

      const result = await nextMessage(ws);
      expect(result.type).toBe("auth_result");
      expect(result.payload?.success).toBe(true);
      expect(validateCalls).toBe(1);
      ws.close();
    } finally {
      await server.stop();
    }
  });

  test("remote origin with full device proof but no validator still authenticates", async () => {
    const authKey = await generateEd25519();
    const deviceKey = await generateEd25519();
    const server = new GatewayServer({
      port: randomPort(),
      host: "127.0.0.1",
      eventBus: new EventBus(),
      resolveClientIp: () => "100.101.102.103",
      onMessage: async () => null,
    });

    try {
      server.start();
      const ws = await openWs(`ws://127.0.0.1:${server.port}`);
      const challengeMsg = await nextMessage(ws);
      const challenge = challengeMsg.payload.challenge as string;

      const principalSignature = await signBase64(challenge, authKey.privateKey);
      const deviceProof = await signBase64(challenge, deviceKey.privateKey);
      send(ws, "authenticate", {
        publicKey: authKey.publicKeyBase64,
        signature: principalSignature,
        clientType: "test-client",
        clientVersion: "1.0.0",
        deviceId: "iphone-1",
        devicePublicKey: deviceKey.publicKeyBase64,
        deviceProofSignature: deviceProof,
      });

      const result = await nextMessage(ws);
      expect(result.type).toBe("auth_result");
      expect(result.payload?.success).toBe(true);
      ws.close();
    } finally {
      await server.stop();
    }
  });
});
