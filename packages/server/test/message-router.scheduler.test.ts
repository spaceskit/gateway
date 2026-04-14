import { describe, expect, test } from "bun:test";
import { MessageRouter } from "../src/message-router.js";
import { MessageTypes, type GatewayMessage } from "../src/protocol.js";

function makeClient(overrides: Record<string, unknown> = {}): any {
  return {
    id: "client-scheduler-test",
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

function makeSchedulerJob(overrides: Record<string, unknown> = {}): any {
  const now = new Date().toISOString();
  return {
    jobId: "job-1",
    name: "Nightly Summary",
    status: "active",
    enabled: true,
    cronExpression: "0 9 * * *",
    schedulePreset: {
      kind: "daily",
      minute: 0,
      hour: 9,
    },
    timezone: "UTC",
    action: {
      type: "space_prompt",
      promptText: "Summarize updates.",
      targetAgentId: "agent-summary",
    },
    primarySpaceId: "space-main",
    invalidReason: null,
    nextRunAt: now,
    lastRunAt: null,
    lastRunStatus: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdByPrincipalId: "principal-owner",
    createdAt: now,
    updatedAt: now,
    linkedSpaces: [
      {
        spaceId: "space-main",
        spaceUid: "space-main",
        name: "Main Space",
        isPrimary: true,
        linkedAt: now,
      },
    ],
    executionTarget: { mode: "existing_space" },
    evalConfig: {
      evalDefinitionId: "suite:full",
      scenarioIds: ["space-interactions.in-process-combined-smoke"],
      summaryMode: "checkpoints",
      selfImproveEnabled: false,
    },
    evalSelfImproveState: {
      enabled: false,
      appliedRevisionIds: [],
    },
    ...overrides,
  };
}

function makeSchedulerRun(overrides: Record<string, unknown> = {}): any {
  const now = new Date().toISOString();
  return {
    runId: "run-1",
    jobId: "job-1",
    trigger: "manual",
    status: "completed",
    commandId: "cmd-1",
    scheduledFor: now,
    startedAt: now,
    finishedAt: now,
    skipReason: null,
    errorCode: null,
    errorMessage: null,
    result: {},
    evalRun: {
      evalRunId: "run-1",
      evalDefinitionId: "suite:full",
      scenarioIds: ["space-interactions.in-process-combined-smoke"],
      summaryMode: "checkpoints",
      selfImproveEnabled: false,
      artifactRefs: [],
      checkpoints: [],
      scenarioResults: [],
      recommendations: [],
    },
    ...overrides,
  };
}

function makeRouter(options: {
  schedulerService?: Record<string, unknown>;
  spaceSharingService?: Record<string, unknown>;
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
    schedulerService: options.schedulerService as any,
    spaceSharingService: options.spaceSharingService as any,
  });
}

describe("MessageRouter scheduler handlers", () => {
  test("routes all scheduler.* operations and forwards principal identity", async () => {
    const calls: Record<string, any[]> = {
      create: [],
      get: [],
      list: [],
      listEvalDefinitions: [],
      update: [],
      delete: [],
      link: [],
      unlink: [],
      runs: [],
      runNow: [],
    };

    const router = makeRouter({
      schedulerService: {
        createJob: async (input: any) => {
          calls.create.push(input);
          return makeSchedulerJob({ jobId: "job-created" });
        },
        getJob: async (input: any) => {
          calls.get.push(input);
          return makeSchedulerJob({ jobId: input.jobId });
        },
        listJobs: async (input: any) => {
          calls.list.push(input);
          return [makeSchedulerJob({ jobId: "job-listed" })];
        },
        listEvalDefinitions: async (input: any) => {
          calls.listEvalDefinitions.push(input);
          return [{
            evalDefinitionId: "suite:full",
            suiteId: "full",
            description: "Full eval suite",
            domainIds: ["space-interactions"],
            scenarioIds: ["space-interactions.in-process-combined-smoke"],
            domains: [{
              domainId: "space-interactions",
              scenarioIds: ["space-interactions.in-process-combined-smoke"],
            }],
          }];
        },
        updateJob: async (input: any) => {
          calls.update.push(input);
          return makeSchedulerJob({ jobId: input.jobId, status: "paused", enabled: false });
        },
        deleteJob: async (input: any) => {
          calls.delete.push(input);
          return { jobId: input.jobId, deleted: true };
        },
        linkSpace: async (input: any) => {
          calls.link.push(input);
          return makeSchedulerJob({
            jobId: input.jobId,
            linkedSpaces: [
              ...makeSchedulerJob().linkedSpaces,
              {
                spaceId: input.spaceId,
                spaceUid: input.spaceId,
                name: "Related Space",
                isPrimary: false,
                linkedAt: new Date().toISOString(),
              },
            ],
          });
        },
        unlinkSpace: async (input: any) => {
          calls.unlink.push(input);
          return makeSchedulerJob({ jobId: input.jobId });
        },
        listRuns: async (input: any) => {
          calls.runs.push(input);
          return { runs: [makeSchedulerRun({ jobId: input.jobId })], total: 1, nextOffset: undefined };
        },
        runNow: async (input: any) => {
          calls.runNow.push(input);
          return {
            run: makeSchedulerRun({ jobId: input.jobId, trigger: "manual" }),
            job: makeSchedulerJob({ jobId: input.jobId }),
          };
        },
      },
    });

    const client = makeClient({ publicKey: "principal-owner" });

    const createResponse = await router.handle(
      client,
      makeMessage(MessageTypes.SCHEDULER_CREATE_JOB, {
        name: "Nightly Summary",
        timezone: "UTC",
        primarySpaceId: "space-main",
        schedulePreset: { kind: "daily", minute: 0, hour: 9 },
        action: { type: "space_prompt", promptText: "Summarize updates." },
        relatedSpaceIds: ["space-related"],
        executionTarget: { mode: "new_space" },
        evalConfig: {
          evalDefinitionId: "suite:full",
          scenarioIds: ["space-interactions.in-process-combined-smoke"],
          flowVariantId: "research",
          summaryMode: "checkpoints",
          selfImproveEnabled: true,
        },
      }),
    );
    expect(createResponse?.type).toBe(MessageTypes.SCHEDULER_CREATE_JOB);

    const getResponse = await router.handle(
      client,
      makeMessage(MessageTypes.SCHEDULER_GET_JOB, { jobId: "job-created" }),
    );
    expect(getResponse?.type).toBe(MessageTypes.SCHEDULER_GET_JOB);

    const listResponse = await router.handle(
      client,
      makeMessage(MessageTypes.SCHEDULER_LIST_JOBS, { limit: 50 }),
    );
    expect(listResponse?.type).toBe(MessageTypes.SCHEDULER_LIST_JOBS);

    const listEvalDefinitionsResponse = await router.handle(
      client,
      makeMessage(MessageTypes.SCHEDULER_LIST_EVAL_DEFINITIONS, {}),
    );
    expect(listEvalDefinitionsResponse?.type).toBe(MessageTypes.SCHEDULER_LIST_EVAL_DEFINITIONS);

    const updateResponse = await router.handle(
      client,
      makeMessage(MessageTypes.SCHEDULER_UPDATE_JOB, {
        jobId: "job-created",
        status: "paused",
        evalConfig: {
          evalDefinitionId: "suite:full",
          scenarioIds: ["space-interactions.in-process-combined-smoke"],
          promptPackId: "pack-collab",
          summaryMode: "checkpoints",
          selfImproveEnabled: false,
        },
      }),
    );
    expect(updateResponse?.type).toBe(MessageTypes.SCHEDULER_UPDATE_JOB);

    const deleteResponse = await router.handle(
      client,
      makeMessage(MessageTypes.SCHEDULER_DELETE_JOB, { jobId: "job-created" }),
    );
    expect(deleteResponse?.type).toBe(MessageTypes.SCHEDULER_DELETE_JOB);

    const linkResponse = await router.handle(
      client,
      makeMessage(MessageTypes.SCHEDULER_LINK_SPACE, { jobId: "job-created", spaceId: "space-related" }),
    );
    expect(linkResponse?.type).toBe(MessageTypes.SCHEDULER_LINK_SPACE);

    const unlinkResponse = await router.handle(
      client,
      makeMessage(MessageTypes.SCHEDULER_UNLINK_SPACE, { jobId: "job-created", spaceId: "space-related" }),
    );
    expect(unlinkResponse?.type).toBe(MessageTypes.SCHEDULER_UNLINK_SPACE);

    const listRunsResponse = await router.handle(
      client,
      makeMessage(MessageTypes.SCHEDULER_LIST_RUNS, { jobId: "job-created", limit: 25, offset: 0 }),
    );
    expect(listRunsResponse?.type).toBe(MessageTypes.SCHEDULER_LIST_RUNS);

    const runNowResponse = await router.handle(
      client,
      makeMessage(MessageTypes.SCHEDULER_RUN_NOW, { jobId: "job-created" }),
    );
    expect(runNowResponse?.type).toBe(MessageTypes.SCHEDULER_RUN_NOW);

    expect(calls.create[0]?.principalId).toBe("principal-owner");
    expect(calls.create[0]?.executionTarget).toEqual({ mode: "new_space" });
    expect(calls.create[0]?.evalConfig?.evalDefinitionId).toBe("suite:full");
    expect(calls.get[0]?.principalId).toBe("principal-owner");
    expect(calls.list[0]?.principalId).toBe("principal-owner");
    expect(calls.listEvalDefinitions).toHaveLength(1);
    expect(calls.update[0]?.principalId).toBe("principal-owner");
    expect(calls.update[0]?.evalConfig?.promptPackId).toBe("pack-collab");
    expect(calls.delete[0]?.principalId).toBe("principal-owner");
    expect(calls.link[0]?.principalId).toBe("principal-owner");
    expect(calls.unlink[0]?.principalId).toBe("principal-owner");
    expect(calls.runs[0]?.principalId).toBe("principal-owner");
    expect(calls.runNow[0]?.principalId).toBe("principal-owner");
  });

  test("returns NOT_AVAILABLE when scheduler service is not configured", async () => {
    const router = makeRouter();

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SCHEDULER_LIST_JOBS, {}),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("FAILED_PRECONDITION");
  });

  test("enforces write access checks for scheduler.create_job", async () => {
    let createCalled = false;
    const router = makeRouter({
      schedulerService: {
        createJob: async () => {
          createCalled = true;
          return makeSchedulerJob();
        },
      },
      spaceSharingService: {
        evaluateAccess: (input: { action: "read" | "write" }) => {
          if (input.action === "write") {
            return {
              allowed: false,
              enforced: true,
              mode: "read_only",
              reason: "Read-only participant cannot create scheduler jobs",
            };
          }
          return { allowed: true, enforced: true, mode: "read_only" };
        },
      },
    });

    const response = await router.handle(
      makeClient({ publicKey: "principal-read-only" }),
      makeMessage(MessageTypes.SCHEDULER_CREATE_JOB, {
        name: "Blocked Job",
        timezone: "UTC",
        primarySpaceId: "space-main",
        schedulePreset: { kind: "daily", minute: 0, hour: 9 },
        action: { type: "space_prompt", promptText: "No-op" },
      }),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("PERMISSION_DENIED");
    expect((response?.payload as any).message).toContain("Read-only participant");
    expect(createCalled).toBe(false);
  });
});
