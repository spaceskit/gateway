import { randomUUID } from "node:crypto";
import { InMemoryAppleNotificationLifecycleRepository } from "./apple-notification-memory-repository.js";
import {
  isInQuietHours,
  normalizeAction,
  normalizeActionList,
  normalizeCooldownSeconds,
  normalizeMinute,
  normalizeOptionalString,
  normalizePlatform,
  normalizeRequired,
  serviceError,
} from "./apple-notification-lifecycle-helpers.js";

export { InMemoryAppleNotificationLifecycleRepository } from "./apple-notification-memory-repository.js";
import type { Notification } from "./types.js";

export type ApplePushPlatform = "ios" | "macos";
export type ApplePushTokenKind = "alert" | "voip";
export type ApplePushEnvironment = "sandbox" | "production";
export type AppleNotificationAction = "approve" | "reject" | "defer" | "revise" | "open_app";
export type AppleNotificationDeliveryChannel = "alert" | "voip";
export type AppleNotificationDeliveryStatus =
  | "queued"
  | "sent"
  | "opened"
  | "actioned"
  | "failed"
  | "suppressed";

export interface ApplePushDeviceRegistration {
  registrationId: string;
  principalId: string;
  deviceId: string;
  platform: ApplePushPlatform;
  tokenKind: ApplePushTokenKind;
  pushToken: string;
  topic: string;
  environment: ApplePushEnvironment;
  appBundleId?: string;
  deviceName?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  staleAt?: string;
  metadata: Record<string, unknown>;
}

export interface RegisterApplePushDeviceInput {
  registrationId?: string;
  principalId: string;
  deviceId?: string;
  platform: ApplePushPlatform;
  tokenKind?: ApplePushTokenKind;
  pushToken: string;
  topic?: string;
  environment?: ApplePushEnvironment;
  appBundleId?: string;
  deviceName?: string;
  metadata?: Record<string, unknown>;
}

export interface AppleNotificationQuietHours {
  enabled: boolean;
  startMinute: number;
  endMinute: number;
  timeZone?: string;
}

export interface AppleNotificationPreferences {
  principalId: string;
  enabled: boolean;
  quietHours: AppleNotificationQuietHours;
  cooldownSeconds: number;
  allowCritical: boolean;
  updatedAt: string;
}

export interface PatchAppleNotificationPreferencesInput {
  enabled?: boolean;
  quietHours?: Partial<AppleNotificationQuietHours>;
  cooldownSeconds?: number;
  allowCritical?: boolean;
}

export interface AppleNotificationDelivery {
  deliveryId: string;
  principalId: string;
  registrationId?: string;
  notificationId?: string;
  feedbackId?: string;
  callId?: string;
  gatewayId?: string;
  channel: AppleNotificationDeliveryChannel;
  status: AppleNotificationDeliveryStatus;
  action?: AppleNotificationAction;
  deepLink?: string;
  errorMessage?: string;
  createdAt: string;
  sentAt?: string;
  openedAt?: string;
  actionedAt?: string;
  payload: Record<string, unknown>;
}

export interface RecordAppleNotificationDeliveryInput {
  deliveryId?: string;
  principalId: string;
  registrationId?: string;
  notificationId?: string;
  feedbackId?: string;
  callId?: string;
  gatewayId?: string;
  channel: AppleNotificationDeliveryChannel;
  status?: AppleNotificationDeliveryStatus;
  action?: AppleNotificationAction;
  deepLink?: string;
  errorMessage?: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
  sentAt?: string;
  openedAt?: string;
  actionedAt?: string;
}

export interface BackgroundFeedbackResolveInput {
  principalId: string;
  feedbackId: string;
  action: AppleNotificationAction;
  deliveryId?: string;
  message?: string;
  payload?: Record<string, unknown>;
}

export interface BackgroundFeedbackActionResult {
  feedbackId: string;
  action: AppleNotificationAction;
  status: "resolved" | "opened";
  delivery?: AppleNotificationDelivery;
  result?: Record<string, unknown>;
}

export interface AppleApnsPushRequest {
  deviceToken: string;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
}

