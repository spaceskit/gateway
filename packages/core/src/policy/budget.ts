/**
 * Usage budget enforcement — tracks token spend against soft/hard caps.
 */

export interface BudgetPolicy {
  softCapUsd: number;
  hardCapUsd: number;
  warningThreshold: number;  // 0–1, fraction of softCap
}

export interface BudgetState {
  totalSpentUsd: number;
}

export type BudgetCheckResult =
  | { status: "ok" }
  | { status: "warning"; message: string; spent: number; softCap: number }
  | { status: "blocked"; message: string; spent: number; hardCap: number };

export function checkBudget(policy: BudgetPolicy, state: BudgetState): BudgetCheckResult {
  if (state.totalSpentUsd >= policy.hardCapUsd) {
    return {
      status: "blocked",
      message: `Hard spending cap reached ($${policy.hardCapUsd.toFixed(2)}). All model calls are paused until the cap is raised.`,
      spent: state.totalSpentUsd,
      hardCap: policy.hardCapUsd,
    };
  }

  const warningLine = policy.softCapUsd * policy.warningThreshold;
  if (state.totalSpentUsd >= warningLine) {
    return {
      status: "warning",
      message: `Approaching soft spending cap ($${state.totalSpentUsd.toFixed(2)} / $${policy.softCapUsd.toFixed(2)}).`,
      spent: state.totalSpentUsd,
      softCap: policy.softCapUsd,
    };
  }

  return { status: "ok" };
}

/**
 * Estimate cost from token counts. Very rough — real pricing varies by model.
 * This is a convenience for the budget tracker; the native app can show
 * exact per-model pricing from the provider's pricing API.
 */
export function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  inputPricePer1k = 0.003,
  outputPricePer1k = 0.015,
): number {
  return (inputTokens / 1000) * inputPricePer1k + (outputTokens / 1000) * outputPricePer1k;
}
