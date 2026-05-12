/**
 * Migration v1_gateway_policy
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M007_V1_GATEWAY_POLICY_VERSION = "v1_gateway_policy";

export const M007_V1_GATEWAY_POLICY: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS gateway_policy (
        singleton_id INTEGER PRIMARY KEY,
        allowed_capability_types_json TEXT NOT NULL DEFAULT '[]',
        denied_capability_types_json TEXT NOT NULL DEFAULT '[]',
        allowed_skill_ids_json TEXT NOT NULL DEFAULT '[]',
        denied_skill_ids_json TEXT NOT NULL DEFAULT '[]',
        global_flags_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      )`,
  `INSERT OR IGNORE INTO gateway_policy(
        singleton_id,
        allowed_capability_types_json,
        denied_capability_types_json,
        allowed_skill_ids_json,
        denied_skill_ids_json,
        global_flags_json,
        updated_at
      ) VALUES (1, '[]', '[]', '[]', '[]', '{}', datetime('now'))`,
];
