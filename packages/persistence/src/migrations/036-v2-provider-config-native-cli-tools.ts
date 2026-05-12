/**
 * Migration v2_provider_config_native_cli_tools
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M036_V2_PROVIDER_CONFIG_NATIVE_CLI_TOOLS_VERSION = "v2_provider_config_native_cli_tools";

export const M036_V2_PROVIDER_CONFIG_NATIVE_CLI_TOOLS: readonly string[] = [
  `ALTER TABLE provider_configs
        ADD COLUMN native_cli_tools_enabled INTEGER NOT NULL DEFAULT 0`,
];
