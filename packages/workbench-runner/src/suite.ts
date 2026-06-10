import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  CLIOptions,
  DomainManifest,
  ResolvedSuite,
  ScenarioManifest,
  SuiteDefinition,
  SuiteIndex,
} from "./types.js";

function jsonParseFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function normalizePath(basePath: string, value: string): string {
  if (value.startsWith("/")) {
    return value;
  }
  return resolve(basePath, value);
}

function findSuite(index: SuiteIndex, suiteId: string): SuiteDefinition {
  const suite = index.suites.find((candidate) => candidate.suite_id === suiteId);
  if (!suite) {
    throw new Error(`Unknown workbench suite: ${suiteId}`);
  }
  return suite;
}

function validateScenario(domainId: string, scenario: ScenarioManifest): void {
  if (scenario.domain_id !== domainId) {
    throw new Error(
      `Scenario ${scenario.scenario_id} declared domain ${scenario.domain_id} but is stored under ${domainId}`,
    );
  }
  for (const requiredField of [
    "domain_id",
    "scenario_id",
    "adapter",
    "order",
    "blocking",
    "platform",
    "requires",
    "tasks",
    "tags",
    "artifacts",
    "config",
  ] as const) {
    if (scenario[requiredField] == null) {
      throw new Error(`Scenario ${scenario.scenario_id} is missing ${requiredField}`);
    }
  }
}

export function loadSuite(indexPath: string, suiteId: string): ResolvedSuite {
  const absoluteIndexPath = resolve(indexPath);
  const indexDir = dirname(absoluteIndexPath);
  const index = jsonParseFile<SuiteIndex>(absoluteIndexPath);
  const suite = findSuite(index, suiteId);
  const domains = new Map<string, DomainManifest>();
  const scenarios = new Map<string, ScenarioManifest>();

  for (const domainId of suite.domain_order) {
    const manifestPathValue = suite.domain_manifests[domainId];
    if (!manifestPathValue) {
      throw new Error(`Suite ${suiteId} is missing a manifest path for domain ${domainId}`);
    }
    const manifestPath = normalizePath(indexDir, manifestPathValue);
    const manifest = jsonParseFile<DomainManifest>(manifestPath);
    if (manifest.domain_id !== domainId) {
      throw new Error(`Domain manifest mismatch for ${domainId}: found ${manifest.domain_id}`);
    }
    domains.set(domainId, manifest);
    for (const scenario of manifest.scenarios) {
      validateScenario(domainId, scenario);
      if (scenarios.has(scenario.scenario_id)) {
        throw new Error(`Duplicate scenario id: ${scenario.scenario_id}`);
      }
      scenarios.set(scenario.scenario_id, scenario);
    }
  }

  return {
    index_path: absoluteIndexPath,
    suite,
    domains,
    scenarios,
  };
}

function scenarioMatchesSuite(suite: SuiteDefinition, scenario: ScenarioManifest): boolean {
  if (!suite.domain_order.includes(scenario.domain_id)) {
    return false;
  }
  if (!suite.include_tags?.length) {
    return true;
  }
  return suite.include_tags.some((tag) => scenario.tags.includes(tag));
}

function addScenarioAndDependencies(
  scenarioId: string,
  resolved: ResolvedSuite,
  bucket: Set<string>,
): void {
  if (bucket.has(scenarioId)) {
    return;
  }
  const scenario = resolved.scenarios.get(scenarioId);
  if (!scenario) {
    throw new Error(`Unknown scenario dependency: ${scenarioId}`);
  }
  bucket.add(scenarioId);
  for (const requiredScenarioId of scenario.requires) {
    addScenarioAndDependencies(requiredScenarioId, resolved, bucket);
  }
}

export function resolveExecutionPlan(resolved: ResolvedSuite, options: CLIOptions): ScenarioManifest[] {
  const suiteCandidates = [...resolved.scenarios.values()].filter((scenario) =>
    scenarioMatchesSuite(resolved.suite, scenario),
  );
  const hasExplicitFilters =
    options.domainFilters.length > 0
    || options.platformFilters.length > 0
    || options.scenarioFilters.length > 0;

  const targeted = suiteCandidates.filter((scenario) => {
    if (options.domainFilters.length && !options.domainFilters.includes(scenario.domain_id)) {
      return false;
    }
    if (options.platformFilters.length && !options.platformFilters.includes(scenario.platform)) {
      return false;
    }
    if (
      options.scenarioFilters.length &&
      !options.scenarioFilters.includes(scenario.scenario_id)
    ) {
      return false;
    }
    return true;
  });

  const selectedIds = new Set<string>();
  const source = hasExplicitFilters ? targeted : suiteCandidates;
  for (const scenario of source) {
    addScenarioAndDependencies(scenario.scenario_id, resolved, selectedIds);
  }

  const domainRank = new Map(
    resolved.suite.domain_order.map((domainId, index) => [domainId, index]),
  );

  return [...selectedIds]
    .map((scenarioId) => resolved.scenarios.get(scenarioId)!)
    .sort((lhs, rhs) => {
      const leftDomainRank = domainRank.get(lhs.domain_id) ?? Number.MAX_SAFE_INTEGER;
      const rightDomainRank = domainRank.get(rhs.domain_id) ?? Number.MAX_SAFE_INTEGER;
      if (leftDomainRank !== rightDomainRank) {
        return leftDomainRank - rightDomainRank;
      }
      if (lhs.order !== rhs.order) {
        return lhs.order - rhs.order;
      }
      return lhs.scenario_id.localeCompare(rhs.scenario_id);
    });
}

export function isFastScenario(scenario: ScenarioManifest): boolean {
  return scenario.tags.includes("fast") || scenario.scenario_id === "infra.fast-preflight";
}
