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
export {
  handleSpaceAcceptInsight,
  handleSpaceDeleteMemory,
  handleSpaceDismissInsight,
  handleSpaceGetArtifact,
  handleSpaceGetDebugArtifact,
  handleSpaceGetExperience,
  handleSpaceGetInsight,
  handleSpaceGetSpaceAgentNotes,
  handleSpaceGetTurnTrace,
  handleSpaceGetUserProfile,
  handleSpaceListArtifacts,
  handleSpaceListExperiences,
  handleSpaceListInsights,
  handleSpaceListMemories,
  handleSpaceRejectInsight,
  handleSpaceUpdateMemoryImportance,
  handleSpaceUpdateSpaceAgentNotes,
  handleSpaceUpdateUserProfile,
} from "./changeset-memory-artifact-handlers.js";

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
