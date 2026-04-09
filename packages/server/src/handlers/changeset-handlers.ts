import type { ErrorPayload } from "../protocol.js";
import {
  MessageTypes,
  type GatewayMessage,
  type SpaceApplyChangeSetPayload,
  type SpaceApplyChangeSetResponsePayload,
  type SpaceChangeSetDiffPayload,
  type SpaceChangeSetDiffResponsePayload,
  type SpaceCreateChangeSetPayload,
  type SpaceCreateChangeSetResponsePayload,
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
  type SpaceListActivityLogPayload,
  type SpaceListActivityLogResponsePayload,
  type SpaceListExperiencesPayload,
  type SpaceListExperiencesResponsePayload,
  type SpaceListInsightsPayload,
  type SpaceListInsightsResponsePayload,
  type SpaceListMemoriesPayload,
  type SpaceListMemoriesResponsePayload,
  type SpaceMutateInsightPayload,
  type SpaceMutateInsightResponsePayload,
  type SpaceGetQuotaPayload,
  type SpaceGetQuotaResponsePayload,
  type SpaceGetTurnTracePayload,
  type SpaceGetTurnTraceResponsePayload,
  type SpaceGetUserProfilePayload,
  type SpaceGetUserProfileResponsePayload,
  type SpaceGetUsagePayload,
  type SpaceGetUsageResponsePayload,
  type SpaceListArtifactsPayload,
  type SpaceListArtifactsResponsePayload,
  type SpaceListChangeSetsPayload,
  type SpaceListChangeSetsResponsePayload,
  type SpaceReviewChangeSetPayload,
  type SpaceReviewChangeSetResponsePayload,
  type SpaceSubmitChangeSetPayload,
  type SpaceSubmitChangeSetResponsePayload,
  type SpaceDeleteMemoryPayload,
  type SpaceDeleteMemoryResponsePayload,
  type SpaceUpdateMemoryImportancePayload,
  type SpaceUpdateMemoryImportanceResponsePayload,
  type SpaceUpdateSpaceAgentNotesPayload,
  type SpaceUpdateSpaceAgentNotesResponsePayload,
  type SpaceUpdateUserProfilePayload,
  type SpaceUpdateUserProfileResponsePayload,
  type SpaceUpdateQuotaPolicyPayload,
  type SpaceUpdateQuotaPolicyResponsePayload,
  type SpaceUploadChangeSetFileCompletePayload,
  type SpaceUploadChangeSetFileCompleteResponsePayload,
  type SpaceUploadChangeSetFileInitPayload,
  type SpaceUploadChangeSetFileInitResponsePayload,
} from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type {
  MemoryLifecycleService,
  SpaceArtifactReaderService,
  SpaceChangeSetService,
  SpaceQuotaService,
  SpaceTurnTraceService,
} from "../message-router-space-services.js";

export interface ChangeSetHandlerContext {
  memoryLifecycleService: MemoryLifecycleService | null;
  spaceArtifactService: SpaceArtifactReaderService | null;
  spaceChangeSetService: SpaceChangeSetService | null;
  spaceQuotaService: SpaceQuotaService | null;
  spaceTurnTraceService: SpaceTurnTraceService | null;
  response: (correlationId: string, type: string, payload?: unknown) => GatewayMessage;
  errorResponse: (
    correlationId: string,
    code: ErrorPayload["code"],
    message: string,
    errDetails?: unknown,
  ) => GatewayMessage;
}

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

export async function handleSpaceCreateChangeSet(
  context: ChangeSetHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceChangeSetService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Changeset service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }
  const payload = msg.payload as SpaceCreateChangeSetPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const changeSet = await context.spaceChangeSetService.createChangeSet({
    spaceId: payload.spaceId,
    principalId: client.publicKey,
    title: payload.title,
    description: payload.description,
    adapter: payload.adapter,
    targetBranch: payload.targetBranch,
    expiresInSeconds: payload.expiresInSeconds,
  });
  return context.response(msg.id, MessageTypes.SPACE_CREATE_CHANGESET, {
    changeSet,
  } satisfies SpaceCreateChangeSetResponsePayload);
}

export async function handleSpaceListChangeSets(
  context: ChangeSetHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceChangeSetService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Changeset service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }
  const payload = msg.payload as SpaceListChangeSetsPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const changeSets = context.spaceChangeSetService.listChangeSets({
    spaceId: payload.spaceId,
    principalId: client.publicKey,
    statuses: payload.statuses,
    limit: payload.limit,
    offset: payload.offset,
  });
  return context.response(msg.id, MessageTypes.SPACE_LIST_CHANGESETS, {
    spaceId: payload.spaceId,
    changeSets,
  } satisfies SpaceListChangeSetsResponsePayload);
}

export async function handleSpaceUploadChangeSetFileInit(
  context: ChangeSetHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceChangeSetService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Changeset service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }
  const payload = msg.payload as SpaceUploadChangeSetFileInitPayload;
  if (!payload?.spaceId || !payload?.changeSetId || !payload?.relativePath) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId, changeSetId, and relativePath are required");
  }

  const result = await context.spaceChangeSetService.uploadFileInit({
    spaceId: payload.spaceId,
    changeSetId: payload.changeSetId,
    principalId: client.publicKey,
    relativePath: payload.relativePath,
  });
  return context.response(msg.id, MessageTypes.SPACE_UPLOAD_CHANGESET_FILE_INIT, result satisfies SpaceUploadChangeSetFileInitResponsePayload);
}

