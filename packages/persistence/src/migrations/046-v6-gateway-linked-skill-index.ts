/**
 * Migration v6_gateway_linked_skill_index
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M046_V6_GATEWAY_LINKED_SKILL_INDEX_VERSION = "v6_gateway_linked_skill_index";

export const M046_V6_GATEWAY_LINKED_SKILL_INDEX: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS gateway_linked_skill_index (
        entry_id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL UNIQUE,
        source_path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        content_markdown TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        sync_state TEXT NOT NULL DEFAULT 'ready',
        file_mtime_ms INTEGER NOT NULL DEFAULT 0,
        file_size INTEGER NOT NULL DEFAULT 0,
        content_hash TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_gateway_linked_skill_index_name
        ON gateway_linked_skill_index(name, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_gateway_linked_skill_index_sync_state
        ON gateway_linked_skill_index(sync_state, updated_at DESC)`,
];
