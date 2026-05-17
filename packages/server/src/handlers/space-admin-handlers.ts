import { randomUUID } from "node:crypto";
import type { SpaceAdminService } from "@spaceskit/core";
import type { ErrorPayload } from "../protocol.js";
import {
  MessageTypes,
  type GatewayMessage,
  type SpaceAddAgentPayload,
  type SpaceAgentUpdatedEventPayload,
  type SpaceArchivePayload,
  type SpaceAssignmentSummary,
  type SpaceCreatePayload,
  type SpaceDeletePayload,
  type SpaceEndIncognitoSessionPayload,
  type SpaceGetPayload,
  type SpaceGetMemoryPolicyPayload,
  type SpaceListAgentAssignmentsPayload,
  type SpaceListPayload,
  type SpaceRemoveAgentPayload,
  type SpaceSetMemoryPolicyPayload,
  type SpaceSetOrchestratorPayload,
  type SpaceSetThinkingCapturePolicyPayload,
  type SpaceSummary,
  type SpaceUpdateAgentAssignmentPayload,
} from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type {
  RouterSpaceDecorators,
  SpaceMemoryPolicyService,
  SpaceMcpService,
  SpaceQuotaService,
  SpaceSharingService,
  SpaceWorkspaceService,
} from "../message-router-space-services.js";
import { parseSpaceStatuses } from "../message-router-utils.js";
export {
  handleSpaceEndIncognitoSession,
  handleSpaceGetMemoryPolicy,
  handleSpaceListAgentAssignments,
  handleSpaceSetMemoryPolicy,
  handleSpaceSetThinkingCapturePolicy,
} from "./space-admin-memory-handlers.js";

export interface SpaceAdminHandlerContext extends RouterSpaceDecorators {
  spaceAdminService: SpaceAdminService | null;
  spaceMemoryPolicyService: SpaceMemoryPolicyService | null;
  spaceWorkspaceService: SpaceWorkspaceService | null;
  spaceSharingService: SpaceSharingService | null;
  spaceMcpService: SpaceMcpService | null;
  spaceQuotaService: SpaceQuotaService | null;
  spaceManager: {
    deactivate: (spaceId: string) => void;
    invalidateCache: (spaceId: string) => void;
  };
  agentSessionReplacementEnabled: boolean;
  resolveSessionResetPrincipal: (client: ClientSession) => string;
  response: (correlationId: string, type: string, payload?: unknown) => GatewayMessage;
  errorResponse: (
    correlationId: string,
    code: ErrorPayload["code"],
    message: string,
    errDetails?: unknown,
  ) => GatewayMessage;
  broadcastToSpace: (spaceUid: string, msg: GatewayMessage) => void;
}

export async function handleSpaceCreate(
  context: SpaceAdminHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
  }

  const payload = msg.payload as SpaceCreatePayload;
  if (!payload?.resourceId || !payload?.name) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "resourceId and name are required");
  }
  if (payload.workspaceRoot !== undefined && !context.spaceWorkspaceService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space workspace service unavailable");
  }

  const space = await context.spaceAdminService.createSpace({
    idempotencyKey: payload.idempotencyKey,
    spaceId: payload.spaceId,
    resourceId: payload.resourceId,
    spaceType: payload.spaceType,
    name: payload.name,
    goal: payload.goal,
    turnModel: payload.turnModel as any,
    templateId: payload.templateId,
    templateRevision: payload.templateRevision,
    capabilities: payload.capabilities,
    capabilityOverrides: payload.capabilityOverrides,
    visibility: payload.visibility,
    turnModelConfig: payload.turnModelConfig as any,
    maxTurns: payload.maxTurns,
    thinkingCapturePolicy: payload.thinkingCapturePolicy,
    moderatorProfileId: payload.moderatorProfileId,
    initialAgents: Array.isArray(payload.initialAgents)
      ? payload.initialAgents.map((agent) => ({
        agentId: agent.agentId,
        profileId: agent.profileId,
        role: agent.role,
        turnOrder: agent.turnOrder,
        isPrimary: agent.isPrimary,
      }))
      : undefined,
  });
  if (context.spaceWorkspaceService) {
    if (payload.workspaceRoot !== undefined) {
      await context.spaceWorkspaceService.setWorkspace(space.id, payload.workspaceRoot);
    } else {
      await context.spaceWorkspaceService.ensureWorkspace(space.id);
    }
  }

  return context.response(msg.id, MessageTypes.SPACE_CREATE, {
    space: await context.decorateSpaceSummary(space as SpaceSummary),
  });
}

