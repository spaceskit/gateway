import {
  MessageTypes,
  type GatewayMessage,
  type SpaceDeleteMemoryPayload,
  type SpaceDeleteMemoryResponsePayload,
  type SpaceGetArtifactPayload,
  type SpaceGetArtifactResponsePayload,
  type SpaceGetDebugArtifactPayload,
  type SpaceGetDebugArtifactResponsePayload,
  type SpaceGetExperiencePayload,
  type SpaceGetExperienceResponsePayload,
  type SpaceGetInsightPayload,
  type SpaceGetInsightResponsePayload,
  type SpaceGetSpaceAgentNotesPayload,
  type SpaceGetSpaceAgentNotesResponsePayload,
  type SpaceGetTurnTracePayload,
  type SpaceGetTurnTraceResponsePayload,
  type SpaceGetUserProfilePayload,
  type SpaceGetUserProfileResponsePayload,
  type SpaceListArtifactsPayload,
  type SpaceListArtifactsResponsePayload,
  type SpaceListExperiencesPayload,
  type SpaceListExperiencesResponsePayload,
  type SpaceListInsightsPayload,
  type SpaceListInsightsResponsePayload,
  type SpaceListMemoriesPayload,
  type SpaceListMemoriesResponsePayload,
  type SpaceMutateInsightPayload,
  type SpaceMutateInsightResponsePayload,
  type SpaceUpdateMemoryImportancePayload,
  type SpaceUpdateMemoryImportanceResponsePayload,
  type SpaceUpdateSpaceAgentNotesPayload,
  type SpaceUpdateSpaceAgentNotesResponsePayload,
  type SpaceUpdateUserProfilePayload,
  type SpaceUpdateUserProfileResponsePayload,
} from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type { MemoryLifecycleService } from "../message-router-space-services.js";
import type { ChangeSetHandlerContext } from "./changeset-handlers.js";

function mutateInsight(
  context: ChangeSetHandlerContext,
  msg: GatewayMessage,
  responseType: string,
  mutate: (service: MemoryLifecycleService, insightId: string) => ReturnType<MemoryLifecycleService["acceptInsight"]>,
): GatewayMessage | null {
  if (!context.memoryLifecycleService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Memory lifecycle service unavailable");
  }
  const payload = msg.payload as SpaceMutateInsightPayload;
  if (!payload?.insightId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "insightId is required");
  }
  const insight = mutate(context.memoryLifecycleService, payload.insightId) as SpaceMutateInsightResponsePayload["insight"];
  return context.response(msg.id, responseType, {
    insight,
  } satisfies SpaceMutateInsightResponsePayload);
}

export async function handleSpaceGetTurnTrace(
  context: ChangeSetHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceTurnTraceService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space turn trace service unavailable");
  }
  const payload = msg.payload as SpaceGetTurnTracePayload;
  if (!payload?.spaceId || !payload?.turnId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and turnId are required");
  }

  const trace = await context.spaceTurnTraceService.getTurnTrace({
    spaceId: payload.spaceId,
    turnId: payload.turnId,
    limit: payload.limit,
    offset: payload.offset,
  });
  return context.response(msg.id, MessageTypes.SPACE_GET_TURN_TRACE, {
    trace,
  } satisfies SpaceGetTurnTraceResponsePayload);
}

export async function handleSpaceListExperiences(
  context: ChangeSetHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.memoryLifecycleService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Memory lifecycle service unavailable");
  }
  const payload = msg.payload as SpaceListExperiencesPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }
  const result = context.memoryLifecycleService.listExperiences(payload);
  return context.response(msg.id, MessageTypes.SPACE_LIST_EXPERIENCES, {
    spaceId: payload.spaceId,
    experiences: result.experiences,
    total: result.total,
    nextOffset: result.nextOffset,
  } satisfies SpaceListExperiencesResponsePayload);
}

