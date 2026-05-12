import type { ServerWebSocket } from "bun";
import { randomUUID } from "node:crypto";
import type { EventBus } from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import { isLoopbackHost } from "@spaceskit/policy";
import {
  MessageTypes,
  type AuthenticatePayload,
  type ErrorPayload,
  type GatewayMessage,
} from "./protocol.js";
import { buildGatewayErrorPayload } from "./error-contract.js";
import type { ClientSession, WSData } from "./gateway-server.js";

export type GatewayDeviceIdentityValidator = (input: {
  principalId: string;
  deviceId: string;
  devicePublicKey: string;
  platform?: string;
}) => { allowed: boolean; reason?: string };

interface GatewayAuthenticateContext {
  session: ClientSession;
  ws: ServerWebSocket<WSData>;
  msg: GatewayMessage;
  clients: Map<string, ClientSession>;
  sockets: Map<string, ServerWebSocket<WSData>>;
  send: (clientId: string, msg: GatewayMessage) => void;
  eventBus: EventBus;
  validateDeviceIdentity?: GatewayDeviceIdentityValidator;
  logger?: Logger | null;
}

export async function handleGatewayAuthenticate(
  context: GatewayAuthenticateContext,
): Promise<void> {
  const {
    session,
    ws,
    msg,
    clients,
    sockets,
    send,
    eventBus,
    validateDeviceIdentity,
    logger,
  } = context;

  if (session.authenticated) {
    send(session.id, authResultMessage(msg.id, { success: true, reason: "Already authenticated" }));
    return;
  }

  const payload = msg.payload as AuthenticatePayload;

  if (!payload.publicKey || !payload.signature || !session.pendingChallenge) {
    send(session.id, authResultMessage(msg.id, {
      success: false,
      reason: "Missing publicKey, signature, or no pending challenge",
    }));
    return;
  }

  try {
    const challengeBytes = Buffer.from(session.pendingChallenge, "base64");
    const signatureBytes = Buffer.from(payload.signature, "base64");
    const publicKeyBytes = Buffer.from(payload.publicKey, "base64");
    const deviceId = payload.deviceId?.trim() || undefined;
    const devicePublicKey = payload.devicePublicKey?.trim() || undefined;
    const deviceProofSignature = payload.deviceProofSignature?.trim() || undefined;
    const hasAnyDeviceAuth = Boolean(deviceId || devicePublicKey || deviceProofSignature);
    const wsClientIp = ws.data.clientIp;
    const originIsRemote = !isLoopbackHost(wsClientIp);
    const requiresDeviceValidation = originIsRemote
      || typeof validateDeviceIdentity === "function";
    const effectiveDeviceId = deviceId;
    const effectiveDevicePublicKey = devicePublicKey;
    const effectiveDeviceProofSignature = deviceProofSignature;

    const isValid = await verifyEd25519(challengeBytes, signatureBytes, publicKeyBytes);

    if (!isValid) {
      logger?.warn("Authentication failed: invalid signature", {
        sessionId: session.id,
        clientType: payload.clientType,
      });

      send(session.id, authResultMessage(msg.id, {
        success: false,
        reason: "Invalid signature",
      }));
      return;
    }

    if (hasAnyDeviceAuth && (!deviceId || !devicePublicKey || !deviceProofSignature)) {
      send(session.id, authResultMessage(msg.id, {
        success: false,
        reason: "deviceId, devicePublicKey, and deviceProofSignature are required together",
      }));
      return;
    }

    if (requiresDeviceValidation && !hasAnyDeviceAuth) {
      send(session.id, authResultMessage(msg.id, {
        success: false,
        reason: "Explicit device auth fields required",
      }));
      return;
    }

    if (effectiveDeviceId && effectiveDevicePublicKey && effectiveDeviceProofSignature) {
      const deviceProofBytes = Buffer.from(effectiveDeviceProofSignature, "base64");
      const devicePublicKeyBytes = Buffer.from(effectiveDevicePublicKey, "base64");
      const deviceProofValid = await verifyEd25519(
        challengeBytes,
        deviceProofBytes,
        devicePublicKeyBytes,
      );

      if (!deviceProofValid) {
        logger?.warn("Authentication failed: invalid device proof signature", {
          sessionId: session.id,
          clientType: payload.clientType,
          deviceId: effectiveDeviceId,
        });

        send(session.id, authResultMessage(msg.id, {
          success: false,
          reason: "Invalid device proof signature",
        }));
        return;
      }

      if (validateDeviceIdentity) {
        const validation = validateDeviceIdentity({
          principalId: payload.publicKey,
          deviceId: effectiveDeviceId,
          devicePublicKey: effectiveDevicePublicKey,
          platform: payload.clientType,
        });
        if (!validation.allowed) {
          logger?.warn("Authentication failed: device validation denied", {
            sessionId: session.id,
            clientType: payload.clientType,
            deviceId: effectiveDeviceId,
            reason: validation.reason,
          });
          send(session.id, authResultMessage(msg.id, {
            success: false,
            reason: validation.reason ?? "Device validation failed",
          }));
          return;
        }
      }
    } else if (requiresDeviceValidation) {
      send(session.id, authResultMessage(msg.id, {
        success: false,
        reason: "Device identity is required for authentication",
      }));
      return;
    }

    const identityKey = buildClientIdentityKey(payload.publicKey, effectiveDeviceId);
    const superseded = supersedeDuplicateSessions({
      identityKey,
      keepSessionId: session.id,
      clients,
      sockets,
      send,
    });
    if (superseded > 0) {
      logger?.warn("Superseded duplicate authenticated sessions", {
        sessionId: session.id,
        clientType: payload.clientType,
        publicKey: payload.publicKey.slice(0, 12) + "...",
        deviceId: effectiveDeviceId,
        superseded,
      });
    }

    session.authenticated = true;
    session.publicKey = payload.publicKey;
    session.clientType = payload.clientType;
    session.deviceId = effectiveDeviceId;
    session.devicePublicKey = effectiveDevicePublicKey;
    session.pendingChallenge = undefined;

    if (session.authTimeout) {
      clearTimeout(session.authTimeout);
      session.authTimeout = undefined;
    }

    const authDurationMs = Date.now() - session.connectedAt.getTime();
    logger?.info("Client authenticated", {
      sessionId: session.id,
      clientType: payload.clientType,
      publicKey: payload.publicKey.slice(0, 12) + "...",
      deviceId: session.deviceId,
      authDurationMs,
    });

    eventBus.emit({
      type: "client.authenticated",
      sessionId: session.id,
      clientType: payload.clientType,
      publicKey: payload.publicKey,
      timestamp: new Date(),
    });

    send(session.id, authResultMessage(msg.id, { success: true }));
  } catch (err) {
    send(session.id, authResultMessage(msg.id, {
      success: false,
      reason: `Authentication error: ${err instanceof Error ? err.message : String(err)}`,
    }));
  }
}

