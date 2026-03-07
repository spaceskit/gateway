/**
 * Space skill repository — normalized space-level skill assignments.
 */

import type { Database } from "bun:sqlite";

export interface SpaceSkillRow {
  space_id: string;
  skill_id: string;
  added_at: string;
}

export interface UpsertSpaceSkillInput {
  spaceId: string;
  skillId: string;
  addedAt?: string;
}

export class SpaceSkillRepository {
  constructor(private db: Database) {}

  upsert(input: UpsertSpaceSkillInput): SpaceSkillRow {
    const addedAt = input.addedAt ?? new Date().toISOString();
    this.db.query(`
      INSERT INTO space_skills(space_id, skill_id, added_at)
      VALUES (?, ?, ?)
      ON CONFLICT(space_id, skill_id) DO NOTHING
    `).run(
      input.spaceId,
      input.skillId,
      addedAt,
    );

    return this.get(input.spaceId, input.skillId)!;
  }

  get(spaceId: string, skillId: string): SpaceSkillRow | undefined {
    return this.db
      .query("SELECT * FROM space_skills WHERE space_id = ? AND skill_id = ?")
      .get(spaceId, skillId) as SpaceSkillRow | undefined ?? undefined;
  }

  listBySpace(spaceId: string): SpaceSkillRow[] {
    return this.db
      .query("SELECT * FROM space_skills WHERE space_id = ? ORDER BY added_at ASC, skill_id ASC")
      .all(spaceId) as SpaceSkillRow[];
  }

  delete(spaceId: string, skillId: string): boolean {
    return this.db
      .query("DELETE FROM space_skills WHERE space_id = ? AND skill_id = ?")
      .run(spaceId, skillId).changes > 0;
  }
}