export interface AppleAlertPushInput {
  registration: ApplePushDeviceRegistration;
  deliveryId: string;
  notification: Notification;
}

export interface AppleVoipPushInput {
  registration: ApplePushDeviceRegistration;
  callId: string;
  gatewayId: string;
  urgency?: string;
  displayName: string;
  deepLink?: string;
}

export interface AppleAlertDeliveryPlanInput {
  principalId: string;
  notification: Notification;
  connectedClientIds?: string[];
  now?: Date;
}

export type AppleAlertDeliveryDecision =
  | {
    deliver: true;
    registrations: ApplePushDeviceRegistration[];
    deliveryId: string;
  }
  | {
    deliver: false;
    reason: "disabled" | "connected_session" | "quiet_hours" | "cooldown" | "no_devices";
  };

type MaybePromise<T> = T | Promise<T>;

export interface AppleNotificationLifecycleRepository {
  upsertDeviceRegistration(input: RegisterApplePushDeviceInput & {
    registrationId: string;
    tokenKind: ApplePushTokenKind;
    topic: string;
    environment: ApplePushEnvironment;
    createdAt: string;
    updatedAt: string;
    lastSeenAt: string;
  }): MaybePromise<ApplePushDeviceRegistration>;
  deleteDeviceRegistration(principalId: string, registrationId: string): MaybePromise<boolean>;
  listDeviceRegistrations(principalId: string, tokenKind?: ApplePushTokenKind): MaybePromise<ApplePushDeviceRegistration[]>;
  getPreferences(principalId: string): MaybePromise<AppleNotificationPreferences | undefined>;
  setPreferences(principalId: string, preferences: AppleNotificationPreferences): MaybePromise<AppleNotificationPreferences>;
  recordDelivery(input: RecordAppleNotificationDeliveryInput & {
    deliveryId: string;
    status: AppleNotificationDeliveryStatus;
    createdAt: string;
  }): MaybePromise<AppleNotificationDelivery>;
  getDelivery(principalId: string, deliveryId: string): MaybePromise<AppleNotificationDelivery | undefined>;
  updateDelivery(input: {
    principalId: string;
    deliveryId: string;
    status?: AppleNotificationDeliveryStatus;
    action?: AppleNotificationAction;
    openedAt?: string;
    actionedAt?: string;
    errorMessage?: string;
  }): MaybePromise<AppleNotificationDelivery | undefined>;
  pruneStaleRegistrations(beforeIso: string): MaybePromise<number>;
}

export interface AppleNotificationLifecycleServiceOptions {
  repository?: AppleNotificationLifecycleRepository;
  now?: () => Date;
  feedbackResolver?: (input: BackgroundFeedbackResolveInput) => MaybePromise<Record<string, unknown> | undefined>;
}

const DEFAULT_TOPIC = "io.spaces.app";
const DEFAULT_COOLDOWN_SECONDS = 300;

export class AppleNotificationLifecycleService {
  private readonly repository: AppleNotificationLifecycleRepository;
  private readonly now: () => Date;
  private readonly feedbackResolver?: AppleNotificationLifecycleServiceOptions["feedbackResolver"];
  private lastAlertDeliveryByPrincipal = new Map<string, number>();

  constructor(options: AppleNotificationLifecycleServiceOptions = {}) {
    this.repository = options.repository ?? new InMemoryAppleNotificationLifecycleRepository();
    this.now = options.now ?? (() => new Date());
    this.feedbackResolver = options.feedbackResolver;
  }

  async registerDevice(input: RegisterApplePushDeviceInput): Promise<ApplePushDeviceRegistration> {
    const principalId = normalizeRequired(input.principalId, "principalId");
    const pushToken = normalizeRequired(input.pushToken, "pushToken");
    const platform = normalizePlatform(input.platform);
    const tokenKind = input.tokenKind ?? "alert";
    const topic = normalizeOptionalString(input.topic) ?? normalizeOptionalString(input.appBundleId) ?? DEFAULT_TOPIC;
    const environment = input.environment ?? "sandbox";
    const nowIso = this.now().toISOString();
    return this.repository.upsertDeviceRegistration({
      ...input,
      registrationId: normalizeOptionalString(input.registrationId) ?? randomUUID(),
      principalId,
      deviceId: normalizeOptionalString(input.deviceId) ?? "",
      platform,
      tokenKind,
      pushToken,
      topic,
      environment,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastSeenAt: nowIso,
      metadata: input.metadata ?? {},
    });
  }

