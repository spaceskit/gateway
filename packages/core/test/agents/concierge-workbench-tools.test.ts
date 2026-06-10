import { describe, expect, test } from "bun:test";
import {
  CONCIERGE_OPERATIONS_SKILL_ID,
  createConciergeWorkbenchToolDefinitions,
  createConciergeWorkbenchToolExecutor,
  createConciergeWorkbenchToolFilter,
} from "../../src/agents/concierge-workbench-tools.js";

describe("concierge workbench tools", () => {
  test("defines read and confirmation-gated mutation tools", () => {
    const definitions = createConciergeWorkbenchToolDefinitions();
    expect(definitions.map((entry) => entry.name)).toEqual([
      "workbench.list_queue",
      "workbench.get_queue_item",
      "workbench.list_runs",
      "workbench.get_run",
      "workbench.get_policy",
      "workbench.list_artifacts",
      "workbench.start_run",
      "workbench.retry_run",
      "workbench.cancel_run",
      "workbench.approve_stage",
      "workbench.reject_stage",
    ]);
  });

  test("filter only allows the built-in concierge operations profile", async () => {
    const filter = createConciergeWorkbenchToolFilter({
      spaceAdminService: {
        getSpace: async () => ({
          agents: [
            { agentId: "concierge-agent", profileId: "profile-concierge" },
            { agentId: "trusted-worker", profileId: "profile-trusted" },
          ],
        }),
      },
      profileRepo: {
        getActiveRevision: (profileId: string) => ({
          default_skill_set_ids_json: profileId === "profile-concierge"
            ? JSON.stringify([CONCIERGE_OPERATIONS_SKILL_ID])
            : JSON.stringify(["system/user-escalation"]),
        }),
      },
    });

    await expect(filter("space-main", "concierge-agent")).resolves.toBe(true);
    await expect(filter("space-main", "trusted-worker")).resolves.toBe(false);
  });

  test("read tools do not require confirmation", async () => {
    const executor = createConciergeWorkbenchToolExecutor({
      workbenchService: {
        listQueue: async () => [{ queueItemId: "spaces/T-0001" }],
      },
    });

    const result = await executor("workbench.list_queue", { limit: 3 }, {
      spaceId: "space-main",
      agentId: "concierge-agent",
      turnId: "turn-1",
      principalId: "principal-1",
    });

    expect(result.isError).toBeFalsy();
    expect(result.result).toEqual([{ queueItemId: "spaces/T-0001" }]);
  });

  test("read tools preserve the Workbench service receiver", async () => {
    class ReceiverSensitiveWorkbenchService {
      private readonly items = [{ queueItemId: "spaces/T-0001" }];

      async listQueue(): Promise<Array<{ queueItemId: string }>> {
        return this.items;
      }
    }

    const executor = createConciergeWorkbenchToolExecutor({
      workbenchService: new ReceiverSensitiveWorkbenchService(),
    });

    const result = await executor("workbench.list_queue", {}, {
      spaceId: "space-main",
      agentId: "concierge-agent",
      turnId: "turn-1",
    });

    expect(result.isError).toBeFalsy();
    expect(result.result).toEqual([{ queueItemId: "spaces/T-0001" }]);
  });

  test("mutation tools reject missing or unapproved confirmation requests", async () => {
    const startedRuns: unknown[] = [];
    const executor = createConciergeWorkbenchToolExecutor({
      workbenchService: {
        startRun: async (input: unknown) => {
          startedRuns.push(input);
          return { runId: "run-1" };
        },
      },
      confirmationService: {
        getRequestStatus: async () => ({
          requestId: "request-1",
          status: "notified",
          deliveryChannel: "notification",
          question: "Start?",
          reason: "Need approval",
          urgency: "important",
          allowedResponses: ["approve", "reject"],
          fallbackPolicy: "none",
        }),
      },
    });

    const context = {
      spaceId: "space-main",
      agentId: "concierge-agent",
      turnId: "turn-1",
      principalId: "principal-1",
    };

    const missing = await executor("workbench.start_run", { queueItemId: "spaces/T-0001" }, context);
    expect(missing.isError).toBe(true);
    expect(missing.result).toMatchObject({
      error: {
        code: "confirmation_required",
      },
    });

    const unapproved = await executor(
      "workbench.start_run",
      { queueItemId: "spaces/T-0001", confirmationRequestId: "request-1" },
      context,
    );
    expect(unapproved.isError).toBe(true);
    expect(unapproved.result).toMatchObject({
      error: {
        code: "confirmation_not_approved",
      },
    });
    expect(startedRuns).toHaveLength(0);
  });

  test("mutation tools execute after approved confirmation", async () => {
    const executor = createConciergeWorkbenchToolExecutor({
      workbenchService: {
        startRun: async (input: unknown) => input,
      },
      confirmationService: {
        getRequestStatus: async () => ({
          requestId: "request-1",
          status: "actioned",
          deliveryChannel: "notification",
          question: "Start?",
          reason: "Need approval",
          urgency: "important",
          allowedResponses: ["approve", "reject"],
          fallbackPolicy: "none",
          context: {
            source: "workbench",
            requestedMutation: "workbench.start_run",
            queueItemId: "spaces/T-0001",
            executionMode: "supervised",
          },
          response: {
            action: "approve",
          },
        }),
      },
    });

    const result = await executor(
      "workbench.start_run",
      {
        queueItemId: "spaces/T-0001",
        executionMode: "supervised",
        confirmationRequestId: "request-1",
      },
      {
        spaceId: "space-main",
        agentId: "concierge-agent",
        turnId: "turn-1",
        principalId: "principal-1",
      },
    );

    expect(result.isError).toBeFalsy();
    expect(result.result).toMatchObject({
      principalId: "principal-1",
      queueItemId: "spaces/T-0001",
      executionMode: "supervised",
    });
  });

  test("mutation tools reject approved confirmations for a different Workbench target", async () => {
    const startedRuns: unknown[] = [];
    const executor = createConciergeWorkbenchToolExecutor({
      workbenchService: {
        startRun: async (input: unknown) => {
          startedRuns.push(input);
          return { runId: "run-1" };
        },
      },
      confirmationService: {
        getRequestStatus: async () => ({
          requestId: "request-1",
          status: "actioned",
          deliveryChannel: "notification",
          question: "Start spaces/T-0001?",
          reason: "Need approval",
          urgency: "important",
          allowedResponses: ["approve", "reject"],
          fallbackPolicy: "none",
          context: {
            source: "workbench",
            requestedMutation: "workbench.start_run",
            queueItemId: "spaces/T-0001",
            executionMode: "supervised",
          },
          response: {
            action: "approve",
          },
        }),
      },
    });

    const result = await executor(
      "workbench.start_run",
      {
        queueItemId: "spaces/T-0002",
        executionMode: "supervised",
        confirmationRequestId: "request-1",
      },
      {
        spaceId: "space-main",
        agentId: "concierge-agent",
        turnId: "turn-1",
        principalId: "principal-1",
      },
    );

    expect(result.isError).toBe(true);
    expect(result.result).toMatchObject({
      error: {
        code: "confirmation_context_mismatch",
      },
    });
    expect(startedRuns).toHaveLength(0);
  });
});
