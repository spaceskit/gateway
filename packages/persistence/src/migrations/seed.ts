/**
 * Default seed data inserted after the initial schema is applied.
 *
 * These statements use `INSERT OR IGNORE` and are idempotent.
 */
export const SEED_STATEMENTS: readonly string[] = [
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
