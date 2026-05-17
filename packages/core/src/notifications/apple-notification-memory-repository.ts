import type {
  AppleNotificationAction,
  AppleNotificationDelivery,
  AppleNotificationDeliveryStatus,
  AppleNotificationLifecycleRepository,
  AppleNotificationPreferences,
  ApplePushDeviceRegistration,
  ApplePushEnvironment,
  ApplePushTokenKind,
  RecordAppleNotificationDeliveryInput,
  RegisterApplePushDeviceInput,
} from "./apple-notification-lifecycle.js";
import { normalizeOptionalString } from "./apple-notification-lifecycle-helpers.js";

export class InMemoryAppleNotificationLifecycleRepository implements AppleNotificationLifecycleRepository {
  private registrations = new Map<string, ApplePushDeviceRegistration>();
  private preferences = new Map<string, AppleNotificationPreferences>();
  private deliveries = new Map<string, AppleNotificationDelivery>();

  upsertDeviceRegistration(input: RegisterApplePushDeviceInput & {
    registrationId: string;
    tokenKind: ApplePushTokenKind;
    topic: string;
    environment: ApplePushEnvironment;
    createdAt: string;
    updatedAt: string;
    lastSeenAt: string;
  }): ApplePushDeviceRegistration {
    const existing = Array.from(this.registrations.values()).find((registration) =>
      registration.principalId === input.principalId
      && registration.deviceId === (input.deviceId ?? "")
      && registration.tokenKind === input.tokenKind
      && registration.environment === input.environment
      && registration.topic === input.topic
    );
    const registrationId = existing?.registrationId ?? input.registrationId;
    const createdAt = existing?.createdAt ?? input.createdAt;
    const registration: ApplePushDeviceRegistration = {
      registrationId,
      principalId: input.principalId,
      deviceId: input.deviceId ?? "",
      platform: input.platform,
      tokenKind: input.tokenKind,
      pushToken: input.pushToken,
      topic: input.topic,
      environment: input.environment,
      appBundleId: normalizeOptionalString(input.appBundleId),
      deviceName: normalizeOptionalString(input.deviceName),
      enabled: true,
      createdAt,
      updatedAt: input.updatedAt,
      lastSeenAt: input.lastSeenAt,
      staleAt: undefined,
      metadata: input.metadata ?? {},
    };
    this.registrations.set(registrationId, registration);
    return registration;
  }

  deleteDeviceRegistration(principalId: string, registrationId: string): boolean {
    const registration = this.registrations.get(registrationId);
    if (!registration || registration.principalId !== principalId) return false;
    return this.registrations.delete(registrationId);
  }

  listDeviceRegistrations(principalId: string, tokenKind?: ApplePushTokenKind): ApplePushDeviceRegistration[] {
    return Array.from(this.registrations.values()).filter((registration) =>
      registration.principalId === principalId
      && (tokenKind === undefined || registration.tokenKind === tokenKind)
    );
  }

  getPreferences(principalId: string): AppleNotificationPreferences | undefined {
    return this.preferences.get(principalId);
  }

  setPreferences(principalId: string, preferences: AppleNotificationPreferences): AppleNotificationPreferences {
    this.preferences.set(principalId, preferences);
    return preferences;
  }

  recordDelivery(input: RecordAppleNotificationDeliveryInput & {
    deliveryId: string;
    status: AppleNotificationDeliveryStatus;
    createdAt: string;
  }): AppleNotificationDelivery {
    const delivery: AppleNotificationDelivery = {
      deliveryId: input.deliveryId,
      principalId: input.principalId,
      registrationId: normalizeOptionalString(input.registrationId),
      notificationId: normalizeOptionalString(input.notificationId),
      feedbackId: normalizeOptionalString(input.feedbackId),
      callId: normalizeOptionalString(input.callId),
      gatewayId: normalizeOptionalString(input.gatewayId),
      channel: input.channel,
      status: input.status,
      action: input.action,
      deepLink: normalizeOptionalString(input.deepLink),
      errorMessage: normalizeOptionalString(input.errorMessage),
      createdAt: input.createdAt,
      sentAt: normalizeOptionalString(input.sentAt),
      openedAt: normalizeOptionalString(input.openedAt),
      actionedAt: normalizeOptionalString(input.actionedAt),
      payload: input.payload ?? {},
    };
    this.deliveries.set(`${delivery.principalId}:${delivery.deliveryId}`, delivery);
    return delivery;
  }

  getDelivery(principalId: string, deliveryId: string): AppleNotificationDelivery | undefined {
    return this.deliveries.get(`${principalId}:${deliveryId}`);
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
    const next: AppleNotificationDelivery = {
      ...existing,
      status: input.status ?? existing.status,
      action: input.action ?? existing.action,
      openedAt: input.openedAt ?? existing.openedAt,
      actionedAt: input.actionedAt ?? existing.actionedAt,
      errorMessage: input.errorMessage ?? existing.errorMessage,
    };
    this.deliveries.set(`${next.principalId}:${next.deliveryId}`, next);
    return next;
  }

  pruneStaleRegistrations(beforeIso: string): number {
    let pruned = 0;
    for (const registration of Array.from(this.registrations.values())) {
      const staleAt = normalizeOptionalString(registration.staleAt);
      if (staleAt && staleAt <= beforeIso) {
        this.registrations.delete(registration.registrationId);
        pruned++;
      }
    }
    return pruned;
  }

  markRegistrationStale(registrationId: string, staleAt: string): void {
    const registration = this.registrations.get(registrationId);
    if (!registration) return;
    this.registrations.set(registrationId, {
      ...registration,
      staleAt,
      enabled: false,
    });
  }
}
