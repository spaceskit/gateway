/**
 * Migration v1_provider_configs
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M030_V1_PROVIDER_CONFIGS_VERSION = "v1_provider_configs";

export const M030_V1_PROVIDER_CONFIGS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS provider_configs (
        provider_id TEXT PRIMARY KEY,
        model TEXT NOT NULL DEFAULT '',
        base_url TEXT,
        allowed_models_json TEXT NOT NULL DEFAULT '[]',
        allow_custom_model INTEGER NOT NULL DEFAULT 0,
        api_key_secret_ref TEXT,
        source TEXT NOT NULL DEFAULT 'runtime',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
];
