/**
 * Migration v1_space_agent_assignments
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M002_V1_SPACE_AGENT_ASSIGNMENTS_VERSION = "v1_space_agent_assignments";

export const M002_V1_SPACE_AGENT_ASSIGNMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS space_agent_assignments (
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        security_scope_json TEXT,
        role TEXT NOT NULL DEFAULT 'participant',
        turn_order INTEGER NOT NULL DEFAULT 0,
        is_primary INTEGER NOT NULL DEFAULT 0,
        assigned_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (space_id, agent_id)
      )`,
  `CREATE INDEX IF NOT EXISTS idx_space_agent_assignments_space ON space_agent_assignments(space_id, turn_order)`,
  `CREATE INDEX IF NOT EXISTS idx_space_agent_assignments_profile ON space_agent_assignments(profile_id)`,
];
