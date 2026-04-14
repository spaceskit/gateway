import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  SchedulerEvalRunPayload,
} from "../packages/server/src/protocol/scheduler.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface ScenarioEvidenceRow {
  label: string;
  status?: "pass" | "fail" | "skip";
  detail?: Record<string, unknown> | string | number | boolean | null;
}

export interface WorkbenchComparisonRow {
  comparisonId: string;
  label: string;
  status: "pass" | "fail" | "skip";
  summary?: string;
  baseline?: string;
  candidate?: string;
  detail?: Record<string, unknown>;
}

export type WorkbenchEvalRunRecord =
  | SchedulerEvalRunPayload
  | {
    scenarioName: string;
    job: Record<string, unknown>;
    run: Record<string, unknown> & {
      status?: string;
      evalRun?: SchedulerEvalRunPayload;
    };
  };

export interface ScenarioResult {
  name: string;
  status: "pass" | "fail" | "skip";
  duration_ms: number;
  error?: string;
  evidence?: ScenarioEvidenceRow[];
  schedulerEvalRuns?: WorkbenchEvalRunRecord[];
  comparisons?: WorkbenchComparisonRow[];
}

export interface LayerResult {
  name: string;
  status: "pass" | "fail";
  scenarios: ScenarioResult[];
  duration_ms: number;
}

export interface ProviderParityRow {
  scope?: "live" | "metadata";
  provider: string;
  model: string;
  transport: "native" | "bridge" | "mediated" | "mediated_fallback";
  status: "pass" | "fail" | "unavailable";
  observedToolCall?: string;
  observedToolResult?: unknown;
  observedProviderId?: string;
  observedModelId?: string;
  failureReason?: string;
}

export interface WorkbenchRunContext {
  program: string;
  layerNames: string[];
  scenarioCount: number;
  evalRunCount: number;
  providerParityCount: number;
}

export interface WorkbenchReport {
  timestamp: string;
  duration_ms: number;
  overall: "pass" | "fail";
  runContext?: WorkbenchRunContext;
  layers: LayerResult[];
  providerParity?: ProviderParityRow[];
  schedulerEvalRuns?: WorkbenchEvalRunRecord[];
  comparisons?: WorkbenchComparisonRow[];
}

// ── ANSI helpers ───────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";

function statusBadge(status: "pass" | "fail" | "skip"): string {
  switch (status) {
    case "pass":
      return `${GREEN}PASS${RESET}`;
    case "fail":
      return `${RED}FAIL${RESET}`;
    case "skip":
      return `${YELLOW}SKIP${RESET}`;
  }
}

function providerStatusBadge(status: ProviderParityRow["status"]): string {
  switch (status) {
    case "pass":
      return `${GREEN}PASS${RESET}`;
    case "fail":
      return `${RED}FAIL${RESET}`;
    case "unavailable":
      return `${YELLOW}UNAVAILABLE${RESET}`;
  }
}

