/**
 * Migration v12_invite_tokens
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M052_V12_INVITE_TOKENS_VERSION = "v12_invite_tokens";

export const M052_V12_INVITE_TOKENS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS auth_keys (
        kid TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        algorithm TEXT NOT NULL,
        public_key TEXT NOT NULL,
        private_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        rotated_at TEXT
      )`,
  `CREATE INDEX IF NOT EXISTS idx_auth_keys_role ON auth_keys(role)`,
  `CREATE TABLE IF NOT EXISTS invite_tokens (
        token_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        signed_token TEXT NOT NULL UNIQUE,
        mode TEXT NOT NULL,
        signing_kid TEXT NOT NULL,
        issued_by_principal_id TEXT NOT NULL DEFAULT '',
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        created_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_invite_tokens_space_id ON invite_tokens(space_id)`,
  `CREATE INDEX IF NOT EXISTS idx_invite_tokens_expires_at ON invite_tokens(expires_at)`,
];
