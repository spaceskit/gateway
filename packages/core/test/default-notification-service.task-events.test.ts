import { describe, expect, test } from "bun:test";
import { EventBus } from "../src/events/event-bus.js";
import { DefaultNotificationService } from "../src/notifications/notification-service.js";

describe("DefaultNotificationService task event mapping", () => {
  test("maps task.progress and task.input-required to user-facing notifications", async () => {
    const eventBus = new EventBus();
    const pushes: Array<{ clientId: string; notification: { category: string; severity: string; message: string } }> = [];
    const service = new DefaultNotificationService({
      eventBus,
      onPush: async (clientId, notification) => {
        pushes.push({
          clientId,
          notification: {
            category: notification.category,
            severity: notification.severity,
            message: notification.message,
          },
        });
      },
    });

    await service.subscribe("client-1", ["task.progress", "task.input-required"], [{ type: "space", spaceId: "space-1" }]);

    eventBus.emit({
      type: "task.progress",
      timestamp: new Date(),
      spaceId: "space-1",
      data: {
        taskId: "task-1",
        progress: { currentPhase: "executing", turnsCompleted: 1, turnsTotal: 4 },
        message: "Worker 1 is researching",
      },
    } as any);

    eventBus.emit({
      type: "task.input-required",
      timestamp: new Date(),
      spaceId: "space-1",
      data: {
        taskId: "task-1",
        message: "Need a decision before proceeding",
      },
    } as any);

    expect(pushes).toHaveLength(2);
    expect(pushes[0]).toEqual({
      clientId: "client-1",
      notification: {
        category: "task.progress",
        severity: "info",
        message: "Worker 1 is researching",
      },
    });
    expect(pushes[1]).toEqual({
      clientId: "client-1",
      notification: {
        category: "task.input-required",
        severity: "warning",
        message: "Need a decision before proceeding",
      },
    });
  });
});
