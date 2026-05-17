/**
 * Migration v1_schema
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M001_V1_SCHEMA_VERSION = "v1_schema";

export const M001_V1_SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS schema_version (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )`,
  `CREATE TABLE IF NOT EXISTS spaces (
        space_id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL DEFAULT '',
        space_type TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        turn_model TEXT NOT NULL DEFAULT 'sequential_all',
        space_config_json TEXT,
        template_id TEXT NOT NULL DEFAULT '',
        template_revision INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE TABLE IF NOT EXISTS space_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        turn_count INTEGER NOT NULL,
        active_execution INTEGER NOT NULL DEFAULT 0,
        pending_feedback_count INTEGER NOT NULL DEFAULT 0,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_space_states_space ON space_states(space_id)`,
  `CREATE TABLE IF NOT EXISTS agent_execution_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        status TEXT NOT NULL,
        active_turn_id TEXT NOT NULL DEFAULT '',
        in_flight_tool_call_id TEXT NOT NULL DEFAULT '',
        last_transition_at TEXT NOT NULL,
        last_error TEXT NOT NULL DEFAULT ''
      )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_exec_space_agent ON agent_execution_states(space_id, agent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_exec_active ON agent_execution_states(status)`,
  `CREATE TABLE IF NOT EXISTS feedback_items (
        feedback_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        resolved_at TEXT
      )`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_pending ON feedback_items(space_id, status)`,
  `CREATE TABLE IF NOT EXISTS turns (
        turn_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        actor_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        input_json TEXT,
        output_json TEXT,
        status TEXT NOT NULL DEFAULT 'started',
        token_input_count INTEGER NOT NULL DEFAULT 0,
        token_output_count INTEGER NOT NULL DEFAULT 0,
        connector_provider TEXT NOT NULL DEFAULT '',
        requested_connector TEXT NOT NULL DEFAULT '',
        effective_connector TEXT NOT NULL DEFAULT '',
        fallback_reason TEXT NOT NULL DEFAULT '',
        fallback_used INTEGER NOT NULL DEFAULT 0,
        user_turn_id TEXT NOT NULL DEFAULT '',
        race_id TEXT NOT NULL DEFAULT '',
        race_rank INTEGER NOT NULL DEFAULT 0,
        race_score REAL NOT NULL DEFAULT 0,
        race_winner INTEGER NOT NULL DEFAULT 0,
        moderator_rationale TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        completed_at TEXT
      )`,
  `CREATE INDEX IF NOT EXISTS idx_turns_space ON turns(space_id)`,
  `CREATE TABLE IF NOT EXISTS connector_states (
        connector_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        is_local INTEGER NOT NULL,
        command_override TEXT NOT NULL DEFAULT '',
        detected_path TEXT NOT NULL DEFAULT '',
        version TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'degraded',
        auth_state TEXT NOT NULL DEFAULT 'unknown',
        health_status TEXT NOT NULL DEFAULT 'unknown',
        status_message TEXT NOT NULL DEFAULT '',
        checked_at TEXT,
        updated_at TEXT NOT NULL,
        credentials_ref TEXT NOT NULL DEFAULT ''
      )`,
  `CREATE INDEX IF NOT EXISTS idx_connector_provider ON connector_states(provider, is_local)`,
  `CREATE TABLE IF NOT EXISTS agent_profiles (
        profile_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        can_moderate INTEGER NOT NULL DEFAULT 0,
        visibility INTEGER NOT NULL DEFAULT 1,
        is_default INTEGER NOT NULL DEFAULT 0,
        active_revision INTEGER NOT NULL DEFAULT 1,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_profiles_archived ON agent_profiles(archived)`,
  `CREATE TABLE IF NOT EXISTS agent_profile_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id TEXT NOT NULL REFERENCES agent_profiles(profile_id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        personality_prompt TEXT NOT NULL DEFAULT '',
        default_skill_set_ids_json TEXT NOT NULL DEFAULT '[]',
        provider_hint TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL
      )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_rev_unique ON agent_profile_revisions(profile_id, revision)`,
  `CREATE TABLE IF NOT EXISTS space_templates (
        template_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        active_revision INTEGER NOT NULL DEFAULT 1,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_templates_archived ON space_templates(archived)`,
  `CREATE TABLE IF NOT EXISTS space_template_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id TEXT NOT NULL REFERENCES space_templates(template_id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        space_config_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_template_rev_unique ON space_template_revisions(template_id, revision)`,
  `CREATE TABLE IF NOT EXISTS space_orchestrator_sessions (
        space_id TEXT PRIMARY KEY REFERENCES spaces(space_id) ON DELETE CASCADE,
        session_key TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL,
        last_user_turn_id TEXT NOT NULL DEFAULT '',
        last_activity_at TEXT NOT NULL,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_orch_sessions_lifecycle ON space_orchestrator_sessions(lifecycle_state)`,
  `CREATE TABLE IF NOT EXISTS agent_orchestrator_sessions (
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        agent_session_key TEXT NOT NULL,
        continuity_mode TEXT NOT NULL DEFAULT 'STATELESS_REPLAY',
        provider_session_id TEXT NOT NULL DEFAULT '',
        last_turn_id TEXT NOT NULL DEFAULT '',
        context_summary TEXT NOT NULL DEFAULT '',
        scratchpad_path TEXT NOT NULL DEFAULT '',
        last_activity_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (space_id, agent_id)
      )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_orch_sessions_space ON agent_orchestrator_sessions(space_id, updated_at)`,
  `CREATE TABLE IF NOT EXISTS space_canvas_state (
        space_id TEXT PRIMARY KEY REFERENCES spaces(space_id) ON DELETE CASCADE,
        shared_canvas_path TEXT NOT NULL,
        shared_canvas_sha256 TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE TABLE IF NOT EXISTS space_canvas_ops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        op_type TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        source TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_canvas_ops_rev ON space_canvas_ops(space_id, revision)`,
  `CREATE TABLE IF NOT EXISTS orchestration_journal (
        event_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        turn_id TEXT NOT NULL DEFAULT '',
        seq INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        lineage_id TEXT NOT NULL DEFAULT '',
        hop_count INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_space_seq ON orchestration_journal(space_id, seq)`,
  `CREATE INDEX IF NOT EXISTS idx_journal_event_type ON orchestration_journal(event_type)`,
  `CREATE TABLE IF NOT EXISTS space_ratings (
        rating_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        stars INTEGER NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_ratings_space ON space_ratings(space_id)`,
  `CREATE TABLE IF NOT EXISTS personality_insights (
        insight_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL REFERENCES agent_profiles(profile_id) ON DELETE CASCADE,
        base_revision INTEGER NOT NULL,
        editable_patch TEXT NOT NULL DEFAULT '{}',
        rationale TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        approved_revision INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_insights_space ON personality_insights(space_id)`,
  `CREATE INDEX IF NOT EXISTS idx_insights_profile ON personality_insights(profile_id)`,
  `CREATE INDEX IF NOT EXISTS idx_insights_status ON personality_insights(status)`,
  `CREATE TABLE IF NOT EXISTS space_artifacts (
        artifact_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        resource_id TEXT NOT NULL DEFAULT '',
        artifact_type TEXT NOT NULL,
        title TEXT NOT NULL,
        content_json TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        visibility TEXT NOT NULL DEFAULT 'shared',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_artifacts_space ON space_artifacts(space_id)`,
  `CREATE INDEX IF NOT EXISTS idx_artifacts_resource ON space_artifacts(resource_id, visibility)`,
  `CREATE TABLE IF NOT EXISTS entitlement_state (
        singleton_id INTEGER PRIMARY KEY,
        tier TEXT NOT NULL,
        max_active_spaces INTEGER NOT NULL,
        max_agents_per_space INTEGER NOT NULL,
        max_spaces_per_month INTEGER NOT NULL,
        max_monthly_exports INTEGER NOT NULL,
        active_spaces_used INTEGER NOT NULL DEFAULT 0,
        spaces_created_in_period INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )`,
  `CREATE TABLE IF NOT EXISTS usage_budget_policy (
        singleton_id INTEGER PRIMARY KEY,
        soft_cap_usd REAL NOT NULL,
        hard_cap_usd REAL NOT NULL,
        warning_threshold REAL NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE TABLE IF NOT EXISTS log_policy (
        singleton_id INTEGER PRIMARY KEY,
        enabled INTEGER NOT NULL,
        minimum_level TEXT NOT NULL,
        retention_days INTEGER NOT NULL,
        max_total_size_bytes INTEGER NOT NULL,
        redaction_mode TEXT NOT NULL,
        include_debug_logs INTEGER NOT NULL,
        include_space_transcripts INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE TABLE IF NOT EXISTS user_preferences (
        singleton_id INTEGER PRIMARY KEY,
        experience_level TEXT NOT NULL DEFAULT 'EASY',
        runtime_mode TEXT NOT NULL DEFAULT 'SANDBOX',
        behavior_profile TEXT NOT NULL DEFAULT 'STANDARD',
        full_access_warning_accepted INTEGER NOT NULL DEFAULT 0,
        developer_warning_accepted INTEGER NOT NULL DEFAULT 0,
        calendar_enabled INTEGER NOT NULL DEFAULT 1,
        reminders_enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      )`,
  `CREATE TABLE IF NOT EXISTS event_log (
        event_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_event_log_space ON event_log(space_id)`,
  `CREATE INDEX IF NOT EXISTS idx_event_log_type ON event_log(event_type)`,
  `CREATE TABLE IF NOT EXISTS audit_events (
        audit_event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        actor TEXT NOT NULL,
        space_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_events(event_type)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_space ON audit_events(space_id)`,
  `CREATE TABLE IF NOT EXISTS idempotency_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        principal_id TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_type TEXT NOT NULL,
        response_payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_key ON idempotency_records(principal_id, endpoint, idempotency_key)`,
  `CREATE TABLE IF NOT EXISTS plugin_registry (
        plugin_id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        version TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        install_source TEXT NOT NULL DEFAULT 'INSTALL_SOURCE_UNSPECIFIED',
        trust_level TEXT NOT NULL DEFAULT 'TRUST_LEVEL_UNSPECIFIED',
        signed INTEGER NOT NULL DEFAULT 0,
        signature_identity TEXT NOT NULL DEFAULT '',
        scripts_executed INTEGER NOT NULL DEFAULT 0,
        installed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_plugin_trust ON plugin_registry(trust_level)`,
  `CREATE TABLE IF NOT EXISTS runtime_generation (
        singleton_id INTEGER PRIMARY KEY,
        generation TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
];
