/**
 * Migration v2_provider_connection_states_namespace
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M033_V2_PROVIDER_CONNECTION_STATES_NAMESPACE_VERSION = "v2_provider_connection_states_namespace";

export const M033_V2_PROVIDER_CONNECTION_STATES_NAMESPACE: readonly string[] = [
  `DROP INDEX IF EXISTS idx_connector_provider`,
  `ALTER TABLE connector_states RENAME TO provider_connection_states`,
  `CREATE INDEX IF NOT EXISTS idx_provider_connection_provider
        ON provider_connection_states(provider, is_local)`,
];
