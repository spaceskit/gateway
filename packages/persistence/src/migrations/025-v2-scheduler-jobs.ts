/**
 * Migration v2_scheduler_jobs
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M025_V2_SCHEDULER_JOBS_VERSION = "v2_scheduler_jobs";

export const M025_V2_SCHEDULER_JOBS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS scheduler_jobs (
        job_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        enabled INTEGER NOT NULL DEFAULT 1,
        cron_expression TEXT NOT NULL,
        schedule_preset_json TEXT NOT NULL,
        timezone TEXT NOT NULL,
        action_type TEXT NOT NULL DEFAULT 'space_prompt',
        prompt_text TEXT NOT NULL DEFAULT '',
        target_agent_id TEXT NOT NULL DEFAULT '',
        execution_target_json TEXT NOT NULL DEFAULT '{"mode":"existing_space"}',
        calendar_binding_json TEXT,
        eval_config_json TEXT,
        eval_self_improve_state_json TEXT,
        primary_space_id TEXT REFERENCES spaces(space_id) ON DELETE SET NULL,
        invalid_reason TEXT NOT NULL DEFAULT '',
        next_run_at TEXT,
        last_run_at TEXT,
        last_run_status TEXT NOT NULL DEFAULT '',
        last_error_code TEXT NOT NULL DEFAULT '',
        last_error_message TEXT NOT NULL DEFAULT '',
        created_by_principal_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_scheduler_jobs_status
        ON scheduler_jobs(status, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_scheduler_jobs_due
        ON scheduler_jobs(enabled, status, next_run_at)`,
  `CREATE INDEX IF NOT EXISTS idx_scheduler_jobs_primary_space
        ON scheduler_jobs(primary_space_id, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS scheduler_job_spaces (
        job_id TEXT NOT NULL REFERENCES scheduler_jobs(job_id) ON DELETE CASCADE,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        linked_at TEXT NOT NULL,
        PRIMARY KEY (job_id, space_id)
      )`,
  `CREATE INDEX IF NOT EXISTS idx_scheduler_job_spaces_space
        ON scheduler_job_spaces(space_id, linked_at DESC)`,
  `CREATE TABLE IF NOT EXISTS scheduler_job_runs (
        run_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES scheduler_jobs(job_id) ON DELETE CASCADE,
        trigger TEXT NOT NULL,
        status TEXT NOT NULL,
        command_id TEXT NOT NULL DEFAULT '',
        scheduled_for TEXT,
        started_at TEXT,
        finished_at TEXT,
        skip_reason TEXT NOT NULL DEFAULT '',
        error_code TEXT NOT NULL DEFAULT '',
        error_message TEXT NOT NULL DEFAULT '',
        result_json TEXT,
        eval_run_json TEXT,
        created_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_scheduler_job_runs_job
        ON scheduler_job_runs(job_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_scheduler_job_runs_running
        ON scheduler_job_runs(job_id, status, created_at DESC)`,
];
