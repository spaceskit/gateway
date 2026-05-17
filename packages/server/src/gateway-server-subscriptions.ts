import type { ServerWebSocket } from "bun";
import type { Logger } from "@spaceskit/observability";
import {
  MessageTypes,
  type GatewayMessage,
  type SubscribeResponsePayload,
} from "./protocol.js";
import {
  buildSubscribeResponseMessage,
  normalizeSubscribePayload,
} from "./subscription-protocol.js";
import {
  buildNotificationSubscriptionResponseMessage,
  normalizeNotificationCategories,
} from "./notification-subscription-protocol.js";
import type {
  ClientSession,
  GatewayServerOptions,
  SubscribeAuthorizationResult,
  WSData,
} from "./gateway-server.js";

type SendError = (
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

export async function handleGatewaySubscribe(input: {
  session: ClientSession;
  ws: ServerWebSocket<WSData>;
  msg: GatewayMessage;
  options: Pick<GatewayServerOptions, "authorizeSubscribe" | "onSpaceSubscribed" | "resolveSpaceId">;
  logger: Logger | null;
  send: (clientId: string, msg: GatewayMessage) => void;
  sendError: SendError;
}): Promise<void> {
  const normalizedSubscribe = normalizeSubscribePayload(input.msg.payload);
  if (!normalizedSubscribe.ok) {
    input.sendError(input.ws, "INVALID_ARGUMENT", normalizedSubscribe.message, {
      replyTo: input.msg.id,
      correlationId: input.msg.id,
    });
    return;
  }

  const requestedSpaceUids = normalizedSubscribe.spaceUids;
  const subscribedSpaceUids: string[] = [];
  const denied: SubscribeResponsePayload["denied"] = [];

  for (const spaceUid of requestedSpaceUids) {
    const resolvedSpaceId = await resolveSubscribedSpaceId({
      session: input.session,
      spaceUid,
      resolveSpaceId: input.options.resolveSpaceId,
      logger: input.logger,
    });
    const decision = await authorizeSubscription({
      session: input.session,
      spaceUid,
      spaceId: resolvedSpaceId,
      authorizeSubscribe: input.options.authorizeSubscribe,
      logger: input.logger,
    });

    if (!decision.allowed) {
      denied.push({
        spaceUid,
        reason: decision.reason?.trim() || "Access denied for subscription",
      });
      continue;
    }

    input.session.subscribedSpaces.add(spaceUid);
    input.ws.subscribe(`space:${spaceUid}`);
    subscribedSpaceUids.push(spaceUid);

    if (resolvedSpaceId && input.options.onSpaceSubscribed) {
      try {
        input.options.onSpaceSubscribed(resolvedSpaceId);
      } catch {
        // Pre-warming is best-effort.
      }
    }
  }

  input.logger?.info("Client subscribe request handled", {
    sessionId: input.session.id,
    requestedSpaceUids,
    subscribedSpaceUids,
    deniedCount: denied.length,
  });

  input.send(input.session.id, buildSubscribeResponseMessage({
    replyTo: input.msg.id,
    subscribedSpaceUids,
    denied,
  }));
}

export async function handleGatewayNotificationSubscription(input: {
  session: ClientSession;
  ws: ServerWebSocket<WSData>;
  msg: GatewayMessage;
  notificationHandler: GatewayServerOptions["notificationHandler"];
  send: (clientId: string, msg: GatewayMessage) => void;
  sendError: SendError;
}): Promise<void> {
  const { msg, notificationHandler, sendError, session, ws } = input;
  if (msg.type === MessageTypes.SUBSCRIBE_NOTIFICATIONS) {
    if (!notificationHandler || typeof notificationHandler.subscribeClient !== "function") {
      sendNotificationHandlerUnavailable(sendError, ws, msg.id);
      return;
    }
    const subscribed = await notificationHandler.subscribeClient(
      session.id,
      normalizeNotificationCategories(msg.payload),
    );
    input.send(session.id, buildNotificationSubscriptionResponseMessage({
      type: MessageTypes.SUBSCRIBE_NOTIFICATIONS,
      replyTo: msg.id,
      categories: subscribed,
    }));
    return;
  }

  if (!notificationHandler || typeof notificationHandler.unsubscribeClient !== "function") {
    sendNotificationHandlerUnavailable(sendError, ws, msg.id);
    return;
  }
  const unsubscribed = await notificationHandler.unsubscribeClient(
    session.id,
    normalizeNotificationCategories(msg.payload),
  );
  input.send(session.id, buildNotificationSubscriptionResponseMessage({
    type: MessageTypes.UNSUBSCRIBE_NOTIFICATIONS,
    replyTo: msg.id,
    categories: unsubscribed,
  }));
}

async function resolveSubscribedSpaceId(input: {
  session: ClientSession;
  spaceUid: string;
  resolveSpaceId: GatewayServerOptions["resolveSpaceId"];
  logger: Logger | null;
}): Promise<string | undefined> {
  if (!input.resolveSpaceId) {
    return undefined;
  }
  try {
    const candidate = await input.resolveSpaceId(input.spaceUid);
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  } catch (error) {
    input.logger?.warn("Space ID resolution hook failed", {
      sessionId: input.session.id,
      spaceUid: input.spaceUid,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return undefined;
}

async function authorizeSubscription(input: {
  session: ClientSession;
  spaceUid: string;
  spaceId?: string;
  authorizeSubscribe: GatewayServerOptions["authorizeSubscribe"];
  logger: Logger | null;
}): Promise<SubscribeAuthorizationResult> {
  if (!input.authorizeSubscribe) {
    return { allowed: true };
  }
  try {
    return await input.authorizeSubscribe({
      client: input.session,
      spaceUid: input.spaceUid,
      spaceId: input.spaceId,
    });
  } catch (error) {
    input.logger?.warn("Subscription authorization hook failed", {
      sessionId: input.session.id,
      spaceUid: input.spaceUid,
      spaceId: input.spaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { allowed: false, reason: "Subscription authorization failed" };
  }
}

function sendNotificationHandlerUnavailable(
  sendError: SendError,
  ws: ServerWebSocket<WSData>,
  replyTo: string,
): void {
  sendError(ws, "NOT_AVAILABLE", "Notification subscriptions are not configured", {
    replyTo,
    correlationId: replyTo,
  });
}
