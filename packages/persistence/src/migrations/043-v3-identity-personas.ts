/**
 * Migration v3_identity_personas
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M043_V3_IDENTITY_PERSONAS_VERSION = "v3_identity_personas";

export const M043_V3_IDENTITY_PERSONAS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS personas (
        persona_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        active_revision INTEGER NOT NULL DEFAULT 1,
        archived INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_personas_archived ON personas(archived)`,
  `CREATE TABLE IF NOT EXISTS persona_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        persona_id TEXT NOT NULL REFERENCES personas(persona_id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        tone TEXT NOT NULL DEFAULT '',
        style TEXT NOT NULL DEFAULT '',
        emotional_layer TEXT NOT NULL DEFAULT '',
        constraints_json TEXT NOT NULL DEFAULT '[]',
        instructions TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL
      )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_persona_rev_unique ON persona_revisions(persona_id, revision)`,
];
