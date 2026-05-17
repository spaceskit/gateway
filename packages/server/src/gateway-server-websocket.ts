import type { ServerWebSocket } from "bun";
import { randomBytes, randomUUID } from "node:crypto";
import type { Logger } from "@spaceskit/observability";
import {
  MessageTypes,
  type GatewayMessage,
} from "./protocol.js";
import type { ClientSession, GatewayServerOptions, WSData } from "./gateway-server.js";

export type GatewayServerSendError = (
  ws: ServerWebSocket<WSData>,
  code: string,
  message: string,
  options?: {
    details?: unknown;
    correlationId?: string;
    replyTo?: string;
    retryable?: boolean;
  },
) => void;

export interface GatewayWebSocketLifecycleContext {
  options: GatewayServerOptions;
  logger: Logger | null;
  clients: Map<string, ClientSession>;
  sockets: Map<string, ServerWebSocket<WSData>>;
  connectionsPerIp: Map<string, number>;
  send: (clientId: string, msg: GatewayMessage) => void;
  sendError: GatewayServerSendError;
  handleMessage: (
    session: ClientSession,
    ws: ServerWebSocket<WSData>,
    msg: GatewayMessage,
  ) => Promise<void>;
}

export function openGatewayServerWebSocket(
  ws: ServerWebSocket<WSData>,
  context: GatewayWebSocketLifecycleContext,
): void {
  const data = ws.data as WSData;
  const currentCount = context.connectionsPerIp.get(data.clientIp) ?? 0;
  context.connectionsPerIp.set(data.clientIp, currentCount + 1);

  const challenge = randomBytes(32).toString("base64");
  const session: ClientSession = {
    id: data.sessionId,
    authenticated: context.options.skipAuth === true,
    subscribedSpaces: new Set(),
    connectedAt: new Date(),
    pendingChallenge: context.options.skipAuth ? undefined : challenge,
  };
  context.clients.set(session.id, session);
  context.sockets.set(session.id, ws);

  context.logger?.info("Client connected", {
    sessionId: session.id,
    clients: context.clients.size,
  });

  context.options.notificationHandler?.registerClient(session.id, ws);

  if (!context.options.skipAuth) {
    context.send(session.id, {
      type: MessageTypes.AUTH_CHALLENGE,
      id: randomUUID(),
      ts: new Date().toISOString(),
      payload: { challenge },
    });

    const timeoutMs = context.options.authTimeoutMs ?? 30_000;
    session.authTimeout = setTimeout(() => {
      if (!session.authenticated) {
        context.logger?.warn("Authentication timeout", {
          sessionId: session.id,
          timeoutMs,
        });
        context.sendError(ws, "UNAUTHENTICATED", "Authentication timeout - closing connection", {
          correlationId: randomUUID(),
        });
        ws.close(4001, "Authentication timeout");
      }
    }, timeoutMs);
  }
}

export async function handleGatewayServerWebSocketMessage(
  ws: ServerWebSocket<WSData>,
  message: string | Uint8Array | ArrayBuffer,
  context: GatewayWebSocketLifecycleContext,
): Promise<void> {
  const data = ws.data as WSData;
  const session = context.clients.get(data.sessionId);
  if (!session) return;

  try {
    const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
    const msg = JSON.parse(raw) as GatewayMessage;

    context.logger?.debug("Message received", {
      sessionId: session.id,
      type: msg.type,
      msgId: msg.id,
      authenticated: session.authenticated,
      bytes: raw.length,
    });

    await context.handleMessage(session, ws, msg);
  } catch (err) {
    context.logger?.warn("Failed to parse message", {
      sessionId: session.id,
      error: err instanceof Error ? err.message : String(err),
    });
    context.sendError(ws, "INVALID_ARGUMENT", "Invalid message format", {
      details: err,
      correlationId: randomUUID(),
    });
  }
}

export function closeGatewayServerWebSocket(
  ws: ServerWebSocket<WSData>,
  context: GatewayWebSocketLifecycleContext,
): void {
  const data = ws.data as WSData;
  const remaining = (context.connectionsPerIp.get(data.clientIp) ?? 1) - 1;
  if (remaining <= 0) {
    context.connectionsPerIp.delete(data.clientIp);
  } else {
    context.connectionsPerIp.set(data.clientIp, remaining);
  }

  const session = context.clients.get(data.sessionId);
  if (session) {
    const durationMs = Date.now() - session.connectedAt.getTime();
    context.logger?.info("Client disconnected", {
      sessionId: session.id,
      clientType: session.clientType,
      authenticated: session.authenticated,
      subscribedSpaces: Array.from(session.subscribedSpaces),
      durationMs,
      clients: context.clients.size - 1,
    });

    context.options.onClientClose?.(session);
    if (session.authTimeout) {
      clearTimeout(session.authTimeout);
    }
    for (const spaceUid of session.subscribedSpaces) {
      ws.unsubscribe(`space:${spaceUid}`);
    }
  }

  context.options.notificationHandler?.unregisterClient(data.sessionId);
  context.clients.delete(data.sessionId);
  context.sockets.delete(data.sessionId);
}
