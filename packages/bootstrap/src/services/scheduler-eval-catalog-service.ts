import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface SchedulerEvalCatalogDomain {
  domainId: string;
  description?: string;
  scenarioIds: string[];
}

export interface SchedulerEvalCatalogDefinition {
  evalDefinitionId: string;
  suiteId: string;
  description?: string;
  domainIds: string[];
  scenarioIds: string[];
  domains: SchedulerEvalCatalogDomain[];
}

interface SuiteIndex {
  version: number;
  default_suite?: string;
  suites: Array<{
    suite_id: string;
    description?: string;
    domain_order?: string[];
    domain_manifests?: Record<string, string>;
  }>;
}

interface DomainManifest {
  domain_id: string;
  description?: string;
  scenarios?: Array<{
    scenario_id: string;
  }>;
}

export interface SchedulerEvalCatalogServiceOptions {
  suiteIndexPath?: string;
}

export class SchedulerEvalCatalogService {
  private readonly suiteIndexPath: string;
  private definitionsPromise: Promise<SchedulerEvalCatalogDefinition[]> | null = null;

  constructor(options: SchedulerEvalCatalogServiceOptions = {}) {
    this.suiteIndexPath = options.suiteIndexPath
      ?? resolve(import.meta.dir, "../../../../../dev-services/workbench/suite.json");
  }

  async listDefinitions(): Promise<SchedulerEvalCatalogDefinition[]> {
    if (!this.definitionsPromise) {
      this.definitionsPromise = this.loadDefinitions();
    }
    return this.definitionsPromise;
  }

  async getDefinition(evalDefinitionId: string): Promise<SchedulerEvalCatalogDefinition | null> {
    const definitions = await this.listDefinitions();
    return definitions.find((definition) => definition.evalDefinitionId === evalDefinitionId) ?? null;
  }

  private async loadDefinitions(): Promise<SchedulerEvalCatalogDefinition[]> {
    const suiteIndex = JSON.parse(await readFile(this.suiteIndexPath, "utf8")) as SuiteIndex;
    const baseDir = resolve(this.suiteIndexPath, "..");
    const definitions: SchedulerEvalCatalogDefinition[] = [];

    for (const suite of suiteIndex.suites ?? []) {
      const domains: SchedulerEvalCatalogDomain[] = [];
      const scenarioIds: string[] = [];
      for (const domainId of suite.domain_order ?? []) {
        const manifestPath = suite.domain_manifests?.[domainId];
        if (!manifestPath) continue;
        const absoluteManifestPath = resolve(baseDir, manifestPath);
        const manifest = JSON.parse(await readFile(absoluteManifestPath, "utf8")) as DomainManifest;
        const domainScenarioIds = (manifest.scenarios ?? [])
          .map((scenario) => scenario.scenario_id?.trim())
          .filter((scenarioId): scenarioId is string => Boolean(scenarioId));
        scenarioIds.push(...domainScenarioIds);
        domains.push({
          domainId: manifest.domain_id,
          description: manifest.description?.trim() || undefined,
          scenarioIds: domainScenarioIds,
        });
      }
      definitions.push({
        evalDefinitionId: `suite:${suite.suite_id}`,
        suiteId: suite.suite_id,
        description: suite.description?.trim() || undefined,
        domainIds: domains.map((domain) => domain.domainId),
        scenarioIds,
        domains,
      });
    }

    return definitions;
  }
}
