/**
 * Migration v1_space_mcp_endpoints
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M019_V1_SPACE_MCP_ENDPOINTS_VERSION = "v1_space_mcp_endpoints";

export const M019_V1_SPACE_MCP_ENDPOINTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS space_mcp_endpoints (
        endpoint_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL UNIQUE REFERENCES spaces(space_id) ON DELETE CASCADE,
        transport TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        args_json TEXT NOT NULL DEFAULT '[]',
        secret_ref TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        health_status TEXT NOT NULL DEFAULT 'unknown',
        health_message TEXT NOT NULL DEFAULT '',
        last_connected_at TEXT,
        last_error_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_space_mcp_endpoints_enabled
        ON space_mcp_endpoints(enabled, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_space_mcp_endpoints_health
        ON space_mcp_endpoints(health_status, updated_at DESC)`,
];
