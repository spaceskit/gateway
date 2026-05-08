import type { Database } from "bun:sqlite";
import type {
  AppleNotificationAction,
  AppleNotificationDelivery,
  AppleNotificationDeliveryStatus,
  AppleNotificationLifecycleRepository,
  AppleNotificationPreferences,
  ApplePushDeviceRegistration,
  ApplePushEnvironment,
  ApplePushPlatform,
  ApplePushTokenKind,
  RecordAppleNotificationDeliveryInput,
  RegisterApplePushDeviceInput,
} from "@spaceskit/core";

export interface ApplePushDeviceRegistrationRow {
  registration_id: string;
  principal_id: string;
  device_id: string;
  platform: ApplePushPlatform;
  token_kind: ApplePushTokenKind;
  push_token: string;
  topic: string;
  environment: ApplePushEnvironment;
  app_bundle_id: string;
  device_name: string;
  enabled: number;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
  stale_at: string | null;
  metadata_json: string;
}

export interface AppleNotificationPreferencesRow {
  principal_id: string;
  enabled: number;
  quiet_hours_enabled: number;
  quiet_hours_start_minute: number;
  quiet_hours_end_minute: number;
  quiet_hours_time_zone: string;
  cooldown_seconds: number;
  allow_critical: number;
  updated_at: string;
}

export interface AppleNotificationDeliveryRow {
  delivery_id: string;
  principal_id: string;
  registration_id: string;
  notification_id: string;
  feedback_id: string;
  call_id: string;
  gateway_id: string;
  channel: "alert" | "voip";
  status: AppleNotificationDeliveryStatus;
  action: string;
  deep_link: string;
  error_message: string;
  created_at: string;
  sent_at: string | null;
  opened_at: string | null;
  actioned_at: string | null;
  payload_json: string;
}

export class AppleNotificationRepository implements AppleNotificationLifecycleRepository {
  constructor(private readonly db: Database) {}

  upsertDeviceRegistration(input: RegisterApplePushDeviceInput & {
    registrationId: string;
    tokenKind: ApplePushTokenKind;
    topic: string;
    environment: ApplePushEnvironment;
    createdAt: string;
    updatedAt: string;
    lastSeenAt: string;
  }): ApplePushDeviceRegistration {
    this.db.query(`
      INSERT INTO apple_push_device_registrations(
        registration_id,
        principal_id,
        device_id,
        platform,
        token_kind,
        push_token,
        topic,
        environment,
        app_bundle_id,
        device_name,
        enabled,
        created_at,
        updated_at,
        last_seen_at,
        stale_at,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, ?)
      ON CONFLICT(principal_id, device_id, token_kind, environment, topic)
      DO UPDATE SET
        push_token = excluded.push_token,
        platform = excluded.platform,
        app_bundle_id = excluded.app_bundle_id,
        device_name = excluded.device_name,
        enabled = 1,
        updated_at = excluded.updated_at,
        last_seen_at = excluded.last_seen_at,
        stale_at = NULL,
        metadata_json = excluded.metadata_json
    `).run(
      input.registrationId,
      input.principalId,
      input.deviceId ?? "",
      input.platform,
      input.tokenKind,
      input.pushToken,
      input.topic,
      input.environment,
      input.appBundleId ?? "",
      input.deviceName ?? "",
      input.createdAt,
      input.updatedAt,
      input.lastSeenAt,
      JSON.stringify(input.metadata ?? {}),
    );

    return this.findRegistration({
      principalId: input.principalId,
      deviceId: input.deviceId ?? "",
      tokenKind: input.tokenKind,
      environment: input.environment,
      topic: input.topic,
    })!;
  }

  deleteDeviceRegistration(principalId: string, registrationId: string): boolean {
    const result = this.db.query(`
      DELETE FROM apple_push_device_registrations
      WHERE principal_id = ? AND registration_id = ?
    `).run(principalId, registrationId);
    return result.changes > 0;
  }

