import type { SpaceAdminService } from "@spaceskit/core";
import type { ErrorPayload } from "../protocol.js";
import {
  MessageTypes,
  type GatewayMessage,
  type SpaceAddResourcePayload,
  type SpaceAddResourceResponsePayload,
  type SpaceAddSkillPayload,
  type SpaceAddSkillResponsePayload,
  type SpaceApproveMcpAgentPayload,
  type SpaceApproveMcpAgentResponsePayload,
  type SpaceAssignmentSummary,
  type SpaceClearMcpEndpointPayload,
  type SpaceClearMcpEndpointResponsePayload,
  type SpaceDiscoverMcpAgentsPayload,
  type SpaceDiscoverMcpAgentsResponsePayload,
  type SpaceGetMcpEndpointPayload,
  type SpaceGetMcpEndpointResponsePayload,
  type SpaceGetWorkspacePayload,
  type SpaceGetWorkspaceResponsePayload,
  type SpaceListOrchestrationJournalPayload,
  type SpaceListOrchestrationJournalResponsePayload,
  type SpaceListResourcesPayload,
  type SpaceListResourcesResponsePayload,
  type SpaceListSkillsPayload,
  type SpaceListSkillsResponsePayload,
  type SpaceListTurnsPayload,
  type SpaceListTurnsResponsePayload,
  type SpaceMcpEndpointPayload,
  type SpaceRemoveResourcePayload,
  type SpaceRemoveResourceResponsePayload,
  type SpaceRemoveSkillPayload,
  type SpaceRemoveSkillResponsePayload,
  type SpaceSetMcpEndpointPayload,
  type SpaceSetMcpEndpointResponsePayload,
  type SpaceSetWorkspacePayload,
  type SpaceSetWorkspaceResponsePayload,
  type SpaceSummary,
} from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type {
  OrchestrationJournalService,
  RouterSpaceDecorators,
  SpaceMcpService,
  SpaceWorkspaceService,
  TurnHistoryService,
} from "../message-router-space-services.js";
import { normalizeString, parsePaginationInt } from "../message-router-utils.js";
import { normalizeUuid } from "../uuid.js";

export interface SpaceResourceHandlerContext extends RouterSpaceDecorators {
  orchestrationJournalService: OrchestrationJournalService | null;
  spaceAdminService: SpaceAdminService | null;
  spaceMcpService: SpaceMcpService | null;
  spaceWorkspaceService: SpaceWorkspaceService | null;
  turnHistoryService: TurnHistoryService | null;
  spaceManager: { invalidateCache: (spaceId: string) => void };
  response: (correlationId: string, type: string, payload?: unknown) => GatewayMessage;
  errorResponse: (
    correlationId: string,
    code: ErrorPayload["code"],
    message: string,
    errDetails?: unknown,
  ) => GatewayMessage;
}

export async function handleSpaceGetMcpEndpoint(
  context: SpaceResourceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceMcpService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space MCP service unavailable");
  }
  const payload = msg.payload as SpaceGetMcpEndpointPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }
  const endpoint = context.spaceMcpService.getSpaceEndpoint(payload.spaceId) ?? undefined;
  return context.response(msg.id, MessageTypes.SPACE_GET_MCP_ENDPOINT, {
    spaceId: payload.spaceId,
    endpoint,
    fallbackEnabled: context.spaceMcpService.isConfiguredForSpace(payload.spaceId),
  } satisfies SpaceGetMcpEndpointResponsePayload);
}

export async function handleSpaceSetMcpEndpoint(
  context: SpaceResourceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceMcpService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space MCP service unavailable");
  }
  const payload = msg.payload as SpaceSetMcpEndpointPayload;
  if (!payload?.spaceId || !payload?.transport || !payload?.endpoint) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId, transport, and endpoint are required");
  }

  const endpoint = await context.spaceMcpService.setSpaceEndpoint(payload);
  context.spaceManager.invalidateCache(payload.spaceId);
  return context.response(msg.id, MessageTypes.SPACE_SET_MCP_ENDPOINT, {
    endpoint,
  } satisfies SpaceSetMcpEndpointResponsePayload);
}

