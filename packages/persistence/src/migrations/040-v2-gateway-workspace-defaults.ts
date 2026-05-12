/**
 * Migration v2_gateway_workspace_defaults
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M040_V2_GATEWAY_WORKSPACE_DEFAULTS_VERSION = "v2_gateway_workspace_defaults";

export const M040_V2_GATEWAY_WORKSPACE_DEFAULTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS gateway_workspace_defaults (
        singleton_id INTEGER PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
        space_home_root TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
];
