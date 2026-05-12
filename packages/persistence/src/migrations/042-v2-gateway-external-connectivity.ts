/**
 * Migration v2_gateway_external_connectivity
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M042_V2_GATEWAY_EXTERNAL_CONNECTIVITY_VERSION = "v2_gateway_external_connectivity";

export const M042_V2_GATEWAY_EXTERNAL_CONNECTIVITY: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS gateway_external_connectivity (
        singleton_id INTEGER PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
        mode TEXT NOT NULL DEFAULT 'DISABLED',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
];
