import type { ServerWebSocket } from "bun";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { auditWorkbenchPlanningRepo } from "../packages/bootstrap/src/services/workbench-service.js";
import type { WorkbenchAnalystService } from "./analyst-service.js";
import {
  buildAnalystNarrativeSummary,
  buildReportNarrativeListSummary,
  buildReportNarrativeSummary,
  buildRunNarrativeSummary,
} from "./dashboard-summary.js";
import type { WorkbenchReport } from "./report.js";
import type { WorkbenchLiveMessage } from "./runner-protocol.js";
import type { WorkbenchRunnerService } from "./runner-service.js";

const REPORTS_DIR = join(import.meta.dir, "reports");
const PORT = 19321;
const HOST = "127.0.0.1";

interface ReportSummary {
  filename: string;
  timestamp: string;
  overall: "pass" | "fail";
  headline: string;
  humanStatusLabel: string;
  duration_ms: number;
  layers: number;
  scenarios: number;
  evalRuns: number;
  checkpoints: number;
  recommendations: number;
  comparisons: number;
  failures: number;
  failedScenarios: number;
  failedProviderChecks: number;
  runContext?: WorkbenchReport["runContext"];
}

interface DashboardOptions {
  reportsDir?: string;
  runner?: WorkbenchRunnerService;
  analyst?: WorkbenchAnalystService;
  planningRepoRoot?: string;
  port?: number;
  host?: string;
}

interface DashboardSocketData {
  channel: "jobs";
  unsubscribeRunner?: () => void;
  unsubscribeAnalyst?: () => void;
}

function countFailures(report: WorkbenchReport): number {
  const scenarioFailures = report.layers.reduce(
    (sum, layer) => sum + layer.scenarios.filter((scenario) => scenario.status === "fail").length,
    0,
  );
  const providerParityFailures = report.providerParity?.filter((row) => row.status === "fail").length ?? 0;
  const evalRunFailures = report.schedulerEvalRuns?.reduce((sum, run) => {
    const resolved = resolveEvalRunRecord(run);
    const checkpointFailures = (resolved.checkpoints ?? []).filter((checkpoint) => checkpoint.status === "failed").length;
    const scenarioResultFailures = (resolved.scenarioResults ?? []).filter((scenario) => scenario.status === "fail").length;
    return sum + checkpointFailures + scenarioResultFailures;
  }, 0) ?? 0;
  const comparisonFailures = report.comparisons?.filter((comparison) => comparison.status === "fail").length ?? 0;
  return scenarioFailures + providerParityFailures + evalRunFailures + comparisonFailures;
}

async function listReports(reportsDir: string): Promise<ReportSummary[]> {
  let files: string[];
  try {
    files = await readdir(reportsDir);
  } catch {
    return [];
  }

  const jsonFiles = files
    .filter((file) => file.endsWith(".json"))
    .sort()
    .reverse();

  const summaries = await Promise.all(
    jsonFiles.map(async (filename) => {
      try {
        const file = Bun.file(join(reportsDir, filename));
        const report: WorkbenchReport = await file.json();
        const narrative = buildReportNarrativeListSummary(report);
        const scenarioCount = report.layers.reduce((sum, layer) => sum + layer.scenarios.length, 0);
        const evalRuns = report.schedulerEvalRuns?.length ?? 0;
        const checkpoints = report.schedulerEvalRuns?.reduce((sum, run) => sum + (resolveEvalRunRecord(run).checkpoints?.length ?? 0), 0) ?? 0;
        const recommendations = report.schedulerEvalRuns?.reduce((sum, run) => sum + (resolveEvalRunRecord(run).recommendations?.length ?? 0), 0) ?? 0;
        return {
          filename,
          timestamp: report.timestamp,
          overall: report.overall,
          headline: narrative.headline,
          humanStatusLabel: narrative.humanStatusLabel,
          duration_ms: report.duration_ms,
          layers: report.layers.length,
          scenarios: scenarioCount,
          evalRuns,
          checkpoints,
          recommendations,
          comparisons: report.comparisons?.length ?? 0,
          failures: countFailures(report),
          failedScenarios: narrative.failedScenarios,
          failedProviderChecks: narrative.failedProviderChecks,
          runContext: report.runContext,
        } satisfies ReportSummary;
      } catch {
        return null;
      }
    }),
  );

  return summaries.filter((summary): summary is ReportSummary => summary !== null);
}

async function loadReport(filename: string, reportsDir: string): Promise<WorkbenchReport | null> {
  if (filename.includes("..") || filename.includes("/")) return null;
  try {
    return await Bun.file(join(reportsDir, filename)).json();
  } catch {
    return null;
  }
}

async function loadPlanningTask(
  repoRoot: string,
  queueItemId: string,
): Promise<{ queueItemId: string; taskFilePath: string; markdown: string } | null> {
  if (queueItemId.includes("..") || queueItemId.includes("/")) return null;
  const taskPaths = await indexPlanningTaskFiles(repoRoot);
  const taskFilePath = taskPaths.get(queueItemId.toLowerCase());
  if (!taskFilePath) return null;
  try {
    return {
      queueItemId,
      taskFilePath,
      markdown: await readFile(taskFilePath, "utf8"),
    };
  } catch {
    return null;
  }
}

async function indexPlanningTaskFiles(repoRoot: string): Promise<Map<string, string>> {
  const tasksRoot = join(repoRoot, "_planning", "backlog", "tasks");
  const result = new Map<string, string>();
  const stack = [tasksRoot];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: string[];
    try {
      entries = await readdir(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = join(current, entry);
      let entryStat: Awaited<ReturnType<typeof stat>>;
      try {
        entryStat = await stat(fullPath);
      } catch {
        continue;
      }
      if (entryStat.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.endsWith(".md")) {
        result.set(entry.toLowerCase(), fullPath);
      }
    }
  }
  return result;
}

function resolveEvalRunRecord(record: unknown): Record<string, unknown> {
  if (!record || typeof record !== "object") {
    return {};
  }
  const candidate = record as Record<string, unknown>;
  if (candidate.run && typeof candidate.run === "object") {
    const nestedRun = candidate.run as Record<string, unknown>;
    if (nestedRun.evalRun && typeof nestedRun.evalRun === "object") {
      return nestedRun.evalRun as Record<string, unknown>;
    }
    return nestedRun;
  }
  if (candidate.evalRun && typeof candidate.evalRun === "object") {
    return candidate.evalRun as Record<string, unknown>;
  }
  return candidate;
}

