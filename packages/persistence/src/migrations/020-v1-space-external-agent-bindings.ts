/**
 * Migration v1_space_external_agent_bindings
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M020_V1_SPACE_EXTERNAL_AGENT_BINDINGS_VERSION = "v1_space_external_agent_bindings";

export const M020_V1_SPACE_EXTERNAL_AGENT_BINDINGS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS space_external_agent_bindings (
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        endpoint_id TEXT NOT NULL REFERENCES space_mcp_endpoints(endpoint_id) ON DELETE CASCADE,
        remote_agent_id TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (space_id, agent_id)
      )`,
  `CREATE INDEX IF NOT EXISTS idx_space_external_agent_bindings_endpoint
        ON space_external_agent_bindings(endpoint_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_space_external_agent_bindings_remote
        ON space_external_agent_bindings(remote_agent_id, updated_at DESC)`,
];
