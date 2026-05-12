/**
 * Migration v3_space_workspace_metadata_columns
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M028_V3_SPACE_WORKSPACE_METADATA_COLUMNS_VERSION = "v3_space_workspace_metadata_columns";

export const M028_V3_SPACE_WORKSPACE_METADATA_COLUMNS: readonly string[] = [
  `DROP INDEX IF EXISTS idx_space_workspaces_project_meta`,
  `ALTER TABLE space_workspaces
        RENAME COLUMN project_meta_path TO metadata_path`,
  `ALTER TABLE space_workspaces
        RENAME COLUMN project_meta_status TO metadata_status`,
  `ALTER TABLE space_workspaces
        RENAME COLUMN project_meta_updated_at TO metadata_updated_at`,
  `CREATE INDEX IF NOT EXISTS idx_space_workspaces_metadata
        ON space_workspaces(metadata_status, metadata_updated_at)`,
];
