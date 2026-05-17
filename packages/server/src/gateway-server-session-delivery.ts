import type { ServerWebSocket } from "bun";
import type { Logger } from "@spaceskit/observability";
import type { GatewayMessage } from "./protocol.js";
import type { ClientSession, WSData } from "./gateway-server.js";

export function disconnectGatewaySessionsByDevice(input: {
  deviceId: string;
  principalId?: string;
  clients: Map<string, ClientSession>;
  sockets: Map<string, ServerWebSocket<WSData>>;
  logger: Logger | null;
}): number {
  const normalizedDeviceId = input.deviceId.trim();
  if (!normalizedDeviceId) return 0;
  const normalizedPrincipalId = input.principalId?.trim() || undefined;

  let disconnected = 0;
  for (const [sessionId, session] of input.clients) {
    if (session.deviceId !== normalizedDeviceId) continue;
    if (normalizedPrincipalId && session.publicKey !== normalizedPrincipalId) continue;
    const ws = input.sockets.get(sessionId);
    if (!ws) continue;
    ws.close(4003, "Device revoked");
    disconnected += 1;
  }

  if (disconnected > 0) {
    input.logger?.warn("Disconnected sessions for revoked device", {
      deviceId: normalizedDeviceId,
      principalId: normalizedPrincipalId,
      disconnected,
    });
  }

  return disconnected;
}

export function sendToGatewayIdentity(input: {
  principalId: string;
  deviceId?: string;
  msg: GatewayMessage;
  clients: Map<string, ClientSession>;
  send: (clientId: string, msg: GatewayMessage) => void;
}): number {
  const normalizedPrincipalId = input.principalId.trim();
  const normalizedDeviceId = input.deviceId?.trim() || undefined;
  if (!normalizedPrincipalId) {
    return 0;
  }

  const exactMatches: string[] = [];
  const principalMatches: string[] = [];
  for (const [sessionId, session] of input.clients) {
    if (!session.authenticated || session.publicKey !== normalizedPrincipalId) {
      continue;
    }
    principalMatches.push(sessionId);
    if (normalizedDeviceId && session.deviceId === normalizedDeviceId) {
      exactMatches.push(sessionId);
    }
  }

  const targets = exactMatches.length > 0 ? exactMatches : principalMatches;
  for (const sessionId of targets) {
    input.send(sessionId, input.msg);
  }
  return targets.length;
}
