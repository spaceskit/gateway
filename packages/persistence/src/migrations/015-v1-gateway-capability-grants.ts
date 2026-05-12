/**
 * Migration v1_gateway_capability_grants
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M015_V1_GATEWAY_CAPABILITY_GRANTS_VERSION = "v1_gateway_capability_grants";

export const M015_V1_GATEWAY_CAPABILITY_GRANTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS gateway_capability_grants (
        principal_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        capability_id TEXT NOT NULL,
        level TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'runtime_api',
        reason TEXT NOT NULL DEFAULT '',
        granted_by TEXT NOT NULL DEFAULT '',
        granted_at TEXT NOT NULL,
        expires_at TEXT,
        revoked_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (principal_id, device_id, capability_id)
      )`,
  `CREATE INDEX IF NOT EXISTS idx_gateway_capability_grants_scope
        ON gateway_capability_grants(principal_id, device_id, revoked_at, expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_gateway_capability_grants_capability
        ON gateway_capability_grants(capability_id, level, revoked_at)`,
];
