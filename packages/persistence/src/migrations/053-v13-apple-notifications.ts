/**
 * Migration v13_apple_notifications
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M053_V13_APPLE_NOTIFICATIONS_VERSION = "v13_apple_notifications";

export const M053_V13_APPLE_NOTIFICATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS apple_push_device_registrations (
        registration_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        device_id TEXT NOT NULL DEFAULT '',
        platform TEXT NOT NULL,
        token_kind TEXT NOT NULL DEFAULT 'alert',
        push_token TEXT NOT NULL,
        topic TEXT NOT NULL DEFAULT '',
        environment TEXT NOT NULL DEFAULT 'sandbox',
        app_bundle_id TEXT NOT NULL DEFAULT '',
        device_name TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        stale_at TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE(principal_id, device_id, token_kind, environment, topic)
      )`,
  `CREATE INDEX IF NOT EXISTS idx_apple_push_registrations_principal
        ON apple_push_device_registrations(principal_id, token_kind, enabled)`,
  `CREATE INDEX IF NOT EXISTS idx_apple_push_registrations_token
        ON apple_push_device_registrations(push_token, environment, topic)`,
  `CREATE INDEX IF NOT EXISTS idx_apple_push_registrations_stale
        ON apple_push_device_registrations(stale_at)`,
  `CREATE TABLE IF NOT EXISTS apple_notification_preferences (
        principal_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        quiet_hours_enabled INTEGER NOT NULL DEFAULT 0,
        quiet_hours_start_minute INTEGER NOT NULL DEFAULT 1320,
        quiet_hours_end_minute INTEGER NOT NULL DEFAULT 420,
        quiet_hours_time_zone TEXT NOT NULL DEFAULT '',
        cooldown_seconds INTEGER NOT NULL DEFAULT 300,
        allow_critical INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      )`,
  `CREATE TABLE IF NOT EXISTS apple_notification_deliveries (
        delivery_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        registration_id TEXT NOT NULL DEFAULT '',
        notification_id TEXT NOT NULL DEFAULT '',
        feedback_id TEXT NOT NULL DEFAULT '',
        call_id TEXT NOT NULL DEFAULT '',
        gateway_id TEXT NOT NULL DEFAULT '',
        channel TEXT NOT NULL,
        status TEXT NOT NULL,
        action TEXT NOT NULL DEFAULT '',
        deep_link TEXT NOT NULL DEFAULT '',
        error_message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        sent_at TEXT,
        opened_at TEXT,
        actioned_at TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}'
      )`,
  `CREATE INDEX IF NOT EXISTS idx_apple_notification_deliveries_principal
        ON apple_notification_deliveries(principal_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_apple_notification_deliveries_feedback
        ON apple_notification_deliveries(feedback_id, principal_id)`,
];
