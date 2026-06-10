/**
 * Migration v15_workbench_scenario_runs
 *
 * Scenario runs are product Workbench runner executions and are stored
 * separately from queue-backed Workbench task runs.
 */
export const M055_V15_WORKBENCH_SCENARIO_RUNS_VERSION = "v15_workbench_scenario_runs";

export const M055_V15_WORKBENCH_SCENARIO_RUNS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS workbench_scenario_runs (
        scenario_run_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'queued',
        config_json TEXT NOT NULL DEFAULT '{}',
        overall_status TEXT,
        summary TEXT NOT NULL DEFAULT '',
        report_artifact_id TEXT,
        created_by_principal_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        duration_ms INTEGER,
        last_error_code TEXT NOT NULL DEFAULT '',
        last_error_message TEXT NOT NULL DEFAULT ''
      )`,
  `CREATE INDEX IF NOT EXISTS idx_workbench_scenario_runs_status
        ON workbench_scenario_runs(status, updated_at DESC)`,
];
