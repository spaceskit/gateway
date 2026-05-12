/**
 * Migration v2_space_lifecycle_timestamps
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M039_V2_SPACE_LIFECYCLE_TIMESTAMPS_VERSION = "v2_space_lifecycle_timestamps";

export const M039_V2_SPACE_LIFECYCLE_TIMESTAMPS: readonly string[] = [
  `ALTER TABLE spaces
        ADD COLUMN archived_at TEXT`,
  `ALTER TABLE spaces
        ADD COLUMN deleted_at TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_spaces_status_updated
        ON spaces(status, updated_at DESC)`,
];