export async function handleSpaceClearMcpEndpoint(
  context: SpaceResourceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceMcpService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space MCP service unavailable");
  }
  const payload = msg.payload as SpaceClearMcpEndpointPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const cleared = await context.spaceMcpService.clearSpaceEndpoint(payload.spaceId);
  context.spaceManager.invalidateCache(payload.spaceId);
  return context.response(msg.id, MessageTypes.SPACE_CLEAR_MCP_ENDPOINT, {
    spaceId: payload.spaceId,
    cleared,
  } satisfies SpaceClearMcpEndpointResponsePayload);
}

export async function handleSpaceDiscoverMcpAgents(
  context: SpaceResourceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceMcpService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space MCP service unavailable");
  }
  const payload = msg.payload as SpaceDiscoverMcpAgentsPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const result = await context.spaceMcpService.discoverSpaceAgents(payload.spaceId);
  return context.response(msg.id, MessageTypes.SPACE_DISCOVER_MCP_AGENTS, {
    spaceId: payload.spaceId,
    endpointId: result.endpointId,
    agents: result.agents,
  } satisfies SpaceDiscoverMcpAgentsResponsePayload);
}

export async function handleSpaceApproveMcpAgent(
  context: SpaceResourceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceMcpService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space MCP service unavailable");
  }
  const payload = msg.payload as SpaceApproveMcpAgentPayload;
  if (!payload?.spaceId || !payload?.remoteAgentId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and remoteAgentId are required");
  }

  const result = await context.spaceMcpService.approveSpaceAgent(payload);
  context.spaceManager.invalidateCache(payload.spaceId);
  return context.response(msg.id, MessageTypes.SPACE_APPROVE_MCP_AGENT, {
    spaceId: payload.spaceId,
    assignment: context.decorateAssignments(
      payload.spaceId,
      [result.assignment as unknown as SpaceAssignmentSummary],
    )[0],
    binding: result.binding,
  } satisfies SpaceApproveMcpAgentResponsePayload);
}

export async function handleSpaceAddSkill(
  context: SpaceResourceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
  }
  const payload = msg.payload as SpaceAddSkillPayload;
  if (!payload?.spaceId || !payload?.skillId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and skillId are required");
  }

  const skills = await context.spaceAdminService.addSkillToSpace({
    idempotencyKey: payload.idempotencyKey,
    spaceId: payload.spaceId,
    skillId: payload.skillId,
  });
  const space = await context.spaceAdminService.getSpace(payload.spaceId);
  const spaceUid = await context.resolveSpaceUid(payload.spaceId);

  return context.response(msg.id, MessageTypes.SPACE_ADD_SKILL, {
    spaceId: payload.spaceId,
    spaceUid,
    skillId: payload.skillId,
    skills,
    space: space ? await context.decorateSpaceSummary(space as SpaceSummary) : space,
  } satisfies SpaceAddSkillResponsePayload);
}

export async function handleSpaceRemoveSkill(
  context: SpaceResourceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
  }
  const payload = msg.payload as SpaceRemoveSkillPayload;
  if (!payload?.spaceId || !payload?.skillId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and skillId are required");
  }

  const result = await context.spaceAdminService.removeSkillFromSpace({
    idempotencyKey: payload.idempotencyKey,
    spaceId: payload.spaceId,
    skillId: payload.skillId,
  });
  const space = await context.spaceAdminService.getSpace(payload.spaceId);
  const spaceUid = await context.resolveSpaceUid(payload.spaceId);

  return context.response(msg.id, MessageTypes.SPACE_REMOVE_SKILL, {
    removed: result.removed,
    spaceId: payload.spaceId,
    spaceUid,
    skillId: payload.skillId,
    skills: result.skills,
    space: space ? await context.decorateSpaceSummary(space as SpaceSummary) : space,
  } satisfies SpaceRemoveSkillResponsePayload);
}

export async function handleSpaceListSkills(
  context: SpaceResourceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
  }
  const payload = msg.payload as SpaceListSkillsPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const skills = await context.spaceAdminService.listSpaceSkills(payload.spaceId);
  const spaceUid = await context.resolveSpaceUid(payload.spaceId);
  return context.response(msg.id, MessageTypes.SPACE_LIST_SKILLS, {
    spaceId: payload.spaceId,
    spaceUid,
    skills,
  } satisfies SpaceListSkillsResponsePayload);
}

