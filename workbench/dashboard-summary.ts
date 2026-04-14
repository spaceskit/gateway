import type {
  WorkbenchAnalystSessionDetail,
  WorkbenchJobRunDetail,
  WorkbenchJobRunStatus,
} from "./runner-protocol.js";
import type {
  ProviderParityRow,
  WorkbenchComparisonRow,
  WorkbenchEvalRunRecord,
  WorkbenchReport,
} from "./report.js";

export interface WorkbenchNarrativeCounts {
  layerCount: number;
  scenarioCount: number;
  failedScenarios: number;
  failedProviderChecks: number;
  schedulerEvalPayloads: number;
}

export interface WorkbenchRunNarrativeSummary {
  headline: string;
  humanStatusLabel: string;
  primaryFailures: string[];
  passedAreas: string[];
  nextActions: string[];
  activityLabel: string;
  counts: WorkbenchNarrativeCounts;
}

export interface WorkbenchReportNarrativeSummary extends WorkbenchRunNarrativeSummary {}

export interface WorkbenchAnalystNarrativeSummary {
  headline: string;
  humanStatusLabel: string;
  sourceRunStatusLabel?: string;
  diagnosisResult: string;
  primaryFailures: string[];
  nextActions: string[];
}

export interface WorkbenchReportNarrativeListSummary {
  failedScenarios: number;
  failedProviderChecks: number;
  headline: string;
  humanStatusLabel: string;
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

function countScenarioFailuresFromLayers(
  layers: Array<{ scenarios?: Array<{ status: "pending" | "pass" | "fail" | "skip" }> }>,
): number {
  return layers.reduce(
    (sum, layer) => sum + (layer.scenarios ?? []).filter((scenario) => scenario.status === "fail").length,
    0,
  );
}

function countProviderFailures(rows: ProviderParityRow[] = []): number {
  return rows.filter((row) => row.status === "fail").length;
}

function countEvalPayloads(evalRuns: WorkbenchEvalRunRecord[] = []): number {
  return evalRuns.length;
}

function failingLayerNames(
  layers: Array<{ name: string; status: "pending" | "pass" | "fail" }>,
): string[] {
  return layers.filter((layer) => layer.status === "fail").map((layer) => layer.name);
}

function passedLayerNames(
  layers: Array<{ name: string; status: "pending" | "pass" | "fail" }>,
): string[] {
  return layers.filter((layer) => layer.status === "pass").map((layer) => layer.name);
}

function buildProviderFailureMessages(rows: ProviderParityRow[] = []): string[] {
  return rows
    .filter((row) => row.status === "fail")
    .map((row) => `${row.provider}/${row.model}: ${row.failureReason ?? "Provider parity check failed."}`);
}

function buildScenarioFailureMessages(
  layers: Array<{
    name: string;
    scenarios?: Array<{ name: string; status: "pending" | "pass" | "fail" | "skip"; error?: string }>;
  }>,
): string[] {
  const messages: string[] = [];
  for (const layer of layers) {
    for (const scenario of layer.scenarios ?? []) {
      if (scenario.status !== "fail") {
        continue;
      }
      if (scenario.error?.trim()) {
        messages.push(`${layer.name}/${scenario.name}: ${scenario.error.trim()}`);
      } else {
        messages.push(`${layer.name}/${scenario.name}: Scenario failed.`);
      }
    }
  }
  return messages;
}

function buildComparisonFailureMessages(comparisons: WorkbenchComparisonRow[] = []): string[] {
  return comparisons
    .filter((comparison) => comparison.status === "fail")
    .map((comparison) => `${comparison.label}: ${comparison.summary ?? "Comparison failed."}`);
}

function buildEvalFailureMessages(evalRuns: WorkbenchEvalRunRecord[] = []): string[] {
  const messages: string[] = [];
  for (const record of evalRuns) {
    const resolved = resolveEvalRunRecord(record);
    const label = typeof resolved.evalDefinitionId === "string"
      ? resolved.evalDefinitionId
      : typeof resolved.evalRunId === "string"
        ? resolved.evalRunId
        : "scheduler eval";
    const scenarioResults = Array.isArray(resolved.scenarioResults)
      ? resolved.scenarioResults as Array<Record<string, unknown>>
      : [];
    const checkpoints = Array.isArray(resolved.checkpoints)
      ? resolved.checkpoints as Array<Record<string, unknown>>
      : [];

    for (const scenario of scenarioResults) {
      if (scenario.status === "fail") {
        messages.push(`${label}/${String(scenario.scenarioId ?? "scenario")}: ${String(scenario.failureReason ?? "Eval scenario failed.")}`);
      }
    }

    for (const checkpoint of checkpoints) {
      if (checkpoint.status === "failed") {
        messages.push(`${label}/${String(checkpoint.kind ?? "checkpoint")}: ${String(checkpoint.detail ?? "Checkpoint failed.")}`);
      }
    }
  }
  return messages;
}

function buildHeadline(status: "pass" | "fail" | WorkbenchJobRunStatus, failedLayers: string[]): string {
  if (status === "pass" || status === "completed") {
    return "Run passed";
  }
  if (status === "fail" || status === "failed") {
    if (failedLayers.length === 1) {
      return `Run failed in ${failedLayers[0]}`;
    }
    if (failedLayers.length > 1) {
      return `Run failed in ${failedLayers.join(", ")}`;
    }
    return "Run failed";
  }
  if (status === "queued") return "Run queued";
  if (status === "starting") return "Run starting";
  if (status === "running") return "Run running";
  if (status === "cancelling") return "Run cancelling";
  if (status === "cancelled") return "Run cancelled";
  if (status === "interrupted") return "Run interrupted";
  return "Run status unavailable";
}

function buildRunStatusLabel(status: "pass" | "fail" | WorkbenchJobRunStatus): string {
  switch (status) {
    case "pass":
    case "completed":
      return "Passed";
    case "fail":
    case "failed":
      return "Failed checks";
    case "queued":
      return "Queued";
    case "starting":
      return "Starting";
    case "running":
      return "Running";
    case "cancelling":
      return "Cancelling";
    case "cancelled":
      return "Cancelled";
    case "interrupted":
      return "Interrupted";
  }
}

function buildRunActivityLabel(
  status: WorkbenchJobRunStatus,
  activeScenarioName?: string,
  activeLayerName?: string,
): string {
  if (status === "running" || status === "starting" || status === "cancelling") {
    if (activeScenarioName?.trim()) {
      return activeScenarioName;
    }
    if (activeLayerName?.trim()) {
      return `${activeLayerName} running`;
    }
    return "in progress";
  }
  return "run finished";
}

function buildRunFailureMessages(input: {
  layers: Array<{ name: string; scenarios?: Array<{ name: string; status: "pending" | "pass" | "fail" | "skip"; error?: string }> }>;
  providerParity?: ProviderParityRow[];
  schedulerEvalRuns?: WorkbenchEvalRunRecord[];
  comparisons?: WorkbenchComparisonRow[];
}): string[] {
  const providerFailures = buildProviderFailureMessages(input.providerParity);
  const scenarioFailures = buildScenarioFailureMessages(input.layers);
  const comparisonFailures = buildComparisonFailureMessages(input.comparisons);
  const evalFailures = buildEvalFailureMessages(input.schedulerEvalRuns);

  if (providerFailures.length > 0) {
    const nonParityScenarioFailures = scenarioFailures.filter((message) => !message.startsWith("provider-tool-parity/"));
    return [...providerFailures, ...nonParityScenarioFailures, ...comparisonFailures, ...evalFailures];
  }
  if (scenarioFailures.length > 0) {
    return [...scenarioFailures, ...comparisonFailures, ...evalFailures];
  }
  if (comparisonFailures.length > 0) {
    return [...comparisonFailures, ...evalFailures];
  }
  return evalFailures;
}

export function buildRunNarrativeSummary(detail: WorkbenchJobRunDetail): WorkbenchRunNarrativeSummary {
  const layers = detail.snapshot.layers ?? [];
  const providerParity = detail.snapshot.providerParity ?? [];
  const schedulerEvalRuns = detail.snapshot.schedulerEvalRuns ?? [];
  const comparisons = detail.snapshot.comparisons ?? [];
  const failedLayers = failingLayerNames(layers);
  const effectiveStatus = detail.overallStatus === "fail" ? "fail" : detail.status;

  return {
    headline: buildHeadline(effectiveStatus, failedLayers),
    humanStatusLabel: buildRunStatusLabel(effectiveStatus),
    primaryFailures: buildRunFailureMessages({
      layers,
      providerParity,
      schedulerEvalRuns,
      comparisons,
    }),
    passedAreas: passedLayerNames(layers),
    nextActions: [
      ...(detail.status === "completed" || detail.status === "failed" || detail.status === "cancelled" || detail.status === "interrupted"
        ? ["Retry run"]
        : []),
      ...(detail.reportFilename ? ["Open report"] : []),
      ...(detail.status === "completed" || detail.status === "failed" ? ["Analyze run"] : []),
    ],
    activityLabel: buildRunActivityLabel(detail.status, detail.snapshot.activeScenarioName, detail.snapshot.activeLayerName),
    counts: {
      layerCount: layers.length,
      scenarioCount: layers.reduce((sum, layer) => sum + (layer.scenarios?.length ?? 0), 0),
      failedScenarios: countScenarioFailuresFromLayers(layers),
      failedProviderChecks: countProviderFailures(providerParity),
      schedulerEvalPayloads: countEvalPayloads(schedulerEvalRuns),
    },
  };
}

export function buildReportNarrativeSummary(report: WorkbenchReport): WorkbenchReportNarrativeSummary {
  const failedLayers = failingLayerNames(
    report.layers.map((layer) => ({
      name: layer.name,
      status: layer.status,
    })),
  );
  return {
    headline: buildHeadline(report.overall, failedLayers),
    humanStatusLabel: buildRunStatusLabel(report.overall),
    primaryFailures: buildRunFailureMessages({
      layers: report.layers.map((layer) => ({
        name: layer.name,
        scenarios: layer.scenarios.map((scenario) => ({
          name: scenario.name,
          status: scenario.status,
          error: scenario.error,
        })),
      })),
      providerParity: report.providerParity,
      schedulerEvalRuns: report.schedulerEvalRuns,
      comparisons: report.comparisons,
    }),
    passedAreas: passedLayerNames(report.layers.map((layer) => ({
      name: layer.name,
      status: layer.status,
    }))),
    nextActions: report.overall === "fail"
      ? ["Retry from Jobs", "Analyze from Jobs"]
      : ["Queue a new run from Jobs"],
    activityLabel: "run finished",
    counts: {
      layerCount: report.layers.length,
      scenarioCount: report.layers.reduce((sum, layer) => sum + layer.scenarios.length, 0),
      failedScenarios: report.layers.reduce(
        (sum, layer) => sum + layer.scenarios.filter((scenario) => scenario.status === "fail").length,
        0,
      ),
      failedProviderChecks: countProviderFailures(report.providerParity),
      schedulerEvalPayloads: countEvalPayloads(report.schedulerEvalRuns),
    },
  };
}

export function buildReportNarrativeListSummary(report: WorkbenchReport): WorkbenchReportNarrativeListSummary {
  const narrative = buildReportNarrativeSummary(report);
  return {
    failedScenarios: narrative.counts.failedScenarios,
    failedProviderChecks: narrative.counts.failedProviderChecks,
    headline: narrative.headline,
    humanStatusLabel: narrative.humanStatusLabel,
  };
}

function buildAnalystHeadline(
  detail: WorkbenchAnalystSessionDetail,
  sourceRun?: WorkbenchJobRunDetail,
): string {
  if (detail.sourceType === "run" && detail.sourceRunId) {
    const prefix = sourceRun?.status === "failed" || sourceRun?.overallStatus === "fail" ? "failed run" : "run";
    return `Diagnosis of ${prefix} ${detail.sourceRunId}`;
  }
  return `Diagnosis of space ${detail.sourceSpaceId}`;
}

function buildAnalystStatusLabel(detail: WorkbenchAnalystSessionDetail): string {
  if (detail.status === "completed" && detail.proposal) {
    return "Fix proposal created";
  }
  switch (detail.status) {
    case "queued":
      return "Queued";
    case "starting":
      return "Starting diagnosis";
    case "running":
      return detail.phase === "gathering_context"
        ? "Gathering context"
        : detail.phase === "reproducing"
          ? "Reproducing issue"
          : detail.phase === "analyzing"
            ? "Analyzing evidence"
            : detail.phase === "drafting_fix"
              ? "Drafting fix proposal"
              : "Waiting for input";
    case "input_required":
      return "Waiting for input";
    case "cancelling":
      return "Cancelling diagnosis";
    case "cancelled":
      return "Diagnosis cancelled";
    case "completed":
      return "Diagnosis completed";
    case "failed":
      return "Diagnosis failed";
    case "interrupted":
      return "Diagnosis interrupted";
  }
}

export function buildAnalystNarrativeSummary(
  detail: WorkbenchAnalystSessionDetail,
  input: {
    sourceRun?: WorkbenchJobRunDetail;
  } = {},
): WorkbenchAnalystNarrativeSummary {
  const diagnosisResult = detail.proposal?.summary
    ?? detail.exitSummary
    ?? detail.snapshot.message
    ?? buildAnalystStatusLabel(detail);
  return {
    headline: buildAnalystHeadline(detail, input.sourceRun),
    humanStatusLabel: buildAnalystStatusLabel(detail),
    sourceRunStatusLabel: input.sourceRun?.status,
    diagnosisResult,
    primaryFailures:
      detail.status === "failed" || detail.status === "interrupted" || detail.status === "cancelled" || detail.status === "input_required"
        ? (detail.exitSummary ? [detail.exitSummary] : [])
        : [],
    nextActions: [
      ...(detail.proposal ? ["Review fix proposal"] : []),
      ...(
        detail.status === "completed"
        || detail.status === "failed"
        || detail.status === "cancelled"
        || detail.status === "interrupted"
        || detail.status === "input_required"
          ? ["Retry diagnosis"]
          : []
      ),
    ],
  };
}
