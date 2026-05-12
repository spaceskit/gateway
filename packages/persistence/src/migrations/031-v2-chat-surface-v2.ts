/**
 * Migration v2_chat_surface_v2
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M031_V2_CHAT_SURFACE_V2_VERSION = "v2_chat_surface_v2";

export const M031_V2_CHAT_SURFACE_V2: readonly string[] = [
  `ALTER TABLE event_log ADD COLUMN turn_id TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE event_log ADD COLUMN agent_id TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE event_log ADD COLUMN seq INTEGER NOT NULL DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS idx_event_log_space_turn_seq
        ON event_log(space_id, turn_id, seq)`,
  `CREATE INDEX IF NOT EXISTS idx_event_log_turn_created
        ON event_log(turn_id, created_at)`,
  `ALTER TABLE space_artifacts ADD COLUMN turn_id TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE space_artifacts ADD COLUMN agent_id TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE space_artifacts ADD COLUMN mime_type TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE space_artifacts ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS idx_artifacts_space_turn
        ON space_artifacts(space_id, turn_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_artifacts_agent
        ON space_artifacts(space_id, agent_id, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS agent_usage_sessions (
        session_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        agent_role TEXT NOT NULL DEFAULT 'agent',
        status TEXT NOT NULL DEFAULT 'active',
        started_at TEXT NOT NULL,
        ended_at TEXT,
        last_activity_at TEXT NOT NULL,
        reset_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_usage_sessions_space
        ON agent_usage_sessions(space_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_usage_sessions_agent
        ON agent_usage_sessions(space_id, agent_id, updated_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_usage_sessions_active
        ON agent_usage_sessions(space_id, agent_id, status)
        WHERE status = 'active'`,
];
