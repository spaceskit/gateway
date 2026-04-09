import type { ErrorPayload } from "../protocol.js";
import {
  MessageTypes,
  type GatewayDeleteKnowledgeBaseEntryPayload,
  type GatewayDeleteKnowledgeBaseEntryResponsePayload,
  type GatewayGetPolicyResponsePayload,
  type GatewayGrantCapabilityPayload,
  type GatewayGrantCapabilityResponsePayload,
  type GatewayListCapabilityGrantsPayload,
  type GatewayListCapabilityGrantsResponsePayload,
  type GatewayListKnowledgeBaseEntriesPayload,
  type GatewayListKnowledgeBaseEntriesResponsePayload,
  type GatewayMessage,
  type GatewayRevokeCapabilityPayload,
  type GatewayRevokeCapabilityResponsePayload,
  type GatewaySkillDeletePayload,
  type GatewaySkillDeleteResponsePayload,
  type GatewaySkillGetPayload,
  type GatewaySkillGetResponsePayload,
  type GatewaySkillListPayload,
  type GatewaySkillListResponsePayload,
  type GatewaySkillUpsertPayload,
  type GatewaySkillUpsertResponsePayload,
  type GatewayUpdatePolicyPayload,
  type GatewayUpdatePolicyResponsePayload,
  type GatewayUpsertKnowledgeBaseEntryPayload,
  type GatewayUpsertKnowledgeBaseEntryResponsePayload,
  type UsageGetSnapshotResponsePayload,
} from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type {
  GatewayCapabilityAccessService,
  GatewayKnowledgeBaseService,
  GatewayLibraryService,
  GatewayPolicyService,
  GatewaySkillCatalogService,
  UsageSnapshotService,
} from "../message-router-gateway-services.js";
import { normalizeString } from "../message-router-utils.js";

export interface GatewayGovernanceHandlerContext {
  gatewayCapabilityAccessService: GatewayCapabilityAccessService | null;
  gatewayKnowledgeBaseService: GatewayKnowledgeBaseService | null;
  gatewayLibraryService: GatewayLibraryService | null;
  gatewayPolicyService: GatewayPolicyService | null;
  gatewaySkillCatalogService: GatewaySkillCatalogService | null;
  usageSnapshotService: UsageSnapshotService | null;
  response: (correlationId: string, type: string, payload?: unknown) => GatewayMessage;
  errorResponse: (
    correlationId: string,
    code: ErrorPayload["code"],
    message: string,
    errDetails?: unknown,
  ) => GatewayMessage;
}

export async function handleGatewayGetPolicy(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayPolicyService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway policy service unavailable");
  }

  const policy = context.gatewayPolicyService.getPolicy();
  return context.response(msg.id, MessageTypes.GATEWAY_GET_POLICY, {
    policy,
  } satisfies GatewayGetPolicyResponsePayload);
}

export async function handleGatewayUpdatePolicy(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayPolicyService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway policy service unavailable");
  }

  const payload = (msg.payload ?? {}) as GatewayUpdatePolicyPayload;
  const policy = context.gatewayPolicyService.updatePolicy(payload);
  return context.response(msg.id, MessageTypes.GATEWAY_UPDATE_POLICY, {
    policy,
  } satisfies GatewayUpdatePolicyResponsePayload);
}

export async function handleGatewaySkillList(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewaySkillCatalogService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway skill catalog service unavailable");
  }
  const payload = (msg.payload ?? {}) as GatewaySkillListPayload;
  const skills = context.gatewaySkillCatalogService.listSkills(payload);
  return context.response(msg.id, MessageTypes.GATEWAY_SKILL_LIST, {
    skills,
  } satisfies GatewaySkillListResponsePayload);
}

