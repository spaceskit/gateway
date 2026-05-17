import {
  ArtifactRepository,
  SyncRuntimeRepository,
} from "@spaceskit/persistence";
import {
  asNonEmptyString,
  clampLimit,
  coerceContentJson,
  deterministicImportArtifactId,
  ensureTrailingSlash,
  hashSecret,
  isRecord,
  mapRemoteStatusToError,
  normalizeApiVersion,
  normalizeAuthHash,
  normalizeHttpBaseUrl,
  parseUnknownTags,
} from "./sync-service-normalizers.js";
import {
  pullLocalSyncResources,
  queryLocalSyncResources,
} from "./sync-service-resource-operations.js";
import { GatewaySyncError } from "./sync-service-types.js";
import type {
  AnnouncePeerInput,
  AnnouncePeerResult,
  GatewaySyncServiceOptions,
  PullResourcesInput,
  PullResourcesResult,
  QueryResourcesInput,
  QueryResourcesResult,
  SyncFromPeerInput,
  SyncFromPeerResult,
  SyncProvenance,
  SyncResourcePayload,
} from "./sync-service-types.js";

export { GatewaySyncError } from "./sync-service-types.js";
export type {
  AnnouncePeerInput,
  AnnouncePeerResult,
  GatewaySyncServiceOptions,
  PullResourcesInput,
  PullResourcesResult,
  QueryResourcesInput,
  QueryResourcesResult,
  SyncFromPeerInput,
  SyncFromPeerResult,
  SyncPolicyContext,
  SyncPolicyDecision,
  SyncProvenance,
  SyncResourceDenied,
  SyncResourcePayload,
  SyncResourceRef,
  SyncServiceLogger,
} from "./sync-service-types.js";

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
    return queryLocalSyncResources(this.resourceOperationContext(), input, authSecret);
  }

  pullResources(input: PullResourcesInput, authSecret?: string): PullResourcesResult {
    return pullLocalSyncResources(this.resourceOperationContext(), input, authSecret);
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

  private resourceOperationContext() {
    return {
      syncRepo: this.syncRepo,
      artifacts: this.artifacts,
      options: this.options,
      authorizeInboundPeer: (peerId: string, providedSecret?: string) =>
        this.authorizeInboundPeer(peerId, providedSecret),
      appendDeniedProvenance: (
        peerId: string,
        action: "query" | "pull" | "import",
        resourceType: string,
        resourceId: string,
        reason?: string,
      ) => this.appendDeniedProvenance(peerId, action, resourceType, resourceId, reason),
      appendProvenance: (
        peerId: string,
        action: "query" | "pull" | "import",
        resourceType: string,
        resourceId: string,
        status: string,
        reason?: string,
      ) => this.appendProvenance(peerId, action, resourceType, resourceId, status, reason),
    };
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