  listDeviceRegistrations(principalId: string, tokenKind?: ApplePushTokenKind): ApplePushDeviceRegistration[] {
    if (tokenKind) {
      return (this.db.query(`
        SELECT * FROM apple_push_device_registrations
        WHERE principal_id = ? AND token_kind = ?
        ORDER BY updated_at DESC
      `).all(principalId, tokenKind) as ApplePushDeviceRegistrationRow[]).map(mapRegistration);
    }
    return (this.db.query(`
      SELECT * FROM apple_push_device_registrations
      WHERE principal_id = ?
      ORDER BY updated_at DESC
    `).all(principalId) as ApplePushDeviceRegistrationRow[]).map(mapRegistration);
  }

  getPreferences(principalId: string): AppleNotificationPreferences | undefined {
    const row = this.db.query(`
      SELECT * FROM apple_notification_preferences WHERE principal_id = ?
    `).get(principalId) as AppleNotificationPreferencesRow | undefined;
    return row ? mapPreferences(row) : undefined;
  }

  setPreferences(principalId: string, preferences: AppleNotificationPreferences): AppleNotificationPreferences {
    this.db.query(`
      INSERT INTO apple_notification_preferences(
        principal_id,
        enabled,
        quiet_hours_enabled,
        quiet_hours_start_minute,
        quiet_hours_end_minute,
        quiet_hours_time_zone,
        cooldown_seconds,
        allow_critical,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(principal_id)
      DO UPDATE SET
        enabled = excluded.enabled,
        quiet_hours_enabled = excluded.quiet_hours_enabled,
        quiet_hours_start_minute = excluded.quiet_hours_start_minute,
        quiet_hours_end_minute = excluded.quiet_hours_end_minute,
        quiet_hours_time_zone = excluded.quiet_hours_time_zone,
        cooldown_seconds = excluded.cooldown_seconds,
        allow_critical = excluded.allow_critical,
        updated_at = excluded.updated_at
    `).run(
      principalId,
      preferences.enabled ? 1 : 0,
      preferences.quietHours.enabled ? 1 : 0,
      preferences.quietHours.startMinute,
      preferences.quietHours.endMinute,
      preferences.quietHours.timeZone ?? "",
      preferences.cooldownSeconds,
      preferences.allowCritical ? 1 : 0,
      preferences.updatedAt,
    );
    return this.getPreferences(principalId)!;
  }

  recordDelivery(input: RecordAppleNotificationDeliveryInput & {
    deliveryId: string;
    status: AppleNotificationDeliveryStatus;
    createdAt: string;
  }): AppleNotificationDelivery {
    this.db.query(`
      INSERT INTO apple_notification_deliveries(
        delivery_id,
        principal_id,
        registration_id,
        notification_id,
        feedback_id,
        call_id,
        gateway_id,
        channel,
        status,
        action,
        deep_link,
        error_message,
        created_at,
        sent_at,
        opened_at,
        actioned_at,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(delivery_id)
      DO UPDATE SET
        status = excluded.status,
        action = excluded.action,
        deep_link = excluded.deep_link,
        error_message = excluded.error_message,
        sent_at = excluded.sent_at,
        opened_at = excluded.opened_at,
        actioned_at = excluded.actioned_at,
        payload_json = excluded.payload_json
    `).run(
      input.deliveryId,
      input.principalId,
      input.registrationId ?? "",
      input.notificationId ?? "",
      input.feedbackId ?? "",
      input.callId ?? "",
      input.gatewayId ?? "",
      input.channel,
      input.status,
      input.action ?? "",
      input.deepLink ?? "",
      input.errorMessage ?? "",
      input.createdAt,
      input.sentAt ?? null,
      input.openedAt ?? null,
      input.actionedAt ?? null,
      JSON.stringify(input.payload ?? {}),
    );
    return this.getDelivery(input.principalId, input.deliveryId)!;
  }

  getDelivery(principalId: string, deliveryId: string): AppleNotificationDelivery | undefined {
    const row = this.db.query(`
      SELECT * FROM apple_notification_deliveries
      WHERE principal_id = ? AND delivery_id = ?
    `).get(principalId, deliveryId) as AppleNotificationDeliveryRow | undefined;
    return row ? mapDelivery(row) : undefined;
  }

