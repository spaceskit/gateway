/**
 * Migration v1_orchestrator_commands
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M008_V1_ORCHESTRATOR_COMMANDS_VERSION = "v1_orchestrator_commands";

export const M008_V1_ORCHESTRATOR_COMMANDS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS orchestrator_commands (
        command_id TEXT PRIMARY KEY,
        correlation_id TEXT NOT NULL,
        api_version TEXT NOT NULL DEFAULT 'v1',
        command_type TEXT NOT NULL,
        target_space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        target_agent_id TEXT NOT NULL DEFAULT '',
        idempotency_key TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL,
        result_json TEXT,
        error_code TEXT NOT NULL DEFAULT '',
        error_message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_orchestrator_commands_idempotency ON orchestrator_commands(target_space_id, idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS idx_orchestrator_commands_status ON orchestrator_commands(status, updated_at)`,
  `CREATE TABLE IF NOT EXISTS orchestrator_command_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command_id TEXT NOT NULL REFERENCES orchestrator_commands(command_id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        event_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_orchestrator_command_events_cmd ON orchestrator_command_events(command_id, id)`,
];
