import { describe, expect, test } from "bun:test";
import { SchedulerEvalCatalogService } from "../src/services/scheduler-eval-catalog-service.js";

describe("SchedulerEvalCatalogService", () => {
  test("loads suite-backed eval definitions from the repo workbench manifests", async () => {
    const service = new SchedulerEvalCatalogService();

    const definitions = await service.listDefinitions();
    const fullSuite = definitions.find((definition) => definition.evalDefinitionId === "suite:full");

    expect(definitions.length).toBeGreaterThan(0);
    expect(fullSuite).toBeDefined();
    expect(fullSuite?.scenarioIds).toContain("space-interactions.in-process-combined-smoke");
    expect(fullSuite?.domains.some((domain) => domain.domainId === "summarization")).toBe(true);
  });
});