export async function handleSpaceGetWorkspace(
  context: SpaceResourceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceWorkspaceService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space workspace service unavailable");
  }
  const payload = msg.payload as SpaceGetWorkspacePayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const workspace = await context.spaceWorkspaceService.getWorkspace(payload.spaceId);
  return context.response(msg.id, MessageTypes.SPACE_GET_WORKSPACE, {
    workspace,
  } satisfies SpaceGetWorkspaceResponsePayload);
}

export async function handleSpaceSetWorkspace(
  context: SpaceResourceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceWorkspaceService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space workspace service unavailable");
  }
  const payload = msg.payload as SpaceSetWorkspacePayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const workspace = await context.spaceWorkspaceService.setWorkspace(
    payload.spaceId,
    payload.workspaceRoot ?? null,
  );
  context.spaceManager.invalidateCache(payload.spaceId);
  return context.response(msg.id, MessageTypes.SPACE_SET_WORKSPACE, {
    workspace,
  } satisfies SpaceSetWorkspaceResponsePayload);
}

export async function handleSpaceAddResource(
  context: SpaceResourceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
  }
  const payload = msg.payload as SpaceAddResourcePayload;
  if (!payload?.spaceId || !payload?.uri || !payload?.type) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId, uri, and type are required");
  }
  if (context.spaceWorkspaceService) {
    await context.spaceWorkspaceService.ensureWorkspace(payload.spaceId);
  }

  const resource = await context.spaceAdminService.addResource({
    apiVersion: payload.apiVersion,
    idempotencyKey: payload.idempotencyKey,
    resourceId: payload.resourceId,
    spaceId: payload.spaceId,
    uri: payload.uri,
    type: payload.type,
    label: payload.label,
  });

  return context.response(msg.id, MessageTypes.SPACE_ADD_RESOURCE, {
    resource: {
      resourceId: resource.resourceId,
      spaceId: resource.spaceId,
      spaceUid: await context.resolveSpaceUid(resource.spaceId),
      uri: resource.uri,
      type: resource.type,
      label: resource.label,
      addedAt: resource.addedAt.toISOString(),
    },
  } satisfies SpaceAddResourceResponsePayload);
}

export async function handleSpaceRemoveResource(
  context: SpaceResourceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
  }
  const payload = msg.payload as SpaceRemoveResourcePayload;
  if (!payload?.spaceId || !payload?.resourceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and resourceId are required");
  }
  if (context.spaceWorkspaceService) {
    await context.spaceWorkspaceService.ensureWorkspace(payload.spaceId);
  }

  const removed = await context.spaceAdminService.removeResource({
    apiVersion: payload.apiVersion,
    idempotencyKey: payload.idempotencyKey,
    spaceId: payload.spaceId,
    resourceId: payload.resourceId,
  });
  const spaceUid = await context.resolveSpaceUid(payload.spaceId);

  return context.response(msg.id, MessageTypes.SPACE_REMOVE_RESOURCE, {
    removed,
    spaceId: payload.spaceId,
    spaceUid,
    resourceId: payload.resourceId,
  } satisfies SpaceRemoveResourceResponsePayload);
}

export async function handleSpaceListResources(
  context: SpaceResourceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space admin service unavailable");
  }
  const payload = msg.payload as SpaceListResourcesPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  if (context.spaceWorkspaceService) {
    await context.spaceWorkspaceService.ensureWorkspace(payload.spaceId);
  }
  const resources = await context.spaceAdminService.listResources(payload.spaceId);
  const spaceUid = await context.resolveSpaceUid(payload.spaceId);
  return context.response(msg.id, MessageTypes.SPACE_LIST_RESOURCES, {
    spaceId: payload.spaceId,
    spaceUid,
    resources: resources.map((resource) => ({
      resourceId: resource.resourceId,
      spaceId: resource.spaceId,
      spaceUid,
      uri: resource.uri,
      type: resource.type,
      label: resource.label,
      addedAt: resource.addedAt.toISOString(),
    })),
  } satisfies SpaceListResourcesResponsePayload);
}

