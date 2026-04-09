/**
 * OrchestrationContextBudget — tracks token budget across multi-agent
 * orchestration to prevent context window overflow.
 *
 * Phase D of US-74 (Core Orchestration Mechanics).
 *
 * Each orchestration run creates a budget from the model's context window.
 * As agents consume tokens, the budget is decremented. Before dispatching
 * to the next participant, the orchestrator checks remaining capacity and
 * may truncate history to stay within limits.
 */

export interface OrchestrationContextBudget {
  /** Model context window × 0.75 — usable token ceiling. */
  totalBudgetTokens: number;
  /** Estimated tokens consumed by the system prompt. */
  reservedForSystemPrompt: number;
  /** Estimated tokens consumed by the original user input. */
  reservedForUserInput: number;
  /** Per-agent token spend: agentId → tokens used. */
  spentByParticipants: Map<string, number>;
  /** Running estimate accuracy factor (default 1.0). */
  calibrationFactor: number;
}

/**
 * Create a budget for an orchestration run.
 *
 * @param modelWindowTokens - Full model context window in tokens.
 * @param systemPromptChars - Character length of the system prompt.
 * @param userInputChars    - Character length of the original user input.
 */
export function createBudget(
  modelWindowTokens: number,
  systemPromptChars: number,
  userInputChars: number,
): OrchestrationContextBudget {
  const calibrationFactor = 1.0;
  return {
    totalBudgetTokens: Math.floor(modelWindowTokens * 0.75),
    reservedForSystemPrompt: estimateTokens(systemPromptChars, calibrationFactor),
    reservedForUserInput: estimateTokens(userInputChars, calibrationFactor),
    spentByParticipants: new Map(),
    calibrationFactor,
  };
}

/**
 * Tokens remaining for the next participant.
 * May return negative if prior agents overshot the budget.
 */
export function remainingForNextParticipant(
  budget: OrchestrationContextBudget,
): number {
  let totalSpent = 0;
  for (const spent of budget.spentByParticipants.values()) {
    totalSpent += spent;
  }
  return (
    budget.totalBudgetTokens -
    budget.reservedForSystemPrompt -
    budget.reservedForUserInput -
    totalSpent
  );
}

/**
 * Record actual token spend for a participant agent.
 * Accumulates if called multiple times for the same agent.
 */
export function recordParticipantSpend(
  budget: OrchestrationContextBudget,
  agentId: string,
  tokens: number,
): void {
  const existing = budget.spentByParticipants.get(agentId) ?? 0;
  budget.spentByParticipants.set(agentId, existing + tokens);
}

/**
 * Rough token estimate from character count.
 * Uses ~4 chars per token, adjusted by calibration factor.
 */
export function estimateTokens(
  chars: number,
  calibrationFactor: number = 1.0,
): number {
  return Math.ceil((chars / 4) * calibrationFactor);
}
