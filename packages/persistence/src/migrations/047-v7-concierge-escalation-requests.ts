/**
 * Migration v7_concierge_escalation_requests
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M047_V7_CONCIERGE_ESCALATION_REQUESTS_VERSION = "v7_concierge_escalation_requests";

export const M047_V7_CONCIERGE_ESCALATION_REQUESTS: readonly string[] = [
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
];
