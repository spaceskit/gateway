import type { GatewayInstance } from "../../packages/bootstrap/src/index.js";
import type { LayerResult, ProviderParityRow, ScenarioResult } from "../report.js";

export interface ScenarioContext {
  gateway: GatewayInstance;
  wsUrl: string;
  httpUrl: string;
  providerParityRows: ProviderParityRow[];
  providerFilters?: Set<string>;
}

export interface Scenario {
  name: string;
  run: (ctx: ScenarioContext) => Promise<void>;
}

export interface Layer {
  name: string;
  scenarios: Scenario[];
}

export async function runScenario(scenario: Scenario, ctx: ScenarioContext): Promise<ScenarioResult> {
  const start = Date.now();
  try {
    await scenario.run(ctx);
    return { name: scenario.name, status: "pass", duration_ms: Date.now() - start };
  } catch (err) {
    return {
      name: scenario.name,
      status: "fail",
      duration_ms: Date.now() - start,
      error: formatScenarioError(err),
    };
  }
}

export async function runLayer(layer: Layer, ctx: ScenarioContext): Promise<LayerResult> {
  const start = Date.now();
  const scenarios: ScenarioResult[] = [];
  for (const scenario of layer.scenarios) {
    scenarios.push(await runScenario(scenario, ctx));
  }
  const status = scenarios.every(s => s.status === "pass") ? "pass" : "fail";
  return { name: layer.name, status, scenarios, duration_ms: Date.now() - start };
}

export async function runAllLayers(layers: Layer[], ctx: ScenarioContext): Promise<LayerResult[]> {
  const results: LayerResult[] = [];
  for (const layer of layers) {
    results.push(await runLayer(layer, ctx));
  }
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
