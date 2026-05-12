import type { TurnResult } from "../agents/agent-runtime.js";
import type { ModelMessage } from "../agents/model-provider.js";
import type { SaveTurnInput } from "./space-manager.js";

export function buildCompletedSaveTurnInput(input: {
  turnId: string;
  spaceId: string;
  agentId: string;
  userMessage: ModelMessage;
  result: TurnResult;
}): SaveTurnInput {
  return {
    turnId: buildPersistedTurnId(input.turnId, input.agentId),
    userTurnId: input.turnId,
    spaceId: input.spaceId,
    agentId: input.agentId,
    input: input.userMessage.content,
    output: input.result.finalMessage.content,
    status: "completed",
    promptTokens: input.result.usage.promptTokens,
    completionTokens: input.result.usage.completionTokens,
    totalTokens: input.result.usage.totalTokens,
  };
}

export function buildPersistedTurnId(turnId: string, agentId: string): string {
  const normalizedAgentId = agentId
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${turnId}:${normalizedAgentId}`;
}
