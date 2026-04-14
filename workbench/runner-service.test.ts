import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import type { WorkbenchReport } from "./report.js";
import { WorkbenchRunnerService, type WorkbenchRunExecutor } from "./runner-service.js";

function makeReport(label: string, overall: WorkbenchReport["overall"] = "pass"): WorkbenchReport {
  return {
    timestamp: new Date().toISOString(),
    duration_ms: 1,
    overall,
    runContext: {
      program: label,
      layerNames: ["chat-roundtrip"],
      scenarioCount: 1,
      evalRunCount: 0,
      providerParityCount: 0,
    },
    layers: [{
      name: "chat-roundtrip",
      status: overall === "pass" ? "pass" : "fail",
      duration_ms: 1,
      scenarios: [{
        name: label,
        status: overall === "pass" ? "pass" : "fail",
        duration_ms: 1,
      }],
    }],
  };
}

describe("WorkbenchRunnerService", () => {
  let db: Database;
  let reportsDir: string;
  let service: WorkbenchRunnerService | null;

  beforeEach(async () => {
    db = new Database(":memory:");
    reportsDir = join(tmpdir(), `workbench-runner-test-${crypto.randomUUID()}`);
    service = null;
    await mkdir(reportsDir, { recursive: true });
  });

  afterEach(async () => {
    await service?.shutdown();
    db.close(false);
    await rm(reportsDir, { recursive: true, force: true });
  });

  test("persists presets and supports CRUD updates", async () => {
    service = new WorkbenchRunnerService({
      db,
      reportsDir,
      executor: async ({ config }) => ({ report: makeReport(config.name ?? "preset-crud") }),
    });
    service.initialize();

    const preset = service.createPreset({
      name: "Smoke",
      layers: ["chat-roundtrip", "provider-tool-parity"],
      providers: ["claude", "gemini"],
    });

    expect(service.listPresets()).toEqual([preset]);

    const updated = service.updatePreset(preset.id, {
      name: "Smoke Updated",
      layers: ["orchestration"],
      providers: ["apple"],
    });

    expect(updated.name).toBe("Smoke Updated");
    expect(updated.layers).toEqual(["orchestration"]);
    expect(updated.providers).toEqual(["apple"]);

    service.deletePreset(preset.id);
    expect(service.listPresets()).toEqual([]);
  });

  test("runs one job at a time and inserts run-now jobs at the front of the waiting queue", async () => {
    const started: string[] = [];
    let releaseSlow: (() => void) | null = null;

    const executor: WorkbenchRunExecutor = async ({ config, signal }) => {
      started.push(config.name ?? "unnamed");
      if (config.name === "slow") {
        await new Promise<void>((resolve, reject) => {
          releaseSlow = resolve;
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
      }
      return { report: makeReport(config.name ?? "job") };
    };

    service = new WorkbenchRunnerService({ db, reportsDir, executor });
    service.initialize();

    const slow = service.runNow({ name: "slow", layers: ["chat-roundtrip"] });
    const tail = service.queueRun({ name: "tail", layers: ["chat-roundtrip"] });
    const urgent = service.runNow({ name: "urgent", layers: ["chat-roundtrip"] });

    const snapshotWhileSlowRunning = service.getSnapshot();
    expect(snapshotWhileSlowRunning.activeRun?.name).toBe("slow");
    expect(snapshotWhileSlowRunning.queuedRuns.map((run) => run.name)).toEqual(["urgent", "tail"]);

    releaseSlow?.();

    await Promise.all([
      service.waitForRunCompletion(slow.id),
      service.waitForRunCompletion(urgent.id),
      service.waitForRunCompletion(tail.id),
    ]);

    expect(started).toEqual(["slow", "urgent", "tail"]);
  });

  test("cancels queued and running jobs", async () => {
    const started: string[] = [];

    const executor: WorkbenchRunExecutor = async ({ config, signal }) => {
      started.push(config.name ?? "unnamed");
      await new Promise<void>((_, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
      return { report: makeReport(config.name ?? "cancelled") };
    };

    service = new WorkbenchRunnerService({ db, reportsDir, executor });
    service.initialize();

    const active = service.runNow({ name: "active", layers: ["chat-roundtrip"] });
    const queued = service.queueRun({ name: "queued", layers: ["chat-roundtrip"] });

    const cancelledQueued = await service.cancelRun(queued.id);
    expect(cancelledQueued?.status).toBe("cancelled");
    expect(service.getRunDetail(queued.id)?.status).toBe("cancelled");

    const cancelling = await service.cancelRun(active.id);
    expect(cancelling?.status).toBe("cancelling");

    const cancelledActive = await service.waitForRunCompletion(active.id);
    expect(cancelledActive.status).toBe("cancelled");
    expect(started).toEqual(["active"]);
  });

  test("marks nonterminal runs interrupted on initialize while keeping queued runs queued", async () => {
    service = new WorkbenchRunnerService({
      db,
      reportsDir,
      executor: async ({ config }) => ({ report: makeReport(config.name ?? "restart") }),
    });
    service.initialize();

    db.query(`
      INSERT INTO workbench_job_runs (
        id, name, source, status, queue_rank, config_json, snapshot_json, created_at, updated_at
      ) VALUES
        ('run-running', 'Running Run', 'preset', 'running', NULL, '{"layers":["chat-roundtrip"]}', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
        ('run-queued', 'Queued Run', 'preset', 'queued', 1, '{"layers":["chat-roundtrip"]}', '{}', '2026-01-01T00:00:01.000Z', '2026-01-01T00:00:01.000Z')
    `).run();

    service.initialize();

    expect(service.getRunDetail("run-running")?.status).toBe("interrupted");
    expect(service.getRunDetail("run-queued")?.status).toBe("queued");
    expect(service.getSnapshot().queuedRuns.map((run) => run.id)).toContain("run-queued");
  });

  test("stores completed reports and links them from the run record", async () => {
    service = new WorkbenchRunnerService({
      db,
      reportsDir,
      executor: async ({ config }) => ({ report: makeReport(config.name ?? "completed") }),
    });
    service.initialize();

    const run = service.runNow({ name: "completed-run", layers: ["chat-roundtrip"] });
    const completed = await service.waitForRunCompletion(run.id);

    expect(completed.status).toBe("completed");
    expect(completed.reportPath).toContain(reportsDir);
    expect(completed.reportFilename).toMatch(/\.json$/);

    const savedReport = await Bun.file(completed.reportPath!).json();
    expect(savedReport.runContext?.program).toBe("completed-run");
  });
});
