import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { WorkbenchFixProposal } from "./runner-protocol.js";
import { WorkbenchAnalystService, type WorkbenchAnalystExecutor } from "./analyst-service.js";
import { WorkbenchExecutionGate } from "./execution-gate.js";
import { WorkbenchRunnerService, type WorkbenchRunExecutor } from "./runner-service.js";

function makeProposal(label: string): WorkbenchFixProposal {
  return {
    summary: `${label} summary`,
    rootCause: `${label} root cause`,
    evidence: [{
      title: `${label} evidence`,
      detail: `Observed ${label}`,
    }],
    reproductionCommands: [`bun test ${label}.test.ts`],
    proposedEdits: [{
      filePath: `/tmp/${label}.ts`,
      summary: `Update ${label}`,
      rationale: `Because ${label}`,
    }],
    verificationCommands: [{
      command: `bun test ${label}.test.ts`,
      status: "failed",
      summary: `${label} still failing`,
      outputPreview: `${label} output`,
    }],
  };
}

describe("WorkbenchAnalystService", () => {
  let db: Database;
  let gate: WorkbenchExecutionGate;
  let service: WorkbenchAnalystService | null;

  beforeEach(() => {
    db = new Database(":memory:");
    gate = new WorkbenchExecutionGate();
    service = null;
  });

  afterEach(async () => {
    await service?.shutdown();
    db.close(false);
  });

  test("creates analyst sessions from runs and stores fix proposals", async () => {
    const executor: WorkbenchAnalystExecutor = async ({ registerAnalysisSpace, registerAnalysisRootTurn, registerTaskId }) => {
      registerAnalysisSpace("analysis-space-1");
      registerAnalysisRootTurn("analysis-root-turn-1");
      registerTaskId("analysis-task-1");
      return {
        proposal: makeProposal("run-analysis"),
        exitSummary: "Analysis completed.",
      };
    };

    service = new WorkbenchAnalystService({
      db,
      executionGate: gate,
      resolveRunSource: async (runId) => ({
        runId,
        runName: "Failing Run",
        sourceSpaceId: "source-space-1",
        sourceRootTurnId: "source-root-turn-1",
      }),
      resolveSpaceSource: async (spaceId, rootTurnId) => ({
        sourceSpaceId: spaceId,
        sourceRootTurnId: rootTurnId,
      }),
      executor,
    });
    service.initialize();

    const session = await service.startFromRun({ runId: "run-1" });
    const completed = await service.waitForSessionCompletion(session.id, 5_000);

    expect(completed.status).toBe("completed");
    expect(completed.sourceRunId).toBe("run-1");
    expect(completed.sourceSpaceId).toBe("source-space-1");
    expect(completed.analysisSpaceId).toBe("analysis-space-1");
    expect(completed.analysisRootTurnId).toBe("analysis-root-turn-1");
    expect(completed.taskId).toBe("analysis-task-1");

    const detail = service.getSessionDetail(session.id);
    expect(detail?.proposal?.summary).toBe("run-analysis summary");
    expect(detail?.proposal?.proposedEdits).toHaveLength(1);
  });

  test("creates analyst sessions from spaces and preserves source root turn ids", async () => {
    const executor: WorkbenchAnalystExecutor = async ({ registerAnalysisSpace }) => {
      registerAnalysisSpace("analysis-space-2");
      return {
        proposal: makeProposal("space-analysis"),
      };
    };

    service = new WorkbenchAnalystService({
      db,
      executionGate: gate,
      resolveRunSource: async () => null,
      resolveSpaceSource: async (spaceId, rootTurnId) => ({
        sourceSpaceId: spaceId,
        sourceRootTurnId: rootTurnId,
      }),
      executor,
    });
    service.initialize();

    const session = await service.startFromSpace({
      spaceId: "source-space-2",
      rootTurnId: "source-root-turn-2",
    });
    const completed = await service.waitForSessionCompletion(session.id, 5_000);

    expect(completed.status).toBe("completed");
    expect(completed.sourceType).toBe("space");
    expect(completed.sourceSpaceId).toBe("source-space-2");
    expect(completed.sourceRootTurnId).toBe("source-root-turn-2");
    expect(completed.analysisSpaceId).toBe("analysis-space-2");
  });

  test("shares one execution slot with workbench jobs", async () => {
    let releaseRun: (() => void) | null = null;

    const runExecutor: WorkbenchRunExecutor = async ({ signal }) => {
      await new Promise<void>((resolve, reject) => {
        releaseRun = resolve;
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
      return {
        report: {
          timestamp: new Date().toISOString(),
          duration_ms: 1,
          overall: "pass",
          runContext: {
            program: "job",
            layerNames: ["chat-roundtrip"],
            scenarioCount: 1,
            evalRunCount: 0,
            providerParityCount: 0,
          },
          layers: [{
            name: "chat-roundtrip",
            status: "pass",
            duration_ms: 1,
            scenarios: [{
              name: "job",
              status: "pass",
              duration_ms: 1,
            }],
          }],
        },
      };
    };

    const runner = new WorkbenchRunnerService({
      db,
      reportsDir: "/tmp",
      executionGate: gate,
      executor: runExecutor,
      layerCatalog: [{ name: "chat-roundtrip", scenarios: ["job"] }],
      defaultLayers: ["chat-roundtrip"],
    });
    runner.initialize();

    const analystExecutor: WorkbenchAnalystExecutor = async () => ({
      proposal: makeProposal("queued-after-run"),
    });

    service = new WorkbenchAnalystService({
      db,
      executionGate: gate,
      resolveRunSource: async (runId) => ({
        runId,
        runName: "Failing Run",
        sourceSpaceId: "source-space-3",
      }),
      resolveSpaceSource: async (spaceId, rootTurnId) => ({
        sourceSpaceId: spaceId,
        sourceRootTurnId: rootTurnId,
      }),
      executor: analystExecutor,
    });
    service.initialize();

    const run = runner.runNow({ name: "active-job", layers: ["chat-roundtrip"] });
    const session = await service.startFromRun({ runId: "run-3" });

    expect(runner.getSnapshot().activeRun?.id).toBe(run.id);
    expect(service.getSnapshot().activeSession).toBeUndefined();
    expect(service.getSnapshot().queuedSessions.map((entry) => entry.id)).toEqual([session.id]);

    releaseRun?.();
    await runner.waitForRunCompletion(run.id, 5_000);
    const completed = await service.waitForSessionCompletion(session.id, 5_000);
    expect(completed.status).toBe("completed");

    await runner.shutdown();
  });

  test("cancels queued and running analyst sessions and supports retry", async () => {
    const executor: WorkbenchAnalystExecutor = async ({ signal }) => {
      await new Promise<void>((_, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
      return {
        proposal: makeProposal("cancelled"),
      };
    };

    service = new WorkbenchAnalystService({
      db,
      executionGate: gate,
      resolveRunSource: async (runId) => ({
        runId,
        runName: "Retry Source",
        sourceSpaceId: "source-space-4",
      }),
      resolveSpaceSource: async (spaceId, rootTurnId) => ({
        sourceSpaceId: spaceId,
        sourceRootTurnId: rootTurnId,
      }),
      executor,
    });
    service.initialize();

    const running = await service.startFromRun({ runId: "run-4" });
    const queued = await service.startFromRun({ runId: "run-5" });

    const cancelledQueued = await service.cancelSession(queued.id);
    expect(cancelledQueued?.status).toBe("cancelled");

    const cancelling = await service.cancelSession(running.id);
    expect(cancelling?.status).toBe("cancelling");
    const cancelledRunning = await service.waitForSessionCompletion(running.id, 5_000);
    expect(cancelledRunning.status).toBe("cancelled");

    const retry = await service.retrySession(cancelledRunning.id);
    expect(retry.sourceRunId).toBe("run-4");
    expect(retry.status).toBe("queued");
  });
});
