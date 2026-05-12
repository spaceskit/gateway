/**
 * Migration v1_space_context_transfer
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M009_V1_SPACE_CONTEXT_TRANSFER_VERSION = "v1_space_context_transfer";

export const M009_V1_SPACE_CONTEXT_TRANSFER: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS space_links (
        source_space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        target_space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        mode TEXT NOT NULL DEFAULT 'pull',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (source_space_id, target_space_id)
      )`,
  `CREATE INDEX IF NOT EXISTS idx_space_links_target ON space_links(target_space_id, source_space_id)`,
  `CREATE TABLE IF NOT EXISTS space_context_transfers (
        transfer_id TEXT PRIMARY KEY,
        source_space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        target_space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        artifact_id TEXT NOT NULL REFERENCES space_artifacts(artifact_id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        denial_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        applied_at TEXT
      )`,
  `CREATE INDEX IF NOT EXISTS idx_space_context_transfers_lookup
        ON space_context_transfers(source_space_id, target_space_id, status, created_at)`,
];
