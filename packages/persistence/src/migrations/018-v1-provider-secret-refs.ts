/**
 * Migration v1_provider_secret_refs
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M018_V1_PROVIDER_SECRET_REFS_VERSION = "v1_provider_secret_refs";

export const M018_V1_PROVIDER_SECRET_REFS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS provider_secret_refs (
        secret_ref TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        backend TEXT NOT NULL DEFAULT 'gateway_encrypted',
        encrypted_secret TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT
      )`,
  `CREATE INDEX IF NOT EXISTS idx_provider_secret_refs_provider
        ON provider_secret_refs(provider_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_provider_secret_refs_last_used
        ON provider_secret_refs(last_used_at)`,
];