async function verifyEd25519(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  try {
    const keyBuf = new Uint8Array(publicKey).buffer as ArrayBuffer;
    const sigBuf = new Uint8Array(signature).buffer as ArrayBuffer;
    const msgBuf = new Uint8Array(message).buffer as ArrayBuffer;

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBuf,
      { name: "Ed25519" },
      false,
      ["verify"],
    );

    return await crypto.subtle.verify(
      "Ed25519",
      cryptoKey,
      sigBuf,
      msgBuf,
    );
  } catch {
    return false;
  }
}

function authResultMessage(
  replyTo: string | undefined,
  payload: { success: boolean; reason?: string },
): GatewayMessage {
  return {
    type: MessageTypes.AUTH_RESULT,
    id: randomUUID(),
    replyTo,
    ts: new Date().toISOString(),
    payload,
  };
}

function buildClientIdentityKey(publicKeyRaw: string, deviceIdRaw?: string): string | null {
  const principalId = publicKeyRaw.trim();
  if (!principalId) return null;
  const deviceId = deviceIdRaw?.trim();
  if (deviceId) {
    return `principal:${principalId}|device:${deviceId}`;
  }
  return `principal:${principalId}`;
}

function sessionIdentityKey(session: ClientSession): string | null {
  if (!session.authenticated || !session.publicKey) {
    return null;
  }
  return buildClientIdentityKey(session.publicKey, session.deviceId);
}

function supersedeDuplicateSessions(input: {
  identityKey: string | null;
  keepSessionId: string;
  clients: Map<string, ClientSession>;
  sockets: Map<string, ServerWebSocket<WSData>>;
  send: (clientId: string, msg: GatewayMessage) => void;
}): number {
  const { identityKey, keepSessionId, clients, sockets, send } = input;
  if (!identityKey) return 0;

  let superseded = 0;
  for (const [sessionId, existingSession] of clients) {
    if (sessionId === keepSessionId) continue;
    if (sessionIdentityKey(existingSession) !== identityKey) continue;

    const ws = sockets.get(sessionId);
    if (!ws) continue;

    const correlationId = randomUUID();
    const payload: ErrorPayload = buildGatewayErrorPayload(
      "SESSION_SUPERSEDED",
      "Session superseded by newer connection",
      correlationId,
      undefined,
      false,
    );
    send(sessionId, {
      type: MessageTypes.ERROR,
      id: randomUUID(),
      ts: new Date().toISOString(),
      payload,
    });

    setTimeout(() => {
      ws.close(4004, "Session superseded by newer connection");
    }, 0);
    superseded += 1;
  }

  return superseded;
}
