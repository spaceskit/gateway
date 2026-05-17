/**
 * Migration v2_runtime_reset_ledger
 *
 * Runtime ledger tables.
 */
export const M035_V2_RUNTIME_RESET_LEDGER_VERSION = "v2_runtime_reset_ledger";

export const M035_V2_RUNTIME_RESET_LEDGER: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        trigger_source TEXT NOT NULL DEFAULT 'space_input',
        requested_by_principal_id TEXT NOT NULL DEFAULT '',
        requested_by_device_id TEXT NOT NULL DEFAULT '',
        target_agent_id TEXT NOT NULL DEFAULT '',
        input_text TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        error_code TEXT NOT NULL DEFAULT '',
        error_message TEXT NOT NULL DEFAULT ''
      )`,
  `CREATE INDEX IF NOT EXISTS idx_runs_space_status
        ON runs(space_id, status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_runs_turn
        ON runs(turn_id)`,
  `CREATE TABLE IF NOT EXISTS run_steps (
        step_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL DEFAULT '',
        sequence_no INTEGER NOT NULL DEFAULT 0,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        detail_text TEXT NOT NULL DEFAULT '',
        tool_name TEXT NOT NULL DEFAULT '',
        provider_id TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL DEFAULT '{}',
        output_json TEXT,
        error_message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT
      )`,
  `CREATE INDEX IF NOT EXISTS idx_run_steps_run_seq
        ON run_steps(run_id, sequence_no, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_run_steps_space_status
        ON run_steps(space_id, status, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS invocation_records (
        invocation_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        step_id TEXT NOT NULL REFERENCES run_steps(step_id) ON DELETE CASCADE,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        integration_id TEXT NOT NULL DEFAULT '',
        integration_class TEXT NOT NULL,
        status TEXT NOT NULL,
        provider_id TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL DEFAULT '',
        request_json TEXT NOT NULL DEFAULT '{}',
        response_json TEXT,
        usage_json TEXT NOT NULL DEFAULT '{}',
        error_message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT
      )`,
  `CREATE INDEX IF NOT EXISTS idx_invocation_records_run
        ON invocation_records(run_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_invocation_records_space
        ON invocation_records(space_id, integration_class, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS approval_requests (
        approval_request_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        step_id TEXT NOT NULL REFERENCES run_steps(step_id) ON DELETE CASCADE,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL DEFAULT '',
        agent_id TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        context_json TEXT NOT NULL DEFAULT '{}',
        options_json TEXT NOT NULL DEFAULT '[]',
        resolution TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        resolved_at TEXT
      )`,
  `CREATE INDEX IF NOT EXISTS idx_approval_requests_space_status
        ON approval_requests(space_id, status, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS usage_records (
        usage_record_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        step_id TEXT NOT NULL REFERENCES run_steps(step_id) ON DELETE CASCADE,
        invocation_id TEXT NOT NULL DEFAULT '',
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        provider_id TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL DEFAULT '',
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_usage_records_run
        ON usage_records(run_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_records_space
        ON usage_records(space_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS integration_requests (
        integration_request_id TEXT PRIMARY KEY,
        integration_class TEXT NOT NULL,
        requested_name TEXT NOT NULL,
        use_case TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        principal_id TEXT NOT NULL DEFAULT '',
        device_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'requested',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_integration_requests_class_status
        ON integration_requests(integration_class, status, created_at DESC)`,
];
