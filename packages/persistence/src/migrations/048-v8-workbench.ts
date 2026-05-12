/**
 * Migration v8_workbench
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M048_V8_WORKBENCH_VERSION = "v8_workbench";

export const M048_V8_WORKBENCH: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS workbench_batches (
        batch_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        execution_mode TEXT NOT NULL DEFAULT 'supervised',
        queue_item_ids_json TEXT NOT NULL DEFAULT '[]',
        created_by_principal_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_workbench_batches_status
        ON workbench_batches(status, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS workbench_runs (
        run_id TEXT PRIMARY KEY,
        batch_id TEXT REFERENCES workbench_batches(batch_id) ON DELETE SET NULL,
        queue_item_id TEXT NOT NULL,
        queue_item_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        current_stage TEXT NOT NULL DEFAULT 'intake',
        execution_mode TEXT NOT NULL DEFAULT 'supervised',
        approval_state TEXT NOT NULL DEFAULT 'not_required',
        worktree_json TEXT,
        touched_repos_json TEXT NOT NULL DEFAULT '[]',
        verification_suites_json TEXT NOT NULL DEFAULT '[]',
        verification_result_json TEXT,
        landing_result_json TEXT,
        last_error_code TEXT NOT NULL DEFAULT '',
        last_error_message TEXT NOT NULL DEFAULT '',
        created_by_principal_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      )`,
  `CREATE INDEX IF NOT EXISTS idx_workbench_runs_status
        ON workbench_runs(status, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_workbench_runs_queue_item
        ON workbench_runs(queue_item_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS workbench_artifacts (
        artifact_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES workbench_runs(run_id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        content_type TEXT NOT NULL DEFAULT 'text/plain',
        content_text TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_workbench_artifacts_run
        ON workbench_artifacts(run_id, created_at ASC)`,
  `CREATE TABLE IF NOT EXISTS workbench_policy (
        singleton_id INTEGER PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
        default_execution_mode TEXT NOT NULL DEFAULT 'supervised',
        autonomous_enabled INTEGER NOT NULL DEFAULT 1,
        max_parallel_runs INTEGER NOT NULL DEFAULT 2,
        require_explicit_autonomous_opt_in INTEGER NOT NULL DEFAULT 1,
        require_ai_shippable_for_autonomous INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      )`,
];
