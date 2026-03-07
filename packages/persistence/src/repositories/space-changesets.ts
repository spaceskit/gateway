import type { Database, SQLQueryBindings } from "bun:sqlite";

export type ChangeSetStatus =
  | "draft"
  | "uploaded"
  | "pending_review"
  | "approved"
  | "applied"
  | "rejected"
  | "expired";

export type ChangeSetAdapter = "filesystem" | "git";

export interface SpaceChangeSetRow {
  changeset_id: string;
  space_id: string;
  participant_id: string;
  created_by_principal_id: string;
  status: ChangeSetStatus;
  title: string;
  description: string;
  adapter: ChangeSetAdapter;
  target_branch: string;
  workspace_base_path: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  applied_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSpaceChangeSetInput {
  changeSetId: string;
  spaceId: string;
  participantId?: string;
  createdByPrincipalId: string;
  status?: ChangeSetStatus;
  title?: string;
  description?: string;
  adapter?: ChangeSetAdapter;
  targetBranch?: string;
  workspaceBasePath?: string;
  expiresAt?: string | null;
}

export interface UpdateSpaceChangeSetInput {
  participantId?: string | null;
  status?: ChangeSetStatus;
  title?: string;
  description?: string;
  adapter?: ChangeSetAdapter;
  targetBranch?: string;
  workspaceBasePath?: string;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  appliedAt?: string | null;
  expiresAt?: string | null;
}

export interface ListSpaceChangeSetsQuery {
  statuses?: ChangeSetStatus[];
  createdByPrincipalId?: string;
  participantId?: string;
  limit?: number;
  offset?: number;
}

const OPEN_CHANGESET_STATUSES: ChangeSetStatus[] = [
  "draft",
  "uploaded",
  "pending_review",
  "approved",
];

export class SpaceChangeSetRepository {
  constructor(private readonly db: Database) {}

