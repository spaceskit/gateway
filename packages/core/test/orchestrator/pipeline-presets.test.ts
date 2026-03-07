import { describe, expect, test } from "bun:test";
import {
  validatePipelinePreset,
  getNextStages,
} from "../../src/orchestrator/pipeline-presets.js";
import type { PipelinePreset, PipelineStage } from "../../src/orchestrator/pipeline-presets.js";

function makePreset(overrides?: Partial<PipelinePreset>): PipelinePreset {
  return {
    presetId: "p1",
    name: "Test Pipeline",
    description: "A test pipeline",
    stages: [
      { stageId: "s1", name: "Plan", order: 1, agentRole: "planner", description: "Planning", dependsOnStageIds: [] },
      { stageId: "s2", name: "Execute", order: 2, agentRole: "executor", description: "Execution", dependsOnStageIds: ["s1"] },
      { stageId: "s3", name: "Review", order: 3, agentRole: "reviewer", description: "Review", dependsOnStageIds: ["s2"] },
    ],
    createdAt: "2026-02-28T00:00:00.000Z",
    ...overrides,
  };
}

describe("validatePipelinePreset", () => {
  test("valid preset passes", () => {
    const result = validatePipelinePreset(makePreset());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("empty name fails", () => {
    const result = validatePipelinePreset(makePreset({ name: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("name is required");
  });

  test("no stages fails", () => {
    const result = validatePipelinePreset(makePreset({ stages: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Pipeline must have at least one stage");
  });

  test("duplicate stageIds fails", () => {
    const stages: PipelineStage[] = [
      { stageId: "s1", name: "A", order: 1, agentRole: "planner", description: "A", dependsOnStageIds: [] },
      { stageId: "s1", name: "B", order: 2, agentRole: "executor", description: "B", dependsOnStageIds: [] },
    ];
    const result = validatePipelinePreset(makePreset({ stages }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Duplicate stageIds"))).toBe(true);
  });

  test("unknown dependency fails", () => {
    const stages: PipelineStage[] = [
      { stageId: "s1", name: "A", order: 1, agentRole: "planner", description: "A", dependsOnStageIds: ["unknown-id"] },
    ];
    const result = validatePipelinePreset(makePreset({ stages }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("unknown stage"))).toBe(true);
  });

  test("self-dependency fails", () => {
    const stages: PipelineStage[] = [
      { stageId: "s1", name: "A", order: 1, agentRole: "planner", description: "A", dependsOnStageIds: ["s1"] },
    ];
    const result = validatePipelinePreset(makePreset({ stages }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("cannot depend on itself"))).toBe(true);
  });

  test("circular dependency fails", () => {
    const stages: PipelineStage[] = [
      { stageId: "s1", name: "A", order: 1, agentRole: "planner", description: "A", dependsOnStageIds: ["s2"] },
      { stageId: "s2", name: "B", order: 2, agentRole: "executor", description: "B", dependsOnStageIds: ["s1"] },
    ];
    const result = validatePipelinePreset(makePreset({ stages }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("circular"))).toBe(true);
  });
});

describe("getNextStages", () => {
  test("returns first stage when nothing completed", () => {
    const preset = makePreset();
    const next = getNextStages(preset, []);
    expect(next.length).toBe(1);
    expect(next[0].stageId).toBe("s1");
  });

  test("returns stage after deps completed", () => {
    const preset = makePreset();
    const next = getNextStages(preset, ["s1"]);
    expect(next.length).toBe(1);
    expect(next[0].stageId).toBe("s2");
  });

  test("returns empty when all completed", () => {
    const preset = makePreset();
    const next = getNextStages(preset, ["s1", "s2", "s3"]);
    expect(next).toEqual([]);
  });

  test("returns multiple parallel stages when deps allow", () => {
    const stages: PipelineStage[] = [
      { stageId: "s1", name: "Plan", order: 1, agentRole: "planner", description: "Planning", dependsOnStageIds: [] },
      { stageId: "s2", name: "Exec A", order: 2, agentRole: "executor", description: "Exec A", dependsOnStageIds: ["s1"] },
      { stageId: "s3", name: "Exec B", order: 3, agentRole: "executor", description: "Exec B", dependsOnStageIds: ["s1"] },
      { stageId: "s4", name: "Review", order: 4, agentRole: "reviewer", description: "Review", dependsOnStageIds: ["s2", "s3"] },
    ];
    const preset = makePreset({ stages });
    const next = getNextStages(preset, ["s1"]);
    expect(next.length).toBe(2);
    expect(next.map((s) => s.stageId)).toEqual(["s2", "s3"]);
  });
});