export async function handleSpaceGetExperience(
  context: ChangeSetHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.memoryLifecycleService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Memory lifecycle service unavailable");
  }
  const payload = msg.payload as SpaceGetExperiencePayload;
  if (!payload?.spaceId || !payload?.experienceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and experienceId are required");
  }
  const result = context.memoryLifecycleService.getExperience(payload);
  return context.response(msg.id, MessageTypes.SPACE_GET_EXPERIENCE, result satisfies SpaceGetExperienceResponsePayload);
}

export async function handleSpaceListInsights(
  context: ChangeSetHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.memoryLifecycleService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Memory lifecycle service unavailable");
  }
  const payload = msg.payload as SpaceListInsightsPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }
  const result = context.memoryLifecycleService.listInsights(payload);
  return context.response(msg.id, MessageTypes.SPACE_LIST_INSIGHTS, {
    spaceId: payload.spaceId,
    insights: result.insights,
    total: result.total,
    nextOffset: result.nextOffset,
  } satisfies SpaceListInsightsResponsePayload);
}

export async function handleSpaceGetInsight(
  context: ChangeSetHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.memoryLifecycleService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Memory lifecycle service unavailable");
  }
  const payload = msg.payload as SpaceGetInsightPayload;
  if (!payload?.insightId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "insightId is required");
  }
  return context.response(msg.id, MessageTypes.SPACE_GET_INSIGHT, {
    insight: context.memoryLifecycleService.getInsight(payload.insightId),
  } satisfies SpaceGetInsightResponsePayload);
}

export async function handleSpaceAcceptInsight(
  context: ChangeSetHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  return mutateInsight(context, msg, MessageTypes.SPACE_ACCEPT_INSIGHT, (service, insightId) => service.acceptInsight(insightId));
}

export async function handleSpaceRejectInsight(
  context: ChangeSetHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  return mutateInsight(context, msg, MessageTypes.SPACE_REJECT_INSIGHT, (service, insightId) => service.rejectInsight(insightId));
}

export async function handleSpaceDismissInsight(
  context: ChangeSetHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  return mutateInsight(context, msg, MessageTypes.SPACE_DISMISS_INSIGHT, (service, insightId) => service.dismissInsight(insightId));
}

export async function handleSpaceGetSpaceAgentNotes(
  context: ChangeSetHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.memoryLifecycleService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Memory lifecycle service unavailable");
  }
  const payload = msg.payload as SpaceGetSpaceAgentNotesPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }
  const result = context.memoryLifecycleService.getSpaceAgentNotes(payload);
  return context.response(msg.id, MessageTypes.SPACE_GET_SPACE_AGENT_NOTES, result satisfies SpaceGetSpaceAgentNotesResponsePayload);
}

export async function handleSpaceUpdateSpaceAgentNotes(
  context: ChangeSetHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.memoryLifecycleService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Memory lifecycle service unavailable");
  }
  const payload = msg.payload as SpaceUpdateSpaceAgentNotesPayload;
  if (!payload?.spaceId || !payload?.agentId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and agentId are required");
  }
  return context.response(msg.id, MessageTypes.SPACE_UPDATE_SPACE_AGENT_NOTES, {
    note: context.memoryLifecycleService.updateSpaceAgentNotes(payload),
  } satisfies SpaceUpdateSpaceAgentNotesResponsePayload);
}

export async function handleSpaceGetUserProfile(
  context: ChangeSetHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.memoryLifecycleService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Memory lifecycle service unavailable");
  }
  const payload = msg.payload as SpaceGetUserProfilePayload | undefined;
  return context.response(msg.id, MessageTypes.SPACE_GET_USER_PROFILE, {
    profile: context.memoryLifecycleService.getUserProfile(payload?.principalId ?? client.publicKey ?? undefined),
  } satisfies SpaceGetUserProfileResponsePayload);
}

