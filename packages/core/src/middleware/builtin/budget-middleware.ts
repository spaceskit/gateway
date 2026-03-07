/**
 * BudgetMiddleware — tracks token spending and enforces budget limits.
 *
 * LLM layer (order: 20):
 * - Pre: Check if budget allows the call. If hard cap hit, terminate.
 * - Post: Accumulate token usage, emit warnings.
 *
 * Stolen from: CrewAI's cost tracking + Spaceskit's budget policy.
 */

import type { Middleware, MiddlewareContext } from "../types.js";
import type { EventBus } from "../../events/event-bus.js";
import { checkBudget, estimateCostUsd, type BudgetPolicy, type BudgetState } from "@spaceskit/policy";

export interface BudgetMiddlewareOptions {
  eventBus: EventBus;
  /** Load current budget policy. */
  loadPolicy: () => Promise<BudgetPolicy>;
  /** Load current budget state (total spent). */
  loadState: () => Promise<BudgetState>;
  /** Update budget state after a call. */
  updateState: (additionalCostUsd: number) => Promise<void>;
}

export function createBudgetMiddleware(
  options: BudgetMiddlewareOptions,
): Middleware {
  return {
    name: "budget",
    layer: "llm",
    order: 20,
    async process(ctx: MiddlewareContext, next: () => Promise<void>) {
      const policy = await options.loadPolicy();
      const state = await options.loadState();

      // --- Pre-hook: Check budget before LLM call ---
      const check = checkBudget(policy, state);

      if (check.status === "blocked") {
        ctx.terminate = true;
        ctx.output = {
          feedbackRequest: {
            id: `budget-${Date.now()}`,
            agentId: ctx.agentId ?? "unknown",
            triggerClass: "budget_gate" as const,
            description: `Budget hard cap reached: $${state.totalSpentUsd.toFixed(2)} / $${policy.hardCapUsd.toFixed(2)}`,
            options: ["approve" as const, "reject" as const],
          },
        };

        options.eventBus.emit({
          type: "budget.blocked",
          spaceId: ctx.spaceId,
          agentId: ctx.agentId,
          spent: state.totalSpentUsd,
          hardCap: policy.hardCapUsd,
          timestamp: new Date(),
        });
        return;
      }

      if (check.status === "warning") {
        ctx.metadata.budgetWarning = check.message;
        options.eventBus.emit({
          type: "budget.warning",
          spaceId: ctx.spaceId,
          agentId: ctx.agentId,
          spent: state.totalSpentUsd,
          softCap: policy.softCapUsd,
          timestamp: new Date(),
        });
      }

      await next();

      // --- Post-hook: Track token usage ---
      if (ctx.output && typeof ctx.output === "object") {
        const result = ctx.output as Record<string, unknown>;
        const usage = result.usage as
          | { promptTokens?: number; completionTokens?: number }
          | undefined;

        if (usage) {
          const cost = estimateCostUsd(
            usage.promptTokens ?? 0,
            usage.completionTokens ?? 0,
          );
          await options.updateState(cost);

          ctx.metadata.tokenCost = cost;
          ctx.metadata.totalSpent = state.totalSpentUsd + cost;
        }
      }
    },
  };
}
