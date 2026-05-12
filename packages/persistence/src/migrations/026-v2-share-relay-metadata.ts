/**
 * Migration v2_share_relay_metadata
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M026_V2_SHARE_RELAY_METADATA_VERSION = "v2_share_relay_metadata";

export const M026_V2_SHARE_RELAY_METADATA: readonly string[] = [
  `ALTER TABLE space_share_invites
        ADD COLUMN relay_invite_id TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE space_share_invites
        ADD COLUMN relay_url TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE space_share_invites
        ADD COLUMN relay_session_scope_json TEXT NOT NULL DEFAULT '{}'`,
  `CREATE INDEX IF NOT EXISTS idx_space_share_invites_relay_id
        ON space_share_invites(relay_invite_id)`,
];