export async function handleGatewaySkillGet(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewaySkillCatalogService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway skill catalog service unavailable");
  }
  const payload = msg.payload as GatewaySkillGetPayload;
  if (!payload?.skillId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "skillId is required");
  }

  const skill = context.gatewaySkillCatalogService.getSkill(payload.skillId);
  if (!skill) {
    return context.errorResponse(msg.id, "NOT_FOUND", `Skill not found: ${payload.skillId}`);
  }

  return context.response(msg.id, MessageTypes.GATEWAY_SKILL_GET, {
    skill,
  } satisfies GatewaySkillGetResponsePayload);
}

export async function handleGatewaySkillUpsert(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewaySkillCatalogService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway skill catalog service unavailable");
  }
  const payload = msg.payload as GatewaySkillUpsertPayload;
  if (!payload?.name || !payload?.contentMarkdown) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "name and contentMarkdown are required");
  }

  const result = context.gatewaySkillCatalogService.upsertSkill(payload);
  return context.response(msg.id, MessageTypes.GATEWAY_SKILL_UPSERT, result satisfies GatewaySkillUpsertResponsePayload);
}

export async function handleGatewaySkillDelete(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewaySkillCatalogService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway skill catalog service unavailable");
  }
  const payload = msg.payload as GatewaySkillDeletePayload;
  if (!payload?.skillId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "skillId is required");
  }

  const deleted = context.gatewaySkillCatalogService.deleteSkill(payload.skillId);
  return context.response(msg.id, MessageTypes.GATEWAY_SKILL_DELETE, {
    skillId: payload.skillId,
    deleted,
  } satisfies GatewaySkillDeleteResponsePayload);
}

export async function handleGatewayKnowledgeBaseListEntries(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayKnowledgeBaseService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway knowledge base service unavailable");
  }
  const payload = (msg.payload ?? {}) as GatewayListKnowledgeBaseEntriesPayload;
  const kinds = Array.isArray(payload.kinds)
    ? payload.kinds.filter((kind): kind is "web" | "file" | "folder" =>
      kind === "web" || kind === "file" || kind === "folder")
    : undefined;
  const tags = Array.isArray(payload.tags)
    ? payload.tags.filter((tag): tag is string => typeof tag === "string")
    : undefined;
  const limit = typeof payload.limit === "number" && payload.limit > 0
    ? Math.floor(payload.limit)
    : undefined;

  const entries = context.gatewayKnowledgeBaseService.listEntries({
    apiVersion: payload.apiVersion,
    spaceId: normalizeString(payload.spaceId),
    query: normalizeString(payload.query),
    tags,
    kinds,
    limit,
  });

  return context.response(msg.id, MessageTypes.GATEWAY_KB_LIST_ENTRIES, {
    entries,
  } satisfies GatewayListKnowledgeBaseEntriesResponsePayload);
}

export async function handleGatewayKnowledgeBaseUpsertEntry(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayKnowledgeBaseService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway knowledge base service unavailable");
  }
  const payload = msg.payload as GatewayUpsertKnowledgeBaseEntryPayload;
  if (!payload?.name || !payload?.kind || !payload?.uri || !payload?.scopeType) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "name, kind, uri, and scopeType are required");
  }

  const entry = context.gatewayKnowledgeBaseService.upsertEntry(payload);
  return context.response(msg.id, MessageTypes.GATEWAY_KB_UPSERT_ENTRY, {
    entry,
  } satisfies GatewayUpsertKnowledgeBaseEntryResponsePayload);
}

export async function handleGatewayKnowledgeBaseDeleteEntry(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayKnowledgeBaseService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway knowledge base service unavailable");
  }
  const payload = msg.payload as GatewayDeleteKnowledgeBaseEntryPayload;
  if (!payload?.entryId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "entryId is required");
  }

  const deleted = context.gatewayKnowledgeBaseService.deleteEntry(payload.entryId);
  return context.response(msg.id, MessageTypes.GATEWAY_KB_DELETE_ENTRY, {
    entryId: payload.entryId,
    deleted,
  } satisfies GatewayDeleteKnowledgeBaseEntryResponsePayload);
}

