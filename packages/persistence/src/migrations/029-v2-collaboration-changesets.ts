/**
 * Migration v2_collaboration_changesets
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M029_V2_COLLABORATION_CHANGESETS_VERSION = "v2_collaboration_changesets";

export const M029_V2_COLLABORATION_CHANGESETS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS space_changesets (
        changeset_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL DEFAULT '',
        created_by_principal_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        adapter TEXT NOT NULL DEFAULT 'filesystem',
        target_branch TEXT NOT NULL DEFAULT '',
        workspace_base_path TEXT NOT NULL DEFAULT '',
        submitted_at TEXT,
        reviewed_at TEXT,
        applied_at TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_space_changesets_space_status
        ON space_changesets(space_id, status, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_space_changesets_principal
        ON space_changesets(created_by_principal_id, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS space_changeset_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        changeset_id TEXT NOT NULL REFERENCES space_changesets(changeset_id) ON DELETE CASCADE,
        relative_path TEXT NOT NULL,
        staged_path TEXT NOT NULL DEFAULT '',
        sha256 TEXT NOT NULL DEFAULT '',
        size_bytes INTEGER NOT NULL DEFAULT 0,
        change_type TEXT NOT NULL DEFAULT 'modified',
        created_at TEXT NOT NULL,
        UNIQUE (changeset_id, relative_path)
      )`,
  `CREATE INDEX IF NOT EXISTS idx_space_changeset_files_changeset
        ON space_changeset_files(changeset_id, id)`,
  `CREATE TABLE IF NOT EXISTS space_changeset_reviews (
        review_id TEXT PRIMARY KEY,
        changeset_id TEXT NOT NULL REFERENCES space_changesets(changeset_id) ON DELETE CASCADE,
        reviewer_principal_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        comment TEXT NOT NULL DEFAULT '',
        diff_summary_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_space_changeset_reviews_changeset
        ON space_changeset_reviews(changeset_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS space_quota_policies (
        space_id TEXT PRIMARY KEY REFERENCES spaces(space_id) ON DELETE CASCADE,
        max_staging_bytes INTEGER NOT NULL DEFAULT 1073741824,
        max_open_changesets INTEGER NOT NULL DEFAULT 50,
        max_applied_changesets_monthly INTEGER NOT NULL DEFAULT 500,
        max_token_spend_usd REAL NOT NULL DEFAULT 0,
        max_participant_staging_bytes INTEGER NOT NULL DEFAULT 268435456,
        max_participant_uploads_per_day INTEGER NOT NULL DEFAULT 100,
        max_open_changesets_per_participant INTEGER NOT NULL DEFAULT 10,
        max_tool_calls_per_hour INTEGER NOT NULL DEFAULT 1000,
        updated_by TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      )`,
  `CREATE TABLE IF NOT EXISTS participant_quota_policies (
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        principal_id TEXT NOT NULL,
        max_staging_bytes INTEGER NOT NULL DEFAULT 0,
        max_uploads_per_day INTEGER NOT NULL DEFAULT 0,
        max_open_changesets INTEGER NOT NULL DEFAULT 0,
        max_tool_calls_per_hour INTEGER NOT NULL DEFAULT 0,
        updated_by TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (space_id, principal_id)
      )`,
  `CREATE INDEX IF NOT EXISTS idx_participant_quota_policies_space
        ON participant_quota_policies(space_id, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS space_usage_counters (
        space_id TEXT PRIMARY KEY REFERENCES spaces(space_id) ON DELETE CASCADE,
        staging_bytes INTEGER NOT NULL DEFAULT 0,
        open_changesets INTEGER NOT NULL DEFAULT 0,
        applied_changesets_monthly INTEGER NOT NULL DEFAULT 0,
        token_spend_usd REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )`,
  `CREATE TABLE IF NOT EXISTS participant_usage_counters (
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        principal_id TEXT NOT NULL,
        staging_bytes INTEGER NOT NULL DEFAULT 0,
        uploads_today INTEGER NOT NULL DEFAULT 0,
        open_changesets INTEGER NOT NULL DEFAULT 0,
        tool_calls_last_hour INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (space_id, principal_id)
      )`,
  `CREATE INDEX IF NOT EXISTS idx_participant_usage_counters_space
        ON participant_usage_counters(space_id, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS space_tool_policies (
        space_id TEXT PRIMARY KEY REFERENCES spaces(space_id) ON DELETE CASCADE,
        allowed_tools_json TEXT NOT NULL DEFAULT '[]',
        denied_tools_json TEXT NOT NULL DEFAULT '[]',
        policy_version TEXT NOT NULL DEFAULT 'v1',
        updated_by TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      )`,
];
