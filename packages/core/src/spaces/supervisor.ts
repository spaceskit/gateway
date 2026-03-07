/**
 * Supervisor pattern — explicit coordinator agent orchestrating workers.
 *
 * The supervisor:
 * 1. Receives the task/goal
 * 2. Creates an execution plan (which agents, in what order)
 * 3. Delegates sub-tasks to worker agents
 * 4. Monitors progress and handles failures
 * 5. Synthesizes the final result
 *
 * This maps to the PRIMARY_ONLY turn model with the primary agent
 * acting as supervisor using agent-as-tool delegation.
 */

import type { ModelProvider, ModelMessage } from "../agents/model-provider.js";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SupervisorConfig {
  /** ID of the supervisor agent. */
  supervisorAgentId: string;
  /** Worker agents the supervisor can delegate to. */
  workers: SupervisorWorker[];
  /** Max planning iterations. Default: 3. */
  maxPlanIterations?: number;
  /** Strategy for worker execution. */
  executionStrategy?: "sequential" | "parallel" | "adaptive";
}

export interface SupervisorWorker {
  agentId: string;
  name: string;
  description: string;
  capabilities: string[];
}

export interface SupervisorPlan {
  planId: string;
  goal: string;
  steps: SupervisorStep[];
  status: "draft" | "approved" | "executing" | "completed" | "failed";
  createdAt: Date;
}

export interface SupervisorStep {
  stepId: string;
  agentId: string;
  task: string;
  dependsOn: string[];
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  result?: string;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

// ---------------------------------------------------------------------------
// Plan generation
// ---------------------------------------------------------------------------

/**
 * Generate a supervisor plan from a goal using LLM.
 * Falls back to single-step plan if LLM is unavailable.
 */
export async function generateSupervisorPlan(
  goal: string,
  config: SupervisorConfig,
  modelProvider?: ModelProvider,
  modelId?: string,
): Promise<SupervisorPlan> {
  const plan: SupervisorPlan = {
    planId: randomUUID(),
    goal,
    steps: [],
    status: "draft",
    createdAt: new Date(),
  };

  // Try LLM-based planning
  if (modelProvider && modelId) {
    try {
      const workerDescriptions = config.workers
        .map((w) => `- ${w.agentId} (${w.name}): ${w.description}. Capabilities: ${w.capabilities.join(", ")}`)
        .join("\n");

      const messages: ModelMessage[] = [
        {
          role: "system",
          content: `You are a task planning supervisor. Break down goals into concrete steps assigned to available workers. Return valid JSON only.

Available workers:
${workerDescriptions}

Return a JSON array of steps:
[{"agentId": "worker-id", "task": "description", "dependsOn": []}]

Rules:
- Each step must use an available worker's agentId
- dependsOn lists stepIds that must complete first (use "step-0", "step-1", etc.)
- Keep plans concise (2-5 steps)`,
        },
        {
          role: "user",
          content: `Create a plan for: ${goal}`,
        },
      ];

      const result = await modelProvider.generate(modelId, {
        messages,
        maxTokens: 500,
        temperature: 0.2,
      });

      const parsed = JSON.parse(result.message.content);
      if (Array.isArray(parsed)) {
        plan.steps = parsed.map((step: any, i: number) => ({
          stepId: `step-${i}`,
          agentId: step.agentId ?? config.workers[0]?.agentId ?? "unknown",
          task: step.task ?? "Unknown task",
          dependsOn: step.dependsOn ?? [],
          status: "pending" as const,
        }));
      }
    } catch (err) {
      // JSON parse failed or LLM error — fall through to heuristic
      console.warn(
        `Supervisor plan generation via LLM failed, using heuristic fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Fallback: assign everything to the first worker
  if (plan.steps.length === 0 && config.workers.length > 0) {
    plan.steps = [{
      stepId: "step-0",
      agentId: config.workers[0].agentId,
      task: goal,
      dependsOn: [],
      status: "pending",
    }];
  }

  return plan;
}

/**
 * Get the next executable steps from a plan.
 * A step is executable when all its dependencies are completed.
 */
export function getExecutableSteps(plan: SupervisorPlan): SupervisorStep[] {
  const completedIds = new Set(
    plan.steps.filter((s) => s.status === "completed").map((s) => s.stepId),
  );

  return plan.steps.filter((step) => {
    if (step.status !== "pending") return false;
    return step.dependsOn.every((depId) => completedIds.has(depId));
  });
}

/**
 * Check if a plan is complete (all steps done or failed).
 */
export function isPlanComplete(plan: SupervisorPlan): boolean {
  return plan.steps.every((s) => s.status === "completed" || s.status === "failed" || s.status === "skipped");
}
