/**
 * Migration v9_agent_usage_session_runtime_metadata
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M049_V9_AGENT_USAGE_SESSION_RUNTIME_METADATA_VERSION = "v9_agent_usage_session_runtime_metadata";

export const M049_V9_AGENT_USAGE_SESSION_RUNTIME_METADATA: readonly string[] = [
  `ALTER TABLE agent_usage_sessions ADD COLUMN display_title TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE agent_usage_sessions ADD COLUMN provider_session_handle_json TEXT NOT NULL DEFAULT ''`,
];
