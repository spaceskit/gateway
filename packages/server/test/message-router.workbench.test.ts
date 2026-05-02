import { describe, expect, test } from "bun:test";
import { MessageRouter } from "../src/message-router.js";
import { MessageTypes, type GatewayMessage } from "../src/protocol.js";

function makeClient(overrides: Record<string, unknown> = {}): any {
  return {
    id: "client-workbench-test",
    authenticated: true,
    clientType: "sdk",
    publicKey: "principal-owner",
    subscribedSpaces: new Set<string>(),
    connectedAt: new Date(),
    ...overrides,
  };
}

function makeMessage<T>(type: string, payload: T): GatewayMessage<T> {
  return {
    type,
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    payload,
  };
}

function makeWorkbenchQueueItem(overrides: Record<string, unknown> = {}): any {
  return {
    queueItemId: "spaces/T-0001",
    queueIndex: 1,
    title: "spaces/T-0001",
    type: "TD",
    status: "Planned",
    nextAction: "Land the first slice.",
    taskFilePath: "/Users/caruso/Documents/work/projects/spaces/tasks/T-0001.md",
    delegation: "autonomous",
    parallelKeys: ["gateway"],
    aiShippable: true,
    executionModeEligibility: {
      supervised: true,
      autonomous: true,
    },
    verificationMode: "machine_readable",
    executionModeBlockers: [],
    products: ["gateway"],
    verificationCommands: ["cd gateway && bun test"],
    createdAt: undefined,
    updatedAt: undefined,
    ...overrides,
  };
}

