import { createHash } from "node:crypto";
import {
  ArtifactRepository,
  SyncRuntimeRepository,
  SpaceRepository,
  type ArtifactRow,
  type SpaceRow,
} from "@spaceskit/persistence";
import {
  BASIC_SPACE_ARTIFACT_TYPE,
  buildBasicSyncContent,
  buildBasicSyncRef,
  getSpaceIdFromBasicArtifactId,
  isGeneratedBasicArtifact,
} from "./basic-space-export.js";

export interface SyncResourceRef {
  type?: string;
  id?: string;
  versionHash?: string;
  resourceType: string;
  resourceId: string;
  title?: string;
  updatedAt?: string;
  tags?: string[];
}

export interface SyncResourcePayload {
  ref: SyncResourceRef;
  content: Record<string, unknown>;
}

export interface SyncResourceDenied {
  ref: SyncResourceRef;
  reason: string;
}

export interface SyncProvenance {
  peerId: string;
  ref: SyncResourceRef;
  action: string;
  status: string;
  reason?: string;
  pulledAt: string;
}

export interface QueryResourcesInput {
  apiVersion?: string;
  peerId: string;
  resourceId?: string;
  types?: string[];
  tags?: string[];
  updatedAfter?: string;
  cursor?: string;
  limit?: number;
}

export interface QueryResourcesResult {
  resources: SyncResourceRef[];
  nextCursor?: string;
  apiVersion: string;
}

export interface PullResourcesInput {
  apiVersion?: string;
  peerId: string;
  idempotencyKey: string;
  refs: SyncResourceRef[];
}

export interface PullResourcesResult {
  resources: SyncResourcePayload[];
  denied: SyncResourceDenied[];
  provenance: SyncProvenance[];
  appliedCount: number;
  skippedCount: number;
  apiVersion: string;
}

export interface AnnouncePeerInput {
  apiVersion?: string;
  peerId: string;
  resourceId: string;
  gatewayVersion: string;
  endpointUrl?: string;
  authSecretHash?: string;
  skillCount?: number;
  actionCount?: number;
  experienceCount?: number;
  profileCount?: number;
}

export interface AnnouncePeerResult {
  peerId: string;
  resourceId: string;
  gatewayVersion: string;
  syncEnabled: boolean;
  announcedAt: string;
  apiVersion: string;
}

export interface SyncFromPeerInput {
  peerId: string;
  targetSpaceId: string;
  resourceId?: string;
  types?: string[];
  tags?: string[];
  limit?: number;
  maxPages?: number;
  idempotencyKeyPrefix?: string;
}

export interface SyncFromPeerResult {
  peerId: string;
  targetSpaceId: string;
  pages: number;
  queriedCount: number;
  pulledCount: number;
  importedCount: number;
  skippedCount: number;
  deniedCount: number;
  nextCursor?: string;
}

export interface SyncServiceLogger {
  info?: (message: string, fields?: Record<string, unknown>) => void;
  warn?: (message: string, fields?: Record<string, unknown>) => void;
  error?: (message: string, error?: unknown, fields?: Record<string, unknown>) => void;
}

export interface SyncPolicyDecision {
  allowed: boolean;
  reason?: string;
}

export interface SyncPolicyContext {
  peerId: string;
  resourceType: string;
  resourceId: string;
  artifactType?: string;
  title?: string;
  tags?: string[];
  isGeneratedBasic?: boolean;
}

export interface GatewaySyncServiceOptions {
  /** Optional repo used when importing resources from peers. */
  spaceRepo?: SpaceRepository;
  /** Default local peer ID used for outbound peer calls. */
  localPeerId?: string;
  /** Resolve plaintext shared secret for outbound requests to a specific peer. */
  resolvePeerSecret?: (peerId: string) => string | undefined;
  /** Injected fetch implementation for tests. */
  fetchImpl?: typeof fetch;
  /** Remote request timeout in milliseconds. */
  remoteTimeoutMs?: number;
  /** Enable background pull when peers announce themselves. */
  autoPullOnAnnounce?: boolean;
  /** Default target space used by auto pull. */
  autoPullTargetSpaceId?: string;
  /** Optional policy hook for query responses. */
  evaluateQueryPolicy?: (context: SyncPolicyContext) => SyncPolicyDecision;
  /** Optional policy hook for pull responses. */
  evaluatePullPolicy?: (context: SyncPolicyContext) => SyncPolicyDecision;
  logger?: SyncServiceLogger;
}

