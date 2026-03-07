import type { Database } from "bun:sqlite";

export type ChangeSetFileType = "added" | "modified" | "deleted";

export interface SpaceChangeSetFileRow {
  id: number;
  changeset_id: string;
  relative_path: string;
  staged_path: string;
  sha256: string;
  size_bytes: number;
  change_type: ChangeSetFileType;
  created_at: string;
}

export interface UpsertSpaceChangeSetFileInput {
  changeSetId: string;
  relativePath: string;
  stagedPath: string;
  sha256: string;
  sizeBytes: number;
  changeType?: ChangeSetFileType;
}

export class SpaceChangeSetFileRepository {
  constructor(private readonly db: Database) {}

  get(changeSetId: string, relativePath: string): SpaceChangeSetFileRow | undefined {
    return this.db.query(`
      SELECT * FROM space_changeset_files
      WHERE changeset_id = ?
        AND relative_path = ?
    `).get(changeSetId, relativePath) as SpaceChangeSetFileRow | undefined ?? undefined;
  }

  upsert(input: UpsertSpaceChangeSetFileInput): SpaceChangeSetFileRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO space_changeset_files(
        changeset_id,
        relative_path,
        staged_path,
        sha256,
        size_bytes,
        change_type,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(changeset_id, relative_path) DO UPDATE SET
        staged_path = excluded.staged_path,
        sha256 = excluded.sha256,
        size_bytes = excluded.size_bytes,
        change_type = excluded.change_type
    `).run(
      input.changeSetId,
      input.relativePath,
      input.stagedPath,
      input.sha256,
      Math.max(0, Math.floor(input.sizeBytes)),
      input.changeType ?? "modified",
      now,
    );

    return this.get(input.changeSetId, input.relativePath)!;
  }

  listByChangeSet(changeSetId: string): SpaceChangeSetFileRow[] {
    return this.db.query(`
      SELECT * FROM space_changeset_files
      WHERE changeset_id = ?
      ORDER BY relative_path ASC
    `).all(changeSetId) as SpaceChangeSetFileRow[];
  }

  sumSizeByChangeSet(changeSetId: string): number {
    const row = this.db.query(`
      SELECT COALESCE(SUM(size_bytes), 0) AS total
      FROM space_changeset_files
      WHERE changeset_id = ?
    `).get(changeSetId) as { total: number };
    return row.total ?? 0;
  }

  sumSizeBySpace(spaceId: string): number {
    const row = this.db.query(`
      SELECT COALESCE(SUM(f.size_bytes), 0) AS total
      FROM space_changeset_files f
      INNER JOIN space_changesets c ON c.changeset_id = f.changeset_id
      WHERE c.space_id = ?
        AND c.status IN ('draft', 'uploaded', 'pending_review', 'approved')
    `).get(spaceId) as { total: number };
    return row.total ?? 0;
  }

  sumSizeBySpaceAndPrincipal(spaceId: string, principalId: string): number {
    const row = this.db.query(`
      SELECT COALESCE(SUM(f.size_bytes), 0) AS total
      FROM space_changeset_files f
      INNER JOIN space_changesets c ON c.changeset_id = f.changeset_id
      WHERE c.space_id = ?
        AND c.created_by_principal_id = ?
        AND c.status IN ('draft', 'uploaded', 'pending_review', 'approved')
    `).get(spaceId, principalId) as { total: number };
    return row.total ?? 0;
  }

  deleteByChangeSet(changeSetId: string): number {
    return this.db.query(`
      DELETE FROM space_changeset_files
      WHERE changeset_id = ?
    `).run(changeSetId).changes;
  }
}
