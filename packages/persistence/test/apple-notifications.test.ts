import { afterEach, describe, expect, test } from "bun:test";
import { initDatabase } from "../src/database.js";
import { AppleNotificationRepository } from "../src/repositories/apple-notifications.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
});

function createInMemory() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-apple-notifications-${crypto.randomUUID()}`,
  });
  dbManagers.push(db);
  return db;
}

describe("AppleNotificationRepository", () => {
  test("upserts device registrations by principal/device/token kind/topic", () => {
    const db = createInMemory();
    const repo = new AppleNotificationRepository(db.db);

    const first = repo.upsertDeviceRegistration({
      registrationId: "registration-1",
      principalId: "principal-1",
      deviceId: "device-1",
      platform: "ios",
      tokenKind: "alert",
      pushToken: "token-1",
      topic: "io.spaces.app",
      environment: "sandbox",
      createdAt: "2026-05-03T08:00:00.000Z",
      updatedAt: "2026-05-03T08:00:00.000Z",
      lastSeenAt: "2026-05-03T08:00:00.000Z",
      metadata: { locale: "en-US" },
    });
    const second = repo.upsertDeviceRegistration({
      registrationId: "registration-ignored",
      principalId: "principal-1",
      deviceId: "device-1",
      platform: "ios",
      tokenKind: "alert",
      pushToken: "token-2",
      topic: "io.spaces.app",
      environment: "sandbox",
      createdAt: "2026-05-03T08:01:00.000Z",
      updatedAt: "2026-05-03T08:01:00.000Z",
      lastSeenAt: "2026-05-03T08:01:00.000Z",
    });

    expect(second.registrationId).toBe(first.registrationId);
    expect(second.pushToken).toBe("token-2");
    expect(repo.listDeviceRegistrations("principal-1", "alert")).toHaveLength(1);
  });

  test("stores preferences and delivery telemetry", () => {
    const db = createInMemory();
    const repo = new AppleNotificationRepository(db.db);

    const preferences = repo.setPreferences("principal-1", {
      principalId: "principal-1",
      enabled: true,
      quietHours: {
        enabled: true,
        startMinute: 22 * 60,
        endMinute: 7 * 60,
        timeZone: "Europe/Berlin",
      },
      cooldownSeconds: 120,
      allowCritical: false,
      updatedAt: "2026-05-03T08:00:00.000Z",
    });
    const delivery = repo.recordDelivery({
      deliveryId: "delivery-1",
      principalId: "principal-1",
      channel: "alert",
      status: "sent",
      feedbackId: "feedback-1",
      createdAt: "2026-05-03T08:01:00.000Z",
      payload: { category: "feedback.requested" },
    });
    const opened = repo.updateDelivery({
      principalId: "principal-1",
      deliveryId: delivery.deliveryId,
      status: "opened",
      openedAt: "2026-05-03T08:02:00.000Z",
    });

    expect(preferences.quietHours.timeZone).toBe("Europe/Berlin");
    expect(repo.getPreferences("principal-1")?.cooldownSeconds).toBe(120);
    expect(opened?.status).toBe("opened");
    expect(opened?.openedAt).toBe("2026-05-03T08:02:00.000Z");
    expect(repo.getDelivery("principal-1", "delivery-1")?.payload).toEqual({
      category: "feedback.requested",
    });
  });

  test("prunes stale registrations", () => {
    const db = createInMemory();
    const repo = new AppleNotificationRepository(db.db);

    const registration = repo.upsertDeviceRegistration({
      registrationId: "registration-1",
      principalId: "principal-1",
      deviceId: "device-1",
      platform: "macos",
      tokenKind: "alert",
      pushToken: "token-1",
      topic: "io.spaces.mac",
      environment: "production",
      createdAt: "2026-05-03T08:00:00.000Z",
      updatedAt: "2026-05-03T08:00:00.000Z",
      lastSeenAt: "2026-05-03T08:00:00.000Z",
    });
    repo.markRegistrationStale(registration.registrationId, "2026-05-03T09:00:00.000Z");

    expect(repo.pruneStaleRegistrations("2026-05-03T08:59:00.000Z")).toBe(0);
    expect(repo.pruneStaleRegistrations("2026-05-03T09:00:00.000Z")).toBe(1);
    expect(repo.listDeviceRegistrations("principal-1")).toHaveLength(0);
  });
});
