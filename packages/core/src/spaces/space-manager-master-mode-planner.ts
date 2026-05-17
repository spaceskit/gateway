import { randomUUID } from "node:crypto";
import type { TurnContext, TurnResult } from "../agents/agent-runtime.js";
import type { ModelMessage } from "../agents/model-provider.js";
import { renderTemplate, type MasterModePromptTemplates } from "./master-mode-prompts.js";
import type { ActiveSpace } from "./space-manager-agent-sessions.js";
import {
  buildFallbackPlannerInstructions,
  formatGuestList,
  parsePlannerInstructions,
  parseSlashPlannerDirectives,
  type MasterFlowAssignments,
  type PlannerPhaseResult,
} from "./space-manager-master-mode-helpers.js";
import type { TurnExecutionIdentity } from "./space-manager-normalizers.js";
import type { MasterModeContext } from "./space-manager-master-mode-types.js";

export async function runMasterPlannerPhase(
  ctx: MasterModeContext,
  space: ActiveSpace,
  turnId: string,
  userMessage: ModelMessage,
  assignments: MasterFlowAssignments,
  promptTemplates: MasterModePromptTemplates,
  executionIdentity?: TurnExecutionIdentity,
): Promise<PlannerPhaseResult> {
  const fallback = buildFallbackPlannerInstructions(assignments.guests, userMessage.content);
  const slashInstructions = parseSlashPlannerDirectives(userMessage.content, assignments.guests);
  if (slashInstructions) {
    return {
      instructions: slashInstructions,
      source: "slash",
    };
  }

  const runtime = await ctx.getRuntime(space, assignments.master.agentId);
  const session = await ctx.getOrCreateAgentSession(space, assignments.master.agentId);
  const plannerPrompt = renderTemplate(
    promptTemplates.planner,
    {
      user_input: userMessage.content,
      guest_agent_id: assignments.master.agentId,
      guest_list: formatGuestList(assignments.guests),
      guest_reports: "",
      global_instruction: "",
      guest_instruction: "",
    },
  );
  const plannerContext: TurnContext = {
    spaceId: space.config.id,
    turnId,
    messages: [
      ...session.messages,
      userMessage,
      { role: "user", content: plannerPrompt },
    ],
    lineageId: randomUUID(),
    hopCount: 0,
    maxHops: ctx.maxHops,
    principalId: executionIdentity?.principalId,
    deviceId: executionIdentity?.deviceId,
    executionOrigin: executionIdentity?.executionOrigin,
    accessMode: executionIdentity?.accessMode,
    mode: executionIdentity?.mode,
    effort: executionIdentity?.effort,
  };

  let plannerResult: TurnResult | null = null;
  try {
    for await (const event of runtime.executeTurn(plannerContext)) {
      if (event.type === "turn_completed") {
        plannerResult = event.result;
      }
    }
  } catch {
    return {
      instructions: fallback,
      source: "fallback",
      fallbackReason: "planner_execution_error",
    };
  }

  if (!plannerResult) {
    return {
      instructions: fallback,
      source: "fallback",
      fallbackReason: "planner_missing_completion",
    };
  }
  const parsed = parsePlannerInstructions(plannerResult.finalMessage.content, assignments.guests);
  if (parsed) {
    return {
      instructions: parsed,
      source: "planner",
      rawOutput: plannerResult.finalMessage.content,
    };
  }
  return {
    instructions: fallback,
    source: "fallback",
    rawOutput: plannerResult.finalMessage.content,
    fallbackReason: "planner_invalid_json",
  };
}
