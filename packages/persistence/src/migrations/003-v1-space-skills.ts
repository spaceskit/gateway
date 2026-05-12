/**
 * Migration v1_space_skills
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M003_V1_SPACE_SKILLS_VERSION = "v1_space_skills";

export const M003_V1_SPACE_SKILLS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS space_skills (
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        skill_id TEXT NOT NULL,
        added_at TEXT NOT NULL,
        PRIMARY KEY (space_id, skill_id)
      )`,
  `CREATE INDEX IF NOT EXISTS idx_space_skills_space ON space_skills(space_id, added_at)`,
  `CREATE INDEX IF NOT EXISTS idx_space_skills_skill ON space_skills(skill_id)`,
];
