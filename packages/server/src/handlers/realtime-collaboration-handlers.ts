import { randomUUID } from "node:crypto";
import type { SessionContinuityManager, SpaceManager } from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import type { ErrorPayload } from "../protocol.js";
import {
  type ConciergeActionResultAckPayload,
  type ConciergeActionResultPayload,
  MessageTypes,
  type AgentMessagePayload,
  type AgentPokePayload,
  type GatewayMessage,
  type TaskDependencyPayload,
} from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type { ConciergeEscalationService } from "../message-router-gateway-services.js";

export interface RealtimeCollaborationHandlerContext {
  logger: Logger;
  sessionContinuityManager: SessionContinuityManager | null;
  spaceManager: SpaceManager;
  conciergeEscalationService: ConciergeEscalationService | null;
  rememberContinuityIdentity: (client: ClientSession) => string;
  trackClientSpace: (client: ClientSession, spaceId: string) => void;
  resolveSpaceUid: (spaceIdRaw: string) => Promise<string>;
  response: (correlationId: string, type: string, payload?: unknown) => GatewayMessage;
  errorResponse: (
    correlationId: string,
    code: ErrorPayload["code"],
    message: string,
    errDetails?: unknown,
  ) => GatewayMessage;
  broadcastToSpace: (spaceUid: string, msg: GatewayMessage) => void;
}

export async function handleAgentMessage(
  context: RealtimeCollaborationHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const payload = msg.payload as AgentMessagePayload;
  if (!payload.spaceId || !payload.fromAgentId || !payload.toAgentId || !payload.content) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId, fromAgentId, toAgentId, and content are required");
  }
  const spaceUid = await context.resolveSpaceUid(payload.spaceId);

  const outbound: GatewayMessage = {
    type: MessageTypes.AGENT_MESSAGE,
    id: randomUUID(),
    ts: new Date().toISOString(),
    payload: {
      spaceId: payload.spaceId,
      spaceUid,
      fromAgentId: payload.fromAgentId,
      toAgentId: payload.toAgentId,
      content: payload.content,
      metadata: payload.metadata,
    } satisfies AgentMessagePayload,
  };

  context.broadcastToSpace(spaceUid, outbound);
  context.logger.debug("Agent message relayed", {
    spaceId: payload.spaceId,
    from: payload.fromAgentId,
    to: payload.toAgentId,
  });

  return context.response(msg.id, MessageTypes.AGENT_MESSAGE, {
    spaceId: payload.spaceId,
    spaceUid,
    fromAgentId: payload.fromAgentId,
    toAgentId: payload.toAgentId,
    content: payload.content,
    metadata: { ...payload.metadata, _ack: true },
  } satisfies AgentMessagePayload);
}

export async function handleAgentPoke(
  context: RealtimeCollaborationHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const payload = msg.payload as AgentPokePayload;
  if (!payload.spaceId || !payload.targetAgentId || !payload.reason) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId, targetAgentId, and reason are required");
  }
  const spaceUid = await context.resolveSpaceUid(payload.spaceId);

  context.broadcastToSpace(spaceUid, {
    type: MessageTypes.AGENT_POKE,
    id: randomUUID(),
    ts: new Date().toISOString(),
    payload: { ...payload, spaceUid } satisfies AgentPokePayload,
  });
  context.logger.info("Agent poked", {
    spaceId: payload.spaceId,
    targetAgentId: payload.targetAgentId,
    reason: payload.reason,
  });
  return context.response(msg.id, MessageTypes.AGENT_POKE, {
    ...payload,
    spaceUid,
  } satisfies AgentPokePayload);
}