  updateDelivery(input: {
    principalId: string;
    deliveryId: string;
    status?: AppleNotificationDeliveryStatus;
    action?: AppleNotificationAction;
    openedAt?: string;
    actionedAt?: string;
    errorMessage?: string;
  }): AppleNotificationDelivery | undefined {
    const existing = this.getDelivery(input.principalId, input.deliveryId);
    if (!existing) return undefined;
    this.db.query(`
      UPDATE apple_notification_deliveries
      SET
        status = ?,
        action = ?,
        opened_at = ?,
        actioned_at = ?,
        error_message = ?
      WHERE principal_id = ? AND delivery_id = ?
    `).run(
      input.status ?? existing.status,
      input.action ?? existing.action ?? "",
      input.openedAt ?? existing.openedAt ?? null,
      input.actionedAt ?? existing.actionedAt ?? null,
      input.errorMessage ?? existing.errorMessage ?? "",
      input.principalId,
      input.deliveryId,
    );
    return this.getDelivery(input.principalId, input.deliveryId);
  }

  pruneStaleRegistrations(beforeIso: string): number {
    const result = this.db.query(`
      DELETE FROM apple_push_device_registrations
      WHERE stale_at IS NOT NULL AND stale_at <= ?
    `).run(beforeIso);
    return result.changes;
  }

  markRegistrationStale(registrationId: string, staleAt: string): void {
    this.db.query(`
      UPDATE apple_push_device_registrations
      SET enabled = 0, stale_at = ?, updated_at = ?
      WHERE registration_id = ?
    `).run(staleAt, staleAt, registrationId);
  }

  private findRegistration(input: {
    principalId: string;
    deviceId: string;
    tokenKind: ApplePushTokenKind;
    environment: ApplePushEnvironment;
    topic: string;
  }): ApplePushDeviceRegistration | undefined {
    const row = this.db.query(`
      SELECT * FROM apple_push_device_registrations
      WHERE principal_id = ?
        AND device_id = ?
        AND token_kind = ?
        AND environment = ?
        AND topic = ?
    `).get(
      input.principalId,
      input.deviceId,
      input.tokenKind,
      input.environment,
      input.topic,
    ) as ApplePushDeviceRegistrationRow | undefined;
    return row ? mapRegistration(row) : undefined;
  }
}

function mapRegistration(row: ApplePushDeviceRegistrationRow): ApplePushDeviceRegistration {
  return {
    registrationId: row.registration_id,
    principalId: row.principal_id,
    deviceId: row.device_id,
    platform: row.platform,
    tokenKind: row.token_kind,
    pushToken: row.push_token,
    topic: row.topic,
    environment: row.environment,
    appBundleId: row.app_bundle_id || undefined,
    deviceName: row.device_name || undefined,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
    staleAt: row.stale_at ?? undefined,
    metadata: parseRecord(row.metadata_json),
  };
}

function mapPreferences(row: AppleNotificationPreferencesRow): AppleNotificationPreferences {
  return {
    principalId: row.principal_id,
    enabled: row.enabled === 1,
    quietHours: {
      enabled: row.quiet_hours_enabled === 1,
      startMinute: row.quiet_hours_start_minute,
      endMinute: row.quiet_hours_end_minute,
      timeZone: row.quiet_hours_time_zone || undefined,
    },
    cooldownSeconds: row.cooldown_seconds,
    allowCritical: row.allow_critical === 1,
    updatedAt: row.updated_at,
  };
}

function mapDelivery(row: AppleNotificationDeliveryRow): AppleNotificationDelivery {
  return {
    deliveryId: row.delivery_id,
    principalId: row.principal_id,
    registrationId: row.registration_id || undefined,
    notificationId: row.notification_id || undefined,
    feedbackId: row.feedback_id || undefined,
    callId: row.call_id || undefined,
    gatewayId: row.gateway_id || undefined,
    channel: row.channel,
    status: row.status,
    action: normalizeAction(row.action),
    deepLink: row.deep_link || undefined,
    errorMessage: row.error_message || undefined,
    createdAt: row.created_at,
    sentAt: row.sent_at ?? undefined,
    openedAt: row.opened_at ?? undefined,
    actionedAt: row.actioned_at ?? undefined,
    payload: parseRecord(row.payload_json),
  };
}

function parseRecord(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function normalizeAction(value: string): AppleNotificationAction | undefined {
  if (
    value === "approve"
    || value === "reject"
    || value === "defer"
    || value === "revise"
    || value === "open_app"
  ) {
    return value;
  }
  return undefined;
}
