import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { buildReportNarrativeListSummary } from "./dashboard-summary.js";
import type { WorkbenchReport } from "./report.js";

export interface ReportSummary {
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
  planningTasksRoot?: string;
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

export async function listReports(reportsDir: string): Promise<ReportSummary[]> {
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

export async function loadReport(filename: string, reportsDir: string): Promise<WorkbenchReport | null> {
  if (filename.includes("..") || filename.includes("/")) return null;
  try {
    return await Bun.file(join(reportsDir, filename)).json();
  } catch {
    return null;
  }
}

export async function loadPlanningTask(
  tasksRoot: string,
  queueItemId: string,
): Promise<{ queueItemId: string; taskFilePath: string; markdown: string } | null> {
  if (isPathTraversalId(queueItemId)) return null;
  const taskPaths = await indexPlanningTaskFiles(tasksRoot);
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

function isPathTraversalId(queueItemId: string): boolean {
  return queueItemId
    .split(/[\\/]+/)
    .some((segment) => segment === "..");
}

function parsePlanningTaskId(markdown: string): string | null {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) return null;
  for (const line of frontmatter[1].split(/\r?\n/)) {
    const match = line.match(/^id:\s*(.+?)\s*$/);
    if (!match) continue;
    return match[1].replace(/^['"]|['"]$/g, "").trim() || null;
  }
  return null;
}

async function indexPlanningTaskFiles(tasksRoot: string): Promise<Map<string, string>> {
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
        try {
          const taskId = parsePlanningTaskId(await readFile(fullPath, "utf8"));
          if (taskId) {
            result.set(taskId.toLowerCase(), fullPath);
          }
        } catch {
          continue;
        }
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