export async function handleSpaceGet(
  context: SpaceAdminHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
  }

  const payload = msg.payload as SpaceGetPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const space = await context.spaceAdminService.getSpace(payload.spaceId);
  if (!space) {
    return context.errorResponse(msg.id, "NOT_FOUND", `Space not found: ${payload.spaceId}`);
  }

  return context.response(msg.id, MessageTypes.SPACE_GET, {
    space: await context.decorateSpaceSummary(space as SpaceSummary),
  });
}

export async function handleSpaceList(
  context: SpaceAdminHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
  }

  const payload = (msg.payload ?? {}) as SpaceListPayload;
  const spaces = await context.spaceAdminService.listSpaces({
    statuses: parseSpaceStatuses(payload.statuses),
    resourceId: payload.resourceId,
    limit: payload.limit,
  });

  if (!context.spaceSharingService) {
    return context.response(msg.id, MessageTypes.SPACE_LIST, {
      spaces: await context.decorateSpaceListSummaries(spaces as SpaceSummary[]),
    });
  }

  const principalId = client.publicKey?.trim();
  const visibleSpaces = spaces.filter((space) => {
    const decision = context.spaceSharingService!.evaluateAccess({
      spaceId: space.id,
      principalId,
      action: "read",
    });
    return decision.allowed;
  });

  return context.response(msg.id, MessageTypes.SPACE_LIST, {
    spaces: await context.decorateSpaceListSummaries(visibleSpaces as SpaceSummary[]),
  });
}

export async function handleSpaceArchive(
  context: SpaceAdminHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
  }

  const payload = msg.payload as SpaceArchivePayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const space = await context.spaceAdminService.archiveSpace({
    idempotencyKey: payload.idempotencyKey,
    spaceId: payload.spaceId,
  });
  context.spaceManager.deactivate(space.id);

  return context.response(msg.id, MessageTypes.SPACE_ARCHIVE, {
    space: await context.decorateSpaceSummary(space as SpaceSummary),
    archived: space.status === "archived",
  });
}

export async function handleSpaceDelete(
  context: SpaceAdminHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
  }

  const payload = msg.payload as SpaceDeletePayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const space = await context.spaceAdminService.deleteSpace({
    idempotencyKey: payload.idempotencyKey,
    spaceId: payload.spaceId,
  });
  context.spaceManager.deactivate(space.id);

  return context.response(msg.id, MessageTypes.SPACE_DELETE, {
    spaceId: space.id,
    spaceUid: space.spaceUid,
    deleted: space.status === "deleted",
    space: await context.decorateSpaceSummary(space as SpaceSummary),
  });
}

export async function handleSpaceAddAgent(
  context: SpaceAdminHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
  }

  const payload = msg.payload as SpaceAddAgentPayload;
  if (!payload?.spaceId || !payload?.agentId || !payload?.profileId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId, agentId, and profileId are required");
  }

  const assignment = await context.spaceAdminService.addAgent({
    idempotencyKey: payload.idempotencyKey,
    spaceId: payload.spaceId,
    agentId: payload.agentId,
    profileId: payload.profileId,
    role: payload.role,
    turnOrder: payload.turnOrder,
    isPrimary: payload.isPrimary,
  });

  context.spaceManager.invalidateCache(payload.spaceId);

  const space = await context.spaceAdminService.getSpace(payload.spaceId);
  return context.response(msg.id, MessageTypes.SPACE_ADD_AGENT, {
    assignment,
    space: space ? await context.decorateSpaceSummary(space as SpaceSummary) : space,
  });
}

