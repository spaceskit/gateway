/**
 * Migration v1_space_resources
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M004_V1_SPACE_RESOURCES_VERSION = "v1_space_resources";

export const M004_V1_SPACE_RESOURCES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS space_resources (
        resource_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        uri TEXT NOT NULL,
        type TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        added_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_space_resources_space ON space_resources(space_id, added_at)`,
  `CREATE INDEX IF NOT EXISTS idx_space_resources_type ON space_resources(type)`,
];
