import type { GatewayInstance } from "../packages/bootstrap/src/index.js";
import {
  chatRoundtripLayer,
  mcpToolsLayer,
  orchestrationLayer,
  providerToolParityLayer,
  runAllLayers,
  templateHandoffLayer,
  type Layer,
  type ScenarioContext,
} from "./scenarios/index.js";
import {
  computeWorkbenchOverallStatus,
  type WorkbenchReport,
  type WorkbenchEvalRunRecord,
  type WorkbenchComparisonRow,
} from "./report.js";

export const WORKBENCH_LAYERS: Layer[] = [
  chatRoundtripLayer,
  mcpToolsLayer,
  providerToolParityLayer,
  orchestrationLayer,
  templateHandoffLayer,
];

export interface ExecuteWorkbenchRunOptions {
  gateway: GatewayInstance;
  wsUrl: string;
  httpUrl: string;
  layerNames?: string[];
  providerFilters?: Set<string>;
  registerSpace?: (spaceId: string) => void;
  registerTurn?: (spaceId: string, turnId: string) => void;
  recordProviderParityRow?: ScenarioContext["recordProviderParityRow"];
  recordSchedulerEvalRun?: ScenarioContext["recordSchedulerEvalRun"];
  recordComparison?: ScenarioContext["recordComparison"];
  updateMessage?: ScenarioContext["updateMessage"];
  onLayerStarted?: ScenarioContext["onLayerStarted"];
  onLayerCompleted?: ScenarioContext["onLayerCompleted"];
  onScenarioStarted?: ScenarioContext["onScenarioStarted"];
  onScenarioCompleted?: ScenarioContext["onScenarioCompleted"];
}

export function buildWorkbenchLayerCatalog(
  layers: Layer[] = WORKBENCH_LAYERS,
): Array<{ name: string; scenarios: string[] }> {
  return layers.map((layer) => ({
    name: layer.name,
    scenarios: layer.scenarios.map((scenario) => scenario.name),
  }));
}

export function selectWorkbenchLayers(layerNames?: string[]): Layer[] {
  if (!layerNames || layerNames.length === 0) {
    return WORKBENCH_LAYERS;
  }
  const requested = new Set(layerNames);
  const available = new Set(WORKBENCH_LAYERS.map((layer) => layer.name));
  const unknown = Array.from(requested).filter((name) => !available.has(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown workbench layers: ${unknown.join(", ")}`);
  }
  return WORKBENCH_LAYERS.filter((layer) => requested.has(layer.name));
}

export async function executeWorkbenchRun(
  options: ExecuteWorkbenchRunOptions,
): Promise<WorkbenchReport> {
  const layers = selectWorkbenchLayers(options.layerNames);
  const providerParityRows = [] as ScenarioContext["providerParityRows"];
  const schedulerEvalRuns: WorkbenchEvalRunRecord[] = [];
  const comparisons: WorkbenchComparisonRow[] = [];
  const start = Date.now();

  const ctx: ScenarioContext = {
    gateway: options.gateway,
    wsUrl: options.wsUrl,
    httpUrl: options.httpUrl,
    providerParityRows,
    ...(options.providerFilters ? { providerFilters: options.providerFilters } : {}),
    ...(options.registerSpace ? { registerSpace: options.registerSpace } : {}),
    ...(options.registerTurn ? { registerTurn: options.registerTurn } : {}),
    recordProviderParityRow: (row) => {
      options.recordProviderParityRow?.(row);
    },
    recordSchedulerEvalRun: (run) => {
      schedulerEvalRuns.push(run);
      options.recordSchedulerEvalRun?.(run);
    },
    recordComparison: (comparison) => {
      comparisons.push(comparison);
      options.recordComparison?.(comparison);
    },
    ...(options.updateMessage ? { updateMessage: options.updateMessage } : {}),
    ...(options.onLayerStarted ? { onLayerStarted: options.onLayerStarted } : {}),
    ...(options.onLayerCompleted ? { onLayerCompleted: options.onLayerCompleted } : {}),
    ...(options.onScenarioStarted ? { onScenarioStarted: options.onScenarioStarted } : {}),
    ...(options.onScenarioCompleted ? { onScenarioCompleted: options.onScenarioCompleted } : {}),
  };

  const layerResults = await runAllLayers(layers, ctx);
  const duration = Date.now() - start;
  const derivedEvalRuns = layerResults.flatMap((layer) =>
    layer.scenarios.flatMap((scenario) => scenario.schedulerEvalRuns ?? []),
  );
  const derivedComparisons = layerResults.flatMap((layer) =>
    layer.scenarios.flatMap((scenario) => scenario.comparisons ?? []),
  );
  const finalSchedulerEvalRuns = dedupeJsonRows([...schedulerEvalRuns, ...derivedEvalRuns]);
  const finalComparisons = dedupeComparisonRows([...comparisons, ...derivedComparisons]);
  const scenarioCount = layerResults.reduce((sum, layer) => sum + layer.scenarios.length, 0);

  return {
    timestamp: new Date().toISOString(),
    duration_ms: duration,
    overall: computeWorkbenchOverallStatus(
      layerResults,
      providerParityRows,
      finalSchedulerEvalRuns,
      finalComparisons,
    ),
    runContext: {
      program: "Autoresearch Eval Workbench Program",
      layerNames: layerResults.map((layer) => layer.name),
      scenarioCount,
      evalRunCount: finalSchedulerEvalRuns.length,
      providerParityCount: providerParityRows.length,
    },
    layers: layerResults,
    ...(providerParityRows.length > 0 ? { providerParity: providerParityRows } : {}),
    ...(finalSchedulerEvalRuns.length > 0 ? { schedulerEvalRuns: finalSchedulerEvalRuns } : {}),
    ...(finalComparisons.length > 0 ? { comparisons: finalComparisons } : {}),
  };
}

function dedupeJsonRows<T>(rows: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const row of rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function dedupeComparisonRows(rows: WorkbenchComparisonRow[]): WorkbenchComparisonRow[] {
  const seen = new Set<string>();
  const deduped: WorkbenchComparisonRow[] = [];
  for (const row of rows) {
    const key = row.comparisonId || JSON.stringify(row);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}