export async function handleGatewayListCapabilityGrants(
  context: GatewayGovernanceHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayCapabilityAccessService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway capability access service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }

  const payload = (msg.payload ?? {}) as GatewayListCapabilityGrantsPayload;
  const principalId = normalizeString(payload.principalId) ?? client.publicKey;
  if (principalId !== client.publicKey) {
    return context.errorResponse(msg.id, "PERMISSION_DENIED", "Cannot list grants for another principal");
  }

  const grants = context.gatewayCapabilityAccessService.listCapabilityGrants({
    principalId,
    deviceId: normalizeString(payload.deviceId),
    includeExpired: payload.includeExpired,
    includeRevoked: payload.includeRevoked,
  });
  return context.response(msg.id, MessageTypes.GATEWAY_LIST_CAPABILITY_GRANTS, {
    grants,
  } satisfies GatewayListCapabilityGrantsResponsePayload);
}

export async function handleGatewayGrantCapability(
  context: GatewayGovernanceHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayCapabilityAccessService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway capability access service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }

  const payload = (msg.payload ?? {}) as GatewayGrantCapabilityPayload;
  if (!payload?.capabilityId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "capabilityId is required");
  }

  const principalId = normalizeString(payload.principalId) ?? client.publicKey;
  if (principalId !== client.publicKey) {
    return context.errorResponse(msg.id, "PERMISSION_DENIED", "Cannot grant capability for another principal");
  }

  const grant = context.gatewayCapabilityAccessService.grantCapability({
    principalId,
    deviceId: normalizeString(payload.deviceId) ?? client.deviceId,
    capabilityId: payload.capabilityId,
    reason: payload.reason,
    grantedBy: client.publicKey,
    expiresAt: payload.expiresAt,
  });
  return context.response(msg.id, MessageTypes.GATEWAY_GRANT_CAPABILITY, {
    grant,
  } satisfies GatewayGrantCapabilityResponsePayload);
}

export async function handleGatewayRevokeCapability(
  context: GatewayGovernanceHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayCapabilityAccessService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway capability access service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }

  const payload = (msg.payload ?? {}) as GatewayRevokeCapabilityPayload;
  if (!payload?.capabilityId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "capabilityId is required");
  }

  const principalId = normalizeString(payload.principalId) ?? client.publicKey;
  if (principalId !== client.publicKey) {
    return context.errorResponse(msg.id, "PERMISSION_DENIED", "Cannot revoke capability for another principal");
  }

  const result = context.gatewayCapabilityAccessService.revokeCapability({
    principalId,
    deviceId: normalizeString(payload.deviceId) ?? client.deviceId,
    capabilityId: payload.capabilityId,
    reason: payload.reason,
    revokedBy: client.publicKey,
  });
  return context.response(msg.id, MessageTypes.GATEWAY_REVOKE_CAPABILITY, {
    revoked: result.revoked,
    capabilityId: result.capabilityId,
    principalId: result.principalId,
    deviceId: result.deviceId,
    grant: result.grant,
  } satisfies GatewayRevokeCapabilityResponsePayload);
}

export async function handleUsageGetSnapshot(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.usageSnapshotService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Usage snapshot service unavailable");
  }

  const snapshot = context.usageSnapshotService.getSnapshot();
  return context.response(msg.id, MessageTypes.USAGE_GET_SNAPSHOT, {
    snapshot,
  } satisfies UsageGetSnapshotResponsePayload);
}

// ---------------------------------------------------------------------------
// Library handlers
// ---------------------------------------------------------------------------

export async function handleLibraryListEntries(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const payload = (msg.payload ?? {}) as Record<string, unknown>;
  const entries = context.gatewayLibraryService.listEntries(payload);
  return context.response(msg.id, MessageTypes.LIBRARY_LIST_ENTRIES, { entries });
}