export async function handleTaskDependency(
  context: RealtimeCollaborationHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const payload = msg.payload as TaskDependencyPayload;
  if (!payload.spaceId || !payload.blockedTurnId || !payload.dependsOnTurnId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId, blockedTurnId, and dependsOnTurnId are required");
  }
  const spaceUid = await context.resolveSpaceUid(payload.spaceId);

  context.broadcastToSpace(spaceUid, {
    type: MessageTypes.TASK_DEPENDENCY,
    id: randomUUID(),
    ts: new Date().toISOString(),
    payload: { ...payload, spaceUid } satisfies TaskDependencyPayload,
  });
  context.logger.info("Task dependency declared", {
    spaceId: payload.spaceId,
    blockedTurnId: payload.blockedTurnId,
    dependsOnTurnId: payload.dependsOnTurnId,
  });
  return context.response(msg.id, MessageTypes.TASK_DEPENDENCY, {
    ...payload,
    spaceUid,
  } satisfies TaskDependencyPayload);
}

export async function handleConciergeActionResult(
  context: RealtimeCollaborationHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage> {
  const payload = msg.payload as ConciergeActionResultPayload;
  if (!payload?.requestId?.trim()) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "requestId is required");
  }
  if (payload.status !== "ok" && payload.status !== "error") {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "status must be ok or error");
  }
  if (!context.conciergeEscalationService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Concierge escalation service is not configured");
  }

  const resolved = await context.conciergeEscalationService.resolveRequest({
    requestId: payload.requestId,
    status: payload.status,
    payload: payload.payload,
    error: payload.error,
  });

  context.logger.info("Concierge action result received", {
    requestId: payload.requestId,
    status: payload.status,
    resolvedStatus: resolved.status,
    hasPayload: payload.payload != null,
    error: payload.error,
  });

  return context.response(msg.id, MessageTypes.CONCIERGE_ACTION_RESULT, {
    acknowledged: true,
    requestId: payload.requestId,
  } satisfies ConciergeActionResultAckPayload);
}

export async function handleSessionListResumable(
  context: RealtimeCollaborationHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage> {
  if (!context.sessionContinuityManager) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Session continuity not configured");
  }
  const continuityClientId = context.rememberContinuityIdentity(client);
  const sessions = await context.sessionContinuityManager.listResumable(continuityClientId);
  return context.response(msg.id, MessageTypes.SESSION_LIST_RESUMABLE, {
    sessions: sessions.map((session) => ({
      sessionId: session.sessionId,
      spaceId: session.spaceId,
      lastActivityAt: session.lastActivityAt.toISOString(),
      continuityMode: session.continuityMode,
      checkpointId: session.checkpointId,
    })),
  });
}

export async function handleSessionResume(
  context: RealtimeCollaborationHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage> {
  if (!context.sessionContinuityManager) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Session continuity not configured");
  }
  const { spaceId } = (msg.payload ?? {}) as { spaceId?: string };
  if (!spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const continuityClientId = context.rememberContinuityIdentity(client);
  const session = await context.sessionContinuityManager.resume(spaceId, continuityClientId);
  if (!session) {
    return context.response(msg.id, MessageTypes.SESSION_RESUME, { resumed: false });
  }
  context.trackClientSpace(client, session.spaceId);

  let lastTurnId: string | undefined;
  if (session.checkpointId) {
    try {
      const checkpoint = await context.sessionContinuityManager.loadCheckpoint(session.checkpointId);
      if (checkpoint) {
        const restored = await context.spaceManager.restoreFromCheckpoint(session.spaceId, {
          agentStates: checkpoint.agentStates,
        });
        if (restored) {
          if (checkpoint.turnIds.length > 0) {
            lastTurnId = checkpoint.turnIds[checkpoint.turnIds.length - 1];
          } else {
            for (const state of Object.values(checkpoint.agentStates)) {
              if (state.lastTurnId) {
                lastTurnId = state.lastTurnId;
              }
            }
          }
        }
      }
    } catch (error) {
      context.logger.warn("Failed to restore checkpoint during session resume", {
        clientId: client.id,
        continuityClientId,
        spaceId: session.spaceId,
        checkpointId: session.checkpointId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return context.response(msg.id, MessageTypes.SESSION_RESUME, {
    resumed: true,
    sessionId: session.sessionId,
    checkpointId: session.checkpointId,
    lastTurnId,
  });
}
