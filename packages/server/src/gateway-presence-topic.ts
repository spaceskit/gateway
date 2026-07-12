import type { ServerWebSocket } from "bun";
import type { WSData } from "./gateway-server-types.js";

/**
 * Space-agnostic pub/sub topic for the gateway-wide agent-presence "departure
 * board". Unlike `space:${spaceUid}` topics (one per space), there is a single
 * gateway-global presence stream, so the topic is a fixed constant. The poller
 * (`AgentPresenceSourceService`) publishes the full snapshot here via
 * `GatewayServer.broadcastToGateway`; clients attach via
 * `subscribeWebSocketToGatewayPresence`.
 */
export const GATEWAY_PRESENCE_TOPIC = "agent-presence";

/** Attach a WebSocket to the gateway-wide presence topic. Additive, idempotent. */
export function subscribeWebSocketToGatewayPresence(ws: ServerWebSocket<WSData>): void {
  ws.subscribe(GATEWAY_PRESENCE_TOPIC);
}

/** Detach a WebSocket from the gateway-wide presence topic. */
export function unsubscribeWebSocketFromGatewayPresence(ws: ServerWebSocket<WSData>): void {
  ws.unsubscribe(GATEWAY_PRESENCE_TOPIC);
}