function makeWorkbenchBatch(overrides: Record<string, unknown> = {}): any {
  const now = new Date().toISOString();
  return {
    batchId: "batch-1",
    name: "Gateway batch",
    status: "draft",
    executionMode: "supervised",
    queueItemIds: ["spaces/T-0001"],
    createdByPrincipalId: "principal-owner",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeWorkbenchRun(overrides: Record<string, unknown> = {}): any {
  const now = new Date().toISOString();
  return {
    runId: "run-1",
    batchId: "batch-1",
    queueItemId: "spaces/T-0001",
    queueItemPath: "/Users/caruso/Documents/work/projects/spaces/tasks/T-0001.md",
    status: "awaiting_review",
    currentStage: "review_gate",
    executionMode: "supervised",
    approvalState: "pending",
    worktree: {
      path: "/tmp/workbench/run-1",
      branchName: "workbench/spaces-t-0001-run-1",
      baseBranchName: "main",
      createdAt: now,
    },
    touchedRepos: [],
    verificationMode: "machine_readable",
    executionModeBlockers: [],
    verificationSuites: [],
    verificationResult: undefined,
    landingResult: undefined,
    createdByPrincipalId: "principal-owner",
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: undefined,
    lastErrorCode: undefined,
    lastErrorMessage: undefined,
    ...overrides,
  };
}

function makeWorkbenchArtifact(overrides: Record<string, unknown> = {}): any {
  const now = new Date().toISOString();
  return {
    artifactId: "artifact-1",
    runId: "run-1",
    kind: "plan",
    title: "Execution Plan",
    contentType: "text/markdown",
    contentText: "# Plan",
    createdAt: now,
    ...overrides,
  };
}

function makeWorkbenchPolicy(overrides: Record<string, unknown> = {}): any {
  const now = new Date().toISOString();
  return {
    defaultExecutionMode: "supervised",
    autonomousEnabled: true,
    maxParallelRuns: 2,
    requireExplicitAutonomousOptIn: true,
    requireAiShippableForAutonomous: true,
    updatedAt: now,
    ...overrides,
  };
}

function makeRouter(options: {
  workbenchService?: Record<string, unknown>;
} = {}): MessageRouter {
  const logger: any = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };

  return new MessageRouter({
    spaceManager: {
      executeTurn: async () => ({ turnId: "turn-1" }),
      resumeFeedback: async () => {},
    } as any,
    capabilities: {
      invoke: async () => ({ ok: true }),
      register: () => {},
      deregister: () => {},
    } as any,
    logger,
    workbenchService: options.workbenchService as any,
  });
}

describe("MessageRouter workbench handlers", () => {
  test("routes workbench.* operations and forwards principal identity", async () => {
    const calls: Record<string, any[]> = {
      listQueue: [],
      getQueueItem: [],
      createBatch: [],
      listBatches: [],
      updateBatch: [],
      startRun: [],
      retryRun: [],
      cancelRun: [],
      listRuns: [],
      getRun: [],
      approveStage: [],
      rejectStage: [],
      setMode: [],
      listArtifacts: [],
      getPolicy: [],
      updatePolicy: [],
    };

    const router = makeRouter({
      workbenchService: {
        listQueue: async (input: any) => {
          calls.listQueue.push(input);
          return [makeWorkbenchQueueItem()];
        },
        getQueueItem: async (input: any) => {
          calls.getQueueItem.push(input);
          return makeWorkbenchQueueItem({ queueItemId: input.queueItemId });
        },
        createBatch: async (input: any) => {
          calls.createBatch.push(input);
          return makeWorkbenchBatch({ batchId: "batch-created", queueItemIds: input.queueItemIds });
        },
        listBatches: async (input: any) => {
          calls.listBatches.push(input);
          return [makeWorkbenchBatch()];
        },
        updateBatch: async (input: any) => {
          calls.updateBatch.push(input);
          return makeWorkbenchBatch({ batchId: input.batchId, executionMode: input.executionMode ?? "supervised" });
        },
        startRun: async (input: any) => {
          calls.startRun.push(input);
          return makeWorkbenchRun({ runId: "run-started", queueItemId: input.queueItemId });
        },
        retryRun: async (input: any) => {
          calls.retryRun.push(input);
          return makeWorkbenchRun({ runId: "run-retry", queueItemId: "spaces/T-0001" });
        },
        cancelRun: async (input: any) => {
          calls.cancelRun.push(input);
          return makeWorkbenchRun({ runId: input.runId, status: "cancelled", approvalState: "rejected" });
        },
        listRuns: async (input: any) => {
          calls.listRuns.push(input);
          return [makeWorkbenchRun()];
        },
        getRun: async (input: any) => {
          calls.getRun.push(input);
          return makeWorkbenchRun({ runId: input.runId });
        },
        approveStage: async (input: any) => {
          calls.approveStage.push(input);
          return makeWorkbenchRun({ runId: input.runId, approvalState: "approved", status: "queued", currentStage: "execute" });
        },
        rejectStage: async (input: any) => {
          calls.rejectStage.push(input);
          return makeWorkbenchRun({ runId: input.runId, approvalState: "rejected", status: "cancelled" });
        },
        setMode: async (input: any) => {
          calls.setMode.push(input);
          return { run: makeWorkbenchRun({ runId: input.runId ?? "run-1", executionMode: input.executionMode }), batch: undefined };
        },
        listArtifacts: async (input: any) => {
          calls.listArtifacts.push(input);
          return [makeWorkbenchArtifact({ runId: input.runId })];
        },
        getPolicy: async (input: any) => {
          calls.getPolicy.push(input);
          return makeWorkbenchPolicy();
        },
        updatePolicy: async (input: any) => {
          calls.updatePolicy.push(input);
          return makeWorkbenchPolicy({ autonomousEnabled: input.autonomousEnabled ?? true });
        },
      },
    });

    const client = makeClient({ publicKey: "principal-owner" });

    const listQueueResponse = await router.handle(
      client,
      makeMessage(MessageTypes.WORKBENCH_LIST_QUEUE, { limit: 50 }),
    );
    expect(listQueueResponse?.type).toBe(MessageTypes.WORKBENCH_LIST_QUEUE);
    expect((listQueueResponse?.payload as any)?.items?.[0]).toMatchObject({
      verificationMode: "machine_readable",
      executionModeBlockers: [],
    });

    expect((await router.handle(
      client,
      makeMessage(MessageTypes.WORKBENCH_GET_QUEUE_ITEM, { queueItemId: "spaces/T-0001" }),
    ))?.type).toBe(MessageTypes.WORKBENCH_GET_QUEUE_ITEM);

    expect((await router.handle(
      client,
      makeMessage(MessageTypes.WORKBENCH_CREATE_BATCH, {
        name: "Gateway batch",
        queueItemIds: ["spaces/T-0001"],
        executionMode: "supervised",
      }),
    ))?.type).toBe(MessageTypes.WORKBENCH_CREATE_BATCH);

    expect((await router.handle(
      client,
      makeMessage(MessageTypes.WORKBENCH_LIST_BATCHES, { limit: 10 }),
    ))?.type).toBe(MessageTypes.WORKBENCH_LIST_BATCHES);

    expect((await router.handle(
      client,
      makeMessage(MessageTypes.WORKBENCH_UPDATE_BATCH, { batchId: "batch-created", executionMode: "autonomous" }),
    ))?.type).toBe(MessageTypes.WORKBENCH_UPDATE_BATCH);

    const startRunResponse = await router.handle(
      client,
      makeMessage(MessageTypes.WORKBENCH_START_RUN, { queueItemId: "spaces/T-0001" }),
    );
    expect(startRunResponse?.type).toBe(MessageTypes.WORKBENCH_START_RUN);
    expect((startRunResponse?.payload as any)?.run).toMatchObject({
      verificationMode: "machine_readable",
      executionModeBlockers: [],
    });

    expect((await router.handle(
      client,
      makeMessage(MessageTypes.WORKBENCH_RETRY_RUN, { runId: "run-started" }),
    ))?.type).toBe(MessageTypes.WORKBENCH_RETRY_RUN);

    expect((await router.handle(
      client,
      makeMessage(MessageTypes.WORKBENCH_CANCEL_RUN, { runId: "run-started" }),
    ))?.type).toBe(MessageTypes.WORKBENCH_CANCEL_RUN);

    expect((await router.handle(
      client,
      makeMessage(MessageTypes.WORKBENCH_LIST_RUNS, { limit: 10 }),
    ))?.type).toBe(MessageTypes.WORKBENCH_LIST_RUNS);

    expect((await router.handle(
      client,
      makeMessage(MessageTypes.WORKBENCH_GET_RUN, { runId: "run-1" }),
    ))?.type).toBe(MessageTypes.WORKBENCH_GET_RUN);

    expect((await router.handle(
      client,
      makeMessage(MessageTypes.WORKBENCH_APPROVE_STAGE, { runId: "run-1", stage: "review_gate" }),
    ))?.type).toBe(MessageTypes.WORKBENCH_APPROVE_STAGE);

    expect((await router.handle(
      client,
      makeMessage(MessageTypes.WORKBENCH_REJECT_STAGE, { runId: "run-1", stage: "review_gate" }),
    ))?.type).toBe(MessageTypes.WORKBENCH_REJECT_STAGE);

    expect((await router.handle(
      client,
      makeMessage(MessageTypes.WORKBENCH_SET_MODE, { runId: "run-1", executionMode: "autonomous" }),
    ))?.type).toBe(MessageTypes.WORKBENCH_SET_MODE);

    expect((await router.handle(
      client,
      makeMessage(MessageTypes.WORKBENCH_LIST_ARTIFACTS, { runId: "run-1" }),
    ))?.type).toBe(MessageTypes.WORKBENCH_LIST_ARTIFACTS);

    expect((await router.handle(
      client,
      makeMessage(MessageTypes.WORKBENCH_GET_POLICY, {}),
    ))?.type).toBe(MessageTypes.WORKBENCH_GET_POLICY);

    expect((await router.handle(
      client,
      makeMessage(MessageTypes.WORKBENCH_UPDATE_POLICY, { maxParallelRuns: 4 }),
    ))?.type).toBe(MessageTypes.WORKBENCH_UPDATE_POLICY);

    expect(calls.createBatch[0]?.principalId).toBe("principal-owner");
    expect(calls.updateBatch[0]?.principalId).toBe("principal-owner");
    expect(calls.startRun[0]?.principalId).toBe("principal-owner");
    expect(calls.retryRun[0]?.principalId).toBe("principal-owner");
    expect(calls.cancelRun[0]?.principalId).toBe("principal-owner");
    expect(calls.approveStage[0]?.principalId).toBe("principal-owner");
    expect(calls.rejectStage[0]?.principalId).toBe("principal-owner");
    expect(calls.setMode[0]?.principalId).toBe("principal-owner");
    expect(calls.updatePolicy[0]?.principalId).toBe("principal-owner");
  });

  test("returns NOT_AVAILABLE when workbench service is not configured", async () => {
    const router = makeRouter();
    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.WORKBENCH_LIST_QUEUE, {}),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect(response?.payload).toMatchObject({
      code: "FAILED_PRECONDITION",
      message: "Workbench service unavailable",
    });
  });

  test("enforces write access checks for workbench.start_run", async () => {
    const router = makeRouter({
      workbenchService: {
        startRun: async () => makeWorkbenchRun(),
      },
    });

    const response = await router.handle(
      makeClient({ publicKey: undefined }),
      makeMessage(MessageTypes.WORKBENCH_START_RUN, { queueItemId: "spaces/T-0001" }),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect(response?.payload).toMatchObject({
      code: "UNAUTHENTICATED",
      message: "Authenticated principal key is required",
    });
  });
});
