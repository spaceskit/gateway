import type { ServerWebSocket } from "bun";
import { randomUUID } from "node:crypto";
import type { Logger } from "@spaceskit/observability";
import {
  MessageTypes,
  type GatewayMessage,
} from "./protocol.js";
import { handleGatewayAuthenticate } from "./gateway-authentication.js";
import {
  handleGatewayNotificationSubscription,
  handleGatewaySubscribe,
} from "./gateway-server-subscriptions.js";
import type { ClientSession, GatewayServerOptions, WSData } from "./gateway-server.js";
import type { GatewayServerSendError } from "./gateway-server-websocket.js";

export async function handleGatewayServerMessage(input: {
  session: ClientSession;
  ws: ServerWebSocket<WSData>;
  msg: GatewayMessage;
  options: GatewayServerOptions;
  logger: Logger | null;
  clients: Map<string, ClientSession>;
  sockets: Map<string, ServerWebSocket<WSData>>;
  isDraining: boolean;
  send: (clientId: string, msg: GatewayMessage) => void;
  sendError: GatewayServerSendError;
}): Promise<void> {
  const { session, ws, msg, options, logger, send, sendError } = input;

  if (msg.type === MessageTypes.PING) {
    send(session.id, {
      type: MessageTypes.PONG,
      id: randomUUID(),
      replyTo: msg.id,
      ts: new Date().toISOString(),
      payload: {},
    });
    return;
  }

  if (msg.type === MessageTypes.AUTHENTICATE) {
    await handleGatewayAuthenticate({
      session,
      ws,
      msg,
      clients: input.clients,
      sockets: input.sockets,
      send,
      eventBus: options.eventBus,
      validateDeviceIdentity: options.validateDeviceIdentity,
      logger,
    });
    return;
  }

  if (!session.authenticated) {
    logger?.warn("Unauthenticated message rejected", {
      sessionId: session.id,
      type: msg.type,
    });
    sendError(ws, "UNAUTHENTICATED", "Authentication required before sending messages", {
      replyTo: msg.id,
      correlationId: msg.id,
    });
    return;
  }

  if (msg.type === MessageTypes.SUBSCRIBE) {
    await handleGatewaySubscribe({
      session,
      ws,
      msg,
      options,
      logger,
      send,
      sendError,
    });
    return;
  }

  if (
    msg.type === MessageTypes.SUBSCRIBE_NOTIFICATIONS
    || msg.type === MessageTypes.UNSUBSCRIBE_NOTIFICATIONS
  ) {
    await handleGatewayNotificationSubscription({
      session,
      ws,
      msg,
      notificationHandler: options.notificationHandler,
      send,
      sendError,
    });
    return;
  }

  if (input.isDraining) {
    sendError(ws, "UNAVAILABLE", "Server shutting down", {
      replyTo: msg.id,
      correlationId: msg.id,
    });
    return;
  }

  if (options.onMessage) {
    const response = await options.onMessage(session, msg);
    if (response) {
      logger?.debug("Response sent", {
        sessionId: session.id,
        requestType: msg.type,
        responseType: response.type,
        replyTo: msg.id,
      });
      send(session.id, response);
    }
  }
}
