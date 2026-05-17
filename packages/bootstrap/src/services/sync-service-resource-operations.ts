import type {
  ArtifactRepository,
  SyncRuntimeRepository,
} from "@spaceskit/persistence";
import {
  BASIC_SPACE_ARTIFACT_TYPE,
  buildBasicSyncContent,
  buildBasicSyncRef,
  getSpaceIdFromBasicArtifactId,
  isGeneratedBasicArtifact,
} from "./basic-space-export.js";
import {
  clampLimit,
  computeSyncRefVersionHash,
  decodeCursor,
  dedupeRefs,
  encodeCursor,
  hashJson,
  normalizeApiVersion,
  parsePullResponse,
  parseTags,
  sanitizeStrings,
} from "./sync-service-normalizers.js";
import { GatewaySyncError } from "./sync-service-types.js";
import type {
  GatewaySyncServiceOptions,
  PullResourcesInput,
  PullResourcesResult,
  QueryResourcesInput,
  QueryResourcesResult,
  SyncPolicyContext,
  SyncPolicyDecision,
  SyncProvenance,
  SyncResourcePayload,
} from "./sync-service-types.js";

interface SyncResourceOperationContext {
  syncRepo: SyncRuntimeRepository;
  artifacts: ArtifactRepository;
  options: GatewaySyncServiceOptions;
  authorizeInboundPeer(peerId: string, providedSecret?: string): void;
  appendDeniedProvenance(
    peerId: string,
    action: "query" | "pull" | "import",
    resourceType: string,
    resourceId: string,
    reason?: string,
  ): SyncProvenance;
  appendProvenance(
    peerId: string,
    action: "query" | "pull" | "import",
    resourceType: string,
    resourceId: string,
    status: string,
    reason?: string,
  ): SyncProvenance;
}

export function queryLocalSyncResources(
  context: SyncResourceOperationContext,
  input: QueryResourcesInput,
  authSecret?: string,
): QueryResourcesResult {
  const peerId = input.peerId?.trim();
  if (!peerId) {
    throw new GatewaySyncError("INVALID_ARGUMENT", "peerId is required");
  }

  context.authorizeInboundPeer(peerId, authSecret);

  const limit = clampLimit(input.limit ?? 100, 1, 500);
  const offset = decodeCursor(input.cursor);
  const requestedTypes = sanitizeStrings(input.types);
  const requestedTags = new Set(sanitizeStrings(input.tags));

  if (requestedTypes.length > 0 && !requestedTypes.includes("artifact")) {
    return {
      resources: [],
      apiVersion: normalizeApiVersion(input.apiVersion),
    };
  }

  const refs = collectQueryableResourceRefs(context, input, peerId, requestedTags);
  const sorted = refs.sort((a, b) => {
    const aTime = a.updatedAt ?? "";
    const bTime = b.updatedAt ?? "";
    if (aTime !== bTime) return aTime.localeCompare(bTime);
    return a.resourceId.localeCompare(b.resourceId);
  });
  const resources = sorted.slice(offset, offset + limit);
  const nextCursor = offset + limit < sorted.length
    ? encodeCursor(offset + limit)
    : undefined;

  return {
    resources,
    nextCursor,
    apiVersion: normalizeApiVersion(input.apiVersion),
  };
}

