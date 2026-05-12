/**
 * Migration v1_knowledge_base_entries
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M021_V1_KNOWLEDGE_BASE_ENTRIES_VERSION = "v1_knowledge_base_entries";

export const M021_V1_KNOWLEDGE_BASE_ENTRIES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS knowledge_base_entries (
        entry_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        uri TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        scope_type TEXT NOT NULL DEFAULT 'global',
        space_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_base_scope
        ON knowledge_base_entries(scope_type, space_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_base_kind
        ON knowledge_base_entries(kind, updated_at DESC)`,
];
