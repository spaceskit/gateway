/**
 * Migration v4_space_workspace_managed_folder_name
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M044_V4_SPACE_WORKSPACE_MANAGED_FOLDER_NAME_VERSION = "v4_space_workspace_managed_folder_name";

export const M044_V4_SPACE_WORKSPACE_MANAGED_FOLDER_NAME: readonly string[] = [
  `ALTER TABLE space_workspaces
        ADD COLUMN managed_folder_name TEXT NOT NULL DEFAULT ''`,
];
