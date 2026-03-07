import { afterEach, describe, expect, test } from "bun:test";
import { initDatabase } from "../src/database.js";
import { SchedulerJobRunRepository } from "../src/repositories/scheduler-job-runs.js";
import { SchedulerJobSpaceRepository } from "../src/repositories/scheduler-job-spaces.js";
import { SchedulerJobRepository } from "../src/repositories/scheduler-jobs.js";
import { SpaceRepository } from "../src/repositories/spaces.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
});

function createRepos() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-scheduler-repos-${crypto.randomUUID()}`,
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

  return {
    jobs: new SchedulerJobRepository(db.db),
    jobSpaces: new SchedulerJobSpaceRepository(db.db),
    runs: new SchedulerJobRunRepository(db.db),
  };
}

function createJobInput(jobId: string) {
  return {
    jobId,
    name: "Nightly Summary",
    cronExpression: "0 9 * * *",
    schedulePresetJson: JSON.stringify({
      kind: "daily",
      minute: 0,
      hour: 9,
    }),
    timezone: "UTC",
    promptText: "Summarize the latest changes.",
    targetAgentId: "agent-summary",
    primarySpaceId: "space-main",
    nextRunAt: new Date(Date.now() + 3_600_000).toISOString(),
    createdByPrincipalId: "principal-owner",
  } satisfies Parameters<SchedulerJobRepository["create"]>[0];
}

describe("Scheduler repositories", () => {
  test("supports scheduler job create/get/list/update/delete", () => {
    const repos = createRepos();

    const created = repos.jobs.create(createJobInput("job-1"));
    expect(created.job_id).toBe("job-1");
    expect(created.status).toBe("active");
    expect(created.enabled).toBe(1);

    const listedAll = repos.jobs.list();
    expect(listedAll.map((job) => job.job_id)).toContain("job-1");

    const listedActive = repos.jobs.list({ statuses: ["active"] });
    expect(listedActive.map((job) => job.job_id)).toContain("job-1");

    const updated = repos.jobs.update("job-1", {
      name: "Morning Summary",
      status: "paused",
      enabled: false,
      lastRunStatus: "completed",
      lastErrorMessage: "none",
    });
    expect(updated).toBeDefined();
    expect(updated?.name).toBe("Morning Summary");
    expect(updated?.status).toBe("paused");
    expect(updated?.enabled).toBe(0);
    expect(updated?.last_run_status).toBe("completed");

    expect(repos.jobs.delete("job-1")).toBe(true);
    expect(repos.jobs.get("job-1")).toBeUndefined();
  });

  test("supports scheduler related-space link dedupe and replacement", () => {
    const repos = createRepos();
    repos.jobs.create(createJobInput("job-space-links"));

    repos.jobSpaces.upsert("job-space-links", "space-secondary");
    repos.jobSpaces.upsert("job-space-links", "space-secondary");

    const deduped = repos.jobSpaces.listByJob("job-space-links");
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.space_id).toBe("space-secondary");

    const replaced = repos.jobSpaces.replaceForJob(
      "job-space-links",
      ["space-main", "space-secondary", "space-main", " ", "space-secondary"],
    );
    expect(replaced.map((row) => row.space_id).sort()).toEqual(["space-main", "space-secondary"]);

    expect(repos.jobSpaces.delete("job-space-links", "space-main")).toBe(true);
    expect(repos.jobSpaces.listByJob("job-space-links").map((row) => row.space_id)).toEqual(["space-secondary"]);
  });

  test("prunes scheduler run history to latest 200 rows per job", () => {
    const repos = createRepos();
    repos.jobs.create(createJobInput("job-runs"));

    for (let index = 0; index < 205; index += 1) {
      repos.runs.create({
        runId: `run-${index.toString().padStart(3, "0")}`,
        jobId: "job-runs",
        trigger: "scheduled",
        status: "completed",
        commandId: `cmd-${index}`,
      });
    }

    expect(repos.runs.countByJob("job-runs")).toBe(205);
    const deleted = repos.runs.pruneToLatest("job-runs", 200);
    expect(deleted).toBe(5);
    expect(repos.runs.countByJob("job-runs")).toBe(200);
  });
});