export function pullLocalSyncResources(
  context: SyncResourceOperationContext,
  input: PullResourcesInput,
  authSecret?: string,
): PullResourcesResult {
  const peerId = input.peerId?.trim();
  if (!peerId || !input.idempotencyKey?.trim()) {
    throw new GatewaySyncError(
      "INVALID_ARGUMENT",
      "peerId and idempotencyKey are required",
    );
  }

  context.authorizeInboundPeer(peerId, authSecret);
  const apiVersion = normalizeApiVersion(input.apiVersion);

  const normalizedRefs = dedupeRefs(input.refs);
  const duplicateCount = Math.max(0, input.refs.length - normalizedRefs.length);
  const requestHash = hashJson({ refs: normalizedRefs });
  const previous = context.syncRepo.getReceipt(peerId, input.idempotencyKey);
  if (previous && previous.request_hash === requestHash) {
    const cached = parsePullResponse(previous.response_payload_json);
    return {
      ...cached,
      apiVersion: cached.apiVersion || apiVersion,
    };
  }

  const resources: SyncResourcePayload[] = [];
  const denied: PullResourcesResult["denied"] = [];
  const provenance: SyncProvenance[] = [];
  const seen = new Set<string>();

  for (const ref of normalizedRefs) {
    const key = `${ref.resourceType}:${ref.resourceId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const pulled = resolvePullResource(context, peerId, ref);
    if (pulled.resource) {
      resources.push(pulled.resource);
      provenance.push(context.appendProvenance(peerId, "pull", ref.resourceType, ref.resourceId, "applied"));
      continue;
    }

    denied.push({ ref, reason: pulled.reason });
    provenance.push(context.appendDeniedProvenance(peerId, "pull", ref.resourceType, ref.resourceId, pulled.provenanceReason));
  }

  const response: PullResourcesResult = {
    resources,
    denied,
    provenance,
    appliedCount: resources.length,
    skippedCount: duplicateCount,
    apiVersion,
  };

  context.syncRepo.putReceipt({
    peerId,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    responsePayloadJson: JSON.stringify(response),
    appliedCount: response.appliedCount,
    skippedCount: response.skippedCount,
  });

  return response;
}

function collectQueryableResourceRefs(
  context: SyncResourceOperationContext,
  input: QueryResourcesInput,
  peerId: string,
  requestedTags: Set<string>,
): QueryResourcesResult["resources"] {
  const refs: QueryResourcesResult["resources"] = [];
  const seenResourceIds = new Set<string>();

  for (const space of listQuerySpaces(context.options, input.resourceId, input.updatedAfter)) {
    const basicRef = buildBasicSyncRef(space);
    if (requestedTags.size > 0 && !basicRef.tags.some((tag) => requestedTags.has(tag))) {
      continue;
    }

    const decision = evaluateQueryDecision(context.options, {
      peerId,
      resourceType: basicRef.resourceType,
      resourceId: basicRef.resourceId,
      artifactType: basicRef.artifactType,
      title: basicRef.title,
      tags: basicRef.tags,
      isGeneratedBasic: basicRef.isGeneratedBasic,
    });
    if (!decision.allowed) {
      context.appendDeniedProvenance(peerId, "query", basicRef.resourceType, basicRef.resourceId, decision.reason);
      continue;
    }

    refs.push(toSyncResourceRef("artifact", basicRef.resourceId, basicRef.updatedAt, basicRef.title, basicRef.tags));
    seenResourceIds.add(basicRef.resourceId);
  }

  for (const artifact of context.artifacts.queryShared({
    resourceId: input.resourceId,
    updatedAfter: input.updatedAfter,
  })) {
    const tags = parseTags(artifact.tags_json);
    if (requestedTags.size > 0 && !tags.some((tag) => requestedTags.has(tag))) {
      continue;
    }

    const isGeneratedBasic = isGeneratedBasicArtifact({
      artifactId: artifact.artifact_id,
      spaceId: artifact.space_id,
      artifactType: artifact.artifact_type,
    });
    if (isGeneratedBasic && seenResourceIds.has(artifact.artifact_id)) {
      continue;
    }

    const decision = evaluateQueryDecision(context.options, {
      peerId,
      resourceType: "artifact",
      resourceId: artifact.artifact_id,
      artifactType: artifact.artifact_type,
      title: artifact.title,
      tags,
      isGeneratedBasic,
    });
    if (!decision.allowed) {
      context.appendDeniedProvenance(peerId, "query", "artifact", artifact.artifact_id, decision.reason);
      continue;
    }

    refs.push(toSyncResourceRef("artifact", artifact.artifact_id, artifact.updated_at, artifact.title, tags));
    seenResourceIds.add(artifact.artifact_id);
  }

  return refs;
}

function resolvePullResource(
  context: SyncResourceOperationContext,
  peerId: string,
  ref: PullResourcesInput["refs"][number],
): { resource?: SyncResourcePayload; reason: string; provenanceReason: string } {
  if (ref.resourceType !== "artifact") {
    return {
      reason: `Unsupported resource type: ${ref.resourceType}`,
      provenanceReason: "unsupported_resource_type",
    };
  }

  const basicSpaceId = getSpaceIdFromBasicArtifactId(ref.resourceId);
  if (basicSpaceId) {
    return resolveBasicSpacePullResource(context, peerId, ref, basicSpaceId);
  }

  const artifact = context.artifacts.getById(ref.resourceId);
  if (!artifact || artifact.visibility !== "shared") {
    return {
      reason: "Resource not found or not shared",
      provenanceReason: "not_found_or_not_shared",
    };
  }

  const artifactTags = parseTags(artifact.tags_json);
  const isGeneratedBasic = isGeneratedBasicArtifact({
    artifactId: artifact.artifact_id,
    spaceId: artifact.space_id,
    artifactType: artifact.artifact_type,
  });
  const policyDecision = evaluatePullDecision(context.options, {
    peerId,
    resourceType: ref.resourceType,
    resourceId: ref.resourceId,
    artifactType: artifact.artifact_type,
    title: artifact.title,
    tags: artifactTags,
    isGeneratedBasic,
  });
  if (!policyDecision.allowed) {
    return {
      reason: policyDecision.reason ?? "Denied by sync policy",
      provenanceReason: policyDecision.reason ?? "policy_denied",
    };
  }

  const content = isGeneratedBasic
    ? resolveGeneratedBasicContentFromArtifact(context.options, artifact.space_id, artifact.artifact_id)
    : {
        spaceId: artifact.space_id,
        resourceId: artifact.resource_id,
        type: artifact.artifact_type,
        title: artifact.title,
        contentJson: artifact.content_json,
        tags: artifactTags,
        visibility: artifact.visibility,
        createdAt: artifact.created_at,
        updatedAt: artifact.updated_at,
      };
  if (!content) {
    return {
      reason: "Source space missing for basic.md export",
      provenanceReason: "source_space_missing",
    };
  }

  return {
    reason: "",
    provenanceReason: "",
    resource: {
      ref: toSyncResourceRef("artifact", artifact.artifact_id, artifact.updated_at, artifact.title, artifactTags),
      content,
    },
  };
}

function resolveBasicSpacePullResource(
  context: SyncResourceOperationContext,
  peerId: string,
  ref: PullResourcesInput["refs"][number],
  basicSpaceId: string,
): { resource?: SyncResourcePayload; reason: string; provenanceReason: string } {
  if (!context.options.spaceRepo) {
    return {
      reason: "Space repository unavailable for basic.md export",
      provenanceReason: "space_repo_unavailable",
    };
  }

  const space = context.options.spaceRepo.getById(basicSpaceId);
  if (!space) {
    return {
      reason: "Resource not found or not shared",
      provenanceReason: "not_found_or_not_shared",
    };
  }

  const basicRef = buildBasicSyncRef(space);
  const policyDecision = evaluatePullDecision(context.options, {
    peerId,
    resourceType: ref.resourceType,
    resourceId: ref.resourceId,
    artifactType: basicRef.artifactType,
    title: basicRef.title,
    tags: basicRef.tags,
    isGeneratedBasic: true,
  });
  if (!policyDecision.allowed) {
    return {
      reason: policyDecision.reason ?? "Denied by sync policy",
      provenanceReason: policyDecision.reason ?? "policy_denied",
    };
  }

  return {
    reason: "",
    provenanceReason: "",
    resource: {
      ref: toSyncResourceRef("artifact", basicRef.resourceId, basicRef.updatedAt, basicRef.title, basicRef.tags),
      content: buildBasicSyncContent(space),
    },
  };
}

function evaluateQueryDecision(
  options: GatewaySyncServiceOptions,
  context: SyncPolicyContext,
): SyncPolicyDecision {
  const decision = options.evaluateQueryPolicy?.(context);
  if (decision) return decision;
  return defaultSyncPolicyDecision(context);
}

function evaluatePullDecision(
  options: GatewaySyncServiceOptions,
  context: SyncPolicyContext,
): SyncPolicyDecision {
  const decision = options.evaluatePullPolicy?.(context);
  if (decision) return decision;
  return defaultSyncPolicyDecision(context);
}

function defaultSyncPolicyDecision(context: SyncPolicyContext): SyncPolicyDecision {
  if (context.resourceType === "artifact") {
    if (context.isGeneratedBasic || context.artifactType === BASIC_SPACE_ARTIFACT_TYPE) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: "Sync artifacts are restricted to basic.md by default",
    };
  }
  return { allowed: true };
}

function listQuerySpaces(
  options: GatewaySyncServiceOptions,
  resourceId?: string,
  updatedAfter?: string,
) {
  if (!options.spaceRepo) return [];
  const spaces = options.spaceRepo.list({ resourceId });
  if (!updatedAfter) return spaces;
  return spaces.filter((space) => space.updated_at >= updatedAfter);
}

function resolveGeneratedBasicContentFromArtifact(
  options: GatewaySyncServiceOptions,
  artifactSpaceId: string,
  artifactId: string,
): Record<string, unknown> | null {
  if (!options.spaceRepo) {
    return null;
  }

  const spaceId = artifactSpaceId || getSpaceIdFromBasicArtifactId(artifactId);
  if (!spaceId) return null;

  const sourceSpace = options.spaceRepo.getById(spaceId);
  if (!sourceSpace) return null;

  return buildBasicSyncContent(sourceSpace);
}

function toSyncResourceRef(
  resourceType: "artifact",
  resourceId: string,
  updatedAt: string,
  title: string,
  tags: string[],
) {
  return {
    type: resourceType,
    id: resourceId,
    versionHash: computeSyncRefVersionHash({
      resourceType,
      resourceId,
      updatedAt,
      tags,
    }),
    resourceType,
    resourceId,
    title,
    updatedAt,
    tags,
  };
}

