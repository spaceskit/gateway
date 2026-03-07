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
        turn_model, space_config_json, template_id, template_revision,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'created', ?, ?, ?, ?, ?, ?)
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

  delete(spaceId: string): boolean {
    const result = this.db
      .query("DELETE FROM spaces WHERE space_id = ?")
      .run(spaceId);
    return result.changes > 0;
  }
}
