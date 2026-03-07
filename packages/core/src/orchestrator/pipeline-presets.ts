/**
 * Pipeline preset type — ordered stage definitions for orchestration workflows.
 * Pure functions — no I/O, no logging.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineStage {
  stageId: string;
  name: string;
  order: number;
  agentRole: string;          // role identifier (e.g., "planner", "executor", "reviewer")
  description: string;
  dependsOnStageIds: string[];
}

export interface PipelinePreset {
  presetId: string;
  name: string;
  description: string;
  stages: PipelineStage[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface PipelineValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePipelinePreset(preset: PipelinePreset): PipelineValidationResult {
  const errors: string[] = [];

  if (!preset.name || preset.name.trim().length === 0) {
    errors.push("Pipeline preset name is required");
  }

  if (!preset.stages || preset.stages.length === 0) {
    errors.push("Pipeline must have at least one stage");
  }

  if (preset.stages) {
    // Unique stageIds
    const ids = preset.stages.map((s) => s.stageId);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length > 0) {
      errors.push(`Duplicate stageIds: ${[...new Set(dupes)].join(", ")}`);
    }

    const idSet = new Set(ids);

    // Check dependencies reference valid stages
    for (const stage of preset.stages) {
      for (const depId of stage.dependsOnStageIds) {
        if (!idSet.has(depId)) {
          errors.push(`Stage "${stage.stageId}" depends on unknown stage "${depId}"`);
        }
        if (depId === stage.stageId) {
          errors.push(`Stage "${stage.stageId}" cannot depend on itself`);
        }
      }
    }

    // Check for circular dependencies (simple DFS)
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const stageMap = new Map(preset.stages.map((s) => [s.stageId, s]));

    function hasCycle(stageId: string): boolean {
      if (visiting.has(stageId)) return true;
      if (visited.has(stageId)) return false;
      visiting.add(stageId);
      const stage = stageMap.get(stageId);
      if (stage) {
        for (const depId of stage.dependsOnStageIds) {
          if (hasCycle(depId)) return true;
        }
      }
      visiting.delete(stageId);
      visited.add(stageId);
      return false;
    }

    for (const stage of preset.stages) {
      visited.clear();
      visiting.clear();
      if (hasCycle(stage.stageId)) {
        errors.push("Pipeline has circular stage dependencies");
        break;
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Stage Navigation
// ---------------------------------------------------------------------------

export function getNextStages(
  preset: PipelinePreset,
  completedStageIds: string[],
): PipelineStage[] {
  const completed = new Set(completedStageIds);

  return preset.stages
    .filter((stage) => !completed.has(stage.stageId))
    .filter((stage) => stage.dependsOnStageIds.every((dep) => completed.has(dep)))
    .sort((a, b) => a.order - b.order);
}
