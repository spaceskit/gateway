/**
 * Space resource repository — normalized resource assignments per space.
 */

import type { Database } from "bun:sqlite";

export type SpaceResourceType = "folder" | "url";

export interface SpaceResourceRow {
  resource_id: string;
  space_id: string;
  uri: string;
  type: string;
  label: string;
  added_at: string;
  updated_at: string;
}

export interface UpsertSpaceResourceInput {
  resourceId: string;
  spaceId: string;
  uri: string;
  type: SpaceResourceType;
  label?: string;
  addedAt?: string;
}

export class SpaceResourceRepository {
  constructor(private db: Database) {}

  upsert(input: UpsertSpaceResourceInput): SpaceResourceRow {
    const now = new Date().toISOString();
    const addedAt = input.addedAt ?? now;
    const label = input.label?.trim() ?? "";

    this.db.query(`
      INSERT INTO space_resources(
        resource_id, space_id, uri, type, label, added_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(resource_id) DO UPDATE SET
        space_id = excluded.space_id,
        uri = excluded.uri,
        type = excluded.type,
        label = excluded.label,
        added_at = excluded.added_at,
        updated_at = excluded.updated_at
    `).run(
      input.resourceId,
      input.spaceId,
      input.uri,
      input.type,
      label,
      addedAt,
      now,
    );

    return this.get(input.spaceId, input.resourceId)!;
  }

  get(spaceId: string, resourceId: string): SpaceResourceRow | undefined {
    return this.db
      .query("SELECT * FROM space_resources WHERE space_id = ? AND resource_id = ?")
      .get(spaceId, resourceId) as SpaceResourceRow | undefined ?? undefined;
  }

  listBySpace(spaceId: string): SpaceResourceRow[] {
    return this.db
      .query("SELECT * FROM space_resources WHERE space_id = ? ORDER BY added_at ASC, resource_id ASC")
      .all(spaceId) as SpaceResourceRow[];
  }

  delete(spaceId: string, resourceId: string): boolean {
    return this.db
      .query("DELETE FROM space_resources WHERE space_id = ? AND resource_id = ?")
      .run(spaceId, resourceId).changes > 0;
  }
}
