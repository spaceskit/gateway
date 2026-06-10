import { join } from "node:path";
import { loadSuite } from "./suite.js";
import type {
  WorkbenchScenario,
  WorkbenchScenarioCatalog,
  WorkbenchScenarioLayer,
} from "./types.js";

export const DEFAULT_WORKBENCH_SUITE_ID = "full";
export const DEFAULT_WORKBENCH_SUITE_INDEX_PATH = join(import.meta.dir, "catalog", "suite.json");

export function listWorkbenchScenarios(input: {
  suiteId?: string;
  suiteIndexPath?: string;
} = {}): WorkbenchScenarioCatalog {
  const resolved = loadSuite(
    input.suiteIndexPath ?? DEFAULT_WORKBENCH_SUITE_INDEX_PATH,
    input.suiteId ?? DEFAULT_WORKBENCH_SUITE_ID,
  );
  const layers: WorkbenchScenarioLayer[] = [];
  const scenarios: WorkbenchScenario[] = [];

  for (const domainId of resolved.suite.domain_order) {
    const manifest = resolved.domains.get(domainId);
    if (!manifest) continue;
    const scenarioIds = manifest.scenarios.map((scenario) => scenario.scenario_id);
    layers.push({
      layerId: domainId,
      name: titleize(domainId),
      description: manifest.description,
      scenarioIds,
    });
    for (const scenario of manifest.scenarios) {
      scenarios.push({
        scenarioId: scenario.scenario_id,
        layerId: scenario.domain_id,
        name: scenario.scenario_id === "harness.smoke.noop"
          ? "Deterministic Harness Smoke"
          : titleize(scenario.scenario_id),
        description: scenario.scenario_id === "harness.smoke.noop"
          ? "No-op scenario used to verify gateway-to-runner wiring without external services."
          : undefined,
        tags: scenario.tags,
        requiredCapabilities: scenario.requires,
        defaultEnabled: scenario.blocking || scenario.tags.includes("baseline") || scenario.tags.includes("deterministic"),
      });
    }
  }

  return { layers, scenarios };
}

function titleize(value: string): string {
  return value
    .replaceAll(".", " ")
    .replaceAll("-", " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
