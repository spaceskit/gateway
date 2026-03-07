import { afterEach, describe, expect, test } from "bun:test";
import {
  initDatabase,
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

function createHarness(nowIso = "2026-01-01T00:30:00.000Z") {
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

  const submittedCommands: Array<Record<string, unknown>> = [];
  const service = new SchedulerService({
    jobs,
    jobSpaces,
    runs,
    spaces,
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
    orchestratorCommandService: {
      submitCommand: async (input: Record<string, unknown>) => {
        submittedCommands.push(input);
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
    submittedCommands,
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
