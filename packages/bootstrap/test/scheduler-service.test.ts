import { afterEach, describe, expect, test } from "bun:test";
import { EventBus } from "@spaceskit/core";
import {
  initDatabase,
  OrchestrationJournalRepository,
  SchedulerJobRepository,
  SchedulerJobRunRepository,
  SchedulerJobSpaceRepository,
  SpaceRepository,
} from "@spaceskit/persistence";
import { SchedulerService } from "../src/services/scheduler-service.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
});

function createHarness(
  nowIso = "2026-01-01T00:30:00.000Z",
  overrides: {
    submitCommand?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  } = {},
) {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-scheduler-service-${crypto.randomUUID()}`,
  });
  dbManagers.push(db);

  const spaces = new SpaceRepository(db.db);
  spaces.create({
    spaceId: "space-main",
    resourceId: "resource:main",
    name: "Main Space",
    spaceType: "space",
    goal: "",
    turnModel: "sequential_all",
  });
  spaces.create({
    spaceId: "space-secondary",
    resourceId: "resource:secondary",
    name: "Secondary Space",
    spaceType: "space",
    goal: "",
    turnModel: "sequential_all",
  });
  spaces.create({
    spaceId: "space-third",
    resourceId: "resource:third",
    name: "Third Space",
    spaceType: "space",
    goal: "",
    turnModel: "sequential_all",
  });

  const jobs = new SchedulerJobRepository(db.db);
  const jobSpaces = new SchedulerJobSpaceRepository(db.db);
  const runs = new SchedulerJobRunRepository(db.db);
  const orchestrationJournal = new OrchestrationJournalRepository(db.db);
  const eventBus = new EventBus();

  const submittedCommands: Array<Record<string, unknown>> = [];
  const templateCreations: Array<Record<string, unknown>> = [];
  const service = new SchedulerService({
    jobs,
    jobSpaces,
    runs,
    spaces,
    eventBus,
    orchestrationJournal,
    spaceAdminService: {
      getSpace: async (spaceId: string) => {
        const row = spaces.getById(spaceId);
        if (!row) return null;
        return {
          spaceId: row.space_id,
          spaceUid: `uid-${row.space_id}`,
          name: row.name,
        } as any;
      },
    } as any,
    spaceTemplateService: {
      createFromTemplate: async (input: Record<string, unknown>, principalId: string) => {
        templateCreations.push({ ...input, principalId });
        const spaceId = String(input.spaceId ?? `space-eval-${templateCreations.length}`);
        if (!spaces.getById(spaceId)) {
          spaces.create({
            spaceId,
            resourceId: String(input.resourceId ?? `resource:${spaceId}`),
            name: String(input.name ?? "Eval Space"),
            spaceType: "space",
            goal: String(input.goal ?? ""),
            turnModel: "primary_only",
          });
        }
        return {
          template: {
            templateId: String(input.templateId ?? "archetype/research"),
          },
          space: {
            id: spaceId,
            spaceUid: `uid-${spaceId}`,
            name: String(input.name ?? "Eval Space"),
          },
        } as any;
      },
    } as any,
    orchestratorCommandService: {
      submitCommand: async (input: Record<string, unknown>) => {
        submittedCommands.push(input);
        if (overrides.submitCommand) {
          return overrides.submitCommand(input);
        }
        return {
          commandId: `cmd-${submittedCommands.length}`,
          status: "completed",
          result: { turnId: `turn-${submittedCommands.length}` },
        } as any;
      },
    } as any,
    now: () => new Date(nowIso),
  });

  return {
    service,
    jobs,
    jobSpaces,
    runs,
    spaces,
    eventBus,
    orchestrationJournal,
    submittedCommands,
    templateCreations,
    nowIso,
  };
}

function createDirectJob(
  jobs: SchedulerJobRepository,
  overrides: Partial<Parameters<SchedulerJobRepository["create"]>[0]> = {},
) {
  return jobs.create({
    jobId: overrides.jobId ?? `job-${crypto.randomUUID()}`,
    name: overrides.name ?? "Scheduler Job",
    status: overrides.status ?? "active",
    enabled: overrides.enabled ?? true,
    cronExpression: overrides.cronExpression ?? "0 1 * * *",
    schedulePresetJson: overrides.schedulePresetJson ?? JSON.stringify({
      kind: "daily",
      minute: 0,
      hour: 1,
    }),
    timezone: overrides.timezone ?? "UTC",
    actionType: overrides.actionType ?? "space_prompt",
    promptText: overrides.promptText ?? "Summarize updates.",
    targetAgentId: overrides.targetAgentId ?? "agent-1",
    executionTargetJson: overrides.executionTargetJson ?? JSON.stringify({ mode: "existing_space" }),
    evalConfigJson: overrides.evalConfigJson ?? null,
    evalSelfImproveStateJson: overrides.evalSelfImproveStateJson ?? null,
    primarySpaceId: overrides.primarySpaceId ?? "space-main",
    invalidReason: overrides.invalidReason ?? "",
    nextRunAt: overrides.nextRunAt ?? "2025-12-31T01:00:00.000Z",
    createdByPrincipalId: overrides.createdByPrincipalId ?? "principal-1",
  });
}

describe("SchedulerService", () => {
  test("compiles preset builder schedules into cron expressions", async () => {
    const { service } = createHarness();

    const hourly = await service.createJob({
      principalId: "principal-1",
      name: "Hourly Digest",
      timezone: "UTC",
      schedulePreset: { kind: "hourly", minute: 15, intervalHours: 2 },
      action: { type: "space_prompt", promptText: "Hourly digest." },
      primarySpaceId: "space-main",
    });
    const daily = await service.createJob({
      principalId: "principal-1",
      name: "Daily Digest",
      timezone: "UTC",
      schedulePreset: { kind: "daily", minute: 5, hour: 7 },
      action: { type: "space_prompt", promptText: "Daily digest." },
      primarySpaceId: "space-main",
    });
    const weekly = await service.createJob({
      principalId: "principal-1",
      name: "Weekly Digest",
      timezone: "UTC",
      schedulePreset: { kind: "weekly", minute: 30, hour: 10, daysOfWeek: [1, 3, 5] },
      action: { type: "space_prompt", promptText: "Weekly digest." },
      primarySpaceId: "space-main",
    });

    expect(hourly.cronExpression).toBe("15 */2 * * *");
    expect(daily.cronExpression).toBe("5 7 * * *");
    expect(weekly.cronExpression).toBe("30 10 * * 1,3,5");
  });

  test("calculates next run using each job timezone", async () => {
    const { service } = createHarness("2026-01-01T00:30:00.000Z");

    const utcJob = await service.createJob({
      principalId: "principal-1",
      name: "UTC Daily",
      timezone: "UTC",
      schedulePreset: { kind: "daily", minute: 0, hour: 8 },
      action: { type: "space_prompt", promptText: "UTC run." },
      primarySpaceId: "space-main",
    });
    const copenhagenJob = await service.createJob({
      principalId: "principal-1",
      name: "Copenhagen Daily",
      timezone: "Europe/Copenhagen",
      schedulePreset: { kind: "daily", minute: 0, hour: 8 },
      action: { type: "space_prompt", promptText: "CPH run." },
      primarySpaceId: "space-main",
    });

    expect(utcJob.nextRunAt).toBe("2026-01-01T08:00:00.000Z");
    expect(copenhagenJob.nextRunAt).toBe("2026-01-01T07:00:00.000Z");
  });

  test("startup reconciliation skips missed windows and rolls next_run_at forward", async () => {
    const { service, jobs, nowIso } = createHarness("2026-01-01T00:30:00.000Z");

    const created = createDirectJob(jobs, {
      jobId: "job-past",
      cronExpression: "0 1 * * *",
      nextRunAt: "2025-12-15T01:00:00.000Z",
    });
    expect(created.next_run_at).toBe("2025-12-15T01:00:00.000Z");

    await service.reconcileSchedulesOnStartup();

    const refreshed = jobs.get("job-past");
    expect(refreshed).toBeDefined();
    expect(refreshed?.next_run_at).toBeDefined();
    expect(new Date(refreshed!.next_run_at!).getTime()).toBeGreaterThan(new Date(nowIso).getTime());
  });

  test("runDueJobsTick records skipped run when overlap is disallowed", async () => {
    const { service, jobs, runs } = createHarness("2026-01-01T00:30:00.000Z");

    createDirectJob(jobs, {
      jobId: "job-overlap",
      cronExpression: "*/5 * * * *",
      schedulePresetJson: JSON.stringify({ kind: "hourly", minute: 0, intervalHours: 1 }),
      nextRunAt: "2026-01-01T00:25:00.000Z",
    });
    runs.create({
      runId: "run-existing-running",
      jobId: "job-overlap",
      trigger: "scheduled",
      status: "running",
      startedAt: "2026-01-01T00:20:00.000Z",
    });

    const executed = await service.runDueJobsTick(10);
    expect(executed).toBe(1);

    const runRows = runs.listByJob("job-overlap", 10, 0);
    const skipped = runRows.find((row) => row.status === "skipped");
    expect(skipped).toBeDefined();
    expect(skipped?.skip_reason).toBe("overlap_disallowed");

    const refreshedJob = jobs.get("job-overlap");
    expect(refreshedJob?.last_run_status).toBe("skipped");
    expect(refreshedJob?.next_run_at).toBeDefined();
    expect(new Date(refreshedJob!.next_run_at!).getTime()).toBeGreaterThan(new Date("2026-01-01T00:25:00.000Z").getTime());
  });

  test("runNow executes orchestrator command and persists run command id", async () => {
    const { service, runs, submittedCommands } = createHarness("2026-01-01T00:30:00.000Z");

    const job = await service.createJob({
      principalId: "principal-1",
      name: "Manual Trigger",
      timezone: "UTC",
      schedulePreset: { kind: "daily", minute: 0, hour: 10 },
      action: { type: "space_prompt", promptText: "Run now prompt.", targetAgentId: "agent-writer" },
      primarySpaceId: "space-main",
      relatedSpaceIds: ["space-secondary"],
    });

    const response = await service.runNow({
      principalId: "principal-1",
      jobId: job.jobId,
    });

    expect(response.run.status).toBe("completed");
    expect(response.run.trigger).toBe("manual");
    expect(response.run.commandId).toBe("cmd-1");
    expect(response.job.lastRunStatus).toBe("completed");
    expect(response.job.lastRunAt).toBeDefined();
    expect(submittedCommands).toHaveLength(1);
    expect(submittedCommands[0]?.commandType).toBe("run_space_prompt");
    expect(submittedCommands[0]?.targetSpaceId).toBe("space-main");

    const runRows = runs.listByJob(job.jobId, 10, 0);
    expect(runRows).toHaveLength(1);
    expect(runRows[0]?.status).toBe("completed");
    expect(runRows[0]?.command_id).toBe("cmd-1");
  });

  test("round-trips executionTarget and eval config on scheduler jobs", async () => {
    const { service } = createHarness("2026-01-01T00:30:00.000Z");

    const created = await service.createJob({
      principalId: "principal-1",
      name: "Nightly Eval",
      timezone: "UTC",
      schedulePreset: { kind: "daily", minute: 0, hour: 2 },
      action: { type: "space_prompt", promptText: "Evaluate the research flow." },
      primarySpaceId: "space-main",
      executionTarget: { mode: "new_space" },
      evalConfig: {
        evalDefinitionId: "suite:full",
        scenarioIds: ["space-interactions.in-process-combined-smoke"],
        flowVariantId: "research",
        promptPackId: "broadcast-team-v1",
        summaryMode: "checkpoints",
        selfImproveEnabled: false,
      },
    });

    expect(created.executionTarget.mode).toBe("new_space");
    expect(created.evalConfig?.evalDefinitionId).toBe("suite:full");
    expect(created.evalConfig?.summaryMode).toBe("checkpoints");
    expect(created.evalSelfImproveState?.enabled).toBe(false);
  });

  test("runNow on eval jobs creates a fresh space and persists canonical eval checkpoints", async () => {
    const { service, runs, submittedCommands, templateCreations, eventBus, orchestrationJournal } = createHarness(
      "2026-01-01T00:30:00.000Z",
      {
        submitCommand: async (input: Record<string, unknown>) => {
          const targetSpaceId = String(input.targetSpaceId);
          orchestrationJournal.create({
            eventId: "journal-planner",
            spaceId: targetSpaceId,
            turnId: "turn-eval-1",
            eventType: "planner.input",
            actorId: "coordinator",
            payloadJson: JSON.stringify({ userInput: "Evaluate the research flow." }),
          });
          orchestrationJournal.create({
            eventId: "journal-guest",
            spaceId: targetSpaceId,
            turnId: "turn-eval-1",
            eventType: "guest.dispatch",
            actorId: "researcher-1",
            payloadJson: JSON.stringify({ iteration: 0 }),
          });
          orchestrationJournal.create({
            eventId: "journal-peer",
            spaceId: targetSpaceId,
            turnId: "turn-eval-1",
            eventType: "peer_review.result",
            actorId: "reviewer-1",
            payloadJson: JSON.stringify({ status: "approved" }),
          });
          orchestrationJournal.create({
            eventId: "journal-synthesis",
            spaceId: targetSpaceId,
            turnId: "turn-eval-1",
            eventType: "synthesis.result",
            actorId: "coordinator",
            payloadJson: JSON.stringify({ output: "Final synthesis." }),
          });

          eventBus.emit({
            type: "context.summarized",
            spaceId: targetSpaceId,
            messagesSummarized: 8,
            droppedRecentMessages: 0,
            summaryTruncated: false,
            newTokenEstimate: 1200,
            maxTokenEstimate: 4000,
            newMessageCount: 6,
            timestamp: new Date("2026-01-01T00:30:01.000Z"),
          });
          eventBus.emit({
            type: "space.orchestrator_event",
            spaceId: targetSpaceId,
            turnId: "turn-eval-1",
            commandId: "summary-turn-eval-1",
            correlationId: "turn-eval-1",
            status: "completed",
            createdAt: "2026-01-01T00:30:02.000Z",
            eventType: "summary.completed",
            event: {
              type: "summary.completed",
              summary: {
                finalSummaryText: "Final synthesis.",
                status: "completed",
              },
            },
            timestamp: new Date("2026-01-01T00:30:02.000Z"),
          });

          return {
            commandId: "cmd-eval-1",
            status: "completed",
            result: { turnId: "turn-eval-1" },
          };
        },
      },
    );

    const job = await service.createJob({
      principalId: "principal-1",
      name: "Nightly Eval",
      timezone: "UTC",
      schedulePreset: { kind: "daily", minute: 0, hour: 2 },
      action: { type: "space_prompt", promptText: "Evaluate the research flow." },
      primarySpaceId: "space-main",
      executionTarget: { mode: "new_space" },
      evalConfig: {
        evalDefinitionId: "suite:full",
        scenarioIds: [
          "space-interactions.in-process-combined-smoke",
          "summarization.gateway-smoke",
        ],
        flowVariantId: "research",
        summaryMode: "checkpoints",
        selfImproveEnabled: true,
      },
    });

    const response = await service.runNow({
      principalId: "principal-1",
      jobId: job.jobId,
    });

    expect(templateCreations).toHaveLength(1);
    expect(templateCreations[0]?.templateId).toBe("archetype/research");
    const createdEvalSpaceId = String(templateCreations[0]?.spaceId ?? "");
    expect(createdEvalSpaceId.startsWith("space-eval-")).toBe(true);
    expect(submittedCommands).toHaveLength(1);
    expect(submittedCommands[0]?.targetSpaceId).toBe(createdEvalSpaceId);
    expect(response.run.evalRun?.spaceId).toBe(createdEvalSpaceId);
    expect(response.run.evalRun?.rootTurnId).toBe("turn-eval-1");
    expect(
      [...(response.run.evalRun?.checkpoints.map((checkpoint) => checkpoint.kind) ?? [])].sort(),
    ).toEqual([
      "context.summarized",
      "guest.dispatch",
      "planner.input",
      "peer_review.result",
      "summary.completed",
      "synthesis.result",
    ].sort());
    expect(response.run.evalRun?.finalSummaryText).toBe("Final synthesis.");
    expect(response.run.evalRun?.scenarioResults).toHaveLength(2);
    expect(response.run.evalRun?.recommendations.length).toBeGreaterThan(0);
    expect(response.job.evalSelfImproveState?.enabled).toBe(true);
    expect(response.job.evalSelfImproveState?.lastAppliedRunId).toBe(response.run.runId);

    const runRows = runs.listByJob(job.jobId, 10, 0);
    expect(runRows[0]?.eval_run_json).toContain("\"rootTurnId\":\"turn-eval-1\"");
    expect(runRows[0]?.eval_run_json).toContain("\"summary.completed\"");
  });

  test("marks job invalid when primary space has been deleted and keeps run history", async () => {
    const { service, runs, spaces } = createHarness("2026-01-01T00:30:00.000Z");

    const created = await service.createJob({
      principalId: "principal-1",
      name: "Needs Primary",
      timezone: "UTC",
      schedulePreset: { kind: "daily", minute: 0, hour: 11 },
      action: { type: "space_prompt", promptText: "Should fail when primary missing." },
      primarySpaceId: "space-main",
      relatedSpaceIds: ["space-secondary"],
    });
    runs.create({
      runId: "run-history",
      jobId: created.jobId,
      trigger: "manual",
      status: "completed",
      commandId: "cmd-history",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:30.000Z",
    });

    expect(spaces.delete("space-main")).toBe(true);
    const refreshed = await service.getJob({
      jobId: created.jobId,
      principalId: "principal-1",
    });

    expect(refreshed).toBeDefined();
    expect(refreshed?.status).toBe("invalid");
    expect(refreshed?.enabled).toBe(false);
    expect(refreshed?.invalidReason).toBe("primary_space_missing");
    expect(refreshed?.lastErrorCode).toBe("PRIMARY_SPACE_MISSING");
    expect(runs.countByJob(created.jobId)).toBe(1);
  });
});
