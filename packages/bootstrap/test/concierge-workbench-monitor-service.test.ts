import { describe, expect, test } from "bun:test";
import { ConciergeWorkbenchMonitorService } from "../src/services/concierge-workbench-monitor-service.js";

describe("ConciergeWorkbenchMonitorService", () => {
  test("prompts for an awaiting-review run once per cooldown window", async () => {
    const requests: unknown[] = [];
    const service = new ConciergeWorkbenchMonitorService({
      workbenchService: {
        listQueue: async () => [],
        listRuns: async () => [{
          runId: "run-review",
          queueItemId: "spaces/T-0001",
          status: "awaiting_review",
          currentStage: "review_gate",
          updatedAt: "2026-06-05T10:00:00.000Z",
        }],
        getPolicy: async () => ({
          runnerAvailable: true,
          autonomousEnabled: true,
        }),
      },
      escalationService: {
        requestUserInput: async (input) => {
          requests.push(input);
          return {
            requestId: "request-review",
            status: "notified",
            deliveryChannel: "notification",
          };
        },
      },
      now: () => new Date("2026-06-05T10:10:00.000Z"),
      cooldownMs: 60_000,
    });

    const first = await service.runOnce({
      spaceId: "space-main",
      requestingAgentId: "concierge-agent",
      principalId: "principal-1",
    });
    const second = await service.runOnce({
      spaceId: "space-main",
      requestingAgentId: "concierge-agent",
      principalId: "principal-1",
    });

    expect(first.map((signal) => signal.kind)).toEqual(["run_awaiting_review"]);
    expect(second).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      question: "Open Workbench run run-review for review",
      reason: "Review evidence for spaces/T-0001",
      allowedResponses: ["approve", "reject", "open_app", "defer"],
      urgency: "important",
      context: {
        source: "workbench",
        signalKind: "run_awaiting_review",
        action: "open_workbench_run",
        requestedMutation: "workbench.approve_stage",
        rejectMutation: "workbench.reject_stage",
        runId: "run-review",
        queueItemId: "spaces/T-0001",
        stage: "review_gate",
      },
    });
  });

  test("uses persisted active Workbench prompts to avoid duplicates after monitor restart", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const contextMatches = (left: unknown, right: unknown): boolean => (
      JSON.stringify(left) === JSON.stringify(right)
    );
    const escalationService = {
      requestUserInput: async (input: Record<string, unknown>) => {
        requests.push(input);
        return {
          requestId: `request-review-${requests.length}`,
          status: "notified",
          deliveryChannel: "notification",
        };
      },
      findRecentRequestByContext: async (input: { context: Record<string, unknown> }) => {
        const existing = requests.find((request) => contextMatches(request.context, input.context));
        return existing
          ? {
            requestId: "request-review-1",
            status: "notified",
          }
          : undefined;
      },
    } as any;
    const workbenchService = {
      listQueue: async () => [],
      listRuns: async () => [{
        runId: "run-review",
        queueItemId: "spaces/T-0001",
        status: "awaiting_review",
        currentStage: "review_gate",
        updatedAt: "2026-06-05T10:00:00.000Z",
      }],
      getPolicy: async () => ({
        runnerAvailable: true,
        autonomousEnabled: true,
      }),
    };

    const firstService = new ConciergeWorkbenchMonitorService({
      workbenchService,
      escalationService,
      now: () => new Date("2026-06-05T10:10:00.000Z"),
      cooldownMs: 6 * 60 * 60 * 1000,
    });
    const secondService = new ConciergeWorkbenchMonitorService({
      workbenchService,
      escalationService,
      now: () => new Date("2026-06-05T10:11:00.000Z"),
      cooldownMs: 6 * 60 * 60 * 1000,
    });

    const first = await firstService.runOnce({
      spaceId: "space-main",
      requestingAgentId: "concierge-agent",
      principalId: "principal-1",
    });
    const second = await secondService.runOnce({
      spaceId: "space-main",
      requestingAgentId: "concierge-agent",
      principalId: "principal-1",
    });

    expect(first.map((signal) => signal.kind)).toEqual(["run_awaiting_review"]);
    expect(second).toEqual([]);
    expect(requests).toHaveLength(1);
  });

  test("reissues expired review prompts with a timeout covering the dedupe cooldown", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const service = new ConciergeWorkbenchMonitorService({
      workbenchService: {
        listQueue: async () => [],
        listRuns: async () => [{
          runId: "run-review",
          queueItemId: "spaces/T-0001",
          status: "awaiting_review",
          currentStage: "review_gate",
          updatedAt: "2026-06-05T10:00:00.000Z",
        }],
        getPolicy: async () => ({
          runnerAvailable: true,
          autonomousEnabled: true,
        }),
      },
      escalationService: {
        requestUserInput: async (input: Record<string, unknown>) => {
          requests.push(input);
          return {
            requestId: "request-review-fresh",
            status: "notified",
            deliveryChannel: "notification",
          };
        },
        findRecentRequestByContext: async () => ({
          requestId: "request-review-expired",
          status: "expired",
        }),
      },
      now: () => new Date("2026-06-05T10:10:00.000Z"),
      cooldownMs: 6 * 60 * 60 * 1000,
    });

    const signals = await service.runOnce({
      spaceId: "space-main",
      requestingAgentId: "concierge-agent",
      principalId: "principal-1",
    });

    expect(signals.map((signal) => signal.kind)).toEqual(["run_awaiting_review"]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      timeoutSeconds: 21_600,
      context: {
        source: "workbench",
        signalKind: "run_awaiting_review",
        runId: "run-review",
        requestedMutation: "workbench.approve_stage",
        rejectMutation: "workbench.reject_stage",
      },
    });
  });

  test("dispatches approve or reject for an awaiting-review run only from an actioned review prompt", async () => {
    const requests: unknown[] = [];
    const approvedStages: unknown[] = [];
    const rejectedStages: unknown[] = [];
    const service = new ConciergeWorkbenchMonitorService({
      workbenchService: {
        listQueue: async () => [],
        listRuns: async () => [{
          runId: "run-review",
          queueItemId: "spaces/T-0001",
          status: "awaiting_review",
          currentStage: "review_gate",
          updatedAt: "2026-06-05T10:00:00.000Z",
        }],
        getPolicy: async () => ({
          runnerAvailable: true,
          autonomousEnabled: true,
        }),
        approveStage: async (input) => {
          approvedStages.push(input);
          return {
            runId: "run-review",
            queueItemId: "spaces/T-0001",
            status: "running",
            currentStage: "execution",
          };
        },
        rejectStage: async (input) => {
          rejectedStages.push(input);
          return {
            runId: "run-review",
            queueItemId: "spaces/T-0001",
            status: "failed",
            currentStage: "review_gate",
          };
        },
      },
      escalationService: {
        requestUserInput: async (input) => {
          requests.push(input);
          return {
            requestId: "request-review",
            status: "notified",
            deliveryChannel: "notification",
          };
        },
      },
      now: () => new Date("2026-06-05T10:10:00.000Z"),
    });

    const signals = await service.runOnce({
      spaceId: "space-main",
      requestingAgentId: "concierge-agent",
      principalId: "principal-1",
    });

    expect(signals.map((signal) => signal.kind)).toEqual(["run_awaiting_review"]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      allowedResponses: ["approve", "reject", "open_app", "defer"],
      context: {
        source: "workbench",
        signalKind: "run_awaiting_review",
        action: "open_workbench_run",
        requestedMutation: "workbench.approve_stage",
        rejectMutation: "workbench.reject_stage",
        runId: "run-review",
        queueItemId: "spaces/T-0001",
        stage: "review_gate",
      },
    });

    const approved = await service.handleResolvedRequest({
      requestId: "request-review",
      status: "actioned",
      principalId: "principal-1",
      response: {
        action: "approve",
      },
      context: {
        source: "workbench",
        signalKind: "run_awaiting_review",
        requestedMutation: "workbench.approve_stage",
        rejectMutation: "workbench.reject_stage",
        runId: "run-review",
        queueItemId: "spaces/T-0001",
        stage: "review_gate",
      },
    });

    expect(approved).toMatchObject({
      runId: "run-review",
      queueItemId: "spaces/T-0001",
      status: "running",
      currentStage: "execution",
    });
    expect(approvedStages).toEqual([{
      principalId: "principal-1",
      runId: "run-review",
      stage: "review_gate",
      confirmationRequestId: "request-review",
      idempotencyKey: "concierge-workbench:request-review",
    }]);

    const duplicate = await service.handleResolvedRequest({
      requestId: "request-review",
      status: "actioned",
      principalId: "principal-1",
      response: {
        action: "approve",
      },
      context: {
        source: "workbench",
        signalKind: "run_awaiting_review",
        requestedMutation: "workbench.approve_stage",
        rejectMutation: "workbench.reject_stage",
        runId: "run-review",
        queueItemId: "spaces/T-0001",
        stage: "review_gate",
      },
    });

    expect(duplicate).toBeNull();
    expect(approvedStages).toHaveLength(1);

    const rejected = await service.handleResolvedRequest({
      requestId: "request-reject",
      status: "actioned",
      principalId: "principal-1",
      response: {
        action: "reject",
        comment: "Needs a narrower plan.",
      },
      context: {
        source: "workbench",
        signalKind: "run_awaiting_review",
        requestedMutation: "workbench.approve_stage",
        rejectMutation: "workbench.reject_stage",
        runId: "run-review",
        queueItemId: "spaces/T-0001",
        stage: "review_gate",
      },
    });

    expect(rejected).toMatchObject({
      runId: "run-review",
      queueItemId: "spaces/T-0001",
      status: "failed",
      currentStage: "review_gate",
    });
    expect(rejectedStages).toEqual([{
      principalId: "principal-1",
      runId: "run-review",
      stage: "review_gate",
      reason: "Needs a narrower plan.",
      confirmationRequestId: "request-reject",
      idempotencyKey: "concierge-workbench:request-reject",
    }]);
  });

  test("prompts for the top safe next queue item when no run needs attention", async () => {
    const requests: unknown[] = [];
    const service = new ConciergeWorkbenchMonitorService({
      workbenchService: {
        listQueue: async () => [{
          queueItemId: "spaces/T-0002",
          title: "Small safe task",
          status: "ready",
          nextAction: "Run it",
          executionModeEligibility: {
            supervised: true,
            autonomous: true,
          },
          executionModeBlockers: [],
        }],
        listRuns: async () => [],
        getPolicy: async () => ({
          runnerAvailable: true,
          autonomousEnabled: true,
        }),
      },
      escalationService: {
        requestUserInput: async (input) => {
          requests.push(input);
          return {
            requestId: "request-next",
            status: "notified",
            deliveryChannel: "notification",
          };
        },
      },
      now: () => new Date("2026-06-05T10:10:00.000Z"),
    });

    const signals = await service.runOnce({
      spaceId: "space-main",
      requestingAgentId: "concierge-agent",
      principalId: "principal-1",
    });

    expect(signals.map((signal) => signal.kind)).toEqual(["safe_next_task"]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      question: "Start the next safe Workbench task: Small safe task",
      reason: "Confirm before starting spaces/T-0002",
      allowedResponses: ["approve", "open_app", "defer"],
      urgency: "passive",
      context: {
        source: "workbench",
        signalKind: "safe_next_task",
        action: "open_workbench_queue_item",
        requestedMutation: "workbench.start_run",
        executionMode: "supervised",
        queueItemId: "spaces/T-0002",
      },
    });
  });

  test("scans past blocked leading rows for a supervised-ready next task", async () => {
    const requests: unknown[] = [];
    const listQueueInputs: unknown[] = [];
    const blockedItems = Array.from({ length: 12 }, (_, index) => ({
      queueItemId: `spaces/T-${String(index + 1).padStart(4, "0")}`,
      title: `Blocked task ${index + 1}`,
      status: index === 0 ? "done" : "in-progress",
      executionModeEligibility: {
        supervised: false,
        autonomous: false,
      },
      executionModeBlockers: [
        index === 0 ? "Task status is done, not ready." : "Task status is in-progress, not ready.",
        "autonomous is not true.",
      ],
    }));
    const service = new ConciergeWorkbenchMonitorService({
      workbenchService: {
        listQueue: async (input) => {
          listQueueInputs.push(input);
          return [
            ...blockedItems,
            {
              queueItemId: "spaces/T-0031",
              title: "App session resume UI",
              status: "ready",
              executionModeEligibility: {
                supervised: true,
                autonomous: false,
              },
              executionModeBlockers: ["autonomous is not true."],
            },
          ];
        },
        listRuns: async () => [],
        getPolicy: async () => ({
          runnerAvailable: true,
          autonomousEnabled: true,
        }),
      },
      escalationService: {
        requestUserInput: async (input) => {
          requests.push(input);
          return {
            requestId: "request-ready",
            status: "notified",
            deliveryChannel: "notification",
          };
        },
      },
      now: () => new Date("2026-06-05T10:10:00.000Z"),
    });

    const signals = await service.runOnce({
      spaceId: "space-main",
      requestingAgentId: "concierge-agent",
      principalId: "principal-1",
    });

    expect(listQueueInputs).toEqual([{ limit: 100 }]);
    expect(signals.map((signal) => signal.kind)).toEqual(["safe_next_task"]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      question: "Start the next safe Workbench task: App session resume UI",
      reason: "Confirm before starting spaces/T-0031",
      context: {
        source: "workbench",
        signalKind: "safe_next_task",
        requestedMutation: "workbench.start_run",
        executionMode: "supervised",
        queueItemId: "spaces/T-0031",
      },
    });
  });

  test("prompts for a completed run that still needs manual acceptance", async () => {
    const requests: unknown[] = [];
    const service = new ConciergeWorkbenchMonitorService({
      workbenchService: {
        listQueue: async () => [{
          queueItemId: "spaces/T-0003",
          title: "Completed task awaiting acceptance",
          status: "review",
          nextAction: "Accept it",
          executionModeEligibility: {
            supervised: true,
            autonomous: true,
          },
          executionModeBlockers: [],
        }],
        listRuns: async () => [{
          runId: "run-complete",
          queueItemId: "spaces/T-0003",
          status: "completed",
          currentStage: "report",
          updatedAt: "2026-06-05T10:00:00.000Z",
          executionContext: {
            spaceId: "execution-space",
            spaceUid: "execution-space-uid",
            spaceName: "Execution Space",
            stage: "completed",
          },
          verificationResult: {
            status: "passed",
            summary: "All verification commands passed.",
          },
        }],
        getPolicy: async () => ({
          runnerAvailable: true,
          autonomousEnabled: true,
        }),
      },
      escalationService: {
        requestUserInput: async (input) => {
          requests.push(input);
          return {
            requestId: "request-complete",
            status: "notified",
            deliveryChannel: "notification",
          };
        },
      },
      now: () => new Date("2026-06-05T10:10:00.000Z"),
    });

    const signals = await service.runOnce({
      spaceId: "space-main",
      requestingAgentId: "concierge-agent",
      principalId: "principal-1",
    });

    expect(signals.map((signal) => signal.kind)).toEqual(["run_completed"]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      question: "Review completed Workbench run run-complete for acceptance",
      reason: "Open the execution Space to review spaces/T-0003 before marking it accepted",
      allowedResponses: ["open_app", "defer"],
      urgency: "important",
      context: {
        source: "workbench",
        signalKind: "run_completed",
        action: "open_execution_space",
        runId: "run-complete",
        queueItemId: "spaces/T-0003",
        spaceId: "execution-space",
        spaceUid: "execution-space-uid",
        spaceName: "Execution Space",
        verificationStatus: "passed",
      },
    });
  });

  test("starts a supervised run when a safe-next prompt is approved", async () => {
    const startedRuns: unknown[] = [];
    const service = new ConciergeWorkbenchMonitorService({
      workbenchService: {
        listQueue: async () => [],
        listRuns: async () => [],
        getPolicy: async () => ({
          runnerAvailable: true,
          autonomousEnabled: true,
        }),
        startRun: async (input) => {
          startedRuns.push(input);
          return {
            runId: "run-started",
            queueItemId: "spaces/T-0002",
            status: "queued",
          };
        },
      },
      escalationService: {
        requestUserInput: async () => ({
          requestId: "request-next",
          status: "notified",
          deliveryChannel: "notification",
        }),
      },
      now: () => new Date("2026-06-05T10:10:00.000Z"),
    });

    const run = await service.handleResolvedRequest({
      requestId: "request-next",
      status: "actioned",
      principalId: "principal-1",
      response: {
        action: "approve",
      },
      context: {
        source: "workbench",
        signalKind: "safe_next_task",
        requestedMutation: "workbench.start_run",
        queueItemId: "spaces/T-0002",
        executionMode: "supervised",
      },
    });

    expect(run).toMatchObject({
      runId: "run-started",
      queueItemId: "spaces/T-0002",
      status: "queued",
    });
    expect(startedRuns).toEqual([{
      principalId: "principal-1",
      queueItemId: "spaces/T-0002",
      executionMode: "supervised",
      confirmationRequestId: "request-next",
      idempotencyKey: "concierge-workbench:request-next",
    }]);

    const duplicate = await service.handleResolvedRequest({
      requestId: "request-next",
      status: "actioned",
      principalId: "principal-1",
      response: {
        action: "approve",
      },
      context: {
        source: "workbench",
        signalKind: "safe_next_task",
        requestedMutation: "workbench.start_run",
        queueItemId: "spaces/T-0002",
        executionMode: "supervised",
      },
    });

    expect(duplicate).toBeNull();
    expect(startedRuns).toHaveLength(1);
  });

  test("dispatches approved direct Workbench mutation requests created by a concierge ping", async () => {
    const cancelledRuns: unknown[] = [];
    const startedRuns: unknown[] = [];
    const service = new ConciergeWorkbenchMonitorService({
      workbenchService: {
        listQueue: async () => [],
        listRuns: async () => [],
        getPolicy: async () => ({
          runnerAvailable: true,
          autonomousEnabled: true,
        }),
        startRun: async (input: unknown) => {
          startedRuns.push(input);
          return {
            runId: "run-direct-start",
            queueItemId: "spaces/T-0006",
            status: "queued",
            executionMode: "autonomous",
          };
        },
        cancelRun: async (input: unknown) => {
          cancelledRuns.push(input);
          return {
            runId: "run-direct-cancel",
            queueItemId: "spaces/T-0005",
            status: "cancelled",
          };
        },
      } as any,
      escalationService: {
        requestUserInput: async () => ({
          requestId: "request-direct-cancel",
          status: "notified",
          deliveryChannel: "notification",
        }),
      },
      now: () => new Date("2026-06-05T10:10:00.000Z"),
    });

    const cancelled = await service.handleResolvedRequest({
      requestId: "request-direct-cancel",
      status: "actioned",
      principalId: "principal-1",
      response: {
        action: "approve",
      },
      context: {
        source: "workbench",
        requestedMutation: "workbench.cancel_run",
        runId: "run-direct-cancel",
      },
    });

    expect(cancelled).toMatchObject({
      runId: "run-direct-cancel",
      queueItemId: "spaces/T-0005",
      status: "cancelled",
    });
    expect(cancelledRuns).toEqual([{
      principalId: "principal-1",
      runId: "run-direct-cancel",
      confirmationRequestId: "request-direct-cancel",
      idempotencyKey: "concierge-workbench:request-direct-cancel",
    }]);

    const started = await service.handleResolvedRequest({
      requestId: "request-direct-start",
      status: "actioned",
      principalId: "principal-1",
      response: {
        action: "approve",
      },
      context: {
        source: "workbench",
        requestedMutation: "workbench.start_run",
        queueItemId: "spaces/T-0006",
        executionMode: "autonomous",
      },
    });

    expect(started).toMatchObject({
      runId: "run-direct-start",
      queueItemId: "spaces/T-0006",
      status: "queued",
      executionMode: "autonomous",
    });
    expect(startedRuns).toEqual([{
      principalId: "principal-1",
      queueItemId: "spaces/T-0006",
      executionMode: "autonomous",
      confirmationRequestId: "request-direct-start",
      idempotencyKey: "concierge-workbench:request-direct-start",
    }]);
  });
});
