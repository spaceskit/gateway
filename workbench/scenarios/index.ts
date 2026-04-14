import type { GatewayInstance } from "../../packages/bootstrap/src/index.js";
import type { SchedulerEvalRunPayload } from "../../packages/server/src/protocol/scheduler.js";
import type {
  LayerResult,
  ProviderParityRow,
  ScenarioEvidenceRow,
  ScenarioResult,
  WorkbenchEvalRunRecord,
  WorkbenchComparisonRow,
} from "../report.js";

export interface ScenarioContext {
  gateway: GatewayInstance;
  wsUrl: string;
  httpUrl: string;
  providerParityRows: ProviderParityRow[];
  providerFilters?: Set<string>;
  registerSpace?: (spaceId: string) => void;
  registerTurn?: (spaceId: string, turnId: string) => void;
  recordProviderParityRow?: (row: ProviderParityRow) => void;
  recordSchedulerEvalRun?: (run: WorkbenchEvalRunRecord) => void;
  recordComparison?: (comparison: WorkbenchComparisonRow) => void;
  updateMessage?: (message: string | undefined) => void;
  onLayerStarted?: (layerName: string) => void;
  onLayerCompleted?: (layer: LayerResult) => void;
  onScenarioStarted?: (layerName: string, scenarioName: string) => void;
  onScenarioCompleted?: (layerName: string, scenario: ScenarioResult) => void;
}

export interface ScenarioOutcome {
  evidence?: ScenarioEvidenceRow[];
  schedulerEvalRuns?: SchedulerEvalRunPayload[];
  comparisons?: WorkbenchComparisonRow[];
}

export interface Scenario {
  name: string;
  run: (ctx: ScenarioContext) => Promise<ScenarioOutcome | void>;
}

export class SkipScenarioError extends Error {
  readonly evidence?: ScenarioEvidenceRow[];

  constructor(message: string, evidence?: ScenarioEvidenceRow[]) {
    super(message);
    this.name = "SkipScenarioError";
    this.evidence = evidence;
  }
}

export function skipScenario(message: string, evidence?: ScenarioEvidenceRow[]): never {
  throw new SkipScenarioError(message, evidence);
}

export interface Layer {
  name: string;
  scenarios: Scenario[];
}

export async function runScenario(
  layerName: string,
  scenario: Scenario,
  ctx: ScenarioContext,
): Promise<ScenarioResult> {
  const start = Date.now();
  ctx.onScenarioStarted?.(layerName, scenario.name);
  ctx.updateMessage?.(`Running ${layerName} / ${scenario.name}`);
  let result: ScenarioResult;
  try {
    const outcome = await scenario.run(ctx);
    result = {
      name: scenario.name,
      status: "pass",
      duration_ms: Date.now() - start,
      ...(outcome ?? {}),
    };
  } catch (err) {
    if (err instanceof SkipScenarioError) {
      result = {
        name: scenario.name,
        status: "skip",
        duration_ms: Date.now() - start,
        error: err.message,
        ...(err.evidence ? { evidence: err.evidence } : {}),
      };
    } else {
      result = {
        name: scenario.name,
        status: "fail",
        duration_ms: Date.now() - start,
        error: formatScenarioError(err),
      };
    }
  }
  ctx.onScenarioCompleted?.(layerName, result);
  return result;
}

export async function runLayer(layer: Layer, ctx: ScenarioContext): Promise<LayerResult> {
  const start = Date.now();
  ctx.onLayerStarted?.(layer.name);
  ctx.updateMessage?.(`Running ${layer.name}`);
  const scenarios: ScenarioResult[] = [];
  for (const scenario of layer.scenarios) {
    scenarios.push(await runScenario(layer.name, scenario, ctx));
  }
  const status = scenarios.every((scenario) => scenario.status !== "fail") ? "pass" : "fail";
  const result = { name: layer.name, status, scenarios, duration_ms: Date.now() - start } satisfies LayerResult;
  ctx.onLayerCompleted?.(result);
  return result;
}

export async function runAllLayers(layers: Layer[], ctx: ScenarioContext): Promise<LayerResult[]> {
  const results: LayerResult[] = [];
  for (const layer of layers) {
    results.push(await runLayer(layer, ctx));
  }
  ctx.updateMessage?.(undefined);
  return results;
}

function formatScenarioError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export { chatRoundtripLayer } from "./chat-roundtrip.js";
export { mcpToolsLayer } from "./mcp-tools.js";
export { orchestrationLayer } from "./orchestration.js";
export { providerToolParityLayer } from "./provider-tool-parity.js";
export { templateHandoffLayer } from "./template-handoff.js";
