/**
 * Migration v1_profile_model_config
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M006_V1_PROFILE_MODEL_CONFIG_VERSION = "v1_profile_model_config";

export const M006_V1_PROFILE_MODEL_CONFIG: readonly string[] = [
  `ALTER TABLE agent_profile_revisions ADD COLUMN model_config_json TEXT NOT NULL DEFAULT '{}'`,
];
