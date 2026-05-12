/**
 * Migration v1_device_identities
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M012_V1_DEVICE_IDENTITIES_VERSION = "v1_device_identities";

export const M012_V1_DEVICE_IDENTITIES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS device_identities (
        device_id TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        public_key TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT '',
        key_version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen_at TEXT,
        revoked_at TEXT,
        PRIMARY KEY (device_id, principal_id)
      )`,
  `CREATE INDEX IF NOT EXISTS idx_device_identities_principal
        ON device_identities(principal_id, status, updated_at)`,
];
