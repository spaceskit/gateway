/**
 * Migration v2_gateway_runtime_defaults
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M041_V2_GATEWAY_RUNTIME_DEFAULTS_VERSION = "v2_gateway_runtime_defaults";

export const M041_V2_GATEWAY_RUNTIME_DEFAULTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS gateway_runtime_defaults (
        singleton_id INTEGER PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
        main_provider_id TEXT NOT NULL DEFAULT '',
        main_model_id TEXT NOT NULL DEFAULT '',
        concierge_provider_id TEXT NOT NULL DEFAULT '',
        concierge_model_id TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
];
