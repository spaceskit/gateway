/**
 * Migration v2_space_workspace_project_meta
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M027_V2_SPACE_WORKSPACE_PROJECT_META_VERSION = "v2_space_workspace_project_meta";

export const M027_V2_SPACE_WORKSPACE_PROJECT_META: readonly string[] = [
  `ALTER TABLE space_workspaces
        ADD COLUMN project_meta_path TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE space_workspaces
        ADD COLUMN project_meta_status TEXT NOT NULL DEFAULT 'unknown'`,
  `ALTER TABLE space_workspaces
        ADD COLUMN project_meta_updated_at TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_space_workspaces_project_meta
        ON space_workspaces(project_meta_status, project_meta_updated_at)`,
];
