/**
 * Space repository — CRUD operations for spaces (formerly rooms).
 */

import type { Database } from "bun:sqlite";

export interface SpaceRow {
  space_id: string;
  resource_id: string;
  space_type: string;
  name: string;
  goal: string;
  status: string;
  turn_model: string;
  space_config_json: string | null;
  template_id: string;
  template_revision: number;
  archived_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSpaceInput {
  spaceId: string;
  resourceId: string;
  spaceType: string;
  name: string;
  goal: string;
  turnModel?: string;
  configJson?: string;
  templateId?: string;
  templateRevision?: number;
}

export interface UpdateSpaceMetadataInput {
  spaceId: string;
  resourceId?: string;
  spaceType?: string;
  name?: string;
  goal?: string;
  turnModel?: string;
  configJson?: string | null;
}

export interface ListSpacesOptions {
  statuses?: string[];
  resourceId?: string;
  limit?: number;
}

export class SpaceRepository {
  constructor(private db: Database) {}

  create(input: CreateSpaceInput): SpaceRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO spaces(
        space_id, resource_id, space_type, name, goal, status,
        turn_model, space_config_json, template_id, template_revision, archived_at, deleted_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'created', ?, ?, ?, ?, NULL, NULL, ?, ?)
    `).run(
      input.spaceId,
      input.resourceId,
      input.spaceType,
      input.name,
      input.goal,
      input.turnModel ?? "sequential_all",
      input.configJson ?? null,
      input.templateId ?? "",
      input.templateRevision ?? 0,
      now,
      now,
    );
    return this.getById(input.spaceId)!;
  }

  getById(spaceId: string): SpaceRow | undefined {
    return this.db
      .query("SELECT * FROM spaces WHERE space_id = ?")
      .get(spaceId) as SpaceRow | undefined ?? undefined;
  }

  list(options: ListSpacesOptions = {}): SpaceRow[] {
    const whereClauses: string[] = [];
    const values: (string | number)[] = [];

    if (options.resourceId) {
      whereClauses.push("resource_id = ?");
      values.push(options.resourceId);
    }

    if (options.statuses?.length) {
      whereClauses.push(`status IN (${options.statuses.map(() => "?").join(", ")})`);
      values.push(...options.statuses);
    } else {
      whereClauses.push("status NOT IN ('archived', 'deleted')");
    }

    let sql = "SELECT * FROM spaces";
    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(" AND ")}`;
    }
    sql += " ORDER BY updated_at DESC";

    if (typeof options.limit === "number" && options.limit > 0) {
      sql += " LIMIT ?";
      values.push(options.limit);
    }

    return this.db.query(sql).all(...values) as SpaceRow[];
  }

  listByResource(resourceId: string): SpaceRow[] {
    return this.list({ resourceId });
  }

  listActive(): SpaceRow[] {
    return this.list({ statuses: ["created", "active", "paused"] });
  }

  updateStatus(spaceId: string, status: string): void {
    this.db
      .query("UPDATE spaces SET status = ?, updated_at = ? WHERE space_id = ?")
      .run(status, new Date().toISOString(), spaceId);
  }

  updateConfig(spaceId: string, configJson: string): void {
    this.db
      .query("UPDATE spaces SET space_config_json = ?, updated_at = ? WHERE space_id = ?")
      .run(configJson, new Date().toISOString(), spaceId);
  }

  updateMetadata(input: UpdateSpaceMetadataInput): SpaceRow | undefined {
    const updates: string[] = [];
    const values: (string | null)[] = [];

    if (input.resourceId !== undefined) {
      updates.push("resource_id = ?");
      values.push(input.resourceId);
    }
    if (input.spaceType !== undefined) {
      updates.push("space_type = ?");
      values.push(input.spaceType);
    }
    if (input.name !== undefined) {
      updates.push("name = ?");
      values.push(input.name);
    }
    if (input.goal !== undefined) {
      updates.push("goal = ?");
      values.push(input.goal);
    }
    if (input.turnModel !== undefined) {
      updates.push("turn_model = ?");
      values.push(input.turnModel);
    }
    if (input.configJson !== undefined) {
      updates.push("space_config_json = ?");
      values.push(input.configJson);
    }

    if (updates.length === 0) {
      return this.getById(input.spaceId);
    }

    updates.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(input.spaceId);

    this.db
      .query(`UPDATE spaces SET ${updates.join(", ")} WHERE space_id = ?`)
      .run(...values);
    return this.getById(input.spaceId);
  }

  archive(spaceId: string, archivedAt = new Date().toISOString()): SpaceRow | undefined {
    this.db
      .query(`
        UPDATE spaces
        SET status = 'archived',
            archived_at = ?,
            deleted_at = NULL,
            updated_at = ?
        WHERE space_id = ?
      `)
      .run(archivedAt, archivedAt, spaceId);
    return this.getById(spaceId);
  }

  deleteSoft(spaceId: string, deletedAt = new Date().toISOString()): SpaceRow | undefined {
    this.db
      .query(`
        UPDATE spaces
        SET status = 'deleted',
            deleted_at = ?,
            updated_at = ?
        WHERE space_id = ?
      `)
      .run(deletedAt, deletedAt, spaceId);
    return this.getById(spaceId);
  }

  delete(spaceId: string): boolean {
    const result = this.db
      .query("DELETE FROM spaces WHERE space_id = ?")
      .run(spaceId);
    return result.changes > 0;
  }
}