function renderDashboardHtml(runnerAvailable: boolean, analystAvailable: boolean, planningAvailable: boolean): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Workbench Live Runner</title>
<style>
  :root {
    --bg: #071018;
    --bg-2: #0d1826;
    --surface: rgba(14, 24, 38, 0.92);
    --surface-2: rgba(20, 32, 50, 0.96);
    --border: rgba(148, 163, 184, 0.18);
    --text: #e7f0fb;
    --muted: #92a6c4;
    --green: #3ddc97;
    --red: #ff6b6b;
    --yellow: #f7c948;
    --blue: #7cb7ff;
    --cyan: #61dafb;
    --mono: 'SFMono-Regular', 'SF Mono', 'Cascadia Code', monospace;
    --sans: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    color: var(--text);
    font-family: var(--sans);
    background:
      radial-gradient(circle at top left, rgba(124, 183, 255, 0.14), transparent 28%),
      radial-gradient(circle at top right, rgba(97, 218, 251, 0.10), transparent 30%),
      linear-gradient(180deg, var(--bg), var(--bg-2));
  }
  .page { max-width: 1520px; margin: 0 auto; padding: 28px 20px 48px; }
  header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: end;
    gap: 16px;
    margin-bottom: 18px;
  }
  h1 { margin: 0; font-size: 28px; letter-spacing: -0.03em; }
  .subtitle { margin-top: 8px; color: var(--muted); font-size: 13px; font-family: var(--mono); }
  .topline { display: flex; flex-wrap: wrap; gap: 8px; }
  .tabs { display: flex; gap: 8px; margin: 18px 0; }
  .tab {
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 8px 14px;
    background: rgba(255,255,255,0.03);
    color: var(--muted);
    cursor: pointer;
    font-size: 12px;
    font-family: var(--mono);
  }
  .tab.active { color: var(--text); border-color: rgba(124, 183, 255, 0.45); background: rgba(124, 183, 255, 0.10); }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 6px 10px;
    font-size: 11px;
    color: var(--muted);
    background: rgba(255,255,255,0.03);
    font-family: var(--mono);
  }
  .panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 18px;
    box-shadow: 0 12px 36px rgba(0,0,0,0.22);
  }
  .panel-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 16px 18px 0;
  }
  .panel-body { padding: 16px 18px 18px; }
  .grid-jobs {
    display: grid;
    grid-template-columns: 360px 360px minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  .grid-reports { display: grid; grid-template-columns: 420px minmax(0, 1fr); gap: 16px; align-items: start; }
  .stack { display: grid; gap: 16px; }
  .card {
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface-2);
  }
  .card h3, .card h4 { margin: 0 0 10px; font-size: 14px; }
  .note { color: var(--muted); font-size: 12px; font-family: var(--mono); }
  .muted { color: var(--muted); }
  .list { display: grid; gap: 10px; }
  .row-card {
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 12px 14px;
    background: rgba(255,255,255,0.03);
  }
  .row-card.active { border-color: rgba(124, 183, 255, 0.48); box-shadow: inset 0 0 0 1px rgba(124, 183, 255, 0.22); }
  .row-top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .title { font-weight: 700; color: #f8fbff; }
  .meta { color: var(--muted); font-size: 12px; font-family: var(--mono); line-height: 1.45; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  button, .button {
    appearance: none;
    border: 1px solid var(--border);
    background: rgba(255,255,255,0.04);
    color: var(--text);
    padding: 8px 10px;
    border-radius: 10px;
    cursor: pointer;
    font-size: 12px;
    font-family: var(--mono);
  }
  button:hover, .button:hover { border-color: rgba(124, 183, 255, 0.45); }
  button.primary { background: rgba(124, 183, 255, 0.14); border-color: rgba(124, 183, 255, 0.38); }
  button.danger { background: rgba(255, 107, 107, 0.12); border-color: rgba(255, 107, 107, 0.28); color: #ffdede; }
  button.ghost { background: transparent; }
  input, textarea {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: rgba(255,255,255,0.03);
    color: var(--text);
    padding: 10px 12px;
    font: inherit;
    font-size: 13px;
  }
  textarea { min-height: 64px; resize: vertical; }
  label { display: grid; gap: 6px; font-size: 12px; color: var(--muted); font-family: var(--mono); }
  form { display: grid; gap: 10px; }
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 18px;
  }
  .summary-card {
    padding: 14px;
    border-radius: 14px;
    border: 1px solid var(--border);
    background: var(--surface-2);
  }
  .summary-card .label { color: var(--muted); font-size: 11px; font-family: var(--mono); text-transform: uppercase; letter-spacing: 0.08em; }
  .summary-card .value { margin-top: 8px; font-size: 20px; font-weight: 700; }
  .summary-card .hint { margin-top: 6px; color: var(--muted); font-size: 12px; line-height: 1.45; }
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 3px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    font-family: var(--mono);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border: 1px solid transparent;
  }
  .badge-pass { background: rgba(61, 220, 151, 0.12); color: var(--green); border-color: rgba(61, 220, 151, 0.25); }
  .badge-fail { background: rgba(255, 107, 107, 0.12); color: var(--red); border-color: rgba(255, 107, 107, 0.25); }
  .badge-skip { background: rgba(247, 201, 72, 0.12); color: var(--yellow); border-color: rgba(247, 201, 72, 0.25); }
  .badge-info { background: rgba(124, 183, 255, 0.12); color: var(--blue); border-color: rgba(124, 183, 255, 0.25); }
  .badge-live { background: rgba(97, 218, 251, 0.12); color: var(--cyan); border-color: rgba(97, 218, 251, 0.25); }
  .matrix {
    width: 100%;
    border-collapse: collapse;
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid var(--border);
  }
  .matrix th, .matrix td {
    padding: 10px 12px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.12);
    text-align: left;
    vertical-align: top;
    font-size: 12px;
  }
  .matrix th {
    background: rgba(255,255,255,0.03);
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-family: var(--mono);
    font-size: 11px;
  }
  .matrix tr:last-child td { border-bottom: none; }
  .event-list { display: grid; gap: 8px; }
  .event-row {
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px 14px;
    background: rgba(255,255,255,0.03);
  }
  .event-row .topline {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    justify-content: space-between;
  }
  .event-row .detail {
    margin-top: 8px;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.5;
    font-family: var(--mono);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .empty {
    padding: 42px 12px;
    text-align: center;
    color: var(--muted);
    border: 1px dashed var(--border);
    border-radius: 14px;
    background: rgba(255,255,255,0.02);
  }
  .hidden { display: none !important; }
  .section { margin-top: 18px; }
  .section h3 { margin: 0 0 10px; font-size: 14px; }
  details {
    border: 1px solid var(--border);
    border-radius: 14px;
    background: rgba(255,255,255,0.03);
    overflow: hidden;
  }
  details > summary {
    list-style: none;
    cursor: pointer;
    padding: 12px 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: space-between;
    font-weight: 600;
  }
  details > summary::-webkit-details-marker { display: none; }
  .details-body {
    border-top: 1px solid rgba(148, 163, 184, 0.12);
    padding: 12px 14px 14px;
    display: grid;
    gap: 12px;
  }
  .kv {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    font-size: 12px;
  }
  .kv .key { color: var(--muted); font-family: var(--mono); }
  .kv .value { color: #f8fbff; word-break: break-word; }
  @media (max-width: 1320px) {
    .grid-jobs { grid-template-columns: 1fr 1fr; }
    .grid-jobs > :last-child { grid-column: 1 / -1; }
    .grid-reports { grid-template-columns: 1fr; }
  }
  @media (max-width: 960px) {
    .grid-jobs, .split, .summary-grid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
  <div class="page">
    <header>
      <div>
        <h1>Workbench Live Runner</h1>
        <div class="subtitle">Jobs queue, analyst sessions, live progress, gateway traces, and saved reports.</div>
      </div>
      <div class="topline">
        <span class="pill">runner ${runnerAvailable ? "enabled" : "unavailable"}</span>
        <span class="pill">analyst ${analystAvailable ? "enabled" : "unavailable"}</span>
        <span class="pill">planning ${planningAvailable ? "enabled" : "unavailable"}</span>
        <span class="pill" id="ws-status">ws connecting</span>
      </div>
    </header>

    <div class="tabs">
      <button class="tab active" id="tab-jobs" type="button" onclick="switchTab('jobs')">Jobs</button>
      ${analystAvailable ? `<button class="tab" id="tab-analyst" type="button" onclick="switchTab('analyst')">Analyst</button>` : ""}
      <button class="tab" id="tab-planning" type="button" onclick="switchTab('planning')">Planning</button>
      <button class="tab" id="tab-reports" type="button" onclick="switchTab('reports')">Reports</button>
    </div>

    <section id="jobs-view">
      <div class="grid-jobs">
        <div class="stack">
          <section class="panel">
            <div class="panel-header">
              <span class="badge badge-live">presets</span>
              <span class="note">Saved logical run configs</span>
            </div>
            <div class="panel-body">
              <form id="preset-form" onsubmit="savePreset(event)">
                <input type="hidden" id="preset-id" />
                <label>Name<input id="preset-name" placeholder="Nightly parity" /></label>
                <label>Layers (comma separated)<input id="preset-layers" placeholder="chat-roundtrip,provider-tool-parity,orchestration" /></label>
                <label>Providers (optional, comma separated)<input id="preset-providers" placeholder="claude,codex" /></label>
                <div class="actions">
                  <button class="primary" type="submit">Save preset</button>
                  <button class="ghost" type="button" onclick="resetPresetForm()">Clear</button>
                </div>
              </form>
              <div class="section">
                <h3>Preset List</h3>
                <div id="preset-list" class="list"></div>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-header">
              <span class="badge badge-live">ad hoc</span>
              <span class="note">Queue or run immediately without saving</span>
            </div>
            <div class="panel-body">
              <form id="adhoc-form">
                <label>Name<input id="adhoc-name" placeholder="Morning regression" /></label>
                <label>Layers (comma separated)<input id="adhoc-layers" placeholder="chat-roundtrip,provider-tool-parity" /></label>
                <label>Providers (optional, comma separated)<input id="adhoc-providers" placeholder="apple,claude" /></label>
                <div class="actions">
                  <button class="primary" type="button" onclick="submitAdHoc('run-now')">Run now</button>
                  <button type="button" onclick="submitAdHoc('queue')">Queue</button>
                </div>
              </form>
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="panel">
            <div class="panel-header">
              <span class="badge badge-live">queue</span>
              <span class="note">One active worker, FIFO wait queue</span>
            </div>
            <div class="panel-body">
              <div id="queue-list" class="list"></div>
            </div>
          </section>
          <section class="panel">
            <div class="panel-header">
              <span class="badge badge-info">history</span>
              <span class="note">Recent completed, failed, and interrupted runs</span>
            </div>
            <div class="panel-body">
              <div id="recent-list" class="list"></div>
            </div>
          </section>
        </div>

        <section class="panel">
          <div class="panel-header">
            <span class="badge badge-info">run detail</span>
            <span class="note">Canonical runner state plus filtered gateway events</span>
          </div>
          <div class="panel-body" id="run-detail">
            <div class="empty">Select a run to inspect live progress, matrix status, logs, and gateway traces.</div>
          </div>
        </section>
      </div>
    </section>

    <section id="analyst-view" class="hidden">
      <div class="grid-jobs">
        <div class="stack">
          <section class="panel">
            <div class="panel-header">
              <span class="badge badge-live">from run</span>
              <span class="note">Start a manual analyst session from a completed or failed run</span>
            </div>
            <div class="panel-body">
              <form onsubmit="startAnalystFromRun(event)">
                <label>Run ID<input id="analyst-run-id" placeholder="run-..." /></label>
                <div class="actions">
                  <button class="primary" type="submit">Analyze run</button>
                </div>
              </form>
            </div>
          </section>

          <section class="panel">
            <div class="panel-header">
              <span class="badge badge-live">from space</span>
              <span class="note">Analyze an existing source space with an optional root turn anchor</span>
            </div>
            <div class="panel-body">
              <form onsubmit="startAnalystFromSpace(event)">
                <label>Space ID<input id="analyst-space-id" placeholder="space-..." /></label>
                <label>Root turn ID (optional)<input id="analyst-root-turn-id" placeholder="turn-..." /></label>
                <div class="actions">
                  <button class="primary" type="submit">Analyze space</button>
                </div>
              </form>
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="panel">
            <div class="panel-header">
              <span class="badge badge-live">queue</span>
              <span class="note">Analyst sessions share the same local execution slot as jobs</span>
            </div>
            <div class="panel-body">
              <div id="analyst-queue-list" class="list"></div>
            </div>
          </section>
          <section class="panel">
            <div class="panel-header">
              <span class="badge badge-info">history</span>
              <span class="note">Recent analyst sessions and fix proposals</span>
            </div>
            <div class="panel-body">
              <div id="analyst-recent-list" class="list"></div>
            </div>
          </section>
        </div>

        <section class="panel">
          <div class="panel-header">
            <span class="badge badge-info">analyst detail</span>
            <span class="note">Proposal, evidence, verification commands, and events</span>
          </div>
          <div class="panel-body" id="analyst-detail">
            <div class="empty">Select an analyst session to inspect its evidence and fix proposal.</div>
          </div>
        </section>
      </div>
    </section>

    <section id="planning-view" class="hidden">
      <div class="grid-reports">
        <section class="panel">
          <div class="panel-header">
            <span class="badge badge-info">planning audit</span>
            <span class="note">Active queue goal-contract status</span>
          </div>
          <div class="panel-body">
            <div class="actions" style="margin-top:0;margin-bottom:12px">
              <button class="primary" type="button" onclick="fetchPlanningAudit()">Refresh audit</button>
            </div>
            <div id="planning-audit-list" class="list"></div>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <span class="badge badge-info">task source</span>
            <span class="note">Markdown backing the selected queue item</span>
          </div>
          <div class="panel-body" id="planning-task-detail">
            <div class="empty">Select a planning issue to inspect its task file.</div>
          </div>
        </section>
      </div>
    </section>

    <section id="reports-view" class="hidden">
      <div class="grid-reports">
        <section class="panel">
          <div class="panel-header">
            <span class="badge badge-info">reports</span>
            <span class="note">Saved JSON reports from completed runs</span>
          </div>
          <div class="panel-body">
            <div id="report-list" class="list"></div>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <span class="badge badge-info">report detail</span>
            <span class="note">Historical file-backed view</span>
          </div>
          <div class="panel-body" id="report-detail">
            <div class="empty">Select a saved report from the left.</div>
          </div>
        </section>
      </div>
    </section>
  </div>

<script>
const RUNNER_AVAILABLE = ${runnerAvailable ? "true" : "false"};
const ANALYST_AVAILABLE = ${analystAvailable ? "true" : "false"};
const PLANNING_AVAILABLE = ${planningAvailable ? "true" : "false"};
let activeTab = 'jobs';
let snapshot = { presets: [], queuedRuns: [], recentRuns: [] };
let analystSnapshot = { queuedSessions: [], recentSessions: [] };
let reports = [];
let planningAudit = null;
let selectedPlanningTask = null;
let selectedRunId = null;
let selectedRunDetail = null;
let selectedAnalystSessionId = null;
let selectedAnalystDetail = null;
let selectedReportFilename = null;
let selectedReport = null;
let jobsSocket = null;
let selectedRunRefreshTimer = null;
let reportsPollTimer = null;

function esc(value) {
  const node = document.createElement('div');
  node.textContent = value == null ? '' : String(value);
  return node.innerHTML;
}

function badgeClass(status) {
  if (status === 'pass' || status === 'completed' || status === 'running') return 'badge-pass';
  if (status === 'skip' || status === 'unavailable' || status === 'queued' || status === 'cancelling' || status === 'cancelled' || status === 'interrupted') return 'badge-skip';
  return 'badge-fail';
}

function formatDuration(value) {
  return typeof value === 'number' ? value + 'ms' : 'n/a';
}

function switchTab(tab) {
  activeTab = tab;
  document.getElementById('tab-jobs').classList.toggle('active', tab === 'jobs');
  const analystTab = document.getElementById('tab-analyst');
  if (analystTab) analystTab.classList.toggle('active', tab === 'analyst');
  document.getElementById('tab-planning').classList.toggle('active', tab === 'planning');
  document.getElementById('tab-reports').classList.toggle('active', tab === 'reports');
  document.getElementById('jobs-view').classList.toggle('hidden', tab !== 'jobs');
  const analystView = document.getElementById('analyst-view');
  if (analystView) analystView.classList.toggle('hidden', tab !== 'analyst');
  document.getElementById('planning-view').classList.toggle('hidden', tab !== 'planning');
  document.getElementById('reports-view').classList.toggle('hidden', tab !== 'reports');
}

function parseCsv(value) {
  return (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function api(path, options) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options && options.headers ? options.headers : {}) },
    ...(options || {}),
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.error || JSON.stringify(body);
    } catch {}
    throw new Error(detail || ('HTTP ' + response.status));
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

async function fetchSnapshot() {
  if (!RUNNER_AVAILABLE) return;
  snapshot = await api('/api/jobs/snapshot', { method: 'GET' });
  renderJobs();
}

async function fetchRunDetail(runId) {
  if (!RUNNER_AVAILABLE || !runId) return;
  selectedRunDetail = await api('/api/jobs/runs/' + encodeURIComponent(runId), { method: 'GET' });
  selectedRunId = runId;
  renderRunDetail();
  renderJobs();
}

async function fetchReports() {
  reports = await api('/api/reports', { method: 'GET' });
  renderReports();
}

async function fetchAnalystSnapshot() {
  if (!ANALYST_AVAILABLE) return;
  analystSnapshot = await api('/api/analyst/snapshot', { method: 'GET' });
  renderAnalyst();
}

async function fetchAnalystDetail(sessionId) {
  if (!ANALYST_AVAILABLE || !sessionId) return;
  selectedAnalystDetail = await api('/api/analyst/sessions/' + encodeURIComponent(sessionId), { method: 'GET' });
  selectedAnalystSessionId = sessionId;
  renderAnalystDetail();
  renderAnalyst();
}

async function fetchReport(filename) {
  selectedReport = await api('/api/reports/' + encodeURIComponent(filename), { method: 'GET' });
  selectedReportFilename = filename;
  renderReportDetail();
  renderReports();
}

async function fetchPlanningAudit() {
  if (!PLANNING_AVAILABLE) return;
  planningAudit = await api('/api/planning/audit', { method: 'GET' });
  renderPlanning();
}

async function fetchPlanningTask(queueItemId) {
  if (!PLANNING_AVAILABLE || !queueItemId) return;
  selectedPlanningTask = await api('/api/planning/tasks/' + encodeURIComponent(queueItemId), { method: 'GET' });
  renderPlanningTaskDetail();
  renderPlanning();
}

function scheduleSelectedRunRefresh(runId) {
  if (!runId || runId !== selectedRunId) return;
  if (selectedRunRefreshTimer) clearTimeout(selectedRunRefreshTimer);
  selectedRunRefreshTimer = setTimeout(() => {
    selectedRunRefreshTimer = null;
    void fetchRunDetail(runId);
  }, 120);
}

function connectJobsWs() {
  if (!RUNNER_AVAILABLE) {
    document.getElementById('ws-status').textContent = 'ws unavailable';
    return;
  }
  const wsUrl = location.origin.replace(/^http/, 'ws') + '/api/jobs/ws';
  jobsSocket = new WebSocket(wsUrl);
  jobsSocket.addEventListener('open', () => {
    document.getElementById('ws-status').textContent = 'ws live';
  });
  jobsSocket.addEventListener('close', () => {
    document.getElementById('ws-status').textContent = 'ws reconnecting';
    setTimeout(connectJobsWs, 1000);
  });
  jobsSocket.addEventListener('error', () => {
    document.getElementById('ws-status').textContent = 'ws error';
  });
  jobsSocket.addEventListener('message', (message) => {
    const payload = JSON.parse(message.data);
    handleLiveMessage(payload);
  });
}

function handleLiveMessage(message) {
  if (message.type === 'snapshot') {
    snapshot = message.snapshot;
    renderJobs();
    return;
  }
  if (message.type === 'preset.created' || message.type === 'preset.updated' || message.type === 'preset.deleted') {
    void fetchSnapshot();
    return;
  }
  if (message.type === 'run.updated') {
    void fetchSnapshot();
    scheduleSelectedRunRefresh(message.run.id);
    return;
  }
  if (message.type === 'run.event') {
    scheduleSelectedRunRefresh(message.event.runId);
    return;
  }
  if (message.type === 'report.saved') {
    void fetchSnapshot();
    void fetchReports();
    scheduleSelectedRunRefresh(message.runId);
    return;
  }
  if (message.type === 'analyst.snapshot') {
    analystSnapshot = message.snapshot;
    renderAnalyst();
    return;
  }
  if (message.type === 'analyst.session.updated') {
    void fetchAnalystSnapshot();
    if (selectedAnalystSessionId === message.session.id) {
      void fetchAnalystDetail(message.session.id);
    }
    return;
  }
  if (message.type === 'analyst.session.event') {
    if (selectedAnalystSessionId === message.event.sessionId) {
      void fetchAnalystDetail(message.event.sessionId);
    }
    return;
  }
  if (message.type === 'analyst.proposal.saved') {
    void fetchAnalystSnapshot();
    if (selectedAnalystSessionId === message.sessionId) {
      void fetchAnalystDetail(message.sessionId);
    }
  }
}

function renderJobs() {
  renderPresetList();
  renderQueueList();
  renderRecentList();
}

function presetCard(preset) {
  return '<div class="row-card">'
    + '<div class="row-top">'
    + '<div>'
    + '<div class="title">' + esc(preset.name) + '</div>'
    + '<div class="meta">' + esc(preset.layers.join(', ')) + (preset.providers.length ? '<br>' + esc(preset.providers.join(', ')) : '') + '</div>'
    + '</div>'
    + '<span class="badge badge-info">preset</span>'
    + '</div>'
    + '<div class="actions">'
    + '<button class="primary" type="button" onclick="runPresetNow(\\'' + preset.id + '\\')">Run now</button>'
    + '<button type="button" onclick="queuePreset(\\'' + preset.id + '\\')">Queue</button>'
    + '<button type="button" onclick="editPreset(\\'' + preset.id + '\\')">Edit</button>'
    + '<button class="danger" type="button" onclick="deletePreset(\\'' + preset.id + '\\')">Delete</button>'
    + '</div>'
    + '</div>';
}

function renderPresetList() {
  const element = document.getElementById('preset-list');
  if (!RUNNER_AVAILABLE) {
    element.innerHTML = '<div class="empty">Runner APIs are unavailable in this mode.</div>';
    return;
  }
  if (!snapshot.presets.length) {
    element.innerHTML = '<div class="empty">No presets saved yet.</div>';
    return;
  }
  element.innerHTML = snapshot.presets.map(presetCard).join('');
}

function runCard(run, kind) {
  const isSelected = selectedRunId === run.id;
  const actions = [];
  actions.push('<button type="button" onclick="openRun(\\'' + run.id + '\\')">Open</button>');
  if (run.status === 'queued' || run.status === 'starting' || run.status === 'running' || run.status === 'cancelling') {
    actions.push('<button class="danger" type="button" onclick="cancelRun(\\'' + run.id + '\\')">Cancel</button>');
  }
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled' || run.status === 'interrupted') {
    actions.push('<button type="button" onclick="retryRun(\\'' + run.id + '\\')">Retry</button>');
  }
  if (ANALYST_AVAILABLE && (run.status === 'completed' || run.status === 'failed')) {
    actions.push('<button type="button" onclick="prefillRunAnalysis(\\'' + run.id + '\\')">Analyze</button>');
  }
  if (run.reportFilename) {
    actions.push('<button type="button" onclick="openRunReport(\\'' + run.reportFilename + '\\')">Report</button>');
  }
  return '<div class="row-card' + (isSelected ? ' active' : '') + '">'
    + '<div class="row-top">'
    + '<div>'
    + '<div class="title">' + esc(run.name) + '</div>'
    + '<div class="meta">' + esc(run.id) + '<br>' + esc(run.config.layers.join(', ')) + (run.config.providers.length ? '<br>' + esc(run.config.providers.join(', ')) : '') + '</div>'
    + '</div>'
    + '<div>'
    + '<span class="badge ' + badgeClass(run.status) + '">' + esc(run.status) + '</span>'
    + (typeof run.queueRank === 'number' ? '<div class="meta">queue #' + run.queueRank + '</div>' : '')
    + '</div>'
    + '</div>'
    + '<div class="meta">' + esc(kind) + ' · ' + formatDuration(run.durationMs) + (run.exitSummary ? '<br>' + esc(run.exitSummary) : '') + '</div>'
    + '<div class="actions">' + actions.join('') + '</div>'
    + '</div>';
}

function renderQueueList() {
  const element = document.getElementById('queue-list');
  const rows = [];
  if (snapshot.activeRun) {
    rows.push(runCard(snapshot.activeRun, 'active'));
  }
  for (const run of snapshot.queuedRuns) {
    rows.push(runCard(run, 'queued'));
  }
  element.innerHTML = rows.length ? rows.join('') : '<div class="empty">No active or queued jobs.</div>';
}

function renderRecentList() {
  const element = document.getElementById('recent-list');
  element.innerHTML = snapshot.recentRuns.length
    ? snapshot.recentRuns.map((run) => runCard(run, 'recent')).join('')
    : '<div class="empty">No recent runs yet.</div>';
}

function analystSessionCard(session, kind) {
  const isSelected = selectedAnalystSessionId === session.id;
  const actions = ['<button type="button" onclick="openAnalystSession(\\'' + session.id + '\\')">Open</button>'];
  if (session.status === 'queued' || session.status === 'starting' || session.status === 'running' || session.status === 'cancelling') {
    actions.push('<button class="danger" type="button" onclick="cancelAnalystSession(\\'' + session.id + '\\')">Cancel</button>');
  }
  if (session.status === 'completed' || session.status === 'failed' || session.status === 'cancelled' || session.status === 'interrupted' || session.status === 'input_required') {
    actions.push('<button type="button" onclick="retryAnalystSession(\\'' + session.id + '\\')">Retry</button>');
  }
  const progressLabel = session.status === 'completed'
    ? 'Fix proposal created'
    : session.status === 'failed'
      ? 'Diagnosis failed'
      : session.status === 'interrupted'
        ? 'Diagnosis interrupted'
        : session.status === 'running'
          ? (session.phase === 'gathering_context'
            ? 'Gathering context'
            : session.phase === 'reproducing'
              ? 'Reproducing issue'
              : session.phase === 'analyzing'
                ? 'Analyzing evidence'
                : session.phase === 'drafting_fix'
                  ? 'Drafting fix proposal'
                  : 'Waiting for input')
          : session.status;
  return '<div class="row-card' + (isSelected ? ' active' : '') + '">'
    + '<div class="row-top">'
    + '<div>'
    + '<div class="title">' + esc(session.sourceType === 'run' ? ('Run ' + (session.sourceRunId || '')) : ('Space ' + session.sourceSpaceId)) + '</div>'
    + '<div class="meta">' + esc(session.id) + '<br>' + esc(progressLabel) + (session.analysisSpaceId ? '<br>analysis ' + esc(session.analysisSpaceId) : '') + '</div>'
    + '</div>'
    + '<div><span class="badge ' + badgeClass(session.status) + '">' + esc(session.status) + '</span>'
    + (typeof session.queueRank === 'number' ? '<div class="meta">queue #' + session.queueRank + '</div>' : '')
    + '</div>'
    + '</div>'
    + '<div class="meta">' + esc(kind) + ' · ' + formatDuration(session.durationMs) + (session.exitSummary ? '<br>' + esc(session.exitSummary) : '') + '</div>'
    + '<div class="actions">' + actions.join('') + '</div>'
    + '</div>';
}

function renderAnalystQueue() {
  const element = document.getElementById('analyst-queue-list');
  if (!ANALYST_AVAILABLE) {
    element.innerHTML = '<div class="empty">Analyst APIs are unavailable in this mode.</div>';
    return;
  }
  const rows = [];
  if (analystSnapshot.activeSession) {
    rows.push(analystSessionCard(analystSnapshot.activeSession, 'active'));
  }
  for (const session of analystSnapshot.queuedSessions) {
    rows.push(analystSessionCard(session, 'queued'));
  }
  element.innerHTML = rows.length ? rows.join('') : '<div class="empty">No queued analyst sessions.</div>';
}

function renderAnalystRecent() {
  const element = document.getElementById('analyst-recent-list');
  element.innerHTML = analystSnapshot.recentSessions.length
    ? analystSnapshot.recentSessions.map((session) => analystSessionCard(session, 'recent')).join('')
    : '<div class="empty">No recent analyst sessions yet.</div>';
}

function resetPresetForm() {
  document.getElementById('preset-id').value = '';
  document.getElementById('preset-name').value = '';
  document.getElementById('preset-layers').value = '';
  document.getElementById('preset-providers').value = '';
}

function editPreset(presetId) {
  const preset = snapshot.presets.find((entry) => entry.id === presetId);
  if (!preset) return;
  document.getElementById('preset-id').value = preset.id;
  document.getElementById('preset-name').value = preset.name;
  document.getElementById('preset-layers').value = preset.layers.join(',');
  document.getElementById('preset-providers').value = preset.providers.join(',');
}

async function savePreset(event) {
  event.preventDefault();
  const presetId = document.getElementById('preset-id').value;
  const payload = {
    name: document.getElementById('preset-name').value,
    layers: parseCsv(document.getElementById('preset-layers').value),
    providers: parseCsv(document.getElementById('preset-providers').value),
  };
  try {
    if (presetId) {
      await api('/api/jobs/presets/' + encodeURIComponent(presetId), {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    } else {
      await api('/api/jobs/presets', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }
    resetPresetForm();
    await fetchSnapshot();
  } catch (error) {
    alert(error.message);
  }
}

async function deletePreset(presetId) {
  if (!confirm('Delete this preset?')) return;
  try {
    await api('/api/jobs/presets/' + encodeURIComponent(presetId), { method: 'DELETE' });
    if (document.getElementById('preset-id').value === presetId) {
      resetPresetForm();
    }
    await fetchSnapshot();
  } catch (error) {
    alert(error.message);
  }
}

function collectAdHocPayload() {
  return {
    name: document.getElementById('adhoc-name').value || undefined,
    layers: parseCsv(document.getElementById('adhoc-layers').value),
    providers: parseCsv(document.getElementById('adhoc-providers').value),
  };
}

async function submitAdHoc(mode) {
  try {
    const run = await api(mode === 'run-now' ? '/api/jobs/run-now' : '/api/jobs/queue', {
      method: 'POST',
      body: JSON.stringify(collectAdHocPayload()),
    });
    if (run && run.id) {
      await fetchSnapshot();
      await fetchRunDetail(run.id);
    }
  } catch (error) {
    alert(error.message);
  }
}

async function queuePreset(presetId) {
  try {
    const run = await api('/api/jobs/presets/' + encodeURIComponent(presetId) + '/queue', { method: 'POST' });
    await fetchSnapshot();
    if (run && run.id) await fetchRunDetail(run.id);
  } catch (error) {
    alert(error.message);
  }
}

async function runPresetNow(presetId) {
  try {
    const run = await api('/api/jobs/presets/' + encodeURIComponent(presetId) + '/run-now', { method: 'POST' });
    await fetchSnapshot();
    if (run && run.id) await fetchRunDetail(run.id);
  } catch (error) {
    alert(error.message);
  }
}

async function cancelRun(runId) {
  try {
    await api('/api/jobs/runs/' + encodeURIComponent(runId) + '/cancel', { method: 'POST' });
    await fetchSnapshot();
    await fetchRunDetail(runId);
  } catch (error) {
    alert(error.message);
  }
}

async function retryRun(runId) {
  try {
    const run = await api('/api/jobs/runs/' + encodeURIComponent(runId) + '/retry', { method: 'POST' });
    await fetchSnapshot();
    if (run && run.id) await fetchRunDetail(run.id);
  } catch (error) {
    alert(error.message);
  }
}

function openRun(runId) {
  void fetchRunDetail(runId);
}

function openRunReport(filename) {
  switchTab('reports');
  void fetchReport(filename);
}

function prefillRunAnalysis(runId) {
  if (!ANALYST_AVAILABLE) return;
  switchTab('analyst');
  document.getElementById('analyst-run-id').value = runId;
}

async function startAnalystFromRun(event) {
  event.preventDefault();
  try {
    const runId = document.getElementById('analyst-run-id').value.trim();
    if (!runId) return;
    const session = await api('/api/analyst/sessions/from-run', {
      method: 'POST',
      body: JSON.stringify({ runId }),
    });
    await fetchAnalystDetail(session.id);
  } catch (error) {
    alert(error.message);
  }
}

async function startAnalystFromSpace(event) {
  event.preventDefault();
  try {
    const spaceId = document.getElementById('analyst-space-id').value.trim();
    const rootTurnId = document.getElementById('analyst-root-turn-id').value.trim();
    if (!spaceId) return;
    const session = await api('/api/analyst/sessions/from-space', {
      method: 'POST',
      body: JSON.stringify({ spaceId, ...(rootTurnId ? { rootTurnId } : {}) }),
    });
    await fetchAnalystDetail(session.id);
  } catch (error) {
    alert(error.message);
  }
}

function openAnalystSession(sessionId) {
  switchTab('analyst');
  void fetchAnalystDetail(sessionId);
}

async function retryAnalystSession(sessionId) {
  try {
    const session = await api('/api/analyst/sessions/' + encodeURIComponent(sessionId) + '/retry', { method: 'POST' });
    await fetchAnalystDetail(session.id);
  } catch (error) {
    alert(error.message);
  }
}

async function cancelAnalystSession(sessionId) {
  try {
    await api('/api/analyst/sessions/' + encodeURIComponent(sessionId) + '/cancel', { method: 'POST' });
    if (selectedAnalystSessionId === sessionId) {
      await fetchAnalystDetail(sessionId);
    }
  } catch (error) {
    alert(error.message);
  }
}

function renderSummaryCard(label, value, hint) {
  return '<div class="summary-card">'
    + '<div class="label">' + esc(label) + '</div>'
    + '<div class="value">' + esc(value) + '</div>'
    + (hint ? '<div class="hint">' + esc(hint) + '</div>' : '')
    + '</div>';
}

function renderTextList(items, emptyText) {
  if (!items || !items.length) {
    return '<div class="empty">' + esc(emptyText) + '</div>';
  }
  return '<div class="event-list">' + items.map((item) =>
    '<div class="event-row"><div class="detail" style="margin-top:0">' + esc(item) + '</div></div>'
  ).join('') + '</div>';
}

function renderNarrativeSummary(summary, options) {
  if (!summary) {
    return "";
  }
  const headlineLabel = options && options.headlineLabel ? options.headlineLabel : 'what happened';
  const failureLabel = options && options.failureLabel ? options.failureLabel : 'Why it failed';
  const passedLabel = options && options.passedLabel ? options.passedLabel : 'Passed';
  const actionsLabel = options && options.actionsLabel ? options.actionsLabel : 'Next actions';
  const statusClass = summary.humanStatusLabel && summary.humanStatusLabel.toLowerCase().includes('fail')
    ? 'fail'
    : summary.humanStatusLabel && summary.humanStatusLabel.toLowerCase().includes('interrupt')
      ? 'skip'
      : 'pass';
  return ''
    + '<div class="card narrative-card">'
    + '<div class="note">' + esc(headlineLabel) + '</div>'
    + '<div class="row-top" style="margin-top:10px">'
    + '<div class="title">' + esc(summary.headline) + '</div>'
    + '<div><span class="badge badge-' + statusClass + '">' + esc(summary.humanStatusLabel) + '</span></div>'
    + '</div>'
    + (summary.diagnosisResult ? '<div class="meta" style="margin-top:8px">' + esc(summary.diagnosisResult) + '</div>' : '')
    + (summary.activityLabel ? '<div class="meta" style="margin-top:8px">active scenario: ' + esc(summary.activityLabel) + '</div>' : '')
    + '</div>'
    + '<div class="split section">'
    + '<div><h3>' + esc(failureLabel) + '</h3>' + renderTextList(summary.primaryFailures || [], 'No primary failures recorded.') + '</div>'
    + '<div><h3>' + esc(passedLabel) + '</h3>' + renderTextList(summary.passedAreas || [], 'No passing areas recorded.') + '</div>'
    + '</div>'
    + '<div class="section"><h3>' + esc(actionsLabel) + '</h3>' + renderTextList(summary.nextActions || [], 'No next actions suggested.') + '</div>';
}

function renderDebugSection(sections) {
  const renderedSections = (sections || [])
    .filter((section) => section && section.content)
    .map((section) => '<div><h3>' + esc(section.title) + '</h3>' + section.content + '</div>')
    .join('');
  if (!renderedSections) {
    return '';
  }
  return '<details class="section"><summary>Debug</summary><div class="details-body">' + renderedSections + '</div></details>';
}

function renderAnalyst() {
  renderAnalystQueue();
  renderAnalystRecent();
  renderAnalystDetail();
}

function renderAnalystDetail() {
  const element = document.getElementById('analyst-detail');
  const detail = selectedAnalystDetail;
  if (!detail) {
    element.innerHTML = '<div class="empty">Select an analyst session to inspect its evidence and fix proposal.</div>';
    return;
  }

  const proposal = detail.proposal;
  const verificationRows = (detail.snapshot.verificationCommands || []).map((command) =>
    '<tr><td>' + esc(command.command) + '</td><td><span class="badge ' + badgeClass(command.status) + '">' + esc(command.status) + '</span></td><td>' + esc(command.summary || command.outputPreview || '') + '</td></tr>'
  ).join('');
  const evidenceRows = (detail.snapshot.evidence || []).map((item) =>
    '<div class="event-row"><div class="topline"><div class="title">' + esc(item.title) + '</div></div><div class="detail">' + esc(item.detail) + '</div></div>'
  ).join('');
  const analystNarrative = {
    ...detail.narrativeSummary,
    passedAreas: detail.sourceRun && detail.sourceRun.narrativeSummary
      ? [detail.sourceRun.narrativeSummary.headline]
      : [],
  };

  element.innerHTML = ''
    + renderNarrativeSummary(analystNarrative, {
      headlineLabel: 'diagnosis result',
      failureLabel: 'Problems encountered',
      passedLabel: 'Source run result',
      actionsLabel: 'Next actions',
    })
    + '<div class="summary-grid">'
    + renderSummaryCard('result', detail.narrativeSummary ? detail.narrativeSummary.humanStatusLabel : detail.status, (detail.status === 'running' || detail.status === 'starting' || detail.status === 'queued') ? detail.phase : 'terminal session')
    + renderSummaryCard('source', detail.sourceType, detail.sourceRunId || detail.sourceSpaceId)
    + renderSummaryCard('source run', detail.sourceRun ? detail.sourceRun.status : 'n/a', detail.sourceRun && detail.sourceRun.narrativeSummary ? detail.sourceRun.narrativeSummary.headline : (detail.sourceRunId || ''))
    + renderSummaryCard('analysis space', detail.analysisSpaceId || 'n/a', detail.analysisRootTurnId || '')
    + renderSummaryCard('task', detail.taskId || 'n/a', detail.exitSummary || '')
    + renderSummaryCard('authority', detail.authority, formatDuration(detail.durationMs))
    + '</div>'
    + (proposal
      ? '<div class="card"><div class="kv">'
        + '<div class="key">summary</div><div class="value">' + esc(proposal.summary) + '</div>'
        + '<div class="key">rootCause</div><div class="value">' + esc(proposal.rootCause) + '</div>'
        + '<div class="key">reproductionCommands</div><div class="value">' + esc((proposal.reproductionCommands || []).join('\\n')) + '</div>'
        + '<div class="key">proposedEdits</div><div class="value">' + esc((proposal.proposedEdits || []).map((item) => item.filePath + ': ' + item.summary).join('\\n')) + '</div>'
        + '</div></div>'
      : '<div class="empty">No proposal saved yet.</div>')
    + '<div class="section"><h3>Verification Commands</h3>'
    + (verificationRows
      ? '<table class="matrix"><thead><tr><th>Command</th><th>Status</th><th>Summary</th></tr></thead><tbody>' + verificationRows + '</tbody></table>'
      : '<div class="empty">No verification commands recorded.</div>')
    + '</div>'
    + '<div class="section"><h3>Evidence</h3>' + (evidenceRows || '<div class="empty">No evidence recorded.</div>') + '</div>'
    + renderDebugSection([
      { title: 'Session Events', content: renderEventRows(detail.events || []) },
      { title: 'Gateway Events', content: renderEventRows(detail.gatewayEvents || []) },
    ]);
}

function renderLiveMatrix(layers) {
  const rows = [];
  for (const layer of layers || []) {
    const scenarios = layer.scenarios || [];
    if (!scenarios.length) {
      rows.push('<tr><td>' + esc(layer.name) + '</td><td class="muted">—</td><td><span class="badge ' + badgeClass(layer.status) + '">' + esc(layer.status) + '</span></td><td class="meta">' + formatDuration(layer.durationMs) + '</td><td></td></tr>');
    }
    for (const scenario of scenarios) {
      rows.push(
        '<tr>'
          + '<td><span class="badge ' + badgeClass(layer.status) + '">' + esc(layer.name) + '</span></td>'
          + '<td>' + esc(scenario.name) + '</td>'
          + '<td><span class="badge ' + badgeClass(scenario.status) + '">' + esc(scenario.status) + '</span></td>'
          + '<td class="meta">' + formatDuration(scenario.durationMs) + '</td>'
          + '<td>' + (scenario.error ? '<span class="muted">' + esc(scenario.error) + '</span>' : '<span class="muted">' + esc(scenario.startedAt || '') + '</span>') + '</td>'
        + '</tr>'
      );
    }
  }
  return rows.length
    ? '<table class="matrix"><thead><tr><th>Layer</th><th>Scenario</th><th>Status</th><th>Duration</th><th>Notes</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>'
    : '<div class="empty">No live layer state yet.</div>';
}

function renderEventRows(events) {
  if (!events || !events.length) {
    return '<div class="empty">No events recorded yet.</div>';
  }
  return '<div class="event-list">' + events.map((event) =>
    '<div class="event-row">'
      + '<div class="topline">'
      + '<div class="title">' + esc(event.kind) + '</div>'
      + '<div class="meta">#' + esc(event.seq) + ' · ' + esc(event.createdAt) + '</div>'
      + '</div>'
      + '<div class="detail">' + esc(JSON.stringify(event.payload, null, 2)) + '</div>'
    + '</div>'
  ).join('') + '</div>';
}

function renderProviderParity(rows) {
  if (!rows || !rows.length) {
    return '<div class="empty">No provider parity rows yet.</div>';
  }
  return '<div class="event-list">' + rows.map((row) =>
    '<div class="event-row">'
      + '<div class="topline">'
      + '<div class="title">' + esc(row.provider + '/' + row.model) + '</div>'
      + '<div class="meta"><span class="badge badge-info">' + esc(row.transport + (row.scope ? ' · ' + row.scope : '')) + '</span> <span class="badge ' + badgeClass(row.status) + '">' + esc(row.status) + '</span></div>'
      + '</div>'
      + (row.observedToolCall ? '<div class="detail">' + esc(row.observedToolCall) + '</div>' : '')
      + (row.failureReason ? '<div class="detail">' + esc(row.failureReason) + '</div>' : '')
    + '</div>'
  ).join('') + '</div>';
}

function resolveEvalRun(record) {
  if (!record || typeof record !== 'object') return {};
  return record.run && record.run.evalRun ? record.run.evalRun : record.evalRun || record.run || record;
}

function renderScenarioResults(results) {
  if (!results || !results.length) {
    return '<div class="empty">No scenario results recorded.</div>';
  }
  return '<div class="event-list">' + results.map((result) =>
    '<div class="event-row">'
      + '<div class="topline">'
      + '<div class="title">' + esc(result.scenarioId) + '</div>'
      + '<div class="meta"><span class="badge ' + badgeClass(result.status) + '">' + esc(result.status) + '</span></div>'
      + '</div>'
      + '<div class="detail">' + esc('checkpointCount=' + result.checkpointCount + (result.failureReason ? '\\n' + result.failureReason : '')) + '</div>'
    + '</div>'
  ).join('') + '</div>';
}

function renderRecommendations(recommendations) {
  if (!recommendations || !recommendations.length) {
    return '<div class="empty">No recommendations attached.</div>';
  }
  return '<div class="event-list">' + recommendations.map((recommendation) =>
    '<div class="event-row">'
      + '<div class="topline">'
      + '<div class="title">' + esc(recommendation.title) + '</div>'
      + '<div class="meta"><span class="badge ' + badgeClass(recommendation.status === 'applied' ? 'pass' : 'skip') + '">' + esc(recommendation.status) + '</span></div>'
      + '</div>'
      + (recommendation.summary ? '<div class="detail">' + esc(recommendation.summary) + '</div>' : '')
    + '</div>'
  ).join('') + '</div>';
}

function renderEvalRuns(evalRuns) {
  if (!evalRuns || !evalRuns.length) {
    return '<div class="empty">No scheduler eval payloads captured yet.</div>';
  }
  return evalRuns.map((record) => {
    const run = resolveEvalRun(record);
    return '<details open>'
      + '<summary>'
      + '<span>' + esc(run.evalDefinitionId || run.evalRunId || 'Scheduler Eval Run') + '</span>'
      + '<span class="badge badge-info">' + esc(run.summaryMode || 'checkpoints') + '</span>'
      + '</summary>'
      + '<div class="details-body">'
      + '<div class="kv">'
      + '<div class="key">evalRunId</div><div class="value">' + esc(run.evalRunId || 'n/a') + '</div>'
      + '<div class="key">rootTurnId</div><div class="value">' + esc(run.rootTurnId || 'n/a') + '</div>'
      + '<div class="key">finalSummaryText</div><div class="value">' + esc(run.finalSummaryText || 'n/a') + '</div>'
      + '</div>'
      + '<div class="split">'
      + '<div><h3>Scenario Results</h3>' + renderScenarioResults(run.scenarioResults || []) + '</div>'
      + '<div><h3>Recommendations</h3>' + renderRecommendations(run.recommendations || []) + '</div>'
      + '</div>'
      + '<div><h3>Checkpoints</h3>' + renderEventRows((run.checkpoints || []).map((checkpoint, index) => ({ seq: index + 1, kind: checkpoint.kind, createdAt: checkpoint.createdAt || 'n/a', payload: checkpoint }))) + '</div>'
      + '</div>'
      + '</details>';
  }).join('');
}

function renderComparisons(comparisons) {
  if (!comparisons || !comparisons.length) {
    return '<div class="empty">No comparisons attached.</div>';
  }
  return '<div class="event-list">' + comparisons.map((comparison) =>
    '<div class="event-row">'
      + '<div class="topline">'
      + '<div class="title">' + esc(comparison.label) + '</div>'
      + '<div class="meta"><span class="badge ' + badgeClass(comparison.status) + '">' + esc(comparison.status) + '</span></div>'
      + '</div>'
      + (comparison.summary ? '<div class="detail">' + esc(comparison.summary) + '</div>' : '')
    + '</div>'
  ).join('') + '</div>';
}

function renderRunDetail() {
  const element = document.getElementById('run-detail');
  const detail = selectedRunDetail;
  if (!detail) {
    element.innerHTML = '<div class="empty">Select a run to inspect live progress, matrix status, logs, and gateway traces.</div>';
    return;
  }

  const snapshotData = detail.snapshot || { layers: [], providerParity: [], schedulerEvalRuns: [], comparisons: [] };
  const narrative = detail.narrativeSummary;
  const html = []
  html.push('<div class="row-top"><div><div class="title">' + esc(detail.name) + '</div><div class="meta">' + esc(detail.id) + '<br>' + esc(detail.config.layers.join(', ')) + (detail.config.providers.length ? '<br>' + esc(detail.config.providers.join(', ')) : '') + '</div></div><div><span class="badge ' + badgeClass(detail.status) + '">' + esc(detail.status) + '</span></div></div>');
  html.push('<div class="actions">'
    + ((detail.status === 'queued' || detail.status === 'starting' || detail.status === 'running' || detail.status === 'cancelling')
      ? '<button class="danger" type="button" onclick="cancelRun(\\'' + detail.id + '\\')">Cancel</button>'
      : '')
    + ((detail.status === 'completed' || detail.status === 'failed' || detail.status === 'cancelled' || detail.status === 'interrupted')
      ? '<button type="button" onclick="retryRun(\\'' + detail.id + '\\')">Retry</button>'
      : '')
    + (detail.reportFilename ? '<button type="button" onclick="openRunReport(\\'' + detail.reportFilename + '\\')">Open report</button>' : '')
    + '</div>');
  html.push(renderNarrativeSummary(narrative, {
    headlineLabel: 'what happened',
    failureLabel: 'Why it failed',
    passedLabel: 'Passed',
    actionsLabel: 'Next actions',
  }));
  html.push('<div class="summary-grid">'
    + renderSummaryCard('layers', String(narrative.counts.layerCount), detail.config.layers.join(', '))
    + renderSummaryCard('active scenario', narrative.activityLabel, narrative.humanStatusLabel)
    + renderSummaryCard('failed scenarios', String(narrative.counts.failedScenarios), 'scenario-level failures')
    + renderSummaryCard('failed provider checks', String(narrative.counts.failedProviderChecks), 'provider parity failures')
    + renderSummaryCard('scheduler eval payloads', String(narrative.counts.schedulerEvalPayloads), 'captured eval records')
    + '</div>');
  if (snapshotData.message) {
    html.push('<div class="card"><div class="note">message</div><div class="title" style="margin-top:8px">' + esc(snapshotData.message) + '</div></div>');
  }
  html.push('<div class="section"><h3>Scenario Matrix</h3>' + renderLiveMatrix(snapshotData.layers || []) + '</div>');
  html.push('<div class="section"><h3>Provider Parity</h3>' + renderProviderParity(snapshotData.providerParity || []) + '</div>');
  html.push('<div class="section"><h3>Scheduler Eval Runs</h3>' + renderEvalRuns(snapshotData.schedulerEvalRuns || []) + '</div>');
  html.push('<div class="section"><h3>Comparisons</h3>' + renderComparisons(snapshotData.comparisons || []) + '</div>');
  html.push(renderDebugSection([
    { title: 'Runner Events', content: renderEventRows(detail.runnerEvents || []) },
    { title: 'Gateway Events', content: renderEventRows(detail.gatewayEvents || []) },
  ]));
  element.innerHTML = html.join('');
}

function renderReportListItem(report) {
  const active = selectedReportFilename === report.filename ? ' active' : '';
  const context = report.runContext && report.runContext.program ? report.runContext.program : 'Workbench run';
  return '<div class="row-card' + active + '">'
    + '<div class="row-top">'
    + '<div><div class="title">' + esc(report.timestamp) + '</div><div class="meta">' + esc(context) + '<br>' + esc(report.layers + ' layers · ' + report.scenarios + ' scenarios') + '</div></div>'
    + '<div><span class="badge ' + badgeClass(report.overall) + '">' + esc(report.humanStatusLabel) + '</span><div class="meta">' + report.duration_ms + 'ms</div></div>'
    + '</div>'
    + '<div class="meta">' + esc(report.headline) + '<br>' + esc(report.failedScenarios + ' failed scenarios · ' + report.failedProviderChecks + ' failed provider checks' + (report.evalRuns ? ' · ' + report.evalRuns + ' scheduler eval payloads' : '')) + '</div>'
    + '<div class="actions"><button type="button" onclick="fetchReport(\\'' + report.filename + '\\')">Open</button></div>'
    + '</div>';
}

function planningIssueCard(issue, kind) {
  const active = selectedPlanningTask && selectedPlanningTask.queueItemId === issue.queueItemId ? ' active' : '';
  return '<div class="row-card' + active + '">'
    + '<div class="row-top">'
    + '<div><div class="title">' + esc(issue.queueItemId) + '</div><div class="meta">queue #' + esc(issue.queueIndex) + ' · ' + esc(kind) + '<br>' + esc(issue.code || '') + '</div></div>'
    + '<span class="badge ' + (kind === 'warning' ? 'badge-skip' : 'badge-fail') + '">' + esc(kind) + '</span>'
    + '</div>'
    + '<div class="meta">' + esc(issue.message) + '</div>'
    + '<div class="actions"><button type="button" onclick="fetchPlanningTask(\\'' + issue.queueItemId + '\\')">Open task</button></div>'
    + '</div>';
}

function renderPlanning() {
  const element = document.getElementById('planning-audit-list');
  if (!PLANNING_AVAILABLE) {
    element.innerHTML = '<div class="empty">Planning audit is unavailable in this mode.</div>';
    return;
  }
  if (!planningAudit) {
    element.innerHTML = '<div class="empty">Planning audit has not loaded yet.</div>';
    return;
  }
  const issues = []
    .concat((planningAudit.goalContractErrors || []).map((issue) => planningIssueCard(issue, 'error')))
    .concat((planningAudit.goalContractWarnings || []).map((issue) => planningIssueCard(issue, 'warning')))
    .concat((planningAudit.malformedVerificationBlocks || []).map((issue) => planningIssueCard(issue, 'error')))
    .concat((planningAudit.missingMachineReadableVerification || []).map((issue) => planningIssueCard(issue, 'error')));
  const summary = '<div class="summary-grid">'
    + renderSummaryCard('active task files', String(planningAudit.executableQueueItemCount || 0), planningAudit.repoRoot || '')
    + renderSummaryCard('contract errors', String((planningAudit.goalContractErrors || []).length), 'must be fixed')
    + renderSummaryCard('contract warnings', String((planningAudit.goalContractWarnings || []).length), 'drafts need review')
    + renderSummaryCard('verification gaps', String((planningAudit.missingMachineReadableVerification || []).length), 'review-only blockers')
    + renderSummaryCard('non-executable rows', String((planningAudit.nonExecutableRows || []).length), 'queue grouping/story rows')
    + '</div>';
  element.innerHTML = summary + (issues.length ? issues.join('') : '<div class="empty">No planning audit issues.</div>');
}

function renderPlanningTaskDetail() {
  const element = document.getElementById('planning-task-detail');
  if (!selectedPlanningTask) {
    element.innerHTML = '<div class="empty">Select a planning issue to inspect its task file.</div>';
    return;
  }
  element.innerHTML = '<div class="kv">'
    + '<div class="key">queueItemId</div><div class="value">' + esc(selectedPlanningTask.queueItemId) + '</div>'
    + '<div class="key">taskFilePath</div><div class="value">' + esc(selectedPlanningTask.taskFilePath) + '</div>'
    + '</div>'
    + '<div class="section"><h3>Markdown</h3><div class="event-row"><div class="detail">' + esc(selectedPlanningTask.markdown) + '</div></div></div>';
}

function renderReports() {
  const list = document.getElementById('report-list');
  list.innerHTML = reports.length
    ? reports.map(renderReportListItem).join('')
    : '<div class="empty">No reports found yet.</div>';
}

function renderReportDetail() {
  const report = selectedReport;
  const element = document.getElementById('report-detail');
  if (!report) {
    element.innerHTML = '<div class="empty">Select a saved report from the left.</div>';
    return;
  }

  const evalRuns = report.schedulerEvalRuns || [];
  const resolvedRuns = evalRuns.map(resolveEvalRun);
  const checkpointCount = resolvedRuns.reduce((sum, run) => sum + ((run.checkpoints || []).length), 0);
  const recommendationCount = resolvedRuns.reduce((sum, run) => sum + ((run.recommendations || []).length), 0);
  const narrative = report.narrativeSummary;
  const html = [];
  html.push('<div class="row-top"><div><div class="title">' + esc(report.timestamp) + '</div><div class="meta">' + esc((report.runContext && report.runContext.program) || 'Workbench run') + '</div></div><div><span class="badge ' + badgeClass(report.overall) + '">' + esc(report.overall) + '</span></div></div>');
  html.push(renderNarrativeSummary(narrative, {
    headlineLabel: 'what happened',
    failureLabel: 'Why it failed',
    passedLabel: 'Passed',
    actionsLabel: 'Next actions',
  }));
  html.push('<div class="summary-grid">'
    + renderSummaryCard('layers', String(narrative.counts.layerCount), narrative.counts.scenarioCount + ' scenarios')
    + renderSummaryCard('active scenario', narrative.activityLabel, narrative.humanStatusLabel)
    + renderSummaryCard('failed scenarios', String(narrative.counts.failedScenarios), 'historical view')
    + renderSummaryCard('failed provider checks', String(narrative.counts.failedProviderChecks), 'historical view')
    + renderSummaryCard('scheduler eval payloads', String(narrative.counts.schedulerEvalPayloads), checkpointCount + ' checkpoints · ' + recommendationCount + ' recommendations')
    + '</div>');
  html.push('<div class="section"><h3>Scenario Matrix</h3>' + renderLiveMatrix((report.layers || []).map((layer) => ({ name: layer.name, status: layer.status, durationMs: layer.duration_ms, scenarios: (layer.scenarios || []).map((scenario) => ({ name: scenario.name, status: scenario.status, durationMs: scenario.duration_ms, error: scenario.error })) }))) + '</div>');
  if (report.providerParity && report.providerParity.length) {
    html.push('<div class="section"><h3>Provider Parity</h3>' + renderProviderParity(report.providerParity) + '</div>');
  }
  if (evalRuns.length) {
    html.push('<div class="section"><h3>Scheduler Eval Runs</h3>' + renderEvalRuns(evalRuns) + '</div>');
  }
  if (report.comparisons && report.comparisons.length) {
    html.push('<div class="section"><h3>Comparisons</h3>' + renderComparisons(report.comparisons) + '</div>');
  }
  element.innerHTML = html.join('');
}

function startReportPolling() {
  if (reportsPollTimer) clearInterval(reportsPollTimer);
  reportsPollTimer = setInterval(() => { void fetchReports(); }, 15000);
}

document.addEventListener('DOMContentLoaded', () => {
  switchTab('jobs');
  void fetchReports();
  if (PLANNING_AVAILABLE) {
    void fetchPlanningAudit();
  }
  if (ANALYST_AVAILABLE) {
    void fetchAnalystSnapshot();
  }
  if (RUNNER_AVAILABLE) {
    void fetchSnapshot();
    connectJobsWs();
  } else {
    document.getElementById('ws-status').textContent = 'ws unavailable';
    renderJobs();
  }
  startReportPolling();
});
</script>
</body>
</html>`;
}

function jsonBody(request: Request): Promise<Record<string, unknown>> {
  return request.json().catch(() => ({}));
}

function normalizeJobConfigPayload(input: Record<string, unknown>): {
  name?: string;
  layers?: string[];
  providers?: string[];
  presetId?: string;
} {
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : undefined;
  const layers = Array.isArray(input.layers)
    ? input.layers.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
    : undefined;
  const providers = Array.isArray(input.providers)
    ? input.providers.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
    : undefined;
  const presetId = typeof input.presetId === "string" && input.presetId.trim() ? input.presetId.trim() : undefined;
  return {
    ...(name ? { name } : {}),
    ...(layers ? { layers } : {}),
    ...(providers ? { providers } : {}),
    ...(presetId ? { presetId } : {}),
  };
}

function normalizePresetPayload(input: Record<string, unknown>): {
  name: string;
  layers?: string[];
  providers?: string[];
} {
  const payload = normalizeJobConfigPayload(input);
  return {
    name: payload.name ?? "Workbench Preset",
    ...(payload.layers ? { layers: payload.layers } : {}),
    ...(payload.providers ? { providers: payload.providers } : {}),
  };
}

function responseError(error: unknown, status = 400): Response {
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ error: message }, { status });
}

export function startDashboard(input: string | DashboardOptions = REPORTS_DIR): { port: number; stop: () => void } {
  const options = typeof input === "string" ? { reportsDir: input } satisfies DashboardOptions : input;
  const reportsDir = options.reportsDir ?? REPORTS_DIR;
  const runner = options.runner;
  const analyst = options.analyst;
  const planningRepoRoot = resolve(options.planningRepoRoot ?? join(import.meta.dir, "..", ".."));
  const port = options.port ?? PORT;
  const host = options.host ?? HOST;

  const server = Bun.serve<DashboardSocketData>({
    port,
    hostname: host,
    async fetch(req, serverRef) {
      const url = new URL(req.url);

      if (url.pathname === "/api/jobs/ws") {
        if (!runner && !analyst) {
          return Response.json({ error: "Workbench live APIs are unavailable in this mode." }, { status: 503 });
        }
        const upgraded = serverRef.upgrade(req, {
          data: { channel: "jobs" },
        });
        if (upgraded) {
          return undefined;
        }
        return Response.json({ error: "WebSocket upgrade failed." }, { status: 400 });
      }

      if (url.pathname === "/api/reports" && req.method === "GET") {
        return Response.json(await listReports(reportsDir));
      }

      if (url.pathname === "/api/planning/audit" && req.method === "GET") {
        try {
          return Response.json(auditWorkbenchPlanningRepo(planningRepoRoot));
        } catch (error) {
          return responseError(error, 500);
        }
      }

      if (url.pathname.startsWith("/api/planning/tasks/") && req.method === "GET") {
        const queueItemId = decodeURIComponent(url.pathname.slice("/api/planning/tasks/".length));
        const task = await loadPlanningTask(planningRepoRoot, queueItemId);
        if (!task) {
          return Response.json({ error: "Planning task not found" }, { status: 404 });
        }
        return Response.json(task);
      }

      if (url.pathname.startsWith("/api/reports/") && req.method === "GET") {
        const filename = decodeURIComponent(url.pathname.slice("/api/reports/".length));
        const report = await loadReport(filename, reportsDir);
        if (!report) {
          return Response.json({ error: "Report not found" }, { status: 404 });
        }
        return Response.json({
          ...report,
          narrativeSummary: buildReportNarrativeSummary(report),
        });
      }

      if (url.pathname === "/api/jobs/snapshot" && req.method === "GET") {
        if (!runner) return Response.json({ error: "Runner is unavailable in this mode." }, { status: 503 });
        return Response.json(runner.getSnapshot());
      }

      if (url.pathname === "/api/analyst/snapshot" && req.method === "GET") {
        if (!analyst) return Response.json({ error: "Analyst is unavailable in this mode." }, { status: 503 });
        return Response.json(analyst.getSnapshot());
      }

      if (url.pathname === "/api/jobs/presets" && req.method === "GET") {
        if (!runner) return Response.json({ error: "Runner is unavailable in this mode." }, { status: 503 });
        return Response.json(runner.listPresets());
      }

      if (url.pathname === "/api/jobs/presets" && req.method === "POST") {
        if (!runner) return Response.json({ error: "Runner is unavailable in this mode." }, { status: 503 });
        try {
          return Response.json(runner.createPreset(normalizePresetPayload(await jsonBody(req))));
        } catch (error) {
          return responseError(error);
        }
      }

      if (url.pathname.startsWith("/api/jobs/presets/") && !url.pathname.endsWith("/queue") && !url.pathname.endsWith("/run-now")) {
        if (!runner) return Response.json({ error: "Runner is unavailable in this mode." }, { status: 503 });
        const presetId = decodeURIComponent(url.pathname.slice("/api/jobs/presets/".length));
        try {
          if (req.method === "PUT") {
            return Response.json(runner.updatePreset(presetId, normalizePresetPayload(await jsonBody(req))));
          }
          if (req.method === "DELETE") {
            runner.deletePreset(presetId);
            return new Response(null, { status: 204 });
          }
        } catch (error) {
          return responseError(error, 404);
        }
      }

      if (url.pathname.startsWith("/api/jobs/presets/") && url.pathname.endsWith("/queue") && req.method === "POST") {
        if (!runner) return Response.json({ error: "Runner is unavailable in this mode." }, { status: 503 });
        const presetId = decodeURIComponent(url.pathname.slice("/api/jobs/presets/".length, -"/queue".length));
        try {
          return Response.json(runner.queuePresetRun(presetId));
        } catch (error) {
          return responseError(error, 404);
        }
      }

      if (url.pathname.startsWith("/api/jobs/presets/") && url.pathname.endsWith("/run-now") && req.method === "POST") {
        if (!runner) return Response.json({ error: "Runner is unavailable in this mode." }, { status: 503 });
        const presetId = decodeURIComponent(url.pathname.slice("/api/jobs/presets/".length, -"/run-now".length));
        try {
          return Response.json(runner.runPresetNow(presetId));
        } catch (error) {
          return responseError(error, 404);
        }
      }

      if (url.pathname === "/api/jobs/queue" && req.method === "POST") {
        if (!runner) return Response.json({ error: "Runner is unavailable in this mode." }, { status: 503 });
        try {
          return Response.json(runner.queueRun(normalizeJobConfigPayload(await jsonBody(req))));
        } catch (error) {
          return responseError(error);
        }
      }

      if (url.pathname === "/api/jobs/run-now" && req.method === "POST") {
        if (!runner) return Response.json({ error: "Runner is unavailable in this mode." }, { status: 503 });
        try {
          return Response.json(runner.runNow(normalizeJobConfigPayload(await jsonBody(req))));
        } catch (error) {
          return responseError(error);
        }
      }

      if (url.pathname.startsWith("/api/jobs/runs/") && req.method === "GET") {
        if (!runner) return Response.json({ error: "Runner is unavailable in this mode." }, { status: 503 });
        const runId = decodeURIComponent(url.pathname.slice("/api/jobs/runs/".length));
        const detail = runner.getRunDetail(runId);
        if (!detail) {
          return Response.json({ error: "Run not found" }, { status: 404 });
        }
        return Response.json({
          ...detail,
          narrativeSummary: buildRunNarrativeSummary(detail),
        });
      }

      if (url.pathname.startsWith("/api/jobs/runs/") && url.pathname.endsWith("/retry") && req.method === "POST") {
        if (!runner) return Response.json({ error: "Runner is unavailable in this mode." }, { status: 503 });
        const runId = decodeURIComponent(url.pathname.slice("/api/jobs/runs/".length, -"/retry".length));
        try {
          return Response.json(runner.retryRun(runId));
        } catch (error) {
          return responseError(error, 404);
        }
      }

      if (url.pathname.startsWith("/api/jobs/runs/") && url.pathname.endsWith("/cancel") && req.method === "POST") {
        if (!runner) return Response.json({ error: "Runner is unavailable in this mode." }, { status: 503 });
        const runId = decodeURIComponent(url.pathname.slice("/api/jobs/runs/".length, -"/cancel".length));
        try {
          const cancelled = await runner.cancelRun(runId);
          if (!cancelled) {
            return Response.json({ error: "Run not found" }, { status: 404 });
          }
          return Response.json(cancelled);
        } catch (error) {
          return responseError(error, 404);
        }
      }

      if (url.pathname === "/api/analyst/sessions/from-run" && req.method === "POST") {
        if (!analyst) return Response.json({ error: "Analyst is unavailable in this mode." }, { status: 503 });
        const body = await jsonBody(req);
        const runId = typeof body.runId === "string" ? body.runId.trim() : "";
        if (!runId) {
          return Response.json({ error: "runId is required" }, { status: 400 });
        }
        try {
          return Response.json(await analyst.startFromRun({ runId }), { status: 201 });
        } catch (error) {
          return responseError(error);
        }
      }

      if (url.pathname === "/api/analyst/sessions/from-space" && req.method === "POST") {
        if (!analyst) return Response.json({ error: "Analyst is unavailable in this mode." }, { status: 503 });
        const body = await jsonBody(req);
        const spaceId = typeof body.spaceId === "string" ? body.spaceId.trim() : "";
        const rootTurnId = typeof body.rootTurnId === "string" && body.rootTurnId.trim()
          ? body.rootTurnId.trim()
          : undefined;
        if (!spaceId) {
          return Response.json({ error: "spaceId is required" }, { status: 400 });
        }
        try {
          return Response.json(await analyst.startFromSpace({ spaceId, ...(rootTurnId ? { rootTurnId } : {}) }), { status: 201 });
        } catch (error) {
          return responseError(error);
        }
      }

      if (url.pathname.startsWith("/api/analyst/sessions/") && url.pathname.endsWith("/retry") && req.method === "POST") {
        if (!analyst) return Response.json({ error: "Analyst is unavailable in this mode." }, { status: 503 });
        const sessionId = decodeURIComponent(url.pathname.slice("/api/analyst/sessions/".length, -"/retry".length));
        try {
          return Response.json(await analyst.retrySession(sessionId));
        } catch (error) {
          return responseError(error, 404);
        }
      }

      if (url.pathname.startsWith("/api/analyst/sessions/") && url.pathname.endsWith("/cancel") && req.method === "POST") {
        if (!analyst) return Response.json({ error: "Analyst is unavailable in this mode." }, { status: 503 });
        const sessionId = decodeURIComponent(url.pathname.slice("/api/analyst/sessions/".length, -"/cancel".length));
        try {
          const cancelled = await analyst.cancelSession(sessionId);
          if (!cancelled) {
            return Response.json({ error: "Session not found" }, { status: 404 });
          }
          return Response.json(cancelled);
        } catch (error) {
          return responseError(error, 404);
        }
      }

      if (url.pathname.startsWith("/api/analyst/sessions/") && req.method === "GET") {
        if (!analyst) return Response.json({ error: "Analyst is unavailable in this mode." }, { status: 503 });
        const sessionId = decodeURIComponent(url.pathname.slice("/api/analyst/sessions/".length));
        const detail = analyst.getSessionDetail(sessionId);
        if (!detail) {
          return Response.json({ error: "Session not found" }, { status: 404 });
        }
        const sourceRun = runner && detail.sourceRunId ? runner.getRunDetail(detail.sourceRunId) : null;
        return Response.json({
          ...detail,
          ...(sourceRun
            ? {
              sourceRun: {
                id: sourceRun.id,
                status: sourceRun.status,
                overallStatus: sourceRun.overallStatus,
                exitSummary: sourceRun.exitSummary,
                narrativeSummary: buildRunNarrativeSummary(sourceRun),
              },
            }
            : {}),
          narrativeSummary: buildAnalystNarrativeSummary(detail, {
            sourceRun: sourceRun ?? undefined,
          }),
        });
      }

      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(renderDashboardHtml(Boolean(runner), Boolean(analyst), Boolean(planningRepoRoot)), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    },
    websocket: {
      open(ws: ServerWebSocket<DashboardSocketData>) {
        if (!runner && !analyst) {
          ws.close();
          return;
        }
        if (runner) {
          ws.send(JSON.stringify({ type: "snapshot", snapshot: runner.getSnapshot() } satisfies WorkbenchLiveMessage));
          ws.data.unsubscribeRunner = runner.subscribe((message) => {
            ws.send(JSON.stringify(message));
          });
        }
        if (analyst) {
          ws.send(JSON.stringify({ type: "analyst.snapshot", snapshot: analyst.getSnapshot() } satisfies WorkbenchLiveMessage));
          ws.data.unsubscribeAnalyst = analyst.subscribe((message) => {
            if (message.type.startsWith("analyst.")) {
              ws.send(JSON.stringify(message));
            }
          });
        }
      },
      close(ws: ServerWebSocket<DashboardSocketData>) {
        ws.data.unsubscribeRunner?.();
        ws.data.unsubscribeRunner = undefined;
        ws.data.unsubscribeAnalyst?.();
        ws.data.unsubscribeAnalyst = undefined;
      },
    },
  });

  console.log(`  Dashboard running at http://${host}:${server.port}`);

  return {
    port: server.port,
    stop: () => server.stop(),
  };
}

if (import.meta.main) {
  startDashboard();
}
