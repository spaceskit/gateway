import { describe, expect, test } from "bun:test";
import { DefaultNotificationService, EventBus } from "../../core/src/index.js";
import { NotificationHandler } from "../src/notification-handler.js";

describe("NotificationHandler.pushToClient", () => {
  test("binds notification service push delivery after websocket handler setup", async () => {
    const service = new DefaultNotificationService({ eventBus: new EventBus() });
    const handler = new NotificationHandler({ notificationService: service });
    const sent: string[] = [];

    await handler.registerClient("client-1", {
      send(message: string) {
        sent.push(message);
      },
    } as any);

    const subscriptions = await service.getSubscriptions("client-1");
    expect(subscriptions[0]?.categories).toContain("task.input-required");

    await service.send({
      notificationId: "notif-1",
      category: "feedback.requested",
      title: "Input needed",
      message: "Agent needs your input",
      severity: "warning",
      payload: { requestId: "request-1" },
      targets: [{ type: "space", spaceId: "space-1" }],
      createdAt: new Date("2026-03-14T10:00:00.000Z"),
    });

    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0] ?? "{}")).toMatchObject({
      type: "notification",
      payload: {
        notificationId: "notif-1",
        category: "feedback.requested",
        body: "Agent needs your input",
      },
    });
  });

  test("serializes notification payloads with body and context fields", async () => {
    const sent: string[] = [];
    const handler = new NotificationHandler({
      notificationService: {} as any,
    });

    (handler as any).clientSockets.set("client-1", {
      send(message: string) {
        sent.push(message);
      },
    });

    await handler.pushToClient("client-1", {
      notificationId: "notif-1",
      category: "feedback.requested",
      title: "Approval needed",
      message: "Agent needs your input",
      severity: "warning",
      payload: {
        spaceId: "space-1",
        spaceUid: "space-uid-1",
        agentId: "agent-1",
        requestId: "request-1",
        allowedResponses: ["approve", "reject"],
        deepLink: "spaces://concierge/request?requestId=request-1",
        fallbackPolicy: "none",
      },
      targets: [{ type: "space", spaceId: "space-1" }],
      createdAt: new Date("2026-03-14T10:00:00.000Z"),
      expiresAt: new Date("2026-03-14T10:05:00.000Z"),
    });

    expect(sent).toHaveLength(1);
    const decoded = JSON.parse(sent[0] ?? "{}");
    expect(decoded.payload).toMatchObject({
      notificationId: "notif-1",
      category: "feedback.requested",
      title: "Approval needed",
      body: "Agent needs your input",
      message: "Agent needs your input",
      severity: "warning",
      spaceId: "space-1",
      spaceUid: "space-uid-1",
      agentId: "agent-1",
      createdAt: "2026-03-14T10:00:00.000Z",
      expiresAt: "2026-03-14T10:05:00.000Z",
      deepLink: "spaces://concierge/request?requestId=request-1",
      fallbackPolicy: "none",
    });
  });
});
