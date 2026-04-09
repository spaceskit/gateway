/**
 * Space artifact repository — cross-space addressable outputs.
 */

import type { Database } from "bun:sqlite";

export interface ArtifactRow {
  artifact_id: string;
  space_id: string;
  resource_id: string;
  turn_id: string;
  agent_id: string;
  artifact_type: string;
  retention_scope: string;
  title: string;
  mime_type: string;
  size_bytes: number;
  content_json: string;
  tags_json: string;
  visibility: string;
  created_at: string;
  updated_at: string;
}

export interface CreateArtifactInput {
  artifactId: string;
  spaceId: string;
  resourceId: string;
  turnId?: string;
  agentId?: string;
  type: string;
  retentionScope?: string;
  title: string;
  mimeType?: string;
  sizeBytes?: number;
  contentJson: string;
  tagsJson?: string;
  visibility?: "shared" | "private";
}

export class ArtifactRepository {
  constructor(private db: Database) {
    this.ensureCanonicalColumns();
  }

  create(input: CreateArtifactInput): ArtifactRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO space_artifacts(
        artifact_id, space_id, resource_id, turn_id, agent_id, artifact_type, title,
        retention_scope, mime_type, size_bytes, content_json, tags_json, visibility, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.artifactId,
      input.spaceId,
      input.resourceId,
      input.turnId ?? "",
      input.agentId ?? "",
      input.type,
      input.title,
      input.retentionScope ?? "space_local",
      input.mimeType ?? "",
      resolveSizeBytes(input),
      input.contentJson,
      input.tagsJson ?? "[]",
      input.visibility ?? "shared",
      now,
      now,
    );
    return this.getById(input.artifactId)!;
  }

  getById(artifactId: string): ArtifactRow | undefined {
    return this.db
      .query("SELECT * FROM space_artifacts WHERE artifact_id = ?")
      .get(artifactId) as ArtifactRow | undefined ?? undefined;
  }

  listBySpace(spaceId: string): ArtifactRow[] {
    return this.db
      .query("SELECT * FROM space_artifacts WHERE space_id = ? ORDER BY updated_at DESC")
      .all(spaceId) as ArtifactRow[];
  }

  listBySpacePaged(spaceId: string, limit = 100, offset = 0): ArtifactRow[] {
    return this.db
      .query(`
        SELECT * FROM space_artifacts
        WHERE space_id = ?
        ORDER BY updated_at DESC, artifact_id ASC
        LIMIT ? OFFSET ?
      `)
      .all(spaceId, Math.max(1, Math.floor(limit)), Math.max(0, Math.floor(offset))) as ArtifactRow[];
  }

  countBySpace(spaceId: string): number {
    const row = this.db
      .query("SELECT COUNT(*) as total FROM space_artifacts WHERE space_id = ?")
      .get(spaceId) as { total?: number } | undefined;
    return row?.total ?? 0;
  }

  listBySpaceAndTurnPaged(spaceId: string, turnId: string, limit = 100, offset = 0): ArtifactRow[] {
    return this.db
      .query(`
        SELECT * FROM space_artifacts
        WHERE space_id = ?
          AND turn_id = ?
        ORDER BY updated_at DESC, artifact_id ASC
        LIMIT ? OFFSET ?
      `)
      .all(
        spaceId,
        turnId,
        Math.max(1, Math.floor(limit)),
        Math.max(0, Math.floor(offset)),
      ) as ArtifactRow[];
  }

  countBySpaceAndTurn(spaceId: string, turnId: string): number {
    const row = this.db
      .query("SELECT COUNT(*) as total FROM space_artifacts WHERE space_id = ? AND turn_id = ?")
      .get(spaceId, turnId) as { total?: number } | undefined;
    return row?.total ?? 0;
  }

  /** Query shared artifacts across all spaces on the same resource. */
  listSharedByResource(resourceId: string): ArtifactRow[] {
    return this.db
      .query("SELECT * FROM space_artifacts WHERE resource_id = ? AND visibility = 'shared' ORDER BY updated_at DESC")
      .all(resourceId) as ArtifactRow[];
  }

  queryShared(options: {
    resourceId?: string;
    updatedAfter?: string;
    limit?: number;
    offset?: number;
  } = {}): ArtifactRow[] {
    const where: string[] = ["visibility = 'shared'"];
    const values: Array<string | number> = [];

    if (options.resourceId) {
      where.push("resource_id = ?");
      values.push(options.resourceId);
    }
    if (options.updatedAfter) {
      where.push("updated_at >= ?");
      values.push(options.updatedAfter);
    }

    let sql = `SELECT * FROM space_artifacts WHERE ${where.join(" AND ")} ORDER BY updated_at ASC, artifact_id ASC`;

    if (typeof options.limit === "number" && options.limit > 0) {
      sql += " LIMIT ?";
      values.push(options.limit);
    }
    if (typeof options.offset === "number" && options.offset > 0) {
      sql += " OFFSET ?";
      values.push(options.offset);
    }

    return this.db.query(sql).all(...values) as ArtifactRow[];
  }

  update(artifactId: string, fields: { title?: string; contentJson?: string; tagsJson?: string; visibility?: string }): void {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];

    if (fields.title !== undefined) { sets.push("title = ?"); values.push(fields.title); }
    if (fields.contentJson !== undefined) { sets.push("content_json = ?"); values.push(fields.contentJson); }
    if (fields.tagsJson !== undefined) { sets.push("tags_json = ?"); values.push(fields.tagsJson); }
    if (fields.visibility !== undefined) { sets.push("visibility = ?"); values.push(fields.visibility); }

    if (sets.length === 0) return;

    sets.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(artifactId);

    this.db.query(`UPDATE space_artifacts SET ${sets.join(", ")} WHERE artifact_id = ?`).run(...values);
  }

  delete(artifactId: string): boolean {
    return this.db.query("DELETE FROM space_artifacts WHERE artifact_id = ?").run(artifactId).changes > 0;
  }

  deleteBySpace(
    spaceId: string,
    options: {
      createdAtGte?: string;
      createdAtLte?: string;
      retentionScope?: string;
    } = {},
  ): number {
    const where = ["space_id = ?"];
    const values: Array<string | number> = [spaceId];
    if (options.createdAtGte) {
      where.push("created_at >= ?");
      values.push(options.createdAtGte);
    }
    if (options.createdAtLte) {
      where.push("created_at <= ?");
      values.push(options.createdAtLte);
    }
    if (options.retentionScope) {
      where.push("retention_scope = ?");
      values.push(options.retentionScope);
    }
    return this.db
      .query(`DELETE FROM space_artifacts WHERE ${where.join(" AND ")}`)
      .run(...values).changes;
  }

  private ensureCanonicalColumns(): void {
    const columns = this.db
      .query("PRAGMA table_info(space_artifacts)")
      .all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));
    if (!columnNames.has("retention_scope")) {
      this.db.exec(
        "ALTER TABLE space_artifacts ADD COLUMN retention_scope TEXT NOT NULL DEFAULT 'space_local'",
      );
    }
  }
}

function resolveSizeBytes(input: CreateArtifactInput): number {
  if (typeof input.sizeBytes === "number" && Number.isFinite(input.sizeBytes) && input.sizeBytes >= 0) {
    return Math.floor(input.sizeBytes);
  }
  return Buffer.byteLength(input.contentJson, "utf8");
}
