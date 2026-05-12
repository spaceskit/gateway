/**
 * Migration v1_space_workspaces
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M005_V1_SPACE_WORKSPACES_VERSION = "v1_space_workspaces";

export const M005_V1_SPACE_WORKSPACES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS space_workspaces (
        space_id TEXT PRIMARY KEY REFERENCES spaces(space_id) ON DELETE CASCADE,
        explicit_root TEXT NOT NULL DEFAULT '',
        effective_root TEXT NOT NULL,
        managed_resource_id TEXT NOT NULL,
        layout_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_space_workspaces_effective_root
        ON space_workspaces(effective_root)`,
];
