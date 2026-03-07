import { randomUUID } from "node:crypto";
import {
  ArtifactRepository,
  SpaceContextTransferRepository,
  SpaceLinkRepository,
  SpaceRepository,
  type ArtifactRow,
} from "@spaceskit/persistence";
import {
  BASIC_SPACE_ARTIFACT_TYPE,
  basicSpaceArtifactId,
  ensureBasicSpaceArtifact,
  isBasicSpaceAlias,
  isGeneratedBasicArtifact,
} from "./basic-space-export.js";

export type SpaceContextErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "FAILED_PRECONDITION"
  | "PERMISSION_DENIED";

export class SpaceContextError extends Error {
  readonly code: SpaceContextErrorCode;

  constructor(code: SpaceContextErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface SpaceLink {
  sourceSpaceId: string;
  targetSpaceId: string;
  mode: string;
  createdAt: string;
  updatedAt: string;
}

export interface SharedContextRef {
  transferId: string;
  sourceSpaceId: string;
  targetSpaceId: string;
  artifactId: string;
  status: "shared" | "imported" | "denied";
  denialReason?: string;
  createdAt: string;
  appliedAt?: string;
}

export interface SpaceContextTransferResult {
  importedArtifacts: Array<{
    sourceArtifactId: string;
    importedArtifactId: string;
  }>;
  denied: Array<{
    transferId: string;
    reason: string;
  }>;
}

export interface SpaceContextServiceOptions {
  links: SpaceLinkRepository;
  transfers: SpaceContextTransferRepository;
  artifacts: ArtifactRepository;
  spaces: SpaceRepository;
  evaluateSharePolicy?: (
    context: SpaceContextPolicyContext,
  ) => { allowed: boolean; reason?: string };
  evaluateImportPolicy?: (
    context: SpaceContextPolicyContext,
  ) => { allowed: boolean; reason?: string };
}

export interface SpaceContextPolicyContext {
  sourceSpaceId: string;
  targetSpaceId: string;
  artifactId: string;
  artifactType?: string;
  title?: string;
  tags?: string[];
  isGeneratedBasic?: boolean;
}

export class SpaceContextService {
  constructor(private readonly options: SpaceContextServiceOptions) {}

  linkSpaces(sourceSpaceId: string, targetSpaceId: string, mode = "pull"): SpaceLink {
    const sourceId = sourceSpaceId.trim();
    const targetId = targetSpaceId.trim();
    if (!sourceId || !targetId) {
      throw new SpaceContextError("INVALID_ARGUMENT", "sourceSpaceId and targetSpaceId are required");
    }
    if (sourceId === targetId) {
      throw new SpaceContextError("INVALID_ARGUMENT", "sourceSpaceId and targetSpaceId must differ");
    }

    this.assertSpaceExists(sourceId);
    this.assertSpaceExists(targetId);

    return this.mapLink(this.options.links.upsert({
      sourceSpaceId: sourceId,
      targetSpaceId: targetId,
      mode: mode.trim() || "pull",
    }));
  }

  unlinkSpaces(sourceSpaceId: string, targetSpaceId: string): boolean {
    const sourceId = sourceSpaceId.trim();
    const targetId = targetSpaceId.trim();
    if (!sourceId || !targetId) {
      throw new SpaceContextError("INVALID_ARGUMENT", "sourceSpaceId and targetSpaceId are required");
    }
    return this.options.links.delete(sourceId, targetId);
  }

  shareContext(sourceSpaceId: string, targetSpaceId: string, artifactId: string): SharedContextRef {
    const sourceId = sourceSpaceId.trim();
    const targetId = targetSpaceId.trim();
    const normalizedArtifactId = artifactId.trim();
    if (!sourceId || !targetId || !normalizedArtifactId) {
      throw new SpaceContextError(
        "INVALID_ARGUMENT",
        "sourceSpaceId, targetSpaceId, and artifactId are required",
      );
    }

    this.assertLinkExists(sourceId, targetId);

    const resolvedArtifact = this.resolveShareArtifact(sourceId, normalizedArtifactId);
    const policyDecision = this.evaluateShareDecision({
      sourceSpaceId: sourceId,
      targetSpaceId: targetId,
      artifactId: resolvedArtifact.artifact.artifact_id,
      artifactType: resolvedArtifact.artifact.artifact_type,
      title: resolvedArtifact.artifact.title,
      tags: resolvedArtifact.tags,
      isGeneratedBasic: resolvedArtifact.isGeneratedBasic,
    });
    if (!policyDecision.allowed) {
      throw new SpaceContextError(
        "PERMISSION_DENIED",
        policyDecision.reason ?? "Share blocked by policy",
      );
    }

    const row = this.options.transfers.create({
      transferId: `transfer-${randomUUID()}`,
      sourceSpaceId: sourceId,
      targetSpaceId: targetId,
      artifactId: resolvedArtifact.artifact.artifact_id,
      status: "shared",
    });

    return this.mapTransfer(row);
  }

  pullSharedContext(
    sourceSpaceId: string,
    targetSpaceId: string,
    limit = 200,
  ): SpaceContextTransferResult {
    const sourceId = sourceSpaceId.trim();
    const targetId = targetSpaceId.trim();
    if (!sourceId || !targetId) {
      throw new SpaceContextError("INVALID_ARGUMENT", "sourceSpaceId and targetSpaceId are required");
    }

    this.assertLinkExists(sourceId, targetId);
    const targetSpace = this.options.spaces.getById(targetId);
    if (!targetSpace) {
      throw new SpaceContextError("NOT_FOUND", `Target space not found: ${targetId}`);
    }

    const sharedTransfers = this.options.transfers.listShared(sourceId, targetId, limit);
    const importedArtifacts: SpaceContextTransferResult["importedArtifacts"] = [];
    const denied: SpaceContextTransferResult["denied"] = [];

    for (const transfer of sharedTransfers) {
      const sourceArtifact = this.resolveTransferArtifact(sourceId, transfer.artifact_id);
      if (!sourceArtifact) {
        const reason = `Source artifact missing or invalid: ${transfer.artifact_id}`;
        this.options.transfers.markDenied(transfer.transfer_id, reason);
        denied.push({ transferId: transfer.transfer_id, reason });
        continue;
      }

      const policyDecision = this.evaluateImportDecision({
        sourceSpaceId: sourceId,
        targetSpaceId: targetId,
        artifactId: sourceArtifact.artifact.artifact_id,
        artifactType: sourceArtifact.artifact.artifact_type,
        title: sourceArtifact.artifact.title,
        tags: sourceArtifact.tags,
        isGeneratedBasic: sourceArtifact.isGeneratedBasic,
      });
      if (!policyDecision.allowed) {
        const reason = policyDecision.reason ?? "Import blocked by policy";
        this.options.transfers.markDenied(transfer.transfer_id, reason);
        denied.push({ transferId: transfer.transfer_id, reason });
        continue;
      }

      const importedArtifactId = `artifact-${randomUUID()}`;
      this.options.artifacts.create({
        artifactId: importedArtifactId,
        spaceId: targetId,
        resourceId: targetSpace.resource_id,
        type: sourceArtifact.artifact.artifact_type,
        title: sourceArtifact.artifact.title,
        contentJson: sourceArtifact.artifact.content_json,
        tagsJson: sourceArtifact.artifact.tags_json,
        visibility: "shared",
      });

      this.options.transfers.markImported(transfer.transfer_id);
      importedArtifacts.push({
        sourceArtifactId: sourceArtifact.artifact.artifact_id,
        importedArtifactId,
      });
    }

    return { importedArtifacts, denied };
  }

  private resolveShareArtifact(sourceSpaceId: string, requestedArtifactId: string): {
    artifact: ArtifactRow;
    tags: string[];
    isGeneratedBasic: boolean;
  } {
    const canonicalBasicArtifactId = basicSpaceArtifactId(sourceSpaceId);
    const wantsBasicAlias = isBasicSpaceAlias(requestedArtifactId)
      || requestedArtifactId === canonicalBasicArtifactId;

    if (wantsBasicAlias) {
      const sourceSpace = this.options.spaces.getById(sourceSpaceId);
      if (!sourceSpace) {
        throw new SpaceContextError("NOT_FOUND", `Source space not found: ${sourceSpaceId}`);
      }

      try {
        const artifact = ensureBasicSpaceArtifact(this.options.artifacts, sourceSpace);
        return {
          artifact,
          tags: parseTags(artifact.tags_json),
          isGeneratedBasic: true,
        };
      } catch (error) {
        throw new SpaceContextError(
          "FAILED_PRECONDITION",
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    const artifact = this.options.artifacts.getById(requestedArtifactId);
    if (!artifact || artifact.space_id !== sourceSpaceId) {
      throw new SpaceContextError(
        "NOT_FOUND",
        `Artifact not found in source space: ${requestedArtifactId}`,
      );
    }

    return {
      artifact,
      tags: parseTags(artifact.tags_json),
      isGeneratedBasic: isGeneratedBasicArtifact({
        artifactId: artifact.artifact_id,
        spaceId: artifact.space_id,
        artifactType: artifact.artifact_type,
      }),
    };
  }

  private resolveTransferArtifact(sourceSpaceId: string, artifactId: string): {
    artifact: ArtifactRow;
    tags: string[];
    isGeneratedBasic: boolean;
  } | null {
    const canonicalBasicArtifactId = basicSpaceArtifactId(sourceSpaceId);
    if (artifactId === canonicalBasicArtifactId) {
      const sourceSpace = this.options.spaces.getById(sourceSpaceId);
      if (!sourceSpace) return null;
      try {
        const artifact = ensureBasicSpaceArtifact(this.options.artifacts, sourceSpace);
        return {
          artifact,
          tags: parseTags(artifact.tags_json),
          isGeneratedBasic: true,
        };
      } catch {
        return null;
      }
    }

    const artifact = this.options.artifacts.getById(artifactId);
    if (!artifact) return null;

    const isGeneratedBasic = isGeneratedBasicArtifact({
      artifactId: artifact.artifact_id,
      spaceId: artifact.space_id,
      artifactType: artifact.artifact_type,
    });
    if (isGeneratedBasic) {
      const sourceSpace = this.options.spaces.getById(artifact.space_id);
      if (!sourceSpace) return null;
      try {
        const refreshed = ensureBasicSpaceArtifact(this.options.artifacts, sourceSpace);
        return {
          artifact: refreshed,
          tags: parseTags(refreshed.tags_json),
          isGeneratedBasic: true,
        };
      } catch {
        return null;
      }
    }

    return {
      artifact,
      tags: parseTags(artifact.tags_json),
      isGeneratedBasic: false,
    };
  }

  private evaluateShareDecision(context: SpaceContextPolicyContext): { allowed: boolean; reason?: string } {
    const decision = this.options.evaluateSharePolicy?.(context);
    if (decision) return decision;

    if (context.isGeneratedBasic || context.artifactType === BASIC_SPACE_ARTIFACT_TYPE) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: "Cross-space artifacts are restricted to basic.md by default",
    };
  }

  private evaluateImportDecision(context: SpaceContextPolicyContext): { allowed: boolean; reason?: string } {
    const decision = this.options.evaluateImportPolicy?.(context);
    if (decision) return decision;

    if (context.isGeneratedBasic || context.artifactType === BASIC_SPACE_ARTIFACT_TYPE) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: "Cross-space artifacts are restricted to basic.md by default",
    };
  }

  private assertLinkExists(sourceSpaceId: string, targetSpaceId: string): void {
    const link = this.options.links.get(sourceSpaceId, targetSpaceId);
    if (!link) {
      throw new SpaceContextError(
        "FAILED_PRECONDITION",
        `Space link not found: ${sourceSpaceId} -> ${targetSpaceId}`,
      );
    }
  }

  private assertSpaceExists(spaceId: string): void {
    const space = this.options.spaces.getById(spaceId);
    if (!space) {
      throw new SpaceContextError("NOT_FOUND", `Space not found: ${spaceId}`);
    }
  }

  private mapLink(row: ReturnType<SpaceLinkRepository["upsert"]>): SpaceLink {
    return {
      sourceSpaceId: row.source_space_id,
      targetSpaceId: row.target_space_id,
      mode: row.mode,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapTransfer(
    row: ReturnType<SpaceContextTransferRepository["create"]>,
  ): SharedContextRef {
    return {
      transferId: row.transfer_id,
      sourceSpaceId: row.source_space_id,
      targetSpaceId: row.target_space_id,
      artifactId: row.artifact_id,
      status: row.status as SharedContextRef["status"],
      denialReason: row.denial_reason || undefined,
      createdAt: row.created_at,
      appliedAt: row.applied_at || undefined,
    };
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
    // Ignore parse failures.
  }
  return [];
}
