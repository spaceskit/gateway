/**
 * Migration v11_gateway_external_connectivity_funnel
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M051_V11_GATEWAY_EXTERNAL_CONNECTIVITY_FUNNEL_VERSION = "v11_gateway_external_connectivity_funnel";

export const M051_V11_GATEWAY_EXTERNAL_CONNECTIVITY_FUNNEL: readonly string[] = [
  `ALTER TABLE gateway_external_connectivity ADD COLUMN funnel_enabled INTEGER`,
];
