import {
  MessageTypes,
  type GatewayMessage,
  type SpaceAssignmentSummary,
  type SpaceEndIncognitoSessionPayload,
  type SpaceGetMemoryPolicyPayload,
  type SpaceListAgentAssignmentsPayload,
  type SpaceSetMemoryPolicyPayload,
  type SpaceSetThinkingCapturePolicyPayload,
  type SpaceSummary,
} from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type { SpaceAdminHandlerContext } from "./space-admin-handlers.js";

export async function handleSpaceSetThinkingCapturePolicy(
  context: SpaceAdminHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceAdminService || !context.spaceMemoryPolicyService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space memory policy service unavailable");
  }

  const payload = msg.payload as SpaceSetThinkingCapturePolicyPayload;
  if (!payload?.spaceId || !payload?.thinkingCapturePolicy) {
    return context.errorResponse(
      msg.id,
      "INVALID_ARGUMENT",
      "spaceId and thinkingCapturePolicy are required",
    );
  }

  const existing = await context.spaceAdminService.getSpace(payload.spaceId);
  if (!existing) {
    return context.errorResponse(msg.id, "NOT_FOUND", `Space not found: ${payload.spaceId}`);
  }

  await context.spaceMemoryPolicyService.setThinkingCapturePolicy(
    payload.spaceId,
    payload.thinkingCapturePolicy,
  );
  const updated = await context.spaceAdminService.getSpace(payload.spaceId);
  if (!updated) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", `Failed to load updated space: ${payload.spaceId}`);
  }

  return context.response(msg.id, MessageTypes.SPACE_SET_THINKING_CAPTURE_POLICY, {
    space: await context.decorateSpaceSummary(updated as SpaceSummary),
  });
}

export async function handleSpaceGetMemoryPolicy(
  context: SpaceAdminHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceAdminService || !context.spaceMemoryPolicyService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space memory policy service unavailable");
  }

  const payload = msg.payload as SpaceGetMemoryPolicyPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const existing = await context.spaceAdminService.getSpace(payload.spaceId);
  if (!existing) {
    return context.errorResponse(msg.id, "NOT_FOUND", `Space not found: ${payload.spaceId}`);
  }

  return context.response(msg.id, MessageTypes.SPACE_GET_MEMORY_POLICY, {
    spaceId: payload.spaceId,
    memoryPolicy: context.spaceMemoryPolicyService.getSpaceMemoryPolicy(payload.spaceId),
  });
}

export async function handleSpaceSetMemoryPolicy(
  context: SpaceAdminHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceAdminService || !context.spaceMemoryPolicyService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space memory policy service unavailable");
  }

  const payload = msg.payload as SpaceSetMemoryPolicyPayload;
  if (!payload?.spaceId || !payload?.memoryPolicy) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and memoryPolicy are required");
  }

  const existing = await context.spaceAdminService.getSpace(payload.spaceId);
  if (!existing) {
    return context.errorResponse(msg.id, "NOT_FOUND", `Space not found: ${payload.spaceId}`);
  }

  await context.spaceMemoryPolicyService.setSpaceMemoryPolicy(payload.spaceId, payload.memoryPolicy);
  const updated = await context.spaceAdminService.getSpace(payload.spaceId);
  if (!updated) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", `Failed to load updated space: ${payload.spaceId}`);
  }

  return context.response(msg.id, MessageTypes.SPACE_SET_MEMORY_POLICY, {
    space: await context.decorateSpaceSummary(updated as SpaceSummary),
  });
}

export async function handleSpaceEndIncognitoSession(
  context: SpaceAdminHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceAdminService || !context.spaceMemoryPolicyService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space memory policy service unavailable");
  }

  const payload = msg.payload as SpaceEndIncognitoSessionPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const existing = await context.spaceAdminService.getSpace(payload.spaceId);
  if (!existing) {
    return context.errorResponse(msg.id, "NOT_FOUND", `Space not found: ${payload.spaceId}`);
  }

  const result = await context.spaceMemoryPolicyService.endIncognitoSession(payload.spaceId, "manual");
  const updated = await context.spaceAdminService.getSpace(payload.spaceId);
  if (!updated) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", `Failed to load updated space: ${payload.spaceId}`);
  }

  return context.response(msg.id, MessageTypes.SPACE_END_INCOGNITO_SESSION, {
    space: await context.decorateSpaceSummary(updated as SpaceSummary),
    ended: result.ended,
    reason: result.reason,
    purgedAt: result.purgedAt,
    sessionId: result.sessionId,
  });
}

export async function handleSpaceListAgentAssignments(
  context: SpaceAdminHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
  }

  const payload = msg.payload as SpaceListAgentAssignmentsPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const assignments = await context.spaceAdminService.listAgentAssignments(payload.spaceId);
  return context.response(msg.id, MessageTypes.SPACE_LIST_AGENT_ASSIGNMENTS, {
    assignments: context.decorateAssignments(payload.spaceId, assignments as SpaceAssignmentSummary[]),
  });
}
