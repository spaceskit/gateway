/**
 * Migration v1_space_preset_applications
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M013_V1_SPACE_PRESET_APPLICATIONS_VERSION = "v1_space_preset_applications";

export const M013_V1_SPACE_PRESET_APPLICATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS space_preset_applications (
        application_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        preset_id TEXT NOT NULL,
        preset_kind TEXT NOT NULL,
        preset_source TEXT NOT NULL,
        applied_by TEXT NOT NULL,
        result_json TEXT NOT NULL DEFAULT '{}',
        applied_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_space_preset_applications_space
        ON space_preset_applications(space_id, applied_at)`,
  `CREATE INDEX IF NOT EXISTS idx_space_preset_applications_preset
        ON space_preset_applications(preset_id, applied_at)`,
];
