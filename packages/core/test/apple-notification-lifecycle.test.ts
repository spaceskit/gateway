import { describe, expect, test } from "vitest";
import {
  AppleNotificationLifecycleService,
  InMemoryAppleNotificationLifecycleRepository,
  type Notification,
} from "../src/index.js";

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    notificationId: "notification-1",
    category: "feedback.requested",
    title: "Input requested",
    message: "Approve the deployment?",
    severity: "warning",
    payload: {
      requestId: "feedback-1",
      allowedResponses: ["approve", "reject", "defer", "revise", "open_app"],
      deepLink: "spaces://feedback/feedback-1",
      gatewayId: "gateway-1",
      urgency: "important",
    },
    targets: [{ type: "user", userId: "principal-1" }],
    actionUrl: "spaces://feedback/feedback-1",
    createdAt: new Date("2026-05-03T08:00:00.000Z"),
    ...overrides,
  };
}

describe("AppleNotificationLifecycleService", () => {
  test("durably upserts alert and VoIP device registrations", async () => {
    const service = new AppleNotificationLifecycleService({
      now: () => new Date("2026-05-03T08:00:00.000Z"),
    });

    const alert = await service.registerDevice({
      principalId: "principal-1",
      deviceId: "device-1",
      platform: "ios",
      tokenKind: "alert",
      pushToken: "alert-token-1",
      topic: "io.spaces.app",
      environment: "sandbox",
      deviceName: "iPhone",
    });
    const updatedAlert = await service.registerDevice({
      principalId: "principal-1",
      deviceId: "device-1",
      platform: "ios",
      tokenKind: "alert",
      pushToken: "alert-token-2",
      topic: "io.spaces.app",
      environment: "sandbox",
    });
    const voip = await service.registerDevice({
      principalId: "principal-1",
      deviceId: "device-1",
      platform: "ios",
      tokenKind: "voip",
      pushToken: "voip-token-1",
      topic: "io.spaces.app.voip",
      environment: "sandbox",
    });

    expect(updatedAlert.registrationId).toBe(alert.registrationId);
    expect(updatedAlert.pushToken).toBe("alert-token-2");
    expect(voip.registrationId).not.toBe(alert.registrationId);
    expect(voip.tokenKind).toBe("voip");
  });

  test("builds APNs alert and VoIP payloads with required headers", async () => {
    const service = new AppleNotificationLifecycleService();
    const alertRegistration = await service.registerDevice({
      principalId: "principal-1",
      deviceId: "device-1",
      platform: "ios",
      tokenKind: "alert",
      pushToken: "alert-token",
      topic: "io.spaces.app",
    });
    const voipRegistration = await service.registerDevice({
      principalId: "principal-1",
      deviceId: "device-1",
      platform: "ios",
      tokenKind: "voip",
      pushToken: "voip-token",
      topic: "io.spaces.app.voip",
    });

    const alert = service.buildAlertPush({
      registration: alertRegistration,
      deliveryId: "delivery-1",
      notification: makeNotification(),
    });
    const voip = service.buildVoipPush({
      registration: voipRegistration,
      callId: "11111111-2222-3333-4444-555555555555",
      gatewayId: "gateway-1",
      urgency: "urgent",
      displayName: "Spaces Concierge",
      deepLink: "spaces://call/11111111-2222-3333-4444-555555555555",
    });

    expect(alert.headers["apns-push-type"]).toBe("alert");
    expect(alert.headers["apns-topic"]).toBe("io.spaces.app");
    expect(alert.headers["apns-collapse-id"]).toBe("feedback-1");
    expect(alert.payload).toMatchObject({
      spaces: {
        deliveryId: "delivery-1",
        feedbackId: "feedback-1",
        actions: ["approve", "reject", "defer", "revise", "open_app"],
      },
    });

    expect(voip.headers["apns-push-type"]).toBe("voip");
    expect(voip.headers["apns-topic"]).toBe("io.spaces.app.voip");
    expect(voip.payload).toEqual({
      aps: {},
      spaces: {
        type: "concierge_call",
        callId: "11111111-2222-3333-4444-555555555555",
        gatewayId: "gateway-1",
        urgency: "urgent",
        displayName: "Spaces Concierge",
        deepLink: "spaces://call/11111111-2222-3333-4444-555555555555",
      },
    });
    expect(JSON.stringify(voip.payload)).not.toContain("transcript");
    expect(JSON.stringify(voip.payload)).not.toContain("prompt");
  });

  test("suppresses alert push for connected sessions and quiet-hours or cooldown policy", async () => {
    const service = new AppleNotificationLifecycleService({
      now: () => new Date("2026-05-03T08:00:00.000Z"),
    });
    await service.registerDevice({
      principalId: "principal-1",
      platform: "macos",
      pushToken: "alert-token",
      topic: "io.spaces.mac",
    });

    const connectedDecision = await service.planAlertDelivery({
      principalId: "principal-1",
      notification: makeNotification(),
      connectedClientIds: ["client-1"],
    });
    expect(connectedDecision).toEqual({ deliver: false, reason: "connected_session" });

    await service.patchPreferences("principal-1", {
      quietHours: {
        enabled: true,
        startMinute: 7 * 60,
        endMinute: 9 * 60,
      },
    });
    const quietHoursDecision = await service.planAlertDelivery({
      principalId: "principal-1",
      notification: makeNotification(),
      now: new Date("2026-05-03T08:15:00.000Z"),
    });
    expect(quietHoursDecision).toEqual({ deliver: false, reason: "quiet_hours" });

    await service.patchPreferences("principal-1", {
      quietHours: { enabled: false },
      cooldownSeconds: 600,
    });
    const firstDelivery = await service.planAlertDelivery({
      principalId: "principal-1",
      notification: makeNotification(),
      now: new Date("2026-05-03T09:00:00.000Z"),
    });
    expect(firstDelivery.deliver).toBe(true);
    const secondDelivery = await service.planAlertDelivery({
      principalId: "principal-1",
      notification: makeNotification({ notificationId: "notification-2" }),
      now: new Date("2026-05-03T09:05:00.000Z"),
    });
    expect(secondDelivery).toEqual({ deliver: false, reason: "cooldown" });
  });

  test("prunes stale tokens and resolves background feedback actions", async () => {
    const repository = new InMemoryAppleNotificationLifecycleRepository();
    const resolved: Array<Record<string, unknown>> = [];
    const service = new AppleNotificationLifecycleService({
      repository,
      feedbackResolver: (input) => {
        resolved.push(input);
        return { status: "actioned" };
      },
    });

    const registration = await service.registerDevice({
      principalId: "principal-1",
      platform: "ios",
      pushToken: "alert-token",
      topic: "io.spaces.app",
    });
    repository.markRegistrationStale(registration.registrationId, "2026-05-03T07:00:00.000Z");
    await service.recordDelivery({
      deliveryId: "delivery-1",
      principalId: "principal-1",
      registrationId: registration.registrationId,
      feedbackId: "feedback-1",
      channel: "alert",
      status: "sent",
    });

    const pruned = await service.pruneStaleRegistrations("2026-05-03T08:00:00.000Z");
    const result = await service.resolveFeedback({
      principalId: "principal-1",
      deliveryId: "delivery-1",
      feedbackId: "feedback-1",
      action: "approve",
      message: "ship it",
    });

    expect(pruned.pruned).toBe(1);
    expect(result.status).toBe("resolved");
    expect(result.delivery?.status).toBe("actioned");
    expect(result.delivery?.action).toBe("approve");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      feedbackId: "feedback-1",
      action: "approve",
      principalId: "principal-1",
    });
  });
});
