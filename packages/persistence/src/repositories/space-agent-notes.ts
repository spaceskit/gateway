import type { Database } from "bun:sqlite";

export interface SpaceAgentNoteRow {
  space_id: string;
  agent_id: string;
  notes: string;
  updated_at: string;
}

export interface UpsertSpaceAgentNoteInput {
  spaceId: string;
  agentId: string;
  notes: string;
  updatedAt?: string;
}

export class SpaceAgentNotesRepository {
  constructor(private readonly db: Database) {
    this.ensureSchema();
  }

  get(spaceId: string, agentId: string): SpaceAgentNoteRow | undefined {
    return this.db
      .query(`
        SELECT space_id, agent_id, notes, updated_at
        FROM space_agent_notes
        WHERE space_id = ?
          AND agent_id = ?
      `)
      .get(spaceId, agentId) as SpaceAgentNoteRow | undefined ?? undefined;
  }

  listBySpace(spaceId: string): SpaceAgentNoteRow[] {
    return this.db
      .query(`
        SELECT space_id, agent_id, notes, updated_at
        FROM space_agent_notes
        WHERE space_id = ?
        ORDER BY updated_at DESC, agent_id ASC
      `)
      .all(spaceId) as SpaceAgentNoteRow[];
  }

  upsert(input: UpsertSpaceAgentNoteInput): SpaceAgentNoteRow {
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    this.db.query(`
      INSERT INTO space_agent_notes(
        space_id,
        agent_id,
        notes,
        updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(space_id, agent_id) DO UPDATE SET
        notes = excluded.notes,
        updated_at = excluded.updated_at
    `).run(
      input.spaceId,
      input.agentId,
      input.notes,
      updatedAt,
    );
    return this.get(input.spaceId, input.agentId)!;
  }

  deleteBySpace(spaceId: string): number {
    const result = this.db.query("DELETE FROM space_agent_notes WHERE space_id = ?").run(spaceId);
    return result.changes;
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS space_agent_notes (
        space_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (space_id, agent_id)
      );
      CREATE INDEX IF NOT EXISTS idx_space_agent_notes_space
        ON space_agent_notes(space_id, updated_at DESC);
    `);
  }
}
