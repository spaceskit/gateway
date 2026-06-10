import { describe, expect, test } from "bun:test";
import { HarnessConciergePingerService } from "../src/services/harness-concierge-pinger-service.js";
import type { HarnessConciergePing } from "../src/services/harness-concierge-ping-contract.js";

function ping(overrides: Partial<HarnessConciergePing> & { id: string }): HarnessConciergePing {
  return {
    target: "spaces/T-0001",
    urgency: "high",
    deliver: true,
    deliveryChannel: "voice",
    deliveryStatus: "active",
    message: "Review task quality proposal",
    reason: "task-quality",
    ...overrides,
  };
}

/**
 * Mirror of the real constraint in ConciergeEscalationService.requestUserInput
 * (src/services/concierge-escalation-service.ts:114-116). The mock must enforce
 * it — a permissive mock previously hid that the pinger passed the illegal
 * fallbackPolicy/urgency combination for every non-urgent ping.
 */
function assertLegalEscalation(input: Record<string, unknown>): void {
  if (input.fallbackPolicy === "urgent_call_after_timeout" && input.urgency !== "urgent") {
    throw new Error("fallbackPolicy urgent_call_after_timeout requires urgency=urgent");
  }
}

describe("HarnessConciergePingerService", () => {
  test("escalates voice-tier pings (incl. escalated 'waiting' ones) and maps urgency", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const service = new HarnessConciergePingerService({
      escalationService: {
        requestUserInput: async (input) => {
          assertLegalEscalation(input);
          requests.push(input);
          return { requestId: `req-${requests.length}`, status: "notified" };
        },
      },
      readPings: async () => [
        ping({ id: "p-urgent", urgency: "urgent", deliveryChannel: "phone-ready" }),
        // The realistic case: the harness escalated the channel to voice after
        // repeated nags, so it is between ping intervals (waiting), not due-now.
        ping({ id: "p-high", urgency: "high", deliveryChannel: "voice", deliver: false, deliveryStatus: "waiting" }),
        // Excluded: chat channel (not yet escalated to voice)
        ping({ id: "p-chat", urgency: "urgent", deliveryChannel: "chat", deliver: true }),
        // Excluded: already acknowledged by the user
        ping({ id: "p-acked", urgency: "urgent", deliveryChannel: "voice", deliveryStatus: "acknowledged" }),
        // Excluded: snoozed
        ping({ id: "p-snoozed", urgency: "urgent", deliveryChannel: "voice", deliveryStatus: "snoozed" }),
      ],
      resolvePing: async () => {},
      now: () => new Date("2026-06-09T10:00:00.000Z"),
    });

    const escalated = await service.runOnce({
      spaceId: "concierge-space",
      requestingAgentId: "concierge-agent",
    });

    expect(escalated.map((p) => p.id)).toEqual(["p-urgent", "p-high"]);
    expect(requests.map((r) => r.urgency)).toEqual(["urgent", "important"]);
    expect(requests[0]).toMatchObject({
      question: "Review task quality proposal",
      reason: "task-quality",
      fallbackPolicy: "urgent_call_after_timeout",
      // The answer window before the call fallback — NOT the 6h cooldown.
      timeoutSeconds: 120,
      context: {
        source: "harness-concierge",
        pingId: "p-urgent",
        taskId: "spaces/T-0001",
        action: "open_task",
      },
    });
    // Non-urgent pings may never carry the call fallback (the escalation
    // service rejects it); their timeout stays cooldown-derived.
    expect(requests[1]).toMatchObject({
      fallbackPolicy: "none",
      timeoutSeconds: 21600,
    });
  });

  test("isolates a failing escalation: later pings still escalate and the failed one is retried", async () => {
    const attempts: string[] = [];
    const service = new HarnessConciergePingerService({
      escalationService: {
        requestUserInput: async (input) => {
          assertLegalEscalation(input);
          const pingId = (input.context as Record<string, unknown>).pingId as string;
          attempts.push(pingId);
          if (pingId === "p-fail") throw new Error("escalation rejected");
          return { requestId: `req-${attempts.length}`, status: "notified" };
        },
      },
      readPings: async () => [
        ping({ id: "p-fail", urgency: "urgent" }),
        ping({ id: "p-after", urgency: "urgent" }),
      ],
      resolvePing: async () => {},
      now: () => new Date("2026-06-09T10:00:00.000Z"),
    });

    const first = await service.runOnce({ spaceId: "concierge-space", requestingAgentId: "agent" });
    expect(first.map((p) => p.id)).toEqual(["p-after"]);
    expect(attempts).toEqual(["p-fail", "p-after"]);

    // No promptedAt was recorded for the failed ping, so it is retried next
    // pass while the successful one cools down.
    const second = await service.runOnce({ spaceId: "concierge-space", requestingAgentId: "agent" });
    expect(second).toHaveLength(0);
    expect(attempts).toEqual(["p-fail", "p-after", "p-fail"]);
  });

  test("caps escalations per run and drains the remainder on later passes", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const service = new HarnessConciergePingerService({
      escalationService: {
        requestUserInput: async (input) => {
          assertLegalEscalation(input);
          requests.push(input);
          return { requestId: `req-${requests.length}`, status: "notified" };
        },
      },
      readPings: async () => [
        ping({ id: "p-1", urgency: "urgent" }),
        ping({ id: "p-2", urgency: "urgent" }),
        ping({ id: "p-3", urgency: "urgent" }),
      ],
      resolvePing: async () => {},
      now: () => new Date("2026-06-09T10:00:00.000Z"),
      maxEscalationsPerRun: 2,
    });

    const first = await service.runOnce({ spaceId: "concierge-space", requestingAgentId: "agent" });
    expect(first.map((p) => p.id)).toEqual(["p-1", "p-2"]);

    const second = await service.runOnce({ spaceId: "concierge-space", requestingAgentId: "agent" });
    expect(second.map((p) => p.id)).toEqual(["p-3"]);
    expect(requests).toHaveLength(3);
  });

  test("does not re-escalate the same ping within the cooldown window", async () => {
    const requests: unknown[] = [];
    const service = new HarnessConciergePingerService({
      escalationService: {
        requestUserInput: async (input) => {
          assertLegalEscalation(input);
          requests.push(input);
          return { requestId: "req-1", status: "notified" };
        },
      },
      readPings: async () => [ping({ id: "p-urgent", urgency: "urgent" })],
      resolvePing: async () => {},
      now: () => new Date("2026-06-09T10:00:00.000Z"),
      cooldownMs: 60_000,
    });

    const first = await service.runOnce({ spaceId: "concierge-space", requestingAgentId: "agent" });
    const second = await service.runOnce({ spaceId: "concierge-space", requestingAgentId: "agent" });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(requests).toHaveLength(1);
  });

  test("skips a ping that already has a recent persisted escalation", async () => {
    const requests: unknown[] = [];
    const service = new HarnessConciergePingerService({
      escalationService: {
        requestUserInput: async (input) => {
          assertLegalEscalation(input);
          requests.push(input);
          return { requestId: "req-1", status: "notified" };
        },
        findRecentRequestByContext: async () => ({ requestId: "existing", status: "notified" }),
      },
      readPings: async () => [ping({ id: "p-urgent", urgency: "urgent" })],
      resolvePing: async () => {},
      now: () => new Date("2026-06-09T10:00:00.000Z"),
    });

    const escalated = await service.runOnce({ spaceId: "concierge-space", requestingAgentId: "agent" });

    expect(escalated).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  test("resolves the harness ping when the user approves the call", async () => {
    const mutations: Array<{ pingId: string; action: string }> = [];
    const service = new HarnessConciergePingerService({
      escalationService: { requestUserInput: async () => ({ requestId: "req-1", status: "notified" }) },
      readPings: async () => [],
      resolvePing: async ({ pingId, action }) => {
        mutations.push({ pingId, action });
      },
      now: () => new Date("2026-06-09T10:00:00.000Z"),
    });

    const handled = await service.handleResolvedRequest({
      requestId: "req-xyz",
      status: "actioned",
      response: { action: "approve" },
      context: { source: "harness-concierge", pingId: "concierge/N-task-quality-admin-T-0013" },
    });

    expect(handled).toBe(true);
    expect(mutations).toEqual([
      { pingId: "concierge/N-task-quality-admin-T-0013", action: "resolve" },
    ]);
  });

  test("acks the harness ping when the user defers", async () => {
    const mutations: Array<{ pingId: string; action: string }> = [];
    const service = new HarnessConciergePingerService({
      escalationService: { requestUserInput: async () => ({ requestId: "req-1", status: "notified" }) },
      readPings: async () => [],
      resolvePing: async ({ pingId, action }) => {
        mutations.push({ pingId, action });
      },
      now: () => new Date("2026-06-09T10:00:00.000Z"),
    });

    const handled = await service.handleResolvedRequest({
      requestId: "req-defer",
      status: "actioned",
      response: { action: "defer" },
      context: { source: "harness-concierge", pingId: "p-1" },
    });

    expect(handled).toBe(true);
    expect(mutations).toEqual([{ pingId: "p-1", action: "ack" }]);
  });

  test("ignores resolved requests that are not harness pings", async () => {
    let called = false;
    const service = new HarnessConciergePingerService({
      escalationService: { requestUserInput: async () => ({ requestId: "req-1", status: "notified" }) },
      readPings: async () => [],
      resolvePing: async () => {
        called = true;
      },
      now: () => new Date("2026-06-09T10:00:00.000Z"),
    });

    const handled = await service.handleResolvedRequest({
      requestId: "req-workbench",
      status: "actioned",
      response: { action: "approve" },
      context: { source: "workbench", runId: "run-1" },
    });

    expect(handled).toBe(false);
    expect(called).toBe(false);
  });
});