function pad(text: string, width: number): string {
  const stripped = text.replace(/\x1b\[[0-9;]*m/g, "");
  const diff = width - stripped.length;
  return diff > 0 ? text + " ".repeat(diff) : text;
}

function getNestedSchedulerEvalRun(run: unknown): Partial<SchedulerEvalRunPayload> {
  if (!run || typeof run !== "object") return {};
  const record = run as Record<string, unknown>;
  const nestedRun = record.run;
  if (nestedRun && typeof nestedRun === "object") {
    const nestedRecord = nestedRun as Record<string, unknown>;
    if (nestedRecord.evalRun && typeof nestedRecord.evalRun === "object") {
      return nestedRecord.evalRun as Partial<SchedulerEvalRunPayload>;
    }
    return nestedRun as Partial<SchedulerEvalRunPayload>;
  }
  const evalRun = record.evalRun;
  if (evalRun && typeof evalRun === "object") {
    return evalRun as Partial<SchedulerEvalRunPayload>;
  }
  return run as Partial<SchedulerEvalRunPayload>;
}

function extractRunStatus(run: unknown): string | undefined {
  if (!run || typeof run !== "object") return undefined;
  const record = run as Record<string, unknown>;
  if (typeof record.status === "string") {
    return record.status;
  }
  const nestedRun = record.run;
  if (nestedRun && typeof nestedRun === "object" && typeof (nestedRun as Record<string, unknown>).status === "string") {
    return String((nestedRun as Record<string, unknown>).status);
  }
  return undefined;
}

function isSuccessfulRunStatus(status: string | undefined): boolean {
  return status === undefined || status === "pass" || status === "completed";
}

function hasFailingSchedulerEvalRun(run: unknown): boolean {
  const status = extractRunStatus(run);
  if (status !== undefined && !isSuccessfulRunStatus(status)) {
    return true;
  }

  const evalRun = getNestedSchedulerEvalRun(run);
  const scenarioResults = Array.isArray(evalRun.scenarioResults) ? evalRun.scenarioResults : [];
  const checkpoints = Array.isArray(evalRun.checkpoints) ? evalRun.checkpoints : [];
  return scenarioResults.some((scenario) => scenario?.status === "fail")
    || checkpoints.some((checkpoint) => checkpoint?.status === "failed");
}

function summarizeSchedulerEvalRun(run: unknown): {
  status: "pass" | "fail";
  checkpointCount: number;
  failureCount: number;
  recommendationCount: number;
  finalSummaryText?: string;
} {
  const evalRun = getNestedSchedulerEvalRun(run);
  const scenarioResults = Array.isArray(evalRun.scenarioResults) ? evalRun.scenarioResults : [];
  const checkpoints = Array.isArray(evalRun.checkpoints) ? evalRun.checkpoints : [];
  const recommendations = Array.isArray(evalRun.recommendations) ? evalRun.recommendations : [];
  const failureCount = scenarioResults.filter((scenario) => scenario?.status === "fail").length
    + checkpoints.filter((checkpoint) => checkpoint?.status === "failed").length;
  return {
    status: hasFailingSchedulerEvalRun(run) ? "fail" : "pass",
    checkpointCount: checkpoints.length,
    failureCount,
    recommendationCount: recommendations.length,
    finalSummaryText: evalRun.finalSummaryText,
  };
}

export function computeWorkbenchOverallStatus(
  layers: LayerResult[],
  providerParity: ProviderParityRow[] = [],
  schedulerEvalRuns: WorkbenchEvalRunRecord[] = [],
  comparisons: WorkbenchComparisonRow[] = [],
): WorkbenchReport["overall"] {
  const layersPass = layers.every((layer) => layer.status === "pass");
  const providerParityPass = providerParity.every((row) => row.status !== "fail");
  const schedulerEvalPass = schedulerEvalRuns.every((run) => !hasFailingSchedulerEvalRun(run));
  const comparisonPass = comparisons.every((row) => row.status !== "fail");
  return layersPass && providerParityPass && schedulerEvalPass && comparisonPass ? "pass" : "fail";
}

// ── Console report ─────────────────────────────────────────────────────

export function printConsoleReport(report: WorkbenchReport): void {
  const innerWidth = 64;

  const top = `╭${"─".repeat(innerWidth)}╮`;
  const bot = `╰${"─".repeat(innerWidth)}╯`;
  const sep = `├${"─".repeat(innerWidth)}┤`;
  const line = (content: string) => `│ ${pad(content, innerWidth - 2)} │`;

  const overallColor = report.overall === "pass" ? GREEN : RED;

  console.log("");
  console.log(top);
  console.log(
    line(
      `${BOLD}${WHITE}Workbench Report${RESET}  ${overallColor}${BOLD}${report.overall.toUpperCase()}${RESET}`,
    ),
  );
  console.log(
    line(
      `${DIM}${report.timestamp}  ${report.duration_ms}ms${RESET}`,
    ),
  );
  if (report.runContext) {
    console.log(
      line(
        `${DIM}${report.runContext.program}  ${report.runContext.layerNames.length} layers · ${report.runContext.scenarioCount} scenarios · ${report.runContext.evalRunCount} eval runs${RESET}`,
      ),
    );
  }
  console.log(sep);

  for (const layer of report.layers) {
    const layerColor = layer.status === "pass" ? GREEN : RED;
    const passed = layer.scenarios.filter((s) => s.status === "pass").length;
    const failed = layer.scenarios.filter((s) => s.status === "fail").length;
    const skipped = layer.scenarios.filter((s) => s.status === "skip").length;

    console.log(
      line(
        `${layerColor}${BOLD}${layer.status === "pass" ? "✓" : "✗"}${RESET} ${BOLD}${layer.name}${RESET}  ${DIM}${layer.duration_ms}ms${RESET}`,
      ),
    );

    const counts: string[] = [];
    if (passed > 0) counts.push(`${GREEN}${passed} passed${RESET}`);
    if (failed > 0) counts.push(`${RED}${failed} failed${RESET}`);
    if (skipped > 0) counts.push(`${YELLOW}${skipped} skipped${RESET}`);
    console.log(line(`  ${counts.join(`${DIM} · ${RESET}`)}`));

    for (const scenario of layer.scenarios) {
      const icon =
        scenario.status === "pass"
          ? `${GREEN}✓${RESET}`
          : scenario.status === "fail"
            ? `${RED}✗${RESET}`
            : `${YELLOW}−${RESET}`;
      console.log(
        line(
          `  ${icon} ${scenario.name}  ${DIM}${scenario.duration_ms}ms${RESET}`,
        ),
      );
      if (scenario.error) {
        console.log(line(`    ${RED}${scenario.error}${RESET}`));
      }
    }

    if (layer !== report.layers[report.layers.length - 1]) {
      console.log(sep);
    }
  }

  if (report.providerParity && report.providerParity.length > 0) {
    console.log(sep);
    console.log(line(`${CYAN}${BOLD}Provider Tool Parity${RESET}`));

    for (const row of report.providerParity) {
      const displayModel = row.model.startsWith(`${row.provider}/`)
        ? row.model
        : `${row.provider}/${row.model}`;
      console.log(
        line(
          `${providerStatusBadge(row.status)} ${displayModel} ${DIM}[${row.transport}${row.scope ? ` · ${row.scope}` : ""}]${RESET}`,
        ),
      );
      if (row.observedToolCall) {
        console.log(line(`  tool: ${row.observedToolCall}`));
      }
      if (row.observedProviderId || row.observedModelId) {
        const observedProvider = row.observedProviderId?.trim() || "unknown";
        const observedModel = row.observedModelId?.trim()
          || (row.observedProviderId?.trim() ? `${row.observedProviderId.trim()}/unknown` : "unknown");
        console.log(line(`  observed: ${observedModel.startsWith(`${observedProvider}/`) ? observedModel : `${observedProvider}/${observedModel}`}`));
      }
      if (row.failureReason) {
        console.log(line(`  ${RED}${row.failureReason}${RESET}`));
      }
    }
  }

  if (report.schedulerEvalRuns && report.schedulerEvalRuns.length > 0) {
    console.log(sep);
    console.log(line(`${CYAN}${BOLD}Scheduler Eval Runs${RESET}`));

    for (const run of report.schedulerEvalRuns) {
      const summary = summarizeSchedulerEvalRun(run);
      const scenarioSummary = run.scenarioResults
        .map((scenario) => `${scenario.status === "pass" ? GREEN : scenario.status === "skip" ? YELLOW : RED}${scenario.scenarioId}${RESET}`)
        .join(`${DIM}, ${RESET}`);
      console.log(
        line(
          `${summary.status === "pass" ? GREEN : RED}${BOLD}${summary.status === "pass" ? "✓" : "✗"}${RESET} ${BOLD}${run.evalDefinitionId}${RESET}  ${DIM}${run.summaryMode}${RESET}`,
        ),
      );
      console.log(
        line(
          `  ${DIM}${run.evalRunId}${RESET}  ${summary.checkpointCount} checkpoints · ${run.scenarioResults.length} scenarios · ${summary.recommendationCount} recommendations`,
        ),
      );
      if (run.finalSummaryText) {
        console.log(line(`  summary: ${run.finalSummaryText}`));
      }
      if (scenarioSummary) {
        console.log(line(`  scenarios: ${scenarioSummary}`));
      }
      for (const checkpoint of run.checkpoints) {
        const checkpointBadge =
          checkpoint.status === "completed"
            ? GREEN
            : checkpoint.status === "observed"
              ? CYAN
              : RED;
        console.log(
          line(
            `  ${checkpointBadge}${checkpoint.status}${RESET} ${checkpoint.kind}  ${DIM}${checkpoint.actorId ?? "system"}${checkpoint.createdAt ? ` · ${checkpoint.createdAt}` : ""}${RESET}`,
          ),
        );
      }
      for (const recommendation of run.recommendations) {
        const recommendationBadge = recommendation.status === "applied" ? GREEN : YELLOW;
        console.log(
          line(
            `  ${recommendationBadge}${recommendation.kind}${RESET} ${recommendation.title}`,
          ),
        );
        if (recommendation.summary) {
          console.log(line(`    ${DIM}${recommendation.summary}${RESET}`));
        }
      }
    }
  }

  if (report.comparisons && report.comparisons.length > 0) {
    console.log(sep);
    console.log(line(`${CYAN}${BOLD}Comparisons${RESET}`));
    for (const comparison of report.comparisons) {
      const comparisonBadge =
        comparison.status === "pass"
          ? GREEN
          : comparison.status === "skip"
            ? YELLOW
            : RED;
      console.log(
        line(
          `  ${comparisonBadge}${comparison.status}${RESET} ${comparison.label}`,
        ),
      );
      if (comparison.summary) {
        console.log(line(`    ${DIM}${comparison.summary}${RESET}`));
      }
      if (comparison.baseline || comparison.candidate) {
        console.log(
          line(
            `    ${DIM}${comparison.baseline ?? "baseline"} → ${comparison.candidate ?? "candidate"}${RESET}`,
          ),
        );
      }
    }
  }

  console.log(bot);
  console.log("");
}

// ── JSON report persistence ────────────────────────────────────────────

export async function saveJsonReport(
  report: WorkbenchReport,
  reportsDir: string,
): Promise<string> {
  await mkdir(reportsDir, { recursive: true });

  const ts = report.timestamp.replace(/:/g, "-");
  const filename = `${ts}.json`;
  const filepath = join(reportsDir, filename);

  await writeFile(filepath, JSON.stringify(report, null, 2), "utf-8");

  return filepath;
}
