import type { RuntimeApprovalSelection, RuntimeFeedbackCheckpoint } from "@spaceskit/core";
import type { AccessGrantService } from "./access-grant-service.js";
import type { GatewayCapabilityAccessService } from "./gateway-capability-access-service.js";
import type { ToolApprovalGrantService } from "./tool-approval-grant-service.js";

export interface PersistFeedbackApprovalSelectionInput {
  spaceId: string;
  approvalGrant: RuntimeApprovalSelection;
  feedbackRequest?: RuntimeFeedbackCheckpoint;
  principalId?: string;
  deviceId?: string;
  accessGrantService?: AccessGrantService | null;
  gatewayCapabilityAccessService?: GatewayCapabilityAccessService | null;
  toolApprovalGrantService?: ToolApprovalGrantService | null;
  now?: () => Date;
}

export interface PersistFeedbackApprovalSelectionResult {
  persistedAccessGrant: boolean;
  persistedCapabilityGrant: boolean;
  persistedToolApprovalGrant: boolean;
  requestedCapability?: string;
}

export function persistFeedbackApprovalSelection(
  input: PersistFeedbackApprovalSelectionInput,
): PersistFeedbackApprovalSelectionResult {
  const target = extractApprovalTarget(input.feedbackRequest);
  const requestedCapability = extractRequestedCapability(input.feedbackRequest);
  const toolName = extractToolName(input.feedbackRequest);
  if (!target) {
    return {
      persistedAccessGrant: false,
      persistedCapabilityGrant: false,
      persistedToolApprovalGrant: false,
      ...(requestedCapability ? { requestedCapability } : {}),
    };
  }
  if (input.approvalGrant.mode === "once") {
    return {
      persistedAccessGrant: false,
      persistedCapabilityGrant: false,
      persistedToolApprovalGrant: false,
      ...(requestedCapability ? { requestedCapability } : {}),
    };
  }
  if (!input.principalId?.trim()) {
    throw new Error("principalId is required to persist access grants.");
  }

  const now = input.now ?? (() => new Date());
  const expiresAt = input.approvalGrant.mode === "time_window"
    ? new Date(now().getTime() + ((input.approvalGrant.ttlSeconds ?? 900) * 1000)).toISOString()
    : undefined;

  let persistedAccessGrant = false;
  if (input.accessGrantService) {
    input.accessGrantService.grantAccess({
      principalId: input.principalId,
      deviceId: input.deviceId,
      spaceId: input.spaceId,
      targetKind: target.targetKind,
      targetId: target.targetId,
      mode: input.approvalGrant.mode,
      expiresAt,
      source: "feedback_resume",
      reason: buildAccessGrantReason(target.targetKind, target.targetId, requestedCapability),
    });
    persistedAccessGrant = true;
  }

  let persistedCapabilityGrant = false;
  if (target.targetKind === "dangerous_capability" && requestedCapability && input.gatewayCapabilityAccessService) {
    input.gatewayCapabilityAccessService.grantCapability({
      principalId: input.principalId,
      deviceId: input.deviceId,
      capabilityId: requestedCapability,
      expiresAt,
      source: "feedback_resume",
      reason: `Granted ${requestedCapability} after approval for ${target.targetKind}:${target.targetId}.`,
      grantedBy: input.principalId,
    });
    persistedCapabilityGrant = true;
  }

  let persistedToolApprovalGrant = false;
  if (target.targetKind === "tool_selector" && toolName && input.toolApprovalGrantService) {
    input.toolApprovalGrantService.grantApproval({
      principalId: input.principalId,
      deviceId: input.deviceId,
      spaceId: input.spaceId,
      toolId: toolName,
      mode: input.approvalGrant.mode,
      expiresAt,
      source: "feedback_resume",
      reason: `Granted ${toolName} after approval for ${target.targetKind}:${target.targetId}.`,
      grantedBy: input.principalId,
    });
    persistedToolApprovalGrant = true;
  }

  return {
    persistedAccessGrant,
    persistedCapabilityGrant,
    persistedToolApprovalGrant,
    ...(requestedCapability ? { requestedCapability } : {}),
  };
}

export function extractRequestedCapability(
  feedbackRequest?: RuntimeFeedbackCheckpoint,
): string | undefined {
  const requestedCapability = feedbackRequest?.context?.requestedCapability;
  if (typeof requestedCapability !== "string") {
    return undefined;
  }
  const normalized = requestedCapability.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function buildAccessGrantReason(
  targetKind: "dangerous_capability" | "tool_selector",
  targetId: string,
  requestedCapability?: string,
): string {
  const base = `Granted ${targetKind}:${targetId} after approval.`;
  return requestedCapability ? `${base} Requested capability: ${requestedCapability}.` : base;
}

function extractApprovalTarget(
  feedbackRequest?: RuntimeFeedbackCheckpoint,
): { targetKind: "dangerous_capability" | "tool_selector"; targetId: string } | undefined {
  const context = feedbackRequest?.context;
  if (!context || typeof context !== "object") {
    return undefined;
  }
  const targetKind = typeof context.targetKind === "string" ? context.targetKind.trim().toLowerCase() : "";
  const targetId = typeof context.targetId === "string" ? context.targetId.trim() : "";
  if ((targetKind === "dangerous_capability" || targetKind === "tool_selector") && targetId.length > 0) {
    return { targetKind, targetId };
  }
  return undefined;
}

function extractToolName(feedbackRequest?: RuntimeFeedbackCheckpoint): string | undefined {
  const toolName = feedbackRequest?.context && typeof feedbackRequest.context === "object"
    ? feedbackRequest.context.toolName
    : undefined;
  if (typeof toolName !== "string") {
    return undefined;
  }
  const normalized = toolName.trim();
  return normalized.length > 0 ? normalized : undefined;
}
