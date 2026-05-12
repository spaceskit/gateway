/**
 * Migration v2_provider_config_auth_mode
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M037_V2_PROVIDER_CONFIG_AUTH_MODE_VERSION = "v2_provider_config_auth_mode";

export const M037_V2_PROVIDER_CONFIG_AUTH_MODE: readonly string[] = [
  `ALTER TABLE provider_configs
        ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'api_key'`,
];
