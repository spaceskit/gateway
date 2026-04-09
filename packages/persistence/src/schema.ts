/**
 * SQLite schema for the Spaceskit gateway.
 *
 * Ported from v1 Swift (SQLiteDatabaseStack.swift) with room→space rename.
 * Uses raw SQL strings so they work with any SQLite driver (better-sqlite3, sql.js, etc.).
 */

export interface Migration {
  version: string;
  up: string[];
}

/**
 * Ordered list of migrations. Each entry is applied once and tracked in `schema_version`.
 */
export const migrations: Migration[] = [
  {
    version: "v1_schema",
    up: [
      // -- Schema tracking --
      `CREATE TABLE IF NOT EXISTS schema_version (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )`,

      // -- Spaces (formerly rooms) --
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

      // -- Space runtime state snapshots --
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

      // -- Agent execution state per space --
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

      // -- Feedback items (human-in-the-loop) --
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

      // -- Turns --
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

      // -- Connector states (cloud runtimes, local runtimes, etc.) --
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

      // -- Agent profiles --
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
        model_hint TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_rev_unique ON agent_profile_revisions(profile_id, revision)`,

      // -- Space templates --
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

      // -- Orchestrator sessions --
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

      // -- Canvas (shared workspace per space) --
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

      // -- Orchestration journal --
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

      // -- Space ratings --
      `CREATE TABLE IF NOT EXISTS space_ratings (
        rating_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        stars INTEGER NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ratings_space ON space_ratings(space_id)`,

      // -- Personality insights (learning from rated spaces) --
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

      // -- Space artifacts (cross-space addressable) --
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

      // -- Policy singletons --
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

      // -- Event / audit log --
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

      // -- Idempotency --
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

      // -- Plugin registry --
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

      // -- Runtime generation tracking --
      `CREATE TABLE IF NOT EXISTS runtime_generation (
        singleton_id INTEGER PRIMARY KEY,
        generation TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ],
  },
  {
    version: "v1_space_agent_assignments",
    up: [
      // Normalized agent assignments (space_id + agent_id unique)
      `CREATE TABLE IF NOT EXISTS space_agent_assignments (
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        security_scope_json TEXT,
        role TEXT NOT NULL DEFAULT 'participant',
        turn_order INTEGER NOT NULL DEFAULT 0,
        is_primary INTEGER NOT NULL DEFAULT 0,
        assigned_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (space_id, agent_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_space_agent_assignments_space ON space_agent_assignments(space_id, turn_order)`,
      `CREATE INDEX IF NOT EXISTS idx_space_agent_assignments_profile ON space_agent_assignments(profile_id)`,
    ],
  },
  {
    version: "v1_space_skills",
    up: [
      `CREATE TABLE IF NOT EXISTS space_skills (
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        skill_id TEXT NOT NULL,
        added_at TEXT NOT NULL,
        PRIMARY KEY (space_id, skill_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_space_skills_space ON space_skills(space_id, added_at)`,
      `CREATE INDEX IF NOT EXISTS idx_space_skills_skill ON space_skills(skill_id)`,
    ],
  },
  {
    version: "v1_space_resources",
    up: [
      `CREATE TABLE IF NOT EXISTS space_resources (
        resource_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        uri TEXT NOT NULL,
        type TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        added_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_space_resources_space ON space_resources(space_id, added_at)`,
      `CREATE INDEX IF NOT EXISTS idx_space_resources_type ON space_resources(type)`,
    ],
  },
  {
    version: "v1_space_workspaces",
    up: [
      `CREATE TABLE IF NOT EXISTS space_workspaces (
        space_id TEXT PRIMARY KEY REFERENCES spaces(space_id) ON DELETE CASCADE,
        explicit_root TEXT NOT NULL DEFAULT '',
        effective_root TEXT NOT NULL,
        managed_resource_id TEXT NOT NULL,
        layout_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_space_workspaces_effective_root
        ON space_workspaces(effective_root)`,
    ],
  },
  {
    version: "v1_profile_model_config",
    up: [
      `ALTER TABLE agent_profile_revisions ADD COLUMN model_config_json TEXT NOT NULL DEFAULT '{}'`,
    ],
  },
  {
    version: "v1_gateway_policy",
    up: [
      `CREATE TABLE IF NOT EXISTS gateway_policy (
        singleton_id INTEGER PRIMARY KEY,
        allowed_capability_types_json TEXT NOT NULL DEFAULT '[]',
        denied_capability_types_json TEXT NOT NULL DEFAULT '[]',
        allowed_skill_ids_json TEXT NOT NULL DEFAULT '[]',
        denied_skill_ids_json TEXT NOT NULL DEFAULT '[]',
        global_flags_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      )`,
      `INSERT OR IGNORE INTO gateway_policy(
        singleton_id,
        allowed_capability_types_json,
        denied_capability_types_json,
        allowed_skill_ids_json,
        denied_skill_ids_json,
        global_flags_json,
        updated_at
      ) VALUES (1, '[]', '[]', '[]', '[]', '{}', datetime('now'))`,
    ],
  },
  {
    version: "v1_orchestrator_commands",
    up: [
      `CREATE TABLE IF NOT EXISTS orchestrator_commands (
        command_id TEXT PRIMARY KEY,
        correlation_id TEXT NOT NULL,
        api_version TEXT NOT NULL DEFAULT 'v1',
        command_type TEXT NOT NULL,
        target_space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        target_agent_id TEXT NOT NULL DEFAULT '',
        idempotency_key TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL,
        result_json TEXT,
        error_code TEXT NOT NULL DEFAULT '',
        error_message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_orchestrator_commands_idempotency ON orchestrator_commands(target_space_id, idempotency_key)`,
      `CREATE INDEX IF NOT EXISTS idx_orchestrator_commands_status ON orchestrator_commands(status, updated_at)`,
      `CREATE TABLE IF NOT EXISTS orchestrator_command_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command_id TEXT NOT NULL REFERENCES orchestrator_commands(command_id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        event_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_orchestrator_command_events_cmd ON orchestrator_command_events(command_id, id)`,
    ],
  },
  {
    version: "v1_space_context_transfer",
    up: [
      `CREATE TABLE IF NOT EXISTS space_links (
        source_space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        target_space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        mode TEXT NOT NULL DEFAULT 'pull',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (source_space_id, target_space_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_space_links_target ON space_links(target_space_id, source_space_id)`,
      `CREATE TABLE IF NOT EXISTS space_context_transfers (
        transfer_id TEXT PRIMARY KEY,
        source_space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        target_space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        artifact_id TEXT NOT NULL REFERENCES space_artifacts(artifact_id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        denial_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        applied_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_space_context_transfers_lookup
        ON space_context_transfers(source_space_id, target_space_id, status, created_at)`,
    ],
  },
  {
    version: "v1_space_sharing_access",
    up: [
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
    ],
  },
  {
    version: "v1_sync_runtime",
    up: [
      `CREATE TABLE IF NOT EXISTS sync_peers (
        peer_id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL DEFAULT '',
        gateway_version TEXT NOT NULL DEFAULT '',
        endpoint_url TEXT NOT NULL DEFAULT '',
        auth_secret_hash TEXT NOT NULL DEFAULT '',
        sync_enabled INTEGER NOT NULL DEFAULT 1,
        skill_count INTEGER NOT NULL DEFAULT 0,
        action_count INTEGER NOT NULL DEFAULT 0,
        experience_count INTEGER NOT NULL DEFAULT 0,
        profile_count INTEGER NOT NULL DEFAULT 0,
        last_announced_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS sync_pull_receipts (
        peer_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_payload_json TEXT NOT NULL DEFAULT '{}',
        applied_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        PRIMARY KEY (peer_id, idempotency_key)
      )`,
      `CREATE TABLE IF NOT EXISTS sync_provenance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        peer_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        pulled_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sync_provenance_peer ON sync_provenance(peer_id, pulled_at)`,
    ],
  },
  {
    version: "v1_device_identities",
    up: [
      `CREATE TABLE IF NOT EXISTS device_identities (
        device_id TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        public_key TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT '',
        key_version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen_at TEXT,
        revoked_at TEXT,
        PRIMARY KEY (device_id, principal_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_device_identities_principal
        ON device_identities(principal_id, status, updated_at)`,
    ],
  },
  {
    version: "v1_space_preset_applications",
    up: [
      `CREATE TABLE IF NOT EXISTS space_preset_applications (
        application_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        preset_id TEXT NOT NULL,
        preset_kind TEXT NOT NULL,
        preset_source TEXT NOT NULL,
        applied_by TEXT NOT NULL,
        result_json TEXT NOT NULL DEFAULT '{}',
        applied_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_space_preset_applications_space
        ON space_preset_applications(space_id, applied_at)`,
      `CREATE INDEX IF NOT EXISTS idx_space_preset_applications_preset
        ON space_preset_applications(preset_id, applied_at)`,
    ],
  },
  {
    version: "v1_space_template_owners",
    up: [
      `ALTER TABLE space_templates
        ADD COLUMN owner_principal_id TEXT NOT NULL DEFAULT ''`,
      `CREATE INDEX IF NOT EXISTS idx_space_templates_owner
        ON space_templates(owner_principal_id, archived, updated_at)`,
    ],
  },
  {
    version: "v1_gateway_capability_grants",
    up: [
      `CREATE TABLE IF NOT EXISTS gateway_capability_grants (
        principal_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        capability_id TEXT NOT NULL,
        level TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'runtime_api',
        reason TEXT NOT NULL DEFAULT '',
        granted_by TEXT NOT NULL DEFAULT '',
        granted_at TEXT NOT NULL,
        expires_at TEXT,
        revoked_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (principal_id, device_id, capability_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_gateway_capability_grants_scope
        ON gateway_capability_grants(principal_id, device_id, revoked_at, expires_at)`,
      `CREATE INDEX IF NOT EXISTS idx_gateway_capability_grants_capability
        ON gateway_capability_grants(capability_id, level, revoked_at)`,
    ],
  },
  {
    version: "v1_voice_usage_events",
    up: [
      `CREATE TABLE IF NOT EXISTS voice_usage_events (
        event_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        space_id TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'unknown',
        provider_id TEXT NOT NULL DEFAULT '',
        stt_seconds REAL NOT NULL DEFAULT 0,
        tts_chars INTEGER NOT NULL DEFAULT 0,
        tts_seconds REAL NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_voice_usage_events_created_at
        ON voice_usage_events(created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_voice_usage_events_source
        ON voice_usage_events(source, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_voice_usage_events_space
        ON voice_usage_events(space_id, created_at)`,
    ],
  },
  {
    version: "v1_connector_architecture",
    up: [
      `CREATE TABLE IF NOT EXISTS connector_families (
        family_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        runtime TEXT NOT NULL,
        trust_class TEXT NOT NULL,
        embedded_enabled INTEGER NOT NULL DEFAULT 0,
        capability_types_json TEXT NOT NULL DEFAULT '[]',
        features_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_connector_families_runtime
        ON connector_families(runtime, trust_class, embedded_enabled)`,

      `CREATE TABLE IF NOT EXISTS connector_instances (
        connector_id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL REFERENCES connector_families(family_id) ON DELETE RESTRICT,
        display_name TEXT NOT NULL,
        account_fingerprint_hash TEXT NOT NULL,
        label_slug TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (family_id, account_fingerprint_hash, label_slug)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_connector_instances_family
        ON connector_instances(family_id, status, updated_at)`,

      `CREATE TABLE IF NOT EXISTS connector_bindings (
        binding_id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL REFERENCES connector_instances(connector_id) ON DELETE CASCADE,
        binding_type TEXT NOT NULL,
        selector_json TEXT NOT NULL DEFAULT '{}',
        selector_hash TEXT NOT NULL DEFAULT '',
        target_type TEXT NOT NULL,
        target_space_id TEXT NOT NULL DEFAULT '',
        allowed_actions_json TEXT NOT NULL DEFAULT '[]',
        capability_types_json TEXT NOT NULL DEFAULT '[]',
        priority INTEGER NOT NULL DEFAULT 100,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(connector_id, binding_type, selector_hash, priority)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_connector_bindings_connector
        ON connector_bindings(connector_id, binding_type, enabled, priority)`,
      `CREATE INDEX IF NOT EXISTS idx_connector_bindings_target
        ON connector_bindings(target_type, target_space_id, enabled, priority)`,

      `CREATE TABLE IF NOT EXISTS connector_policy (
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        requests_per_minute INTEGER NOT NULL DEFAULT 60,
        burst INTEGER NOT NULL DEFAULT 60,
        disabled INTEGER NOT NULL DEFAULT 0,
        disable_reason TEXT NOT NULL DEFAULT '',
        disabled_until TEXT,
        updated_by TEXT NOT NULL DEFAULT 'system',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope_type, scope_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_connector_policy_disabled
        ON connector_policy(scope_type, disabled, disabled_until)`,
      `INSERT OR IGNORE INTO connector_policy(
        scope_type, scope_id, requests_per_minute, burst, disabled,
        disable_reason, disabled_until, updated_by, updated_at
      ) VALUES ('global', '*', 60, 60, 0, '', NULL, 'system', datetime('now'))`,

      `CREATE TABLE IF NOT EXISTS connector_secret_refs (
        connector_id TEXT NOT NULL REFERENCES connector_instances(connector_id) ON DELETE CASCADE,
        secret_key TEXT NOT NULL,
        secret_ref TEXT NOT NULL,
        backend TEXT NOT NULL DEFAULT 'native_adapter',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (connector_id, secret_key)
      )`,
    ],
  },
  {
    version: "v1_provider_secret_refs",
    up: [
      `CREATE TABLE IF NOT EXISTS provider_secret_refs (
        secret_ref TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        backend TEXT NOT NULL DEFAULT 'gateway_encrypted',
        encrypted_secret TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_provider_secret_refs_provider
        ON provider_secret_refs(provider_id, updated_at)`,
      `CREATE INDEX IF NOT EXISTS idx_provider_secret_refs_last_used
        ON provider_secret_refs(last_used_at)`,
    ],
  },
  {
    version: "v1_space_mcp_endpoints",
    up: [
      `CREATE TABLE IF NOT EXISTS space_mcp_endpoints (
        endpoint_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL UNIQUE REFERENCES spaces(space_id) ON DELETE CASCADE,
        transport TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        args_json TEXT NOT NULL DEFAULT '[]',
        secret_ref TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        health_status TEXT NOT NULL DEFAULT 'unknown',
        health_message TEXT NOT NULL DEFAULT '',
        last_connected_at TEXT,
        last_error_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_space_mcp_endpoints_enabled
        ON space_mcp_endpoints(enabled, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_space_mcp_endpoints_health
        ON space_mcp_endpoints(health_status, updated_at DESC)`,
    ],
  },
  {
    version: "v1_space_external_agent_bindings",
    up: [
      `CREATE TABLE IF NOT EXISTS space_external_agent_bindings (
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        endpoint_id TEXT NOT NULL REFERENCES space_mcp_endpoints(endpoint_id) ON DELETE CASCADE,
        remote_agent_id TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (space_id, agent_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_space_external_agent_bindings_endpoint
        ON space_external_agent_bindings(endpoint_id, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_space_external_agent_bindings_remote
        ON space_external_agent_bindings(remote_agent_id, updated_at DESC)`,
    ],
  },
  {
    version: "v1_knowledge_base_entries",
    up: [
      `CREATE TABLE IF NOT EXISTS knowledge_base_entries (
        entry_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        uri TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        scope_type TEXT NOT NULL DEFAULT 'global',
        space_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_knowledge_base_scope
        ON knowledge_base_entries(scope_type, space_id, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_knowledge_base_kind
        ON knowledge_base_entries(kind, updated_at DESC)`,
    ],
  },
  {
    version: "v2_gateway_skill_catalog",
    up: [
      `CREATE TABLE IF NOT EXISTS gateway_skill_catalog (
        skill_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        content_markdown TEXT NOT NULL DEFAULT '',
        source_ref TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_gateway_skill_catalog_status
        ON gateway_skill_catalog(status, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_gateway_skill_catalog_name
        ON gateway_skill_catalog(name, updated_at DESC)`,
      `INSERT OR IGNORE INTO gateway_skill_catalog(
        skill_id,
        name,
        description,
        content_markdown,
        source_ref,
        tags_json,
        status,
        created_at,
        updated_at
      ) VALUES (
        'anthropic/pdf',
        'PDF Research Assistant',
        'Extract and summarize PDF content with explicit citations and source grounding.',
        'Use this skill when working with PDF documents. Read carefully, preserve original meaning, and cite page numbers for claims. Always separate extracted facts from inferred conclusions.',
        'anthropic:skills/pdf',
        '["pdf","documents","research"]',
        'active',
        datetime('now'),
        datetime('now')
      )`,
      `INSERT OR IGNORE INTO gateway_skill_catalog(
        skill_id,
        name,
        description,
        content_markdown,
        source_ref,
        tags_json,
        status,
        created_at,
        updated_at
      ) VALUES (
        'openai/gh-address-comments',
        'GitHub Comment Resolution',
        'Address GitHub PR feedback by planning changes, applying patches, and verifying outcomes.',
        'Use this skill to process GitHub review comments. Group comments by concern, propose concrete edits, implement fixes, and report exactly which comments were resolved with file-level references.',
        'openai:skills/gh-address-comments',
        '["github","code-review","automation"]',
        'active',
        datetime('now'),
        datetime('now')
      )`,
    ],
  },
  {
    version: "v2_agent_presets",
    up: [
      `CREATE TABLE IF NOT EXISTS agent_presets (
        preset_id TEXT PRIMARY KEY,
        owner_principal_id TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        active_revision INTEGER NOT NULL DEFAULT 1,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_agent_presets_owner
        ON agent_presets(owner_principal_id, archived, updated_at)`,
      `CREATE TABLE IF NOT EXISTS agent_preset_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        preset_id TEXT NOT NULL REFERENCES agent_presets(preset_id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        preset_config_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_preset_rev_unique
        ON agent_preset_revisions(preset_id, revision)`,
    ],
  },
  {
    version: "v2_assignment_prompt_context",
    up: [
      `ALTER TABLE space_agent_assignments ADD COLUMN spawn_context TEXT`,
      `ALTER TABLE space_agent_assignments ADD COLUMN context_overrides_json TEXT`,
    ],
  },
  {
    version: "v2_scheduler_jobs",
    up: [
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
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_scheduler_job_runs_job
        ON scheduler_job_runs(job_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_scheduler_job_runs_running
        ON scheduler_job_runs(job_id, status, created_at DESC)`,
    ],
  },
  {
    version: "v2_share_relay_metadata",
    up: [
      `ALTER TABLE space_share_invites
        ADD COLUMN relay_invite_id TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE space_share_invites
        ADD COLUMN relay_url TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE space_share_invites
        ADD COLUMN relay_session_scope_json TEXT NOT NULL DEFAULT '{}'`,
      `CREATE INDEX IF NOT EXISTS idx_space_share_invites_relay_id
        ON space_share_invites(relay_invite_id)`,
    ],
  },
  {
    version: "v2_space_workspace_project_meta",
    up: [
      `ALTER TABLE space_workspaces
        ADD COLUMN project_meta_path TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE space_workspaces
        ADD COLUMN project_meta_status TEXT NOT NULL DEFAULT 'unknown'`,
      `ALTER TABLE space_workspaces
        ADD COLUMN project_meta_updated_at TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_space_workspaces_project_meta
        ON space_workspaces(project_meta_status, project_meta_updated_at)`,
    ],
  },
  {
    version: "v3_space_workspace_metadata_columns",
    up: [
      `DROP INDEX IF EXISTS idx_space_workspaces_project_meta`,
      `ALTER TABLE space_workspaces
        RENAME COLUMN project_meta_path TO metadata_path`,
      `ALTER TABLE space_workspaces
        RENAME COLUMN project_meta_status TO metadata_status`,
      `ALTER TABLE space_workspaces
        RENAME COLUMN project_meta_updated_at TO metadata_updated_at`,
      `CREATE INDEX IF NOT EXISTS idx_space_workspaces_metadata
        ON space_workspaces(metadata_status, metadata_updated_at)`,
    ],
  },
  {
    version: "v2_collaboration_changesets",
    up: [
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
    ],
  },
  {
    version: "v1_provider_configs",
    up: [
      `CREATE TABLE IF NOT EXISTS provider_configs (
        provider_id TEXT PRIMARY KEY,
        model TEXT NOT NULL DEFAULT '',
        base_url TEXT,
        allowed_models_json TEXT NOT NULL DEFAULT '[]',
        allow_custom_model INTEGER NOT NULL DEFAULT 0,
        api_key_secret_ref TEXT,
        source TEXT NOT NULL DEFAULT 'runtime',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ],
  },
  {
    version: "v2_chat_surface_v2",
    up: [
      `ALTER TABLE event_log ADD COLUMN turn_id TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE event_log ADD COLUMN agent_id TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE event_log ADD COLUMN seq INTEGER NOT NULL DEFAULT 0`,
      `CREATE INDEX IF NOT EXISTS idx_event_log_space_turn_seq
        ON event_log(space_id, turn_id, seq)`,
      `CREATE INDEX IF NOT EXISTS idx_event_log_turn_created
        ON event_log(turn_id, created_at)`,

      `ALTER TABLE space_artifacts ADD COLUMN turn_id TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE space_artifacts ADD COLUMN agent_id TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE space_artifacts ADD COLUMN mime_type TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE space_artifacts ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0`,
      `CREATE INDEX IF NOT EXISTS idx_artifacts_space_turn
        ON space_artifacts(space_id, turn_id, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_artifacts_agent
        ON space_artifacts(space_id, agent_id, updated_at DESC)`,

      `CREATE TABLE IF NOT EXISTS agent_usage_sessions (
        session_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        agent_role TEXT NOT NULL DEFAULT 'agent',
        status TEXT NOT NULL DEFAULT 'active',
        started_at TEXT NOT NULL,
        ended_at TEXT,
        last_activity_at TEXT NOT NULL,
        reset_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_agent_usage_sessions_space
        ON agent_usage_sessions(space_id, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_agent_usage_sessions_agent
        ON agent_usage_sessions(space_id, agent_id, updated_at DESC)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_usage_sessions_active
        ON agent_usage_sessions(space_id, agent_id, status)
        WHERE status = 'active'`,
    ],
  },
  {
    version: "v2_turns_reply_to_turn_id",
    up: [
      `ALTER TABLE turns
        ADD COLUMN reply_to_turn_id TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_turns_reply_to_turn
        ON turns(reply_to_turn_id)`,
    ],
  },
  {
    version: "v2_provider_connection_states_namespace",
    up: [
      `DROP INDEX IF EXISTS idx_connector_provider`,
      `ALTER TABLE connector_states RENAME TO provider_connection_states`,
      `CREATE INDEX IF NOT EXISTS idx_provider_connection_provider
        ON provider_connection_states(provider, is_local)`,
    ],
  },
  {
    version: "v2_turns_space_actor_index",
    up: [
      `CREATE INDEX IF NOT EXISTS idx_turns_space_actor
        ON turns(space_id, actor_id, created_at DESC)`,
    ],
  },
  {
    version: "v2_runtime_reset_ledger",
    up: [
      `CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        compatibility_turn_id TEXT NOT NULL DEFAULT '',
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
        ON runs(compatibility_turn_id)`,

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
        compatibility_turn_id TEXT NOT NULL DEFAULT '',
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
    ],
  },
  {
    version: "v2_provider_config_native_cli_tools",
    up: [
      `ALTER TABLE provider_configs
        ADD COLUMN native_cli_tools_enabled INTEGER NOT NULL DEFAULT 0`,
    ],
  },
  {
    version: "v2_provider_config_auth_mode",
    up: [
      `ALTER TABLE provider_configs
        ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'api_key'`,
    ],
  },
  {
    version: "v2_usage_record_token_accuracy",
    up: [
      `ALTER TABLE usage_records
        ADD COLUMN token_accuracy TEXT NOT NULL DEFAULT 'reported'`,
    ],
  },
  {
    version: "v2_space_lifecycle_timestamps",
    up: [
      `ALTER TABLE spaces
        ADD COLUMN archived_at TEXT`,
      `ALTER TABLE spaces
        ADD COLUMN deleted_at TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_spaces_status_updated
        ON spaces(status, updated_at DESC)`,
    ],
  },
  {
    version: "v2_gateway_workspace_defaults",
    up: [
      `CREATE TABLE IF NOT EXISTS gateway_workspace_defaults (
        singleton_id INTEGER PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
        space_home_root TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    ],
  },
  {
    version: "v2_gateway_external_connectivity",
    up: [
      `CREATE TABLE IF NOT EXISTS gateway_external_connectivity (
        singleton_id INTEGER PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
        mode TEXT NOT NULL DEFAULT 'DISABLED',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    ],
  },
  {
    version: "v3_identity_personas",
    up: [
      `CREATE TABLE IF NOT EXISTS personas (
        persona_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        active_revision INTEGER NOT NULL DEFAULT 1,
        archived INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_personas_archived ON personas(archived)`,
      `CREATE TABLE IF NOT EXISTS persona_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        persona_id TEXT NOT NULL REFERENCES personas(persona_id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        tone TEXT NOT NULL DEFAULT '',
        style TEXT NOT NULL DEFAULT '',
        emotional_layer TEXT NOT NULL DEFAULT '',
        constraints_json TEXT NOT NULL DEFAULT '[]',
        instructions TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_persona_rev_unique ON persona_revisions(persona_id, revision)`,
    ],
  },
  {
    version: "v4_space_workspace_managed_folder_name",
    up: [
      `ALTER TABLE space_workspaces
        ADD COLUMN managed_folder_name TEXT NOT NULL DEFAULT ''`,
    ],
  },
  {
    version: "v5_voice_usage_channel_and_provider_registry",
    up: [
      `ALTER TABLE voice_usage_events
        ADD COLUMN channel TEXT NOT NULL DEFAULT 'session'`,
      `CREATE INDEX IF NOT EXISTS idx_voice_usage_events_channel
        ON voice_usage_events(channel, created_at)`,
      `CREATE TABLE IF NOT EXISTS voice_provider_configs (
        provider_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        source TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 100,
        health_status TEXT NOT NULL DEFAULT 'unknown',
        cost_profile_json TEXT NOT NULL DEFAULT '{}',
        secret_ref TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider_id, channel)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_voice_provider_configs_channel
        ON voice_provider_configs(channel, source, priority, updated_at)`,
    ],
  },
  {
    version: "v6_gateway_linked_skill_index",
    up: [
      `CREATE TABLE IF NOT EXISTS gateway_linked_skill_index (
        entry_id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL UNIQUE,
        source_path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        content_markdown TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        sync_state TEXT NOT NULL DEFAULT 'ready',
        file_mtime_ms INTEGER NOT NULL DEFAULT 0,
        file_size INTEGER NOT NULL DEFAULT 0,
        content_hash TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_gateway_linked_skill_index_name
        ON gateway_linked_skill_index(name, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_gateway_linked_skill_index_sync_state
        ON gateway_linked_skill_index(sync_state, updated_at DESC)`,
    ],
  },
  {
    version: "v7_concierge_escalation_requests",
    up: [
      `CREATE TABLE IF NOT EXISTS concierge_escalation_requests (
        request_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES spaces(space_id) ON DELETE CASCADE,
        requesting_agent_id TEXT NOT NULL DEFAULT '',
        target_agent_id TEXT NOT NULL DEFAULT '',
        requesting_turn_id TEXT NOT NULL DEFAULT '',
        principal_id TEXT NOT NULL DEFAULT '',
        device_id TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        question TEXT NOT NULL DEFAULT '',
        user_message TEXT NOT NULL DEFAULT '',
        urgency TEXT NOT NULL DEFAULT 'important',
        response_mode TEXT NOT NULL DEFAULT 'structured',
        allowed_responses_json TEXT NOT NULL DEFAULT '[]',
        fallback_policy TEXT NOT NULL DEFAULT 'none',
        timeout_seconds INTEGER NOT NULL DEFAULT 300,
        status TEXT NOT NULL DEFAULT 'pending',
        delivery_channel TEXT NOT NULL DEFAULT 'notification',
        deep_link TEXT NOT NULL DEFAULT '',
        response_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        notified_at TEXT,
        actioned_at TEXT,
        cancelled_at TEXT,
        escalated_to_call_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_concierge_escalation_space_status
        ON concierge_escalation_requests(space_id, status, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_concierge_escalation_status_expires
        ON concierge_escalation_requests(status, expires_at)`,
      `CREATE INDEX IF NOT EXISTS idx_concierge_escalation_principal
        ON concierge_escalation_requests(principal_id, created_at DESC)`,
    ],
  },
];

/**
 * Default seed data inserted after initial schema creation.
 */
export const seedStatements: string[] = [
  `INSERT OR IGNORE INTO entitlement_state(
    singleton_id, tier, max_active_spaces, max_agents_per_space,
    max_spaces_per_month, max_monthly_exports,
    active_spaces_used, spaces_created_in_period, updated_at
  ) VALUES (1, 'FREE', 2, 4, 20, 10, 0, 0, datetime('now'))`,

  `INSERT OR IGNORE INTO usage_budget_policy(
    singleton_id, soft_cap_usd, hard_cap_usd, warning_threshold, updated_at
  ) VALUES (1, 20.0, 50.0, 0.8, datetime('now'))`,

  `INSERT OR IGNORE INTO log_policy(
    singleton_id, enabled, minimum_level, retention_days,
    max_total_size_bytes, redaction_mode, include_debug_logs,
    include_space_transcripts, updated_at
  ) VALUES (1, 1, 'INFO', 14, 536870912, 'STANDARD', 0, 0, datetime('now'))`,

  `INSERT OR IGNORE INTO user_preferences(
    singleton_id, experience_level, runtime_mode, behavior_profile,
    full_access_warning_accepted, developer_warning_accepted,
    calendar_enabled, reminders_enabled, updated_at
  ) VALUES (1, 'EASY', 'SANDBOX', 'STANDARD', 0, 0, 1, 1, datetime('now'))`,

  `INSERT OR IGNORE INTO personas(
    persona_id, name, description, active_revision, archived, is_default, created_at, updated_at
  ) VALUES (
    'persona-default',
    'Focused Guide',
    'Clear, calm, direct guidance with restrained emotion.',
    1,
    0,
    1,
    datetime('now'),
    datetime('now')
  )`,

  `INSERT OR IGNORE INTO persona_revisions(
    persona_id, revision, tone, style, emotional_layer, constraints_json, instructions, source, created_at
  ) VALUES (
    'persona-default',
    1,
    'Direct and clear.',
    'Concise, structured, and practical.',
    'Steady and supportive without excess chatter.',
    '["Do not invent facts.","State assumptions when needed.","Prefer simple explanations before advanced detail.","When citing tool results, reference the specific tool and its output.","Use markdown formatting when structure aids clarity, but do not over-format short answers."]',
    'Be warm enough to feel human, but stay precise and task-focused. Answer questions directly before elaborating. When given a command, confirm what you will do, then do it.',
    'system',
    datetime('now')
  )`,
];