export async function handleSpaceRemoveAgent(
  context: SpaceAdminHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
  }

  const payload = msg.payload as SpaceRemoveAgentPayload;
  if (!payload?.spaceId || !payload?.agentId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and agentId are required");
  }

  const removed = await context.spaceAdminService.removeAgent(
    payload.spaceId,
    payload.agentId,
    payload.idempotencyKey,
  );

  if (removed && context.spaceMcpService) {
    context.spaceMcpService.removeBinding(payload.spaceId, payload.agentId);
  }

  context.spaceManager.invalidateCache(payload.spaceId);

  const space = await context.spaceAdminService.getSpace(payload.spaceId);
  const spaceUid = await context.resolveSpaceUid(payload.spaceId);
  return context.response(msg.id, MessageTypes.SPACE_REMOVE_AGENT, {
    removed,
    spaceId: payload.spaceId,
    spaceUid,
    agentId: payload.agentId,
    space: space ? await context.decorateSpaceSummary(space as SpaceSummary) : space,
  });
}

export async function handleSpaceUpdateAgentAssignment(
  context: SpaceAdminHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
  }

  const payload = msg.payload as SpaceUpdateAgentAssignmentPayload;
  if (!payload?.spaceId || !payload?.agentId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and agentId are required");
  }

  const previousAssignments = await context.spaceAdminService.listAgentAssignments(payload.spaceId);
  const previousAssignment = previousAssignments.find((entry) => entry.agentId === payload.agentId);
  const assignment = await context.spaceAdminService.updateAgentAssignment({
    idempotencyKey: payload.idempotencyKey,
    spaceId: payload.spaceId,
    agentId: payload.agentId,
    profileId: payload.profileId,
    spawnContext: payload.spawnContext,
    contextOverrides: payload.contextOverrides as any,
    role: payload.role,
    turnOrder: payload.turnOrder,
    isPrimary: payload.isPrimary,
  });

  context.spaceManager.invalidateCache(payload.spaceId);

  const profileChanged = previousAssignment
    ? previousAssignment.profileId !== assignment.profileId
    : false;
  const shouldResetSession = profileChanged
    || (context.agentSessionReplacementEnabled && payload.resetSession === true);

  if (shouldResetSession) {
    if (context.spaceQuotaService) {
      try {
        const resetPrincipalId = context.resolveSessionResetPrincipal(client);
        context.spaceQuotaService.resetAgentUsageSession(
          payload.spaceId,
          payload.agentId,
          resetPrincipalId,
        );
      } catch {
        // Non-fatal.
      }
    }

    const spaceUid = await context.resolveSpaceUid(payload.spaceId);
    context.broadcastToSpace(spaceUid, {
      type: MessageTypes.SPACE_AGENT_UPDATED,
      id: randomUUID(),
      ts: new Date().toISOString(),
      payload: {
        spaceId: payload.spaceId,
        spaceUid,
        agentId: payload.agentId,
        oldProfileId: previousAssignment?.profileId ?? assignment.profileId,
        newProfileId: assignment.profileId,
        updatedAt: new Date().toISOString(),
      } satisfies SpaceAgentUpdatedEventPayload,
    });
  }

  const space = await context.spaceAdminService.getSpace(payload.spaceId);
  return context.response(msg.id, MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT, {
    assignment,
    space: space ? await context.decorateSpaceSummary(space as SpaceSummary) : space,
  });
}

export async function handleSpaceSetOrchestrator(
  context: SpaceAdminHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
  }

  const payload = msg.payload as SpaceSetOrchestratorPayload;
  if (!payload?.spaceId || !payload?.profileId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and profileId are required");
  }

  const space = await context.spaceAdminService.setSpaceOrchestrator({
    idempotencyKey: payload.idempotencyKey,
    spaceId: payload.spaceId,
    profileId: payload.profileId,
  });

  return context.response(msg.id, MessageTypes.SPACE_SET_ORCHESTRATOR, {
    space: await context.decorateSpaceSummary(space as SpaceSummary),
  });
}