  async deleteDevice(principalId: string, registrationId: string): Promise<{ deleted: boolean }> {
    return {
      deleted: await this.repository.deleteDeviceRegistration(
        normalizeRequired(principalId, "principalId"),
        normalizeRequired(registrationId, "registrationId"),
      ),
    };
  }

  async getPreferences(principalId: string): Promise<AppleNotificationPreferences> {
    const normalizedPrincipalId = normalizeRequired(principalId, "principalId");
    return await this.repository.getPreferences(normalizedPrincipalId)
      ?? this.defaultPreferences(normalizedPrincipalId);
  }

  async patchPreferences(
    principalId: string,
    patch: PatchAppleNotificationPreferencesInput,
  ): Promise<AppleNotificationPreferences> {
    const current = await this.getPreferences(principalId);
    const next: AppleNotificationPreferences = {
      ...current,
      enabled: patch.enabled ?? current.enabled,
      allowCritical: patch.allowCritical ?? current.allowCritical,
      cooldownSeconds: normalizeCooldownSeconds(
        patch.cooldownSeconds ?? current.cooldownSeconds,
        DEFAULT_COOLDOWN_SECONDS,
      ),
      quietHours: {
        ...current.quietHours,
        ...patch.quietHours,
        startMinute: normalizeMinute(patch.quietHours?.startMinute ?? current.quietHours.startMinute),
        endMinute: normalizeMinute(patch.quietHours?.endMinute ?? current.quietHours.endMinute),
      },
      updatedAt: this.now().toISOString(),
    };
    return this.repository.setPreferences(current.principalId, next);
  }

  async markDeliveryOpened(principalId: string, deliveryId: string): Promise<AppleNotificationDelivery> {
    const delivery = await this.repository.updateDelivery({
      principalId: normalizeRequired(principalId, "principalId"),
      deliveryId: normalizeRequired(deliveryId, "deliveryId"),
      status: "opened",
      openedAt: this.now().toISOString(),
    });
    if (!delivery) {
      throw serviceError("NOT_FOUND", `Notification delivery not found: ${deliveryId}`);
    }
    return delivery;
  }

  async resolveFeedback(input: BackgroundFeedbackResolveInput): Promise<BackgroundFeedbackActionResult> {
    const principalId = normalizeRequired(input.principalId, "principalId");
    const feedbackId = normalizeRequired(input.feedbackId, "feedbackId");
    const action = normalizeAction(input.action);
    let delivery: AppleNotificationDelivery | undefined;
    if (input.deliveryId) {
      delivery = await this.repository.updateDelivery({
        principalId,
        deliveryId: input.deliveryId,
        status: "actioned",
        action,
        actionedAt: this.now().toISOString(),
      });
      if (!delivery) {
        throw serviceError("NOT_FOUND", `Notification delivery not found: ${input.deliveryId}`);
      }
    }

    if (action === "open_app") {
      return { feedbackId, action, status: "opened", delivery };
    }

    const result = await this.feedbackResolver?.({
      ...input,
      principalId,
      feedbackId,
      action,
    });
    return {
      feedbackId,
      action,
      status: "resolved",
      delivery,
      result,
    };
  }

  async recordDelivery(input: RecordAppleNotificationDeliveryInput): Promise<AppleNotificationDelivery> {
    return this.repository.recordDelivery({
      ...input,
      deliveryId: normalizeOptionalString(input.deliveryId) ?? randomUUID(),
      status: input.status ?? "queued",
      createdAt: input.createdAt ?? this.now().toISOString(),
      payload: input.payload ?? {},
    });
  }

