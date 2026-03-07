/**
 * Space links repository — directed links between source/target spaces.
 */

import type { Database } from "bun:sqlite";

export interface SpaceLinkRow {
  source_space_id: string;
  target_space_id: string;
  mode: string;
  created_at: string;
  updated_at: string;
}

export interface UpsertSpaceLinkInput {
  sourceSpaceId: string;
  targetSpaceId: string;
  mode?: string;
}

export class SpaceLinkRepository {
  constructor(private db: Database) {}

  upsert(input: UpsertSpaceLinkInput): SpaceLinkRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO space_links(source_space_id, target_space_id, mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source_space_id, target_space_id) DO UPDATE SET
        mode = excluded.mode,
        updated_at = excluded.updated_at
    `).run(
      input.sourceSpaceId,
      input.targetSpaceId,
      input.mode ?? "pull",
      now,
      now,
    );

    return this.get(input.sourceSpaceId, input.targetSpaceId)!;
  }

  get(sourceSpaceId: string, targetSpaceId: string): SpaceLinkRow | undefined {
    return this.db.query(`
      SELECT * FROM space_links
      WHERE source_space_id = ? AND target_space_id = ?
    `).get(sourceSpaceId, targetSpaceId) as SpaceLinkRow | undefined ?? undefined;
  }

  listBySource(sourceSpaceId: string): SpaceLinkRow[] {
    return this.db.query(`
      SELECT * FROM space_links
      WHERE source_space_id = ?
      ORDER BY updated_at DESC
    `).all(sourceSpaceId) as SpaceLinkRow[];
  }

  listByTarget(targetSpaceId: string): SpaceLinkRow[] {
    return this.db.query(`
      SELECT * FROM space_links
      WHERE target_space_id = ?
      ORDER BY updated_at DESC
    `).all(targetSpaceId) as SpaceLinkRow[];
  }

  delete(sourceSpaceId: string, targetSpaceId: string): boolean {
    return this.db.query(`
      DELETE FROM space_links WHERE source_space_id = ? AND target_space_id = ?
    `).run(sourceSpaceId, targetSpaceId).changes > 0;
  }
}

