import { describe, expect, test } from "bun:test";
import { EventBus } from "@spaceskit/core";
import {
  ConciergeEscalationRequestRepository,
  initDatabase,
} from "@spaceskit/persistence";
import { ConciergeEscalationService } from "../src/services/concierge-escalation-service.js";

function createContext(nowIso = "2026-04-08T10:00:00.000Z") {
  let currentNow = new Date(nowIso);
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-concierge-escalation-${crypto.randomUUID()}`,
  });
  db.db.exec(`
    INSERT INTO spaces(
      space_id, resource_id, space_type, name, goal, status, turn_model, space_config_json, template_id, template_revision, created_at, updated_at
    ) VALUES (
      'space-main', 'resource-main', 'space', 'Main Space', '', 'active', 'sequential_all', '{}', '', 0, '${currentNow.toISOString()}', '${currentNow.toISOString()}'
    )
  `);

  const repository = new ConciergeEscalationRequestRepository(db.db);
  const notifications: any[] = [];
  const calls: any[] = [];
  const events: any[] = [];
  const eventBus = new EventBus();
  eventBus.onAny((event) => {
    events.push(event);
  });

  const service = new ConciergeEscalationService({
    repository,
    notificationService: {
      send: async (notification: any) => {
        notifications.push(notification);
      },
    } as any,
    eventBus,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      child() {
        return this;
      },
    } as any,
    now: () => currentNow,
  });

  return {
    db,
    repository,
    notifications,
    calls,
    events,
    service,
    setNow(value: string) {
      currentNow = new Date(value);
    },
    attachCallRuntime() {
      service.setConciergeCallRuntimeService({
        startCall: (input: any) => {
          calls.push(input);
          return {} as any;
        },
      });
    },
  };
}

describe("ConciergeEscalationService", () => {
  test("requestUserInput validates input, rewrites notification payloads, and returns notified state", async () => {
    const context = createContext();
    try {
      const result = await context.service.requestUserInput({
        spaceId: "space-main",
        requestingAgentId: "main-agent",
        requestingTurnId: "turn-1",
        principalId: "principal-1",
        question: "Should I ship the draft now",
        reason: "the agent is blocked on release approval",
        urgency: "important",
        allowedResponses: ["approve", "reject", "revise"],
      });

      expect(result.status).toBe("notified");
      expect(result.deliveryChannel).toBe("notification");
      expect(result.requestId).toBeTruthy();
      expect(result.deepLink).toContain("spaces://concierge/request");
      expect(context.notifications).toHaveLength(1);
      expect(context.notifications[0]).toMatchObject({
        category: "feedback.requested",
        message: "Should I ship the draft now? the agent is blocked on release approval.",
        payload: {
          requestId: result.requestId,
          allowedResponses: ["approve", "reject", "revise"],
          fallbackPolicy: "none",
          deepLink: result.deepLink,
        },
        actionUrl: result.deepLink,
      });

      const row = context.repository.getById(result.requestId);
      expect(row?.status).toBe("notified");
      expect(row?.fallback_policy).toBe("none");
      expect(row?.delivery_channel).toBe("notification");
      expect(JSON.parse(row?.allowed_responses_json ?? "[]")).toEqual(["approve", "reject", "revise"]);
    } finally {
      context.db.close();
    }
  });

  test("resolveRequest stores structured responses and returns actioned status", async () => {
    const context = createContext();
    try {
      const created = await context.service.requestUserInput({
        spaceId: "space-main",
        requestingAgentId: "main-agent",
        requestingTurnId: "turn-1",
        question: "Proceed with the sync",
        reason: "need confirmation",
      });

      const resolved = await context.service.resolveRequest({
        requestId: created.requestId,
        status: "ok",
        payload: {
          action: "approve",
          message: "Proceed",
        },
      });

      expect(resolved.status).toBe("actioned");
      expect(resolved.response).toMatchObject({
        action: "approve",
        message: "Proceed",
      });
      expect(context.events.some((event) => event.type === "concierge.request.resolved")).toBe(true);
    } finally {
      context.db.close();
    }
  });

  test("runMaintenance escalates urgent unanswered requests to a concierge call after timeout", async () => {
    const context = createContext();
    try {
      context.attachCallRuntime();
      const created = await context.service.requestUserInput({
        spaceId: "space-main",
        requestingAgentId: "main-agent",
        requestingTurnId: "turn-1",
        principalId: "principal-1",
        deviceId: "device-1",
        question: "Pick up now",
        reason: "urgent live handoff needed",
        urgency: "urgent",
        fallbackPolicy: "urgent_call_after_timeout",
      });

      context.setNow("2026-04-08T10:00:06.000Z");
      await context.service.runMaintenance();

      const status = await context.service.getRequestStatus({
        requestId: created.requestId,
        spaceId: "space-main",
        agentId: "main-agent",
      });

      expect(status.status).toBe("escalated_to_call");
      expect(status.deliveryChannel).toBe("call");
      expect(context.calls).toHaveLength(1);
      expect(context.calls[0]).toMatchObject({
        platform: "concierge-escalation",
        spaceId: "space-main",
        targetAgentId: undefined,
      });
    } finally {
      context.db.close();
    }
  });

  test("runMaintenance expires non-urgent unanswered requests without starting a call", async () => {
    const context = createContext();
    try {
      const created = await context.service.requestUserInput({
        spaceId: "space-main",
        requestingAgentId: "main-agent",
        requestingTurnId: "turn-1",
        question: "Keep waiting",
        reason: "no response yet",
        urgency: "important",
        timeoutSeconds: 2,
      });

      context.setNow("2026-04-08T10:00:03.000Z");
      await context.service.runMaintenance();

      const status = await context.service.getRequestStatus({
        requestId: created.requestId,
        spaceId: "space-main",
        agentId: "main-agent",
      });

      expect(status.status).toBe("expired");
      expect(context.calls).toHaveLength(0);
    } finally {
      context.db.close();
    }
  });
});
