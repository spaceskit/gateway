import { afterEach, describe, expect, test } from "bun:test";
import {
  initDatabase,
  WorkbenchScenarioRunRepository,
} from "../src/index.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
});

describe("WorkbenchScenarioRunRepository", () => {
  test("persists scenario runs separately from queue-backed workbench runs", () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `workbench-scenario-runs-${crypto.randomUUID()}`,
    });
    dbManagers.push(db);
    const repo = new WorkbenchScenarioRunRepository(db.db);

    const created = repo.create({
      scenarioRunId: "scenario-run-1",
      status: "running",
      configJson: JSON.stringify({ scenarioIds: ["harness.smoke.noop"] }),
      createdByPrincipalId: "principal-owner",
      startedAt: "2026-05-23T10:00:00.000Z",
    });
    const completed = repo.update(created.scenario_run_id, {
      status: "completed",
      overallStatus: "passed",
      durationMs: 12,
      summary: "1 scenario passed.",
      reportArtifactId: "artifact-1",
      finishedAt: "2026-05-23T10:00:00.012Z",
    });

    expect(completed).toMatchObject({
      scenario_run_id: "scenario-run-1",
      status: "completed",
      overall_status: "passed",
      duration_ms: 12,
      report_artifact_id: "artifact-1",
    });
    expect(repo.list({ limit: 10 }).map((row) => row.scenario_run_id)).toEqual(["scenario-run-1"]);
  });
});
