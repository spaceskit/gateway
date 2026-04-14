import { describe, test, expect } from "bun:test";
import { createBudgetMiddleware } from "../../src/middleware/builtin/budget-middleware.js";
import type { MiddlewareContext } from "../../src/middleware/types.js";
import { EventBus } from "../../src/events/event-bus.js";
import type { BudgetPolicy, BudgetState } from "../../src/policy/budget.js";

function makeContext(overrides?: Partial<MiddlewareContext>): MiddlewareContext {
  return {
    layer: "llm",
    input: {},
    metadata: {},
    terminate: false,
    startedAt: new Date(),
    ...overrides,
  };
}

function makePolicy(overrides?: Partial<BudgetPolicy>): BudgetPolicy {
  return {
    softCapUsd: 5.0,
    hardCapUsd: 10.0,
    warningThreshold: 0.8,
    ...overrides,
  };
}

describe("budget middleware — pre-hook", () => {
  test("under budget passes through", async () => {
    const eventBus = new EventBus();
    const policy = makePolicy();
    const state: BudgetState = { totalSpentUsd: 1.0 };

    const mw = createBudgetMiddleware({
      eventBus,
      loadPolicy: async () => policy,
      loadState: async () => state,
      updateState: async () => {},
    });

    const ctx = makeContext({ spaceId: "s1", agentId: "a1" });
    let nextCalled = false;

    await mw.process(ctx, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(ctx.terminate).toBe(false);
    expect(ctx.metadata.budgetWarning).toBeUndefined();
  });

  test("hard cap blocks execution", async () => {
    const eventBus = new EventBus();
    const emitted: unknown[] = [];
    eventBus.on("budget.blocked", (evt) => emitted.push(evt));

    const policy = makePolicy({ hardCapUsd: 10.0 });
    const state: BudgetState = { totalSpentUsd: 10.0 };

    const mw = createBudgetMiddleware({
      eventBus,
      loadPolicy: async () => policy,
      loadState: async () => state,
      updateState: async () => {},
    });

    const ctx = makeContext({ spaceId: "s1", agentId: "a1" });
    let nextCalled = false;

    await mw.process(ctx, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(ctx.terminate).toBe(true);

    // Should have a feedbackRequest in output
    const output = ctx.output as Record<string, unknown>;
    expect(output.feedbackRequest).toBeDefined();
    const feedback = output.feedbackRequest as Record<string, unknown>;
    expect(feedback.triggerClass).toBe("budget_gate");

    // Should emit budget.blocked event
    expect(emitted.length).toBe(1);
  });

  test("soft cap warns but allows", async () => {
    const eventBus = new EventBus();
    const emitted: unknown[] = [];
    eventBus.on("budget.warning", (evt) => emitted.push(evt));

    // warningThreshold 0.8 of softCapUsd 5.0 = triggers at $4.0+
    const policy = makePolicy({ softCapUsd: 5.0, hardCapUsd: 10.0, warningThreshold: 0.8 });
    const state: BudgetState = { totalSpentUsd: 4.5 };

    const mw = createBudgetMiddleware({
      eventBus,
      loadPolicy: async () => policy,
      loadState: async () => state,
      updateState: async () => {},
    });

    const ctx = makeContext({ spaceId: "s1", agentId: "a1" });
    let nextCalled = false;

    await mw.process(ctx, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(ctx.terminate).toBe(false);
    expect(ctx.metadata.budgetWarning).toBeDefined();

    // Should emit budget.warning event
    expect(emitted.length).toBe(1);
  });
});

describe("budget middleware — post-hook", () => {
  test("calls cost accumulator callback on usage", async () => {
    const eventBus = new EventBus();
    const policy = makePolicy();
    const state: BudgetState = { totalSpentUsd: 1.0 };
    let updatedCost = 0;

    const mw = createBudgetMiddleware({
      eventBus,
      loadPolicy: async () => policy,
      loadState: async () => state,
      updateState: async (cost) => {
        updatedCost = cost;
      },
    });

    const ctx = makeContext({ spaceId: "s1", agentId: "a1" });

    await mw.process(ctx, async () => {
      // Simulate LLM response with usage
      ctx.output = {
        text: "Hello",
        usage: {
          promptTokens: 100,
          completionTokens: 50,
        },
      };
    });

    expect(updatedCost).toBeGreaterThan(0);
    expect(ctx.metadata.tokenCost).toBeDefined();
    expect(ctx.metadata.totalSpent).toBeDefined();
  });
});
