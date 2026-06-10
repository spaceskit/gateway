import {
  DEFAULT_WORKBENCH_SUITE_ID,
  DEFAULT_WORKBENCH_SUITE_INDEX_PATH,
} from "./catalog.js";
import { runWorkbench } from "./core.js";
import { loadSuite } from "./suite.js";
import type {
  AggregateReport,
  CLIOptions,
  ScenarioStatus,
  WorkbenchScenarioRunConfig,
} from "./types.js";

export interface ExecuteWorkbenchScenarioRunOptions {
  config: WorkbenchScenarioRunConfig;
  repoRoot: string;
  suiteId?: string;
  suiteIndexPath?: string;
  reportDir?: string;
  keepRunning?: boolean;
}

export async function executeWorkbenchScenarioRun(
  options: ExecuteWorkbenchScenarioRunOptions,
): Promise<AggregateReport> {
  const suiteId = options.suiteId ?? DEFAULT_WORKBENCH_SUITE_ID;
  const suiteIndexPath = options.suiteIndexPath ?? DEFAULT_WORKBENCH_SUITE_INDEX_PATH;
  const resolved = loadSuite(suiteIndexPath, suiteId);
  const cliOptions: CLIOptions = {
    suiteId,
    domainFilters: options.config.layerIds ?? [],
    scenarioFilters: options.config.scenarioIds ?? [],
    platformFilters: [],
    skipFast: false,
    keepRunning: options.keepRunning ?? false,
    reportDir: options.reportDir,
    jsonPath: undefined,
    junitPath: undefined,
    listOnly: false,
    dryRun: false,
    suiteIndexPath,
    repoRoot: options.repoRoot,
  };
  const report = await runWorkbench(resolved, cliOptions);
  if (!report) {
    throw new Error("Workbench scenario run did not produce a report.");
  }
  return report;
}

export function summarizeScenarioRun(report: AggregateReport): string {
  const counts = countScenarioStatuses(report.scenarios.map((scenario) => scenario.status));
  return [
    `${counts.passed} scenario${counts.passed === 1 ? "" : "s"} passed`,
    `${counts.failed} failed`,
    `${counts.blocked} blocked`,
    `${counts.skipped} skipped`,
  ].join(", ") + ".";
}

export function toScenarioOverallStatus(status: ScenarioStatus): "passed" | "failed" | "blocked" | "skipped" {
  return status;
}

function countScenarioStatuses(statuses: ScenarioStatus[]): Record<ScenarioStatus, number> {
  return {
    passed: statuses.filter((status) => status === "passed").length,
    failed: statuses.filter((status) => status === "failed").length,
    blocked: statuses.filter((status) => status === "blocked").length,
    skipped: statuses.filter((status) => status === "skipped").length,
  };
}
