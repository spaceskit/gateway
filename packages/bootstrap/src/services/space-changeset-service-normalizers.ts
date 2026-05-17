import type {
  SpaceChangeSetFileRow,
  SpaceChangeSetReviewRow,
  SpaceChangeSetRow,
} from "@spaceskit/persistence";
import type {
  ChangeSet,
  ChangeSetFile,
  ChangeSetReview,
} from "./space-changeset-service.js";

export function mapChangeSet(row: SpaceChangeSetRow): ChangeSet {
  return {
    changeSetId: row.changeset_id,
    spaceId: row.space_id,
    participantId: normalizeOptional(row.participant_id),
    createdByPrincipalId: row.created_by_principal_id,
    status: row.status,
    title: normalizeOptional(row.title),
    description: normalizeOptional(row.description),
    adapter: row.adapter,
    targetBranch: normalizeOptional(row.target_branch),
    workspaceBasePath: normalizeOptional(row.workspace_base_path),
    submittedAt: normalizeOptional(row.submitted_at ?? undefined),
    reviewedAt: normalizeOptional(row.reviewed_at ?? undefined),
    appliedAt: normalizeOptional(row.applied_at ?? undefined),
    expiresAt: normalizeOptional(row.expires_at ?? undefined),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapChangeSetFile(row: SpaceChangeSetFileRow): ChangeSetFile {
  return {
    relativePath: row.relative_path,
    stagedPath: row.staged_path,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    changeType: row.change_type,
    createdAt: row.created_at,
  };
}

export function mapChangeSetReview(row: SpaceChangeSetReviewRow): ChangeSetReview {
  return {
    reviewId: row.review_id,
    changeSetId: row.changeset_id,
    reviewerPrincipalId: row.reviewer_principal_id,
    decision: row.decision,
    comment: normalizeOptional(row.comment),
    diffSummary: parseObject(row.diff_summary_json),
    createdAt: row.created_at,
  };
}

export function parseObject(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore parse failures.
  }
  return undefined;
}

export function parseJsonRecord(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore parse failures and treat as empty object.
  }
  return {};
}

export function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeParticipantMode(value: string): "read_only" | "collaborator" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "read_only" || normalized === "collaborator") {
    return normalized;
  }
  return "read_only";
}

export function resolveModeratorPrincipalIds(config: Record<string, unknown>): string[] {
  const direct = normalizeStringArray(config.changeSetModerators);
  if (direct.length > 0) return direct;
  const principalIds = normalizeStringArray(config.changeSetModeratorPrincipalIds);
  if (principalIds.length > 0) return principalIds;
  return [];
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  ));
}
