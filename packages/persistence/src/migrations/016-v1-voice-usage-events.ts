/**
 * Migration v1_voice_usage_events
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M016_V1_VOICE_USAGE_EVENTS_VERSION = "v1_voice_usage_events";

export const M016_V1_VOICE_USAGE_EVENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS voice_usage_events (
        event_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        space_id TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'unknown',
        provider_id TEXT NOT NULL DEFAULT '',
        stt_seconds REAL NOT NULL DEFAULT 0,
        tts_chars INTEGER NOT NULL DEFAULT 0,
        tts_seconds REAL NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_voice_usage_events_created_at
        ON voice_usage_events(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_voice_usage_events_source
        ON voice_usage_events(source, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_voice_usage_events_space
        ON voice_usage_events(space_id, created_at)`,
];