  async planAlertDelivery(input: AppleAlertDeliveryPlanInput): Promise<AppleAlertDeliveryDecision> {
    const preferences = await this.getPreferences(input.principalId);
    if (!preferences.enabled) {
      return { deliver: false, reason: "disabled" };
    }

    const urgency = normalizeOptionalString(input.notification.payload.urgency)
      ?? normalizeOptionalString(input.notification.payload.escalationUrgency);
    const isUrgent = urgency === "urgent" || input.notification.severity === "critical";
    if ((input.connectedClientIds?.length ?? 0) > 0 && !isUrgent) {
      return { deliver: false, reason: "connected_session" };
    }

    const now = input.now ?? this.now();
    if (!isUrgent && isInQuietHours(now, preferences.quietHours)) {
      return { deliver: false, reason: "quiet_hours" };
    }

    const lastDeliveryMs = this.lastAlertDeliveryByPrincipal.get(preferences.principalId);
    if (lastDeliveryMs !== undefined) {
      const elapsedSeconds = (now.getTime() - lastDeliveryMs) / 1000;
      if (elapsedSeconds < preferences.cooldownSeconds && !isUrgent) {
        return { deliver: false, reason: "cooldown" };
      }
    }

    const registrations = await this.repository.listDeviceRegistrations(preferences.principalId, "alert");
    const enabledRegistrations = registrations.filter((registration) => registration.enabled);
    if (enabledRegistrations.length === 0) {
      return { deliver: false, reason: "no_devices" };
    }

    this.lastAlertDeliveryByPrincipal.set(preferences.principalId, now.getTime());
    return {
      deliver: true,
      registrations: enabledRegistrations,
      deliveryId: randomUUID(),
    };
  }

  buildAlertPush(input: AppleAlertPushInput): AppleApnsPushRequest {
    const feedbackId = normalizeOptionalString(input.notification.payload.requestId)
      ?? normalizeOptionalString(input.notification.payload.feedbackId);
    const deepLink = normalizeOptionalString(input.notification.actionUrl)
      ?? normalizeOptionalString(input.notification.payload.deepLink);
    const allowedActions = normalizeActionList(input.notification.payload.allowedResponses);
    return {
      deviceToken: input.registration.pushToken,
      headers: {
        "apns-push-type": "alert",
        "apns-topic": input.registration.topic,
        "apns-priority": input.notification.severity === "critical" ? "10" : "5",
        "apns-collapse-id": feedbackId ?? input.notification.notificationId,
      },
      payload: {
        aps: {
          alert: {
            title: input.notification.title,
            body: input.notification.message,
          },
          sound: "default",
          category: "SPACES_CONCIERGE_FEEDBACK",
          "thread-id": input.notification.category,
          ...(input.notification.severity === "critical" ? { "interruption-level": "time-sensitive" } : {}),
        },
        spaces: {
          deliveryId: input.deliveryId,
          notificationId: input.notification.notificationId,
          feedbackId,
          gatewayId: normalizeOptionalString(input.notification.payload.gatewayId),
          deepLink,
          category: input.notification.category,
          actions: allowedActions,
        },
      },
    };
  }

  buildVoipPush(input: AppleVoipPushInput): AppleApnsPushRequest {
    return {
      deviceToken: input.registration.pushToken,
      headers: {
        "apns-push-type": "voip",
        "apns-topic": input.registration.topic,
        "apns-priority": "10",
      },
      payload: {
        aps: {},
        spaces: {
          type: "concierge_call",
          callId: normalizeRequired(input.callId, "callId"),
          gatewayId: normalizeRequired(input.gatewayId, "gatewayId"),
          urgency: normalizeOptionalString(input.urgency) ?? "important",
          displayName: normalizeRequired(input.displayName, "displayName"),
          deepLink: normalizeOptionalString(input.deepLink),
        },
      },
    };
  }

  async pruneStaleRegistrations(beforeIso: string): Promise<{ pruned: number }> {
    return { pruned: await this.repository.pruneStaleRegistrations(beforeIso) };
  }

  private defaultPreferences(principalId: string): AppleNotificationPreferences {
    return {
      principalId,
      enabled: true,
      quietHours: {
        enabled: false,
        startMinute: 22 * 60,
        endMinute: 7 * 60,
      },
      cooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
      allowCritical: true,
      updatedAt: this.now().toISOString(),
    };
  }
}