  create(input: CreateSpaceChangeSetInput): SpaceChangeSetRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO space_changesets(
        changeset_id,
        space_id,
        participant_id,
        created_by_principal_id,
        status,
        title,
        description,
        adapter,
        target_branch,
        workspace_base_path,
        submitted_at,
        reviewed_at,
        applied_at,
        expires_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)
    `).run(
      input.changeSetId,
      input.spaceId,
      input.participantId ?? "",
      input.createdByPrincipalId,
      input.status ?? "draft",
      input.title ?? "",
      input.description ?? "",
      input.adapter ?? "filesystem",
      input.targetBranch ?? "",
      input.workspaceBasePath ?? "",
      input.expiresAt ?? null,
      now,
      now,
    );
    return this.getById(input.changeSetId)!;
  }

  getById(changeSetId: string): SpaceChangeSetRow | undefined {
    return this.db.query(`
      SELECT * FROM space_changesets
      WHERE changeset_id = ?
    `).get(changeSetId) as SpaceChangeSetRow | undefined ?? undefined;
  }

  listBySpace(spaceId: string, query: ListSpaceChangeSetsQuery = {}): SpaceChangeSetRow[] {
    const statuses = normalizeStatuses(query.statuses);
    const principalId = normalizeOptional(query.createdByPrincipalId);
    const participantId = normalizeOptional(query.participantId);
    const limit = normalizeLimit(query.limit, 200);
    const offset = normalizeOffset(query.offset);

    const clauses = ["space_id = ?"];
    const values: SQLQueryBindings[] = [spaceId];
    if (statuses.length > 0) {
      clauses.push(`status IN (${statuses.map(() => "?").join(", ")})`);
      values.push(...statuses);
    }
    if (principalId) {
      clauses.push("created_by_principal_id = ?");
      values.push(principalId);
    }
    if (participantId) {
      clauses.push("participant_id = ?");
      values.push(participantId);
    }
    values.push(limit, offset);

    return this.db.query(`
      SELECT * FROM space_changesets
      WHERE ${clauses.join(" AND ")}
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `).all(...values) as SpaceChangeSetRow[];
  }

  update(changeSetId: string, patch: UpdateSpaceChangeSetInput): SpaceChangeSetRow | undefined {
    const assignments: string[] = [];
    const values: SQLQueryBindings[] = [];

    if (patch.participantId !== undefined) {
      assignments.push("participant_id = ?");
      values.push(patch.participantId ?? "");
    }
    if (patch.status !== undefined) {
      assignments.push("status = ?");
      values.push(patch.status);
    }
    if (patch.title !== undefined) {
      assignments.push("title = ?");
      values.push(patch.title);
    }
    if (patch.description !== undefined) {
      assignments.push("description = ?");
      values.push(patch.description);
    }
    if (patch.adapter !== undefined) {
      assignments.push("adapter = ?");
      values.push(patch.adapter);
    }
    if (patch.targetBranch !== undefined) {
      assignments.push("target_branch = ?");
      values.push(patch.targetBranch);
    }
    if (patch.workspaceBasePath !== undefined) {
      assignments.push("workspace_base_path = ?");
      values.push(patch.workspaceBasePath);
    }
    if (patch.submittedAt !== undefined) {
      assignments.push("submitted_at = ?");
      values.push(patch.submittedAt ?? null);
    }
    if (patch.reviewedAt !== undefined) {
      assignments.push("reviewed_at = ?");
      values.push(patch.reviewedAt ?? null);
    }
    if (patch.appliedAt !== undefined) {
      assignments.push("applied_at = ?");
      values.push(patch.appliedAt ?? null);
    }
    if (patch.expiresAt !== undefined) {
      assignments.push("expires_at = ?");
      values.push(patch.expiresAt ?? null);
    }

    if (assignments.length === 0) {
      return this.getById(changeSetId);
    }

    assignments.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(changeSetId);

    this.db.query(`
      UPDATE space_changesets
      SET ${assignments.join(", ")}
      WHERE changeset_id = ?
    `).run(...values);

    return this.getById(changeSetId);
  }

  delete(changeSetId: string): boolean {
    return this.db.query(`
      DELETE FROM space_changesets
      WHERE changeset_id = ?
    `).run(changeSetId).changes > 0;
  }

  countOpenBySpace(spaceId: string): number {
    return this.countByStatuses(spaceId, OPEN_CHANGESET_STATUSES);
  }

  countOpenBySpaceAndPrincipal(spaceId: string, principalId: string): number {
    const row = this.db.query(`
      SELECT COUNT(*) AS count
      FROM space_changesets
      WHERE space_id = ?
        AND created_by_principal_id = ?
        AND status IN (${OPEN_CHANGESET_STATUSES.map(() => "?").join(", ")})
    `).get(spaceId, principalId, ...OPEN_CHANGESET_STATUSES) as { count: number };
    return row.count;
  }

  countAppliedBySpaceInRange(spaceId: string, startIso: string, endIso: string): number {
    const row = this.db.query(`
      SELECT COUNT(*) AS count
      FROM space_changesets
      WHERE space_id = ?
        AND status = 'applied'
        AND applied_at IS NOT NULL
        AND applied_at >= ?
        AND applied_at < ?
    `).get(spaceId, startIso, endIso) as { count: number };
    return row.count;
  }

  listStaleDrafts(cutoffIso: string, limit = 200): SpaceChangeSetRow[] {
    const normalizedLimit = normalizeLimit(limit, 200);
    return this.db.query(`
      SELECT * FROM space_changesets
      WHERE status IN ('draft', 'uploaded')
        AND updated_at < ?
      ORDER BY updated_at ASC
      LIMIT ?
    `).all(cutoffIso, normalizedLimit) as SpaceChangeSetRow[];
  }

  listPurgeCandidates(cutoffIso: string, limit = 200): SpaceChangeSetRow[] {
    const normalizedLimit = normalizeLimit(limit, 200);
    return this.db.query(`
      SELECT * FROM space_changesets
      WHERE status IN ('rejected', 'expired')
        AND updated_at < ?
      ORDER BY updated_at ASC
      LIMIT ?
    `).all(cutoffIso, normalizedLimit) as SpaceChangeSetRow[];
  }

  listExpirable(nowIso: string, limit = 200): SpaceChangeSetRow[] {
    const normalizedLimit = normalizeLimit(limit, 200);
    return this.db.query(`
      SELECT * FROM space_changesets
      WHERE status IN ('draft', 'uploaded', 'pending_review', 'approved')
        AND expires_at IS NOT NULL
        AND expires_at <= ?
      ORDER BY expires_at ASC
      LIMIT ?
    `).all(nowIso, normalizedLimit) as SpaceChangeSetRow[];
  }

  private countByStatuses(spaceId: string, statuses: ChangeSetStatus[]): number {
    const row = this.db.query(`
      SELECT COUNT(*) AS count
      FROM space_changesets
      WHERE space_id = ?
        AND status IN (${statuses.map(() => "?").join(", ")})
    `).get(spaceId, ...statuses) as { count: number };
    return row.count;
  }
}

function normalizeStatuses(statuses: ChangeSetStatus[] | undefined): ChangeSetStatus[] {
  if (!Array.isArray(statuses)) return [];
  return Array.from(new Set(statuses.filter((status) => (
    status === "draft"
    || status === "uploaded"
    || status === "pending_review"
    || status === "approved"
    || status === "applied"
    || status === "rejected"
    || status === "expired"
  ))));
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeLimit(limit: number | undefined, fallback: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(limit), 1), 1000);
}

function normalizeOffset(offset: number | undefined): number {
  if (typeof offset !== "number" || !Number.isFinite(offset)) {
    return 0;
  }
  return Math.max(0, Math.floor(offset));
}