export async function handleSpaceUploadChangeSetFileComplete(
  context: ChangeSetHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceChangeSetService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Changeset service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }
  const payload = msg.payload as SpaceUploadChangeSetFileCompletePayload;
  if (!payload?.spaceId || !payload?.changeSetId || !payload?.uploadId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId, changeSetId, and uploadId are required");
  }

  const result = await context.spaceChangeSetService.uploadFileComplete({
    spaceId: payload.spaceId,
    changeSetId: payload.changeSetId,
    principalId: client.publicKey,
    uploadId: payload.uploadId,
    contentBase64: payload.contentBase64,
    sourcePath: payload.sourcePath,
    expectedSha256: payload.expectedSha256,
  });
  return context.response(msg.id, MessageTypes.SPACE_UPLOAD_CHANGESET_FILE_COMPLETE, result satisfies SpaceUploadChangeSetFileCompleteResponsePayload);
}

export async function handleSpaceSubmitChangeSet(
  context: ChangeSetHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceChangeSetService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Changeset service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }
  const payload = msg.payload as SpaceSubmitChangeSetPayload;
  if (!payload?.spaceId || !payload?.changeSetId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and changeSetId are required");
  }

  const changeSet = context.spaceChangeSetService.submitChangeSet({
    spaceId: payload.spaceId,
    changeSetId: payload.changeSetId,
    principalId: client.publicKey,
  });
  return context.response(msg.id, MessageTypes.SPACE_SUBMIT_CHANGESET, {
    changeSet,
  } satisfies SpaceSubmitChangeSetResponsePayload);
}

export async function handleSpaceReviewChangeSet(
  context: ChangeSetHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceChangeSetService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Changeset service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }
  const payload = msg.payload as SpaceReviewChangeSetPayload;
  if (!payload?.spaceId || !payload?.changeSetId || !payload?.decision) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId, changeSetId, and decision are required");
  }

  const result = await context.spaceChangeSetService.reviewChangeSet({
    spaceId: payload.spaceId,
    changeSetId: payload.changeSetId,
    principalId: client.publicKey,
    decision: payload.decision,
    comment: payload.comment,
  });
  return context.response(msg.id, MessageTypes.SPACE_REVIEW_CHANGESET, result satisfies SpaceReviewChangeSetResponsePayload);
}

export async function handleSpaceApplyChangeSet(
  context: ChangeSetHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceChangeSetService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Changeset service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }
  const payload = msg.payload as SpaceApplyChangeSetPayload;
  if (!payload?.spaceId || !payload?.changeSetId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and changeSetId are required");
  }

  const result = await context.spaceChangeSetService.applyChangeSet({
    spaceId: payload.spaceId,
    changeSetId: payload.changeSetId,
    principalId: client.publicKey,
  });
  return context.response(msg.id, MessageTypes.SPACE_APPLY_CHANGESET, result satisfies SpaceApplyChangeSetResponsePayload);
}

export async function handleSpaceGetChangeSetDiff(
  context: ChangeSetHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceChangeSetService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Changeset service unavailable");
  }
  const payload = msg.payload as SpaceChangeSetDiffPayload;
  if (!payload?.spaceId || !payload?.changeSetId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and changeSetId are required");
  }

  const diff = await context.spaceChangeSetService.getChangeSetDiff(payload.spaceId, payload.changeSetId);
  return context.response(msg.id, MessageTypes.SPACE_GET_CHANGESET_DIFF, diff satisfies SpaceChangeSetDiffResponsePayload);
}

export async function handleSpaceGetQuota(
  context: ChangeSetHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceQuotaService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space quota service unavailable");
  }
  const payload = msg.payload as SpaceGetQuotaPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const result = context.spaceQuotaService.getQuota(payload.spaceId, client.publicKey ?? undefined);
  return context.response(msg.id, MessageTypes.SPACE_GET_QUOTA, result satisfies SpaceGetQuotaResponsePayload);
}

export async function handleSpaceUpdateQuotaPolicy(
  context: ChangeSetHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceQuotaService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space quota service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }
  const payload = msg.payload as SpaceUpdateQuotaPolicyPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const spacePolicy = context.spaceQuotaService.updateQuotaPolicy({
    ...payload,
    updatedBy: client.publicKey,
  });
  return context.response(msg.id, MessageTypes.SPACE_UPDATE_QUOTA_POLICY, {
    spacePolicy,
  } satisfies SpaceUpdateQuotaPolicyResponsePayload);
}

export async function handleSpaceGetUsage(
  context: ChangeSetHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceQuotaService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space quota service unavailable");
  }
  const payload = msg.payload as SpaceGetUsagePayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const usage = context.spaceQuotaService.getUsage(payload.spaceId, client.publicKey ?? undefined, {
    includeAgentSessions: payload.includeAgentSessions,
    includeGlobalLifetime: payload.includeGlobalLifetime,
  });
  return context.response(msg.id, MessageTypes.SPACE_GET_USAGE, usage satisfies SpaceGetUsageResponsePayload);
}

export async function handleSpaceListActivityLog(
  context: ChangeSetHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceTurnTraceService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space activity log service unavailable");
  }
  const payload = msg.payload as SpaceListActivityLogPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const result = await context.spaceTurnTraceService.listActivityLog({
    spaceId: payload.spaceId,
    turnId: payload.turnId,
    limit: payload.limit,
    offset: payload.offset,
    includeSystem: payload.includeSystem,
  });
  return context.response(msg.id, MessageTypes.SPACE_LIST_ACTIVITY_LOG, {
    spaceId: payload.spaceId,
    entries: result.entries,
    total: result.total,
    nextOffset: result.nextOffset,
  } satisfies SpaceListActivityLogResponsePayload);
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
