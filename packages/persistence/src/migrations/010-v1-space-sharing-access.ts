/**
 * Migration v1_space_sharing_access
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M010_V1_SPACE_SHARING_ACCESS_VERSION = "v1_space_sharing_access";

export const M010_V1_SPACE_SHARING_ACCESS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS space_share_invites (
        invite_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        issued_by_principal_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at TEXT,
        last_used_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_space_share_invites_space_status
        ON space_share_invites(space_id, status, expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_space_share_invites_hash
        ON space_share_invites(space_id, token_hash)`,
  `CREATE TABLE IF NOT EXISTS space_participants (
        participant_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        principal_id TEXT NOT NULL,
        principal_type TEXT NOT NULL DEFAULT 'public_key',
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        joined_via_invite_id TEXT REFERENCES space_share_invites(invite_id) ON DELETE SET NULL,
        device_id TEXT,
        device_public_key TEXT,
        joined_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revoked_at TEXT
      )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_space_participants_unique_principal
        ON space_participants(space_id, principal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_space_participants_space_status
        ON space_participants(space_id, status, mode)`,
];
