import { describe, expect, test } from "bun:test";
import { AppleNotificationLifecycleService } from "@spaceskit/core";
import { AppleNotificationApiService } from "../src/services/apple-notification-api-service.js";
import { createHttpPrincipalTestContext } from "./http-principal-test-helpers.js";

describe("AppleNotificationApiService", () => {
  test("returns null for unrelated paths", async () => {
    const service = new AppleNotificationApiService({});
    const response = await service.handleRequest(
      new Request("http://localhost/unknown", { method: "GET" }),
      new URL("http://localhost/unknown"),
    );
    expect(response).toBeNull();
  });

  test("registers Apple push devices through authenticated REST", async () => {
    const auth = createHttpPrincipalTestContext();
    const lifecycle = new AppleNotificationLifecycleService({
      now: () => new Date("2026-05-03T08:00:00.000Z"),
    });
    const service = new AppleNotificationApiService({
      principalAuth: auth.strictPrincipalAuth,
      notificationLifecycleService: lifecycle,
    });
    const request = new Request("http://localhost/v1/notifications/devices", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...auth.headers("principal-1", { deviceId: "device-auth-1" }),
      },
      body: JSON.stringify({
        platform: "ios",
        tokenKind: "voip",
        pushToken: "voip-token-1",
        topic: "io.spaces.app.voip",
        environment: "sandbox",
      }),
    });

    const response = await service.handleRequest(request, new URL(request.url));
    expect(response?.status).toBe(200);
    const body = await response!.json() as {
      registration?: { principalId?: string; deviceId?: string; tokenKind?: string };
    };
    expect(body.registration).toMatchObject({
      principalId: "principal-1",
      deviceId: "device-auth-1",
      tokenKind: "voip",
    });
  });

  test("gets and patches notification preferences", async () => {
    const auth = createHttpPrincipalTestContext();
    const lifecycle = new AppleNotificationLifecycleService();
    const service = new AppleNotificationApiService({
      principalAuth: auth.strictPrincipalAuth,
      notificationLifecycleService: lifecycle,
    });

    const patchRequest = new Request("http://localhost/v1/notifications/preferences", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...auth.headers("principal-1"),
      },
      body: JSON.stringify({
        enabled: false,
        cooldownSeconds: 60,
        quietHours: {
          enabled: true,
          startMinute: 1320,
          endMinute: 420,
          timeZone: "Europe/Berlin",
        },
      }),
    });
    const patchResponse = await service.handleRequest(patchRequest, new URL(patchRequest.url));
    expect(patchResponse?.status).toBe(200);

    const getRequest = new Request("http://localhost/v1/notifications/preferences", {
      method: "GET",
      headers: auth.headers("principal-1"),
    });
    const getResponse = await service.handleRequest(getRequest, new URL(getRequest.url));
    const body = await getResponse!.json() as {
      preferences?: { enabled?: boolean; cooldownSeconds?: number; quietHours?: { timeZone?: string } };
    };

    expect(body.preferences?.enabled).toBe(false);
    expect(body.preferences?.cooldownSeconds).toBe(60);
    expect(body.preferences?.quietHours?.timeZone).toBe("Europe/Berlin");
  });

  test("marks deliveries opened and resolves background feedback", async () => {
    const auth = createHttpPrincipalTestContext();
    const resolvedActions: string[] = [];
    const lifecycle = new AppleNotificationLifecycleService({
      feedbackResolver: (input) => {
        resolvedActions.push(input.action);
        return { ok: true };
      },
    });
    await lifecycle.recordDelivery({
      deliveryId: "delivery-1",
      principalId: "principal-1",
      channel: "alert",
      status: "sent",
      feedbackId: "feedback-1",
    });
    const service = new AppleNotificationApiService({
      principalAuth: auth.strictPrincipalAuth,
      notificationLifecycleService: lifecycle,
    });

    const openRequest = new Request("http://localhost/v1/notifications/deliveries/delivery-1/opened", {
      method: "POST",
      headers: auth.headers("principal-1"),
    });
    const openResponse = await service.handleRequest(openRequest, new URL(openRequest.url));
    expect(openResponse?.status).toBe(200);

    const resolveRequest = new Request("http://localhost/v1/notifications/feedback/feedback-1/resolve", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...auth.headers("principal-1"),
      },
      body: JSON.stringify({
        deliveryId: "delivery-1",
        action: "approve",
        message: "Approved from push",
      }),
    });
    const resolveResponse = await service.handleRequest(resolveRequest, new URL(resolveRequest.url));
    expect(resolveResponse?.status).toBe(200);
    const body = await resolveResponse!.json() as { result?: { status?: string } };

    expect(body.result?.status).toBe("resolved");
    expect(resolvedActions).toEqual(["approve"]);
  });

  test("requires signed principal identity", async () => {
    const service = new AppleNotificationApiService({
      notificationLifecycleService: new AppleNotificationLifecycleService(),
    });
    const request = new Request("http://localhost/v1/notifications/preferences", {
      method: "GET",
    });

    const response = await service.handleRequest(request, new URL(request.url));
    expect(response?.status).toBe(401);
  });
});
