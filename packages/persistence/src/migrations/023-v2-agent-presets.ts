/**
 * Migration v2_agent_presets
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M023_V2_AGENT_PRESETS_VERSION = "v2_agent_presets";

export const M023_V2_AGENT_PRESETS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS agent_presets (
        preset_id TEXT PRIMARY KEY,
        owner_principal_id TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        active_revision INTEGER NOT NULL DEFAULT 1,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_presets_owner
        ON agent_presets(owner_principal_id, archived, updated_at)`,
  `CREATE TABLE IF NOT EXISTS agent_preset_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        preset_id TEXT NOT NULL REFERENCES agent_presets(preset_id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        preset_config_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_preset_rev_unique
        ON agent_preset_revisions(preset_id, revision)`,
];