export async function handleLibraryGetEntry(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const payload = msg.payload as { entryId?: string; includeContent?: boolean } | undefined;
  if (!payload?.entryId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "entryId is required");
  }
  const entry = context.gatewayLibraryService.getEntry(payload.entryId, payload.includeContent);
  if (!entry) {
    return context.errorResponse(msg.id, "NOT_FOUND", `Library entry not found: ${payload.entryId}`);
  }
  return context.response(msg.id, MessageTypes.LIBRARY_GET_ENTRY, { entry });
}

export async function handleLibrarySaveSkill(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const payload = msg.payload as Record<string, unknown> | undefined;
  if (!payload?.name || !payload?.contentMarkdown) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "name and contentMarkdown are required");
  }
  const result = context.gatewayLibraryService.saveSkill(payload);
  return context.response(msg.id, MessageTypes.LIBRARY_SAVE_SKILL, result);
}

export async function handleLibraryImportEntry(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const payload = msg.payload as Record<string, unknown> | undefined;
  if (!payload?.entryId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "entryId is required");
  }
  const result = context.gatewayLibraryService.importEntry(payload);
  return context.response(msg.id, MessageTypes.LIBRARY_IMPORT_ENTRY, result);
}

export async function handleLibraryArchiveEntry(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const payload = msg.payload as Record<string, unknown> | undefined;
  if (!payload?.entryId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "entryId is required");
  }
  const result = context.gatewayLibraryService.archiveEntry(payload);
  return context.response(msg.id, MessageTypes.LIBRARY_ARCHIVE_ENTRY, result);
}

export async function handleLibrarySetEntryEnabled(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const payload = msg.payload as Record<string, unknown> | undefined;
  if (!payload?.entryId || typeof payload?.enabled !== "boolean") {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "entryId and enabled are required");
  }
  const result = context.gatewayLibraryService.setEntryEnabled(payload);
  return context.response(msg.id, MessageTypes.LIBRARY_SET_ENTRY_ENABLED, result);
}

export async function handleLibraryDeleteEntry(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const payload = msg.payload as Record<string, unknown> | undefined;
  if (!payload?.entryId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "entryId is required");
  }
  const result = context.gatewayLibraryService.deleteEntry(payload);
  return context.response(msg.id, MessageTypes.LIBRARY_DELETE_ENTRY, result);
}

export async function handleLibraryScanEntries(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const result = context.gatewayLibraryService.scanEntries();
  return context.response(msg.id, MessageTypes.LIBRARY_SCAN_ENTRIES, result);
}

export async function handleLibraryListSkillDrafts(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const drafts = context.gatewayLibraryService.listSkillDrafts();
  return context.response(msg.id, MessageTypes.LIBRARY_LIST_SKILL_DRAFTS, { drafts });
}

export async function handleLibraryGetSkillDraft(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const payload = msg.payload as { draftId?: string } | undefined;
  if (!payload?.draftId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "draftId is required");
  }
  const draft = context.gatewayLibraryService.getSkillDraft(payload.draftId);
  if (!draft) {
    return context.errorResponse(msg.id, "NOT_FOUND", `Skill draft not found: ${payload.draftId}`);
  }
  return context.response(msg.id, MessageTypes.LIBRARY_GET_SKILL_DRAFT, { draft });
}

export async function handleLibraryCreateSkillDraft(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const payload = msg.payload as Record<string, unknown> | undefined;
  if (!payload?.requestPrompt) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "requestPrompt is required");
  }
  const result = context.gatewayLibraryService.createSkillDraft(payload);
  return context.response(msg.id, MessageTypes.LIBRARY_CREATE_SKILL_DRAFT, result);
}

export async function handleLibraryDeleteSkillDraft(
  context: GatewayGovernanceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayLibraryService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway library service unavailable");
  }
  const payload = msg.payload as Record<string, unknown> | undefined;
  if (!payload?.draftId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "draftId is required");
  }
  const result = context.gatewayLibraryService.deleteSkillDraft(payload);
  return context.response(msg.id, MessageTypes.LIBRARY_DELETE_SKILL_DRAFT, result);
}
