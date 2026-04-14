import { randomUUID } from "node:crypto";
import type {
  CapabilityRegistry,
  CapabilityType,
  SessionContinuityManager,
  SpaceManager,
} from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import type { ErrorPayload } from "../protocol.js";
import {
  MessageTypes,
  type CancelTurnPayload,
  type CapabilityInvokePayload,
  type ExecuteTurnPayload,
  type GatewayMessage,
  type ResumeFeedbackPayload,
  type TurnEventPayload,
} from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import { normalizeApprovalGrantPayload, normalizeString } from "../message-router-utils.js";
import { normalizeUuid } from "../uuid.js";

export interface TurnHandlerContext {
  capabilities: CapabilityRegistry;
  logger: Logger;
  onFeedbackResolved?:
    | ((input: {
      spaceId?: string;
      turnId: string;
      status: "approved" | "rejected" | "revised" | "deferred";
      resolution?: string;
    }) => void)
    | null;
  sessionContinuityManager: SessionContinuityManager | null;
  spaceManager: SpaceManager;
  touchContinuitySession: (client: ClientSession, spaceId: string) => Promise<void>;
  resolveExecutionOrigin: (
    spaceId: string,
    principalIdRaw?: string,
  ) => "owner" | "guest" | "unknown";
  resolveSpaceId: (spaceUidRaw: string) => Promise<string | null>;
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

export async function handleExecuteTurn(
  context: TurnHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const payload = msg.payload as ExecuteTurnPayload;
  const spaceUid = normalizeUuid(payload?.spaceUid) || normalizeString(payload?.spaceUid);
  const input = typeof payload?.input === "string" ? payload.input : "";
  const targetAgentId = normalizeString(payload?.targetAgentId);
  const targetAgentIds = normalizeTargetAgentIds(payload?.targetAgentIds);
  const replyToTurnId = normalizeString(payload?.replyToTurnId);
  const conversationTopology = normalizeConversationTopology(payload?.conversationTopology);
  const requestedAccessMode = payload?.accessMode === "full_access" ? "full_access" : "default";
  const mode = normalizeTurnMode(payload?.mode);
  const effort = normalizeTurnEffort(payload?.effort);

  if (!spaceUid || !normalizeString(input)) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceUid and input are required");
  }

  const spaceId = await context.resolveSpaceId(spaceUid);
  if (!spaceId) {
    return context.errorResponse(msg.id, "NOT_FOUND", `Space not found for UID: ${spaceUid}`);
  }