export async function handleSpaceUpdateUserProfile(
  context: ChangeSetHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.memoryLifecycleService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Memory lifecycle service unavailable");
  }
  const payload = msg.payload as SpaceUpdateUserProfilePayload;
  if (!payload?.profile || typeof payload.profile !== "object") {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "profile is required");
  }
  return context.response(msg.id, MessageTypes.SPACE_UPDATE_USER_PROFILE, {
    profile: context.memoryLifecycleService.updateUserProfile({
      principalId: payload.principalId ?? client.publicKey ?? undefined,
      profile: payload.profile,
    }),
  } satisfies SpaceUpdateUserProfileResponsePayload);
}

export async function handleSpaceListMemories(
  context: ChangeSetHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.memoryLifecycleService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Memory lifecycle service unavailable");
  }
  const payload = msg.payload as SpaceListMemoriesPayload | undefined;
  const result = await context.memoryLifecycleService.listMemories({
    principalId: payload?.principalId ?? client.publicKey ?? undefined,
    spaceId: payload?.spaceId,
    agentId: payload?.agentId,
    type: payload?.type,
    limit: payload?.limit,
    offset: payload?.offset,
  });
  return context.response(msg.id, MessageTypes.SPACE_LIST_MEMORIES, result satisfies SpaceListMemoriesResponsePayload);
}

export async function handleSpaceDeleteMemory(
  context: ChangeSetHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.memoryLifecycleService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Memory lifecycle service unavailable");
  }
  const payload = msg.payload as SpaceDeleteMemoryPayload;
  if (!payload?.memoryId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "memoryId is required");
  }
  const result = await context.memoryLifecycleService.deleteMemory(payload.memoryId);
  return context.response(msg.id, MessageTypes.SPACE_DELETE_MEMORY, result satisfies SpaceDeleteMemoryResponsePayload);
}

export async function handleSpaceUpdateMemoryImportance(
  context: ChangeSetHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.memoryLifecycleService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Memory lifecycle service unavailable");
  }
  const payload = msg.payload as SpaceUpdateMemoryImportancePayload;
  if (!payload?.memoryId || typeof payload.importance !== "number") {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "memoryId and importance are required");
  }
  return context.response(msg.id, MessageTypes.SPACE_UPDATE_MEMORY_IMPORTANCE, {
    memory: await context.memoryLifecycleService.updateMemoryImportance(payload.memoryId, payload.importance),
  } satisfies SpaceUpdateMemoryImportanceResponsePayload);
}

export async function handleSpaceListArtifacts(
  context: ChangeSetHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceArtifactService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space artifact service unavailable");
  }
  const payload = msg.payload as SpaceListArtifactsPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const result = await context.spaceArtifactService.listArtifacts({
    spaceId: payload.spaceId,
    turnId: payload.turnId,
    limit: payload.limit,
    offset: payload.offset,
  });
  return context.response(msg.id, MessageTypes.SPACE_LIST_ARTIFACTS, result satisfies SpaceListArtifactsResponsePayload);
}

export async function handleSpaceGetArtifact(
  context: ChangeSetHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceArtifactService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space artifact service unavailable");
  }
  const payload = msg.payload as SpaceGetArtifactPayload;
  if (!payload?.spaceId || !payload?.artifactId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and artifactId are required");
  }

  const artifact = await context.spaceArtifactService.getArtifact({
    spaceId: payload.spaceId,
    artifactId: payload.artifactId,
  });
  return context.response(msg.id, MessageTypes.SPACE_GET_ARTIFACT, {
    artifact,
  } satisfies SpaceGetArtifactResponsePayload);
}

export async function handleSpaceGetDebugArtifact(
  context: ChangeSetHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceArtifactService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space artifact service unavailable");
  }
  const payload = msg.payload as SpaceGetDebugArtifactPayload;
  if (!payload?.spaceId || !payload?.artifactId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and artifactId are required");
  }

  const artifact = await context.spaceArtifactService.getDebugArtifact({
    spaceId: payload.spaceId,
    artifactId: payload.artifactId,
  });
  return context.response(msg.id, MessageTypes.SPACE_GET_DEBUG_ARTIFACT, {
    artifact,
  } satisfies SpaceGetDebugArtifactResponsePayload);
}