export async function handleSpaceListTurns(
  context: SpaceResourceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.turnHistoryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Turn history service unavailable");
  }
  const payload = (msg.payload ?? {}) as SpaceListTurnsPayload;
  const requestedSpaceId = normalizeString(payload?.spaceId);
  const requestedSpaceUid = normalizeUuid(payload?.spaceUid) || normalizeString(payload?.spaceUid);
  const resolvedSpaceId = requestedSpaceId
    ?? (requestedSpaceUid ? await context.resolveSpaceId(requestedSpaceUid) : null);
  if (!resolvedSpaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId or spaceUid is required");
  }

  const parsedLimit = parsePaginationInt(payload?.limit, {
    field: "limit",
    defaultValue: 100,
    min: 1,
    max: 500,
  });
  if (!parsedLimit.ok) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", parsedLimit.message);
  }

  const lastSeenTurnId = normalizeString(payload?.lastSeenTurnId);
  const parsedOffset = lastSeenTurnId
    ? { ok: true as const, value: 0 }
    : parsePaginationInt(payload?.offset, {
      field: "offset",
      defaultValue: 0,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    });
  if (!parsedOffset.ok) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", parsedOffset.message);
  }

  const history = await context.turnHistoryService.listSpaceTurns({
    spaceId: resolvedSpaceId,
    limit: parsedLimit.value,
    offset: parsedOffset.value,
    lastSeenTurnId,
  });
  const normalizedTurns = Array.isArray(history.turns) ? history.turns : [];
  const total = Number.isFinite(history.total)
    ? Math.max(0, Math.trunc(history.total))
    : normalizedTurns.length;
  const nextOffset = lastSeenTurnId
    ? undefined
    : (
      parsedOffset.value + normalizedTurns.length < total
        ? parsedOffset.value + normalizedTurns.length
        : undefined
    );

  return context.response(msg.id, MessageTypes.SPACE_LIST_TURNS, {
    spaceId: resolvedSpaceId,
    spaceUid: await context.resolveSpaceUid(resolvedSpaceId),
    turns: normalizedTurns,
    total,
    nextOffset,
  } satisfies SpaceListTurnsResponsePayload);
}

export async function handleSpaceListOrchestrationJournal(
  context: SpaceResourceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.orchestrationJournalService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Orchestration journal service unavailable");
  }
  const payload = (msg.payload ?? {}) as SpaceListOrchestrationJournalPayload;
  const requestedSpaceId = normalizeString(payload?.spaceId);
  const requestedSpaceUid = normalizeUuid(payload?.spaceUid) || normalizeString(payload?.spaceUid);
  const resolvedSpaceId = requestedSpaceId
    ?? (requestedSpaceUid ? await context.resolveSpaceId(requestedSpaceUid) : null);
  if (!resolvedSpaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId or spaceUid is required");
  }

  const parsedLimit = parsePaginationInt(payload?.limit, {
    field: "limit",
    defaultValue: 50,
    min: 1,
    max: 500,
  });
  if (!parsedLimit.ok) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", parsedLimit.message);
  }

  const parsedOffset = parsePaginationInt(payload?.offset, {
    field: "offset",
    defaultValue: 0,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
  });
  if (!parsedOffset.ok) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", parsedOffset.message);
  }

  const turnId = normalizeString(payload.turnId);
  const history = await context.orchestrationJournalService.listEntries({
    spaceId: resolvedSpaceId,
    turnId,
    limit: parsedLimit.value,
    offset: parsedOffset.value,
  });
  const normalizedEntries = Array.isArray(history.entries) ? history.entries : [];
  const total = Number.isFinite(history.total)
    ? Math.max(0, Math.trunc(history.total))
    : normalizedEntries.length;
  const nextOffset = parsedOffset.value + normalizedEntries.length < total
    ? parsedOffset.value + normalizedEntries.length
    : undefined;
  const spaceUid = await context.resolveSpaceUid(resolvedSpaceId);

  return context.response(msg.id, MessageTypes.SPACE_LIST_ORCHESTRATION_JOURNAL, {
    spaceId: resolvedSpaceId,
    spaceUid,
    entries: normalizedEntries.map((entry) => ({
      eventId: entry.eventId,
      spaceId: resolvedSpaceId,
      spaceUid,
      turnId: normalizeString(entry.turnId),
      seq: entry.seq,
      eventType: entry.eventType,
      actorId: entry.actorId,
      lineageId: normalizeString(entry.lineageId),
      hopCount: entry.hopCount,
      payload: entry.payload,
      createdAt: entry.createdAt,
    })),
    total,
    nextOffset,
  } satisfies SpaceListOrchestrationJournalResponsePayload);
}
