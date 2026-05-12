/**
 * Migration v5_voice_usage_channel_and_provider_registry
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M045_V5_VOICE_USAGE_CHANNEL_AND_PROVIDER_REGISTRY_VERSION = "v5_voice_usage_channel_and_provider_registry";

export const M045_V5_VOICE_USAGE_CHANNEL_AND_PROVIDER_REGISTRY: readonly string[] = [
  `ALTER TABLE voice_usage_events
        ADD COLUMN channel TEXT NOT NULL DEFAULT 'session'`,
  `CREATE INDEX IF NOT EXISTS idx_voice_usage_events_channel
        ON voice_usage_events(channel, created_at)`,
  `CREATE TABLE IF NOT EXISTS voice_provider_configs (
        provider_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        source TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 100,
        health_status TEXT NOT NULL DEFAULT 'unknown',
        cost_profile_json TEXT NOT NULL DEFAULT '{}',
        secret_ref TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider_id, channel)
      )`,
  `CREATE INDEX IF NOT EXISTS idx_voice_provider_configs_channel
        ON voice_provider_configs(channel, source, priority, updated_at)`,
];
