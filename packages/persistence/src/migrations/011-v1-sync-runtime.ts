/**
 * Migration v1_sync_runtime
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M011_V1_SYNC_RUNTIME_VERSION = "v1_sync_runtime";

export const M011_V1_SYNC_RUNTIME: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS sync_peers (
        peer_id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL DEFAULT '',
        gateway_version TEXT NOT NULL DEFAULT '',
        endpoint_url TEXT NOT NULL DEFAULT '',
        auth_secret_hash TEXT NOT NULL DEFAULT '',
        sync_enabled INTEGER NOT NULL DEFAULT 1,
        skill_count INTEGER NOT NULL DEFAULT 0,
        action_count INTEGER NOT NULL DEFAULT 0,
        experience_count INTEGER NOT NULL DEFAULT 0,
        profile_count INTEGER NOT NULL DEFAULT 0,
        last_announced_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE TABLE IF NOT EXISTS sync_pull_receipts (
        peer_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_payload_json TEXT NOT NULL DEFAULT '{}',
        applied_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        PRIMARY KEY (peer_id, idempotency_key)
      )`,
  `CREATE TABLE IF NOT EXISTS sync_provenance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        peer_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        pulled_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_sync_provenance_peer ON sync_provenance(peer_id, pulled_at)`,
];
