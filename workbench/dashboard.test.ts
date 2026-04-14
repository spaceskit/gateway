import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import type { WorkbenchReport } from "./report.js";
import { WorkbenchAnalystService, type WorkbenchAnalystExecutor } from "./analyst-service.js";
import { startDashboard } from "./dashboard.js";
import { WorkbenchExecutionGate } from "./execution-gate.js";
import { WorkbenchRunnerService, type WorkbenchRunExecutor } from "./runner-service.js";
import { buildWorkbenchLayerCatalog } from "./runtime.js";
import { randomPort } from "../packages/bootstrap/test/e2e/harness.js";

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

async function waitForOpen(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for websocket open.")), 5_000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("WebSocket error before open."));
    }, { once: true });
  });
}

async function waitForMessage(
  ws: WebSocket,
  predicate: (payload: unknown) => boolean,
  timeoutMs = 5_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      reject(new Error("Timed out waiting for websocket message."));
    }, timeoutMs);
    const onMessage = (event: MessageEvent) => {
      const payload = JSON.parse(String(event.data));
      if (!predicate(payload)) {
        return;
      }
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      resolve(payload);
    };
    ws.addEventListener("message", onMessage);
  });
}

describe("workbench dashboard", () => {
  let db: Database;
  let reportsDir: string;
  let planningRepoRoot: string;
  let runner: WorkbenchRunnerService;
  let analyst: WorkbenchAnalystService;
  let dashboard: { port: number; stop: () => void } | null;

  beforeEach(async () => {
    db = new Database(":memory:");
    reportsDir = join(tmpdir(), `workbench-dashboard-test-${crypto.randomUUID()}`);
    planningRepoRoot = join(tmpdir(), `workbench-dashboard-planning-${crypto.randomUUID()}`);
    await mkdir(reportsDir, { recursive: true });
    await mkdir(join(planningRepoRoot, "_planning", "backlog", "tasks"), { recursive: true });
    await writeFile(join(planningRepoRoot, "_planning", "WHAT-TO-DO-NEXT.md"), `<!-- planning_classification: canonical -->
<!-- planning_last_reviewed: 2026-04-12 -->

# What To Do Next

## Active Queue

| # | Item | Type | Status | Next Action |
|---|---|---|---|---|
| 1 | \`td-dashboard-planning.md\` | TD | Planned | Inspect in dashboard |
`);
    await writeFile(join(planningRepoRoot, "_planning", "backlog", "tasks", "td-dashboard-planning.md"), `<!-- planning_classification: canonical -->
<!-- planning_last_reviewed: 2026-04-12 -->

# Task: td-dashboard-planning

## Metadata
- Priority: P1
- Complexity: S(2)
- Status: Planned
- Owner: gateway
- Delegation: autonomous
- Parallel: gateway
- AI-Shippable: yes
- Type: code

\`\`\`yaml goal_contract
schemaVersion: 1
goalId: td-dashboard-planning
contractState: reviewed
owner: gateway
status: Planned
delegation: autonomous
aiShippable: true
products:
  - gateway
outcome: Make planning audit visible.
scope:
  in:
    - Show planning audit.
  out:
    - Native app UI.
successCriteria:
  - Dashboard returns planning audit JSON.
verification:
  commands:
    - cd gateway && bun test workbench/dashboard.test.ts
blockers: []
\`\`\`

## Cross-Product / Cross-Platform
- Products: gateway

## Goal
- Make planning audit visible.

## Verification Commands (Machine-Readable)
1. \`cd gateway && bun test workbench/dashboard.test.ts\`
`);
    const executionGate = new WorkbenchExecutionGate();
    const executor: WorkbenchRunExecutor = async ({ config }) => ({
      report: makeReport(config.name ?? "dashboard-run"),
    });
    runner = new WorkbenchRunnerService({
      db,
      reportsDir,
      executionGate,
      executor,
      layerCatalog: buildWorkbenchLayerCatalog(),
    });
    runner.initialize();
    const analystExecutor: WorkbenchAnalystExecutor = async () => ({
      proposal: {
        summary: "Analyst summary",
        rootCause: "Analyst root cause",
        evidence: [{ title: "Evidence", detail: "Something failed" }],
        reproductionCommands: ["bun test workbench/scenarios/provider-tool-parity.test.ts"],
        proposedEdits: [{ filePath: "/tmp/fix.ts", summary: "Update retry logic" }],
        verificationCommands: [{
          command: "bun test workbench/scenarios/provider-tool-parity.test.ts",
          status: "failed",
          summary: "Provider parity still failing",
        }],
      },
    });
    analyst = new WorkbenchAnalystService({
      db,
      executionGate,
      resolveRunSource: async (runId) => ({
        runId,
        runName: "Dashboard Run",
        sourceSpaceId: "space-dashboard",
      }),
      resolveSpaceSource: async (spaceId, rootTurnId) => ({
        sourceSpaceId: spaceId,
        sourceRootTurnId: rootTurnId,
      }),
      executor: analystExecutor,
    });
    analyst.initialize();
    dashboard = startDashboard({
      reportsDir,
      runner,
      analyst,
      port: randomPort(),
      planningRepoRoot,
    });
  });

  afterEach(async () => {
    dashboard?.stop();
    await analyst.shutdown();
    await runner.shutdown();
    db.close(false);
    await rm(reportsDir, { recursive: true, force: true });
    await rm(planningRepoRoot, { recursive: true, force: true });
  });

  test("serves Jobs/Analyst/Reports UI and exposes snapshots + websocket", async () => {
    const html = await fetch(`http://127.0.0.1:${dashboard!.port}/`).then((response) => response.text());
    expect(html).toContain("Workbench Live Runner");
    expect(html).toContain("Jobs");
    expect(html).toContain("Analyst");
    expect(html).toContain("Reports");
    expect(html).toContain("Planning");

    const snapshot = await fetch(`http://127.0.0.1:${dashboard!.port}/api/jobs/snapshot`).then((response) => response.json());
    expect(snapshot.queuedRuns).toEqual([]);
    expect(snapshot.recentRuns).toEqual([]);

    const analystSnapshot = await fetch(`http://127.0.0.1:${dashboard!.port}/api/analyst/snapshot`).then((response) => response.json());
    expect(analystSnapshot.queuedSessions).toEqual([]);
    expect(analystSnapshot.recentSessions).toEqual([]);

    const planningAudit = await fetch(`http://127.0.0.1:${dashboard!.port}/api/planning/audit`).then((response) => response.json());
    expect(planningAudit.executableQueueItemCount).toBe(1);
    expect(planningAudit.goalContractErrors).toEqual([]);

    const planningTask = await fetch(`http://127.0.0.1:${dashboard!.port}/api/planning/tasks/${encodeURIComponent("td-dashboard-planning.md")}`).then((response) => response.json());
    expect(planningTask.queueItemId).toBe("td-dashboard-planning.md");
    expect(planningTask.markdown).toContain("```yaml goal_contract");

    const ws = new WebSocket(`ws://127.0.0.1:${dashboard!.port}/api/jobs/ws`);
    await waitForOpen(ws);
    const initial = await waitForMessage(ws, (payload) => (payload as { type?: string }).type === "snapshot");
    expect((initial as { snapshot: { queuedRuns: unknown[] } }).snapshot.queuedRuns).toEqual([]);
    const analystInitial = await waitForMessage(ws, (payload) => (payload as { type?: string }).type === "analyst.snapshot");
    expect((analystInitial as { snapshot: { queuedSessions: unknown[] } }).snapshot.queuedSessions).toEqual([]);
    ws.close();
  });

  test("supports preset CRUD, analyst sessions, run actions, and report endpoints", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${dashboard!.port}/api/jobs/ws`);
    await waitForOpen(ws);
    await waitForMessage(ws, (payload) => (payload as { type?: string }).type === "snapshot");
    await waitForMessage(ws, (payload) => (payload as { type?: string }).type === "analyst.snapshot");

    const presetCreatedPromise = waitForMessage(ws, (payload) =>
      (payload as { type?: string }).type === "preset.created",
    );
    const preset = await fetch(`http://127.0.0.1:${dashboard!.port}/api/jobs/presets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Nightly",
        layers: ["chat-roundtrip"],
        providers: ["claude"],
      }),
    }).then((response) => response.json());
    expect(preset.name).toBe("Nightly");

    const presetCreated = await presetCreatedPromise;
    expect((presetCreated as { preset: { id: string } }).preset.id).toBe(preset.id);

    const run = await fetch(`http://127.0.0.1:${dashboard!.port}/api/jobs/presets/${preset.id}/run-now`, {
      method: "POST",
    }).then((response) => response.json());
    expect(["queued", "starting", "running", "completed"]).toContain(run.status);

    const completed = await runner.waitForRunCompletion(run.id, 5_000);
    expect(completed.status).toBe("completed");

    const analystUpdatedPromise = waitForMessage(ws, (payload) =>
      (payload as { type?: string }).type === "analyst.session.updated",
    );
    const analystSession = await fetch(`http://127.0.0.1:${dashboard!.port}/api/analyst/sessions/from-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: run.id }),
    }).then((response) => response.json());
    expect(["queued", "starting", "running", "completed"]).toContain(analystSession.status);
    const analystUpdated = await analystUpdatedPromise;
    expect((analystUpdated as { session: { sourceRunId: string } }).session.sourceRunId).toBe(run.id);

    const completedSession = await analyst.waitForSessionCompletion(analystSession.id, 5_000);
    expect(completedSession.status).toBe("completed");

    const analystDetail = await fetch(`http://127.0.0.1:${dashboard!.port}/api/analyst/sessions/${analystSession.id}`).then((response) => response.json());
    expect(analystDetail.proposal.summary).toBe("Analyst summary");
    expect(analystDetail.narrativeSummary.humanStatusLabel).toBe("Fix proposal created");
    expect(analystDetail.narrativeSummary.nextActions).toContain("Retry diagnosis");
    expect(analystDetail.sourceRun.status).toBe("completed");

    const detail = await fetch(`http://127.0.0.1:${dashboard!.port}/api/jobs/runs/${run.id}`).then((response) => response.json());
    expect(detail.status).toBe("completed");
    expect(detail.reportFilename).toMatch(/\.json$/);
    expect(detail.narrativeSummary.headline).toBe("Run passed");
    expect(detail.narrativeSummary.activityLabel).toBe("run finished");

    const reports = await fetch(`http://127.0.0.1:${dashboard!.port}/api/reports`).then((response) => response.json());
    expect(reports).toHaveLength(1);
    expect(reports[0].failedScenarios).toBe(0);
    expect(reports[0].failedProviderChecks).toBe(0);

    const savedReport = await fetch(`http://127.0.0.1:${dashboard!.port}/api/reports/${encodeURIComponent(detail.reportFilename)}`).then((response) => response.json());
    expect(savedReport.runContext.program).toBe("Nightly");
    expect(savedReport.narrativeSummary.headline).toBe("Run passed");

    ws.close();
  });
});