  if (context.sessionContinuityManager) {
    try {
      await context.touchContinuitySession(client, spaceId);
    } catch (error) {
      context.logger.warn("Failed to initialize continuity session for execute_turn", {
        clientId: client.id,
        spaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const executionOrigin = context.resolveExecutionOrigin(spaceId, client.publicKey);
  const accessMode = executionOrigin === "owner" && requestedAccessMode === "full_access"
    ? "full_access"
    : "default";
  if (requestedAccessMode === "full_access" && accessMode !== "full_access") {
    context.logger.debug("execute_turn requested full_access was downgraded", {
      spaceId,
      principalId: client.publicKey ?? undefined,
      executionOrigin,
      requestedAccessMode,
      resolvedAccessMode: accessMode,
      reason: describeFullAccessDowngradeReason(executionOrigin, client.publicKey),
    });
  }
  const { turnId } = await context.spaceManager.executeTurn(
    spaceId,
    input,
    targetAgentId,
    {
      principalId: client.publicKey,
      deviceId: client.deviceId,
      executionOrigin,
      accessMode,
      mode,
      effort,
      ...(targetAgentIds.length > 0 ? { targetAgentIds } : {}),
      ...(replyToTurnId ? { replyToTurnId } : {}),
      ...(conversationTopology ? { conversationTopology } : {}),
    },
  );
  const canonicalSpaceUid = await context.resolveSpaceUid(spaceId);

  return context.response(msg.id, MessageTypes.TURN_EVENT, {
    spaceId,
    spaceUid: canonicalSpaceUid,
    turnId,
    eventType: "started",
    data: { turnId },
  } satisfies TurnEventPayload);
}

function normalizeTurnMode(value: ExecuteTurnPayload["mode"]): ExecuteTurnPayload["mode"] | undefined {
  if (value === "ask" || value === "plan" || value === "execute") {
    return value;
  }
  return undefined;
}

function normalizeTurnEffort(value: ExecuteTurnPayload["effort"]): ExecuteTurnPayload["effort"] | undefined {
  if (value === "low" || value === "medium" || value === "high" || value === "max") {
    return value;
  }
  return undefined;
}

function normalizeTargetAgentIds(value: ExecuteTurnPayload["targetAgentIds"]): string[] {
  if (!Array.isArray(value)) return [];
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const agentId = normalizeString(item);
    if (!agentId || seen.has(agentId)) continue;
    seen.add(agentId);
    normalized.push(agentId);
  }
  return normalized;
}

function normalizeConversationTopology(
  value: ExecuteTurnPayload["conversationTopology"],
): ExecuteTurnPayload["conversationTopology"] | undefined {
  if (value === "direct" || value === "shared_team_chat" || value === "broadcast_team") {
    return value;
  }
  return undefined;
}

export async function handleCancelTurn(
  context: TurnHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const payload = msg.payload as CancelTurnPayload;
  const spaceUid = normalizeUuid(payload?.spaceUid) || normalizeString(payload?.spaceUid);
  const turnId = normalizeString(payload?.turnId);

  if (!spaceUid || !turnId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceUid and turnId are required");
  }

  const spaceId = await context.resolveSpaceId(spaceUid);
  if (!spaceId) {
    return context.errorResponse(msg.id, "NOT_FOUND", `Space not found for UID: ${spaceUid}`);
  }

  const cancelled = await context.spaceManager.cancelTurn(spaceId, turnId);
  const canonicalSpaceUid = await context.resolveSpaceUid(spaceId);
  const nowIso = new Date().toISOString();

  if (cancelled) {
    context.broadcastToSpace(canonicalSpaceUid, {
      type: MessageTypes.TURN_EVENT,
      id: randomUUID(),
      ts: nowIso,
      payload: {
        spaceId,
        spaceUid: canonicalSpaceUid,
        turnId,
        eventType: "cancelled",
        data: { turnId },
        typedPayload: { kind: "turn.cancelled" },
      } satisfies TurnEventPayload,
    });
  }

  return context.response(msg.id, MessageTypes.TURN_EVENT, {
    spaceId,
    spaceUid: canonicalSpaceUid,
    turnId,
    eventType: "cancelled",
    data: { acknowledged: cancelled },
    typedPayload: { kind: "turn.cancelled" },
  } satisfies TurnEventPayload);
}

export async function handleResumeFeedback(
  context: TurnHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const payload = msg.payload as ResumeFeedbackPayload;
  const spaceUid = normalizeUuid(payload?.spaceUid) || normalizeString(payload?.spaceUid);
  const turnId = normalizeString(payload?.turnId);
  const response = normalizeString(payload?.response) as ResumeFeedbackPayload["response"] | undefined;
  const revision = normalizeString(payload?.revision);
  const approvalGrant = normalizeApprovalGrantPayload(payload?.approvalGrant);

  if (!spaceUid || !turnId || !response) {
    return context.errorResponse(
      msg.id,
      "INVALID_ARGUMENT",
      "spaceUid, turnId, and response are required",
    );
  }
  if (payload?.approvalGrant && !approvalGrant) {
    return context.errorResponse(
      msg.id,
      "INVALID_ARGUMENT",
      "approvalGrant.mode must be once, time_window, or durable",
    );
  }

  const spaceId = await context.resolveSpaceId(spaceUid);
  if (!spaceId) {
    return context.errorResponse(msg.id, "NOT_FOUND", `Space not found for UID: ${spaceUid}`);
  }

  if (context.sessionContinuityManager) {
    try {
      await context.touchContinuitySession(client, spaceId);
    } catch (error) {
      context.logger.warn("Failed to initialize continuity session for resume_feedback", {
        clientId: client.id,
        spaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await context.spaceManager.resumeFeedback(
    spaceId,
    turnId,
    response,
    revision,
    {
      approvalGrant,
      principalId: client.publicKey,
      deviceId: client.deviceId,
    },
  );

  const resolvedStatus = response === "approve"
    ? "approved"
    : response === "reject"
      ? "rejected"
      : response === "revise"
        ? "revised"
        : "deferred";
  context.onFeedbackResolved?.({
    spaceId,
    turnId,
    status: resolvedStatus,
    resolution: revision,
  });

  const canonicalSpaceUid = await context.resolveSpaceUid(spaceId);
  const nowIso = new Date().toISOString();
  context.broadcastToSpace(canonicalSpaceUid, {
    type: MessageTypes.TURN_EVENT,
    id: randomUUID(),
    ts: nowIso,
    payload: {
      spaceId,
      spaceUid: canonicalSpaceUid,
      turnId,
      agentId: "unknown-agent",
      eventType: "state_changed",
      data: { type: "feedback_resolved", response: resolvedStatus },
      typedPayload: { kind: "approval.resolved" as const, requestId: turnId, response: resolvedStatus },
      ts: nowIso,
    } satisfies TurnEventPayload,
  });

  return context.response(msg.id, MessageTypes.TURN_EVENT, {
    spaceId,
    spaceUid: canonicalSpaceUid,
    turnId,
    eventType: "started",
    data: { resumed: true },
  } satisfies TurnEventPayload);
}

export async function handleCapabilityInvoke(
  context: TurnHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const payload = msg.payload as CapabilityInvokePayload;
  if (!payload.capability || !payload.method) {
    return context.errorResponse(
      msg.id,
      "INVALID_ARGUMENT",
      "capability and method are required",
    );
  }

  const result = await context.capabilities.invoke({
    capability: payload.capability as CapabilityType,
    operation: payload.method,
    args: payload.params ?? {},
    targetProvider: payload.targetProvider,
  }, {
    principalId: client.publicKey,
    deviceId: client.deviceId,
  });

  return context.response(msg.id, "capability_result", result);
}

function describeFullAccessDowngradeReason(
  executionOrigin: "owner" | "guest" | "unknown",
  principalIdRaw?: string | null,
): string {
  const principalId = normalizeString(principalIdRaw);
  if (!principalId) {
    return "principal_missing";
  }
  if (executionOrigin === "guest") {
    return "guest_origin_cannot_use_full_access";
  }
  if (executionOrigin === "unknown") {
    return "principal_not_resolved_as_owner";
  }
  return "access_mode_clamped";
}