export class GatewaySyncError extends Error {
  readonly code:
    | "INVALID_ARGUMENT"
    | "NOT_FOUND"
    | "FAILED_PRECONDITION"
    | "PERMISSION_DENIED";

  constructor(
    code: GatewaySyncError["code"],
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

export class DefaultGatewaySyncService {
  private readonly options: Required<Pick<GatewaySyncServiceOptions, "fetchImpl" | "remoteTimeoutMs">> & Omit<GatewaySyncServiceOptions, "fetchImpl" | "remoteTimeoutMs">;

  constructor(
    private readonly syncRepo: SyncRuntimeRepository,
    private readonly artifacts: ArtifactRepository,
    options: GatewaySyncServiceOptions = {},
  ) {
    this.options = {
      ...options,
      fetchImpl: options.fetchImpl ?? fetch,
      remoteTimeoutMs: options.remoteTimeoutMs ?? 10_000,
    };
  }

  announcePeer(input: AnnouncePeerInput): AnnouncePeerResult {
    const peerId = input.peerId?.trim();
    const resourceId = input.resourceId?.trim();
    const gatewayVersion = input.gatewayVersion?.trim();

    if (!peerId || !resourceId || !gatewayVersion) {
      throw new GatewaySyncError(
        "INVALID_ARGUMENT",
        "peerId, resourceId, and gatewayVersion are required",
      );
    }

    const peer = this.syncRepo.upsertPeer({
      peerId,
      resourceId,
      gatewayVersion,
      endpointUrl: input.endpointUrl,
      authSecretHash: normalizeAuthHash(input.authSecretHash),
      skillCount: input.skillCount,
      actionCount: input.actionCount,
      experienceCount: input.experienceCount,
      profileCount: input.profileCount,
      syncEnabled: true,
    });

    // Optional background pull for a newly announced peer.
    if (
      this.options.autoPullOnAnnounce
      && this.options.autoPullTargetSpaceId
      && peer.endpoint_url
      && peerId !== (this.options.localPeerId ?? "")
    ) {
      void this.syncFromPeer({
        peerId,
        targetSpaceId: this.options.autoPullTargetSpaceId,
      }).catch((error) => {
        this.options.logger?.warn?.("Auto peer pull failed", {
          peerId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    return {
      peerId: peer.peer_id,
      resourceId: peer.resource_id,
      gatewayVersion: peer.gateway_version,
      syncEnabled: peer.sync_enabled === 1,
      announcedAt: peer.last_announced_at ?? peer.updated_at,
      apiVersion: normalizeApiVersion(input.apiVersion),
    };
  }

  queryResources(input: QueryResourcesInput, authSecret?: string): QueryResourcesResult {
    const peerId = input.peerId?.trim();
    if (!peerId) {
      throw new GatewaySyncError("INVALID_ARGUMENT", "peerId is required");
    }

    this.authorizeInboundPeer(peerId, authSecret);

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

    const refs: SyncResourceRef[] = [];
    const seenResourceIds = new Set<string>();

    for (const space of this.listQuerySpaces(input.resourceId, input.updatedAfter)) {
      const basicRef = buildBasicSyncRef(space);
      if (requestedTags.size > 0 && !basicRef.tags.some((tag) => requestedTags.has(tag))) {
        continue;
      }

      const decision = this.evaluateQueryDecision({
        peerId,
        resourceType: basicRef.resourceType,
        resourceId: basicRef.resourceId,
        artifactType: basicRef.artifactType,
        title: basicRef.title,
        tags: basicRef.tags,
        isGeneratedBasic: basicRef.isGeneratedBasic,
      });
      if (!decision.allowed) {
        this.appendDeniedProvenance(peerId, "query", basicRef.resourceType, basicRef.resourceId, decision.reason);
        continue;
      }

      refs.push({
        type: basicRef.resourceType,
        id: basicRef.resourceId,
        versionHash: computeSyncRefVersionHash({
          resourceType: basicRef.resourceType,
          resourceId: basicRef.resourceId,
          updatedAt: basicRef.updatedAt,
          tags: basicRef.tags,
        }),
        resourceType: basicRef.resourceType,
        resourceId: basicRef.resourceId,
        title: basicRef.title,
        updatedAt: basicRef.updatedAt,
        tags: basicRef.tags,
      });
      seenResourceIds.add(basicRef.resourceId);
    }

    const artifacts = this.artifacts.queryShared({
      resourceId: input.resourceId,
      updatedAfter: input.updatedAfter,
    });

    for (const artifact of artifacts) {
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

      const decision = this.evaluateQueryDecision({
        peerId,
        resourceType: "artifact",
        resourceId: artifact.artifact_id,
        artifactType: artifact.artifact_type,
        title: artifact.title,
        tags,
        isGeneratedBasic,
      });
      if (!decision.allowed) {
        this.appendDeniedProvenance(peerId, "query", "artifact", artifact.artifact_id, decision.reason);
        continue;
      }

      refs.push({
        type: "artifact",
        id: artifact.artifact_id,
        versionHash: computeSyncRefVersionHash({
          resourceType: "artifact",
          resourceId: artifact.artifact_id,
          updatedAt: artifact.updated_at,
          tags,
        }),
        resourceType: "artifact",
        resourceId: artifact.artifact_id,
        title: artifact.title,
        updatedAt: artifact.updated_at,
        tags,
      });
      seenResourceIds.add(artifact.artifact_id);
    }

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

  pullResources(input: PullResourcesInput, authSecret?: string): PullResourcesResult {
    const peerId = input.peerId?.trim();
    if (!peerId || !input.idempotencyKey?.trim()) {
      throw new GatewaySyncError(
        "INVALID_ARGUMENT",
        "peerId and idempotencyKey are required",
      );
    }

    this.authorizeInboundPeer(peerId, authSecret);
    const apiVersion = normalizeApiVersion(input.apiVersion);

    const normalizedRefs = dedupeRefs(input.refs);
    const duplicateCount = Math.max(0, input.refs.length - normalizedRefs.length);
    const requestHash = hashJson({ refs: normalizedRefs });
    const previous = this.syncRepo.getReceipt(peerId, input.idempotencyKey);
    if (previous && previous.request_hash === requestHash) {
      const cached = parsePullResponse(previous.response_payload_json);
      return {
        ...cached,
        apiVersion: cached.apiVersion || apiVersion,
      };
    }

    const resources: SyncResourcePayload[] = [];
    const denied: SyncResourceDenied[] = [];
    const provenance: SyncProvenance[] = [];
    const seen = new Set<string>();

    for (const ref of normalizedRefs) {
      const key = `${ref.resourceType}:${ref.resourceId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      if (ref.resourceType !== "artifact") {
        denied.push({ ref, reason: `Unsupported resource type: ${ref.resourceType}` });
        provenance.push(this.appendDeniedProvenance(
          peerId,
          "pull",
          ref.resourceType,
          ref.resourceId,
          "unsupported_resource_type",
        ));
        continue;
      }

      const basicSpaceId = getSpaceIdFromBasicArtifactId(ref.resourceId);
      if (basicSpaceId) {
        if (!this.options.spaceRepo) {
          denied.push({ ref, reason: "Space repository unavailable for basic.md export" });
          provenance.push(this.appendDeniedProvenance(peerId, "pull", ref.resourceType, ref.resourceId, "space_repo_unavailable"));
          continue;
        }

        const space = this.options.spaceRepo.getById(basicSpaceId);
        if (!space) {
          denied.push({ ref, reason: "Resource not found or not shared" });
          provenance.push(this.appendDeniedProvenance(peerId, "pull", ref.resourceType, ref.resourceId, "not_found_or_not_shared"));
          continue;
        }

        const basicRef = buildBasicSyncRef(space);
        const policyDecision = this.evaluatePullDecision({
          peerId,
          resourceType: ref.resourceType,
          resourceId: ref.resourceId,
          artifactType: basicRef.artifactType,
          title: basicRef.title,
          tags: basicRef.tags,
          isGeneratedBasic: true,
        });
        if (!policyDecision.allowed) {
          denied.push({ ref, reason: policyDecision.reason ?? "Denied by sync policy" });
          provenance.push(this.appendDeniedProvenance(peerId, "pull", ref.resourceType, ref.resourceId, policyDecision.reason));
          continue;
        }

        resources.push({
          ref: {
            type: "artifact",
            id: basicRef.resourceId,
            versionHash: computeSyncRefVersionHash({
              resourceType: "artifact",
              resourceId: basicRef.resourceId,
              updatedAt: basicRef.updatedAt,
              tags: basicRef.tags,
            }),
            resourceType: "artifact",
            resourceId: basicRef.resourceId,
            title: basicRef.title,
            updatedAt: basicRef.updatedAt,
            tags: basicRef.tags,
          },
          content: buildBasicSyncContent(space),
        });
        provenance.push(this.appendProvenance(
          peerId,
          "pull",
          ref.resourceType,
          ref.resourceId,
          "applied",
        ));
        continue;
      }

      const artifact = this.artifacts.getById(ref.resourceId);
      if (!artifact || artifact.visibility !== "shared") {
        denied.push({ ref, reason: "Resource not found or not shared" });
        provenance.push(this.appendDeniedProvenance(peerId, "pull", ref.resourceType, ref.resourceId, "not_found_or_not_shared"));
        continue;
      }

      const artifactTags = parseTags(artifact.tags_json);
      const artifactType = artifact.artifact_type;
      const isGeneratedBasic = isGeneratedBasicArtifact({
        artifactId: artifact.artifact_id,
        spaceId: artifact.space_id,
        artifactType,
      });
      const policyDecision = this.evaluatePullDecision({
        peerId,
        resourceType: ref.resourceType,
        resourceId: ref.resourceId,
        artifactType,
        title: artifact.title,
        tags: artifactTags,
        isGeneratedBasic,
      });
      if (!policyDecision.allowed) {
        denied.push({ ref, reason: policyDecision.reason ?? "Denied by sync policy" });
        provenance.push(this.appendDeniedProvenance(peerId, "pull", ref.resourceType, ref.resourceId, policyDecision.reason));
        continue;
      }

      const content = isGeneratedBasic
        ? this.resolveGeneratedBasicContentFromArtifact(artifact)
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
        denied.push({ ref, reason: "Source space missing for basic.md export" });
        provenance.push(this.appendDeniedProvenance(peerId, "pull", ref.resourceType, ref.resourceId, "source_space_missing"));
        continue;
      }

      resources.push({
        ref: {
          type: "artifact",
          id: artifact.artifact_id,
          versionHash: computeSyncRefVersionHash({
            resourceType: "artifact",
            resourceId: artifact.artifact_id,
            updatedAt: artifact.updated_at,
            tags: artifactTags,
          }),
          resourceType: "artifact",
          resourceId: artifact.artifact_id,
          title: artifact.title,
          updatedAt: artifact.updated_at,
          tags: artifactTags,
        },
        content,
      });
      provenance.push(this.appendProvenance(
        peerId,
        "pull",
        ref.resourceType,
        ref.resourceId,
        "applied",
      ));
    }

    const response: PullResourcesResult = {
      resources,
      denied,
      provenance,
      appliedCount: resources.length,
      skippedCount: duplicateCount,
      apiVersion,
    };

    this.syncRepo.putReceipt({
      peerId,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      responsePayloadJson: JSON.stringify(response),
      appliedCount: response.appliedCount,
      skippedCount: response.skippedCount,
    });

    return response;
  }

  async syncFromPeer(input: SyncFromPeerInput): Promise<SyncFromPeerResult> {
    const peerId = input.peerId?.trim();
    const targetSpaceId = input.targetSpaceId?.trim();

    if (!peerId || !targetSpaceId) {
      throw new GatewaySyncError(
        "INVALID_ARGUMENT",
        "peerId and targetSpaceId are required",
      );
    }

    if (!this.options.spaceRepo) {
      throw new GatewaySyncError(
        "FAILED_PRECONDITION",
        "Space repository is required for peer sync import",
      );
    }

    const targetSpace = this.options.spaceRepo.getById(targetSpaceId);
    if (!targetSpace) {
      throw new GatewaySyncError("NOT_FOUND", `Target space not found: ${targetSpaceId}`);
    }

    const peer = this.syncRepo.getPeer(peerId);
    if (!peer) {
      throw new GatewaySyncError("NOT_FOUND", `Sync peer not found: ${peerId}`);
    }
    if (peer.sync_enabled !== 1) {
      throw new GatewaySyncError(
        "FAILED_PRECONDITION",
        `Sync peer is disabled: ${peerId}`,
      );
    }

    const baseUrl = normalizeHttpBaseUrl(peer.endpoint_url);
    if (!baseUrl) {
      throw new GatewaySyncError(
        "FAILED_PRECONDITION",
        `Sync peer endpoint URL missing: ${peerId}`,
      );
    }

    const peerSecret = this.options.resolvePeerSecret?.(peerId);
    if (peer.auth_secret_hash && !peerSecret) {
      throw new GatewaySyncError(
        "FAILED_PRECONDITION",
        `Missing sync secret for peer: ${peerId}`,
      );
    }

    const localPeerId = this.options.localPeerId ?? "local";
    const limit = clampLimit(input.limit ?? 100, 1, 500);
    const maxPages = clampLimit(input.maxPages ?? 10, 1, 100);
    const idempotencyPrefix = input.idempotencyKeyPrefix?.trim() || `peer-sync:${peerId}:${targetSpaceId}`;

    let cursor: string | undefined;
    let pages = 0;
    let queriedCount = 0;
    let pulledCount = 0;
    let importedCount = 0;
    let skippedCount = 0;
    let deniedCount = 0;

    while (pages < maxPages) {
      const queryResult = await this.postRemote<QueryResourcesInput, QueryResourcesResult>(
        baseUrl,
        "/sync/query",
        {
          apiVersion: "v2",
          peerId: localPeerId,
          resourceId: input.resourceId,
          types: input.types,
          tags: input.tags,
          cursor,
          limit,
        },
        peerSecret,
      );

      const refs = Array.isArray(queryResult.resources) ? queryResult.resources : [];
      queriedCount += refs.length;
      cursor = queryResult.nextCursor;

      if (refs.length === 0) {
        break;
      }

      const pullResult = await this.postRemote<PullResourcesInput, PullResourcesResult>(
        baseUrl,
        "/sync/pull",
        {
          apiVersion: "v2",
          peerId: localPeerId,
          idempotencyKey: `${idempotencyPrefix}:page:${pages}`,
          refs,
        },
        peerSecret,
      );

      pulledCount += pullResult.resources.length;
      deniedCount += pullResult.denied.length;
      skippedCount += Math.max(0, pullResult.skippedCount);

      const imported = this.importPulledResources(peerId, targetSpaceId, targetSpace.resource_id, pullResult.resources);
      importedCount += imported.importedCount;
      skippedCount += imported.skippedCount;
      deniedCount += imported.deniedCount;

      pages += 1;
      if (!cursor) {
        break;
      }
    }

    return {
      peerId,
      targetSpaceId,
      pages,
      queriedCount,
      pulledCount,
      importedCount,
      skippedCount,
      deniedCount,
      nextCursor: cursor,
    };
  }

  private importPulledResources(
    peerId: string,
    targetSpaceId: string,
    targetResourceId: string,
    pulledResources: SyncResourcePayload[],
  ): { importedCount: number; skippedCount: number; deniedCount: number } {
    let importedCount = 0;
    let skippedCount = 0;
    let deniedCount = 0;

    for (const resource of pulledResources) {
      const ref = resource.ref;
      if (!ref || ref.resourceType !== "artifact" || !ref.resourceId) {
        deniedCount += 1;
        continue;
      }

      const artifactId = deterministicImportArtifactId(peerId, targetSpaceId, ref.resourceType, ref.resourceId);
      const existing = this.artifacts.getById(artifactId);
      if (existing) {
        skippedCount += 1;
        this.syncRepo.appendProvenance({
          peerId,
          resourceType: ref.resourceType,
          resourceId: ref.resourceId,
          action: "import",
          status: "skipped",
          reason: "already_imported",
        });
        continue;
      }

      const content = isRecord(resource.content) ? resource.content : {};
      const type = asNonEmptyString(content.type) ?? "artifact";
      const title = asNonEmptyString(content.title)
        ?? ref.title
        ?? `Imported ${ref.resourceType}:${ref.resourceId}`;
      const tags = parseUnknownTags(content.tags) ?? ref.tags ?? [];
      const contentJson = coerceContentJson(content.contentJson, content);

      this.artifacts.create({
        artifactId,
        spaceId: targetSpaceId,
        resourceId: targetResourceId,
        type,
        title,
        contentJson,
        tagsJson: JSON.stringify(tags),
        visibility: "shared",
      });

      importedCount += 1;
      this.syncRepo.appendProvenance({
        peerId,
        resourceType: ref.resourceType,
        resourceId: ref.resourceId,
        action: "import",
        status: "applied",
      });
    }

    return { importedCount, skippedCount, deniedCount };
  }

  private listQuerySpaces(resourceId?: string, updatedAfter?: string): SpaceRow[] {
    if (!this.options.spaceRepo) return [];
    const spaces = this.options.spaceRepo.list({ resourceId });
    if (!updatedAfter) return spaces;
    return spaces.filter((space) => space.updated_at >= updatedAfter);
  }

  private evaluateQueryDecision(context: SyncPolicyContext): SyncPolicyDecision {
    const decision = this.options.evaluateQueryPolicy?.(context);
    if (decision) return decision;

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

  private evaluatePullDecision(context: SyncPolicyContext): SyncPolicyDecision {
    const decision = this.options.evaluatePullPolicy?.(context);
    if (decision) return decision;

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

  private appendDeniedProvenance(
    peerId: string,
    action: "query" | "pull" | "import",
    resourceType: string,
    resourceId: string,
    reason?: string,
  ): SyncProvenance {
    return this.appendProvenance(
      peerId,
      action,
      resourceType,
      resourceId,
      "denied",
      reason ?? "policy_denied",
    );
  }

  private appendProvenance(
    peerId: string,
    action: "query" | "pull" | "import",
    resourceType: string,
    resourceId: string,
    status: string,
    reason?: string,
  ): SyncProvenance {
    const pulledAt = new Date().toISOString();
    const normalizedReason = reason?.trim() || undefined;
    this.syncRepo.appendProvenance({
      peerId,
      resourceType,
      resourceId,
      action,
      status,
      reason: normalizedReason,
    });
    return {
      peerId,
      ref: {
        type: resourceType,
        id: resourceId,
        resourceType,
        resourceId,
      },
      action,
      status,
      reason: normalizedReason,
      pulledAt,
    };
  }

  private resolveGeneratedBasicContentFromArtifact(
    artifact: ArtifactRow,
  ): Record<string, unknown> | null {
    if (!this.options.spaceRepo) {
      return null;
    }

    const spaceId = artifact.space_id || getSpaceIdFromBasicArtifactId(artifact.artifact_id);
    if (!spaceId) return null;

    const sourceSpace = this.options.spaceRepo.getById(spaceId);
    if (!sourceSpace) return null;

    return buildBasicSyncContent(sourceSpace);
  }

  private authorizeInboundPeer(peerId: string, providedSecret?: string): void {
    const peer = this.syncRepo.getPeer(peerId);
    if (!peer) {
      throw new GatewaySyncError("NOT_FOUND", `Sync peer not found: ${peerId}`);
    }

    if (peer.sync_enabled !== 1) {
      throw new GatewaySyncError(
        "FAILED_PRECONDITION",
        `Sync peer is disabled: ${peerId}`,
      );
    }

    const expectedHash = normalizeAuthHash(peer.auth_secret_hash);
    if (!expectedHash) {
      return;
    }

    const normalizedSecret = providedSecret?.trim();
    if (!normalizedSecret) {
      throw new GatewaySyncError(
        "PERMISSION_DENIED",
        `Sync secret required for peer: ${peerId}`,
      );
    }

    const providedHash = hashSecret(normalizedSecret);
    if (providedHash !== expectedHash) {
      throw new GatewaySyncError(
        "PERMISSION_DENIED",
        `Invalid sync secret for peer: ${peerId}`,
      );
    }
  }

  private async postRemote<TRequest, TResponse>(
    baseUrl: string,
    path: string,
    payload: TRequest,
    authSecret?: string,
  ): Promise<TResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.remoteTimeoutMs);

    try {
      const response = await this.options.fetchImpl(new URL(path, ensureTrailingSlash(baseUrl)).toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authSecret ? { "x-spaceskit-sync-secret": authSecret } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        let message = `Remote sync request failed (${response.status})`;
        try {
          const body = await response.json() as { code?: string; message?: string };
          if (typeof body?.message === "string" && body.message.length > 0) {
            message = body.message;
          }
        } catch {
          // ignore JSON parse errors
        }

        throw mapRemoteStatusToError(response.status, message);
      }

      return await response.json() as TResponse;
    } catch (error) {
      if (error instanceof GatewaySyncError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new GatewaySyncError(
          "FAILED_PRECONDITION",
          `Remote sync request timed out after ${this.options.remoteTimeoutMs}ms`,
        );
      }
      throw new GatewaySyncError(
        "FAILED_PRECONDITION",
        error instanceof Error ? error.message : "Remote sync request failed",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  } catch {
    // Ignore parse errors.
  }
  return [];
}

function parseUnknownTags(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return Array.from(
    new Set(
      raw
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

function sanitizeStrings(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function dedupeRefs(refs: SyncResourceRef[]): SyncResourceRef[] {
  const map = new Map<string, SyncResourceRef>();
  for (const ref of refs) {
    const key = `${ref.resourceType}:${ref.resourceId}`;
    if (!map.has(key)) {
      map.set(key, ref);
    }
  }
  return Array.from(map.values());
}

function clampLimit(limit: number, min: number, max: number): number {
  if (!Number.isFinite(limit)) return min;
  return Math.min(max, Math.max(min, Math.floor(limit)));
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = Number.parseInt(decoded, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function computeSyncRefVersionHash(input: {
  resourceType: string;
  resourceId: string;
  updatedAt?: string;
  tags?: string[];
}): string {
  return hashJson({
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    updatedAt: input.updatedAt ?? "",
    tags: input.tags ?? [],
  });
}

function hashJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function hashSecret(value: string): string {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

function normalizeAuthHash(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function parsePullResponse(raw: string): PullResourcesResult {
  try {
    const parsed = JSON.parse(raw);
    if (isRecord(parsed)) {
      return {
        resources: Array.isArray(parsed.resources)
          ? (parsed.resources as SyncResourcePayload[])
          : [],
        denied: Array.isArray(parsed.denied)
          ? (parsed.denied as SyncResourceDenied[])
          : [],
        provenance: Array.isArray(parsed.provenance)
          ? (parsed.provenance as SyncProvenance[])
          : [],
        appliedCount: asNumber(parsed.appliedCount),
        skippedCount: asNumber(parsed.skippedCount),
        apiVersion: normalizeApiVersion(asNonEmptyString(parsed.apiVersion)),
      };
    }
  } catch {
    // Ignore and fallback.
  }

  return {
    resources: [],
    denied: [],
    provenance: [],
    appliedCount: 0,
    skippedCount: 0,
    apiVersion: "v2",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeApiVersion(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : "v2";
}

function coerceContentJson(value: unknown, fallback: Record<string, unknown>): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify({ value: String(value ?? "") });
  }
}

function deterministicImportArtifactId(
  peerId: string,
  targetSpaceId: string,
  resourceType: string,
  resourceId: string,
): string {
  const digest = hashJson({
    peerId,
    targetSpaceId,
    resourceType,
    resourceId,
  }).slice(0, 24);

  return `artifact-sync-${digest}`;
}

function normalizeHttpBaseUrl(raw: string): string | undefined {
  const normalized = raw.trim();
  if (!normalized) return undefined;

  // Accept ws/wss endpoints and map them to http/https for sync HTTP routes.
  const endpoint = normalized
    .replace(/^ws:\/\//i, "http://")
    .replace(/^wss:\/\//i, "https://");

  try {
    const url = new URL(endpoint);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function mapRemoteStatusToError(status: number, message: string): GatewaySyncError {
  if (status === 400) {
    return new GatewaySyncError("INVALID_ARGUMENT", message);
  }
  if (status === 403) {
    return new GatewaySyncError("PERMISSION_DENIED", message);
  }
  if (status === 404) {
    return new GatewaySyncError("NOT_FOUND", message);
  }

  return new GatewaySyncError("FAILED_PRECONDITION", message);
}
