import { describe, test, expect } from "bun:test";
import { createContextWindowMiddleware } from "../../src/middleware/builtin/context-window-middleware.js";
import type { MiddlewareContext } from "../../src/middleware/types.js";
import type { GenerateOptions, GenerateResult, ModelMessage } from "../../src/agents/model-provider.js";
import { EventBus } from "../../src/events/event-bus.js";
import { createBudget, recordParticipantSpend } from "../../src/orchestrator/context-budget.js";
import type { OrchestrationContextBudget } from "../../src/orchestrator/context-budget.js";

function makeContext(
  input: GenerateOptions,
  orchestrationBudget?: OrchestrationContextBudget,
  overrides: Partial<MiddlewareContext> = {},
): MiddlewareContext {
  const metadata: Record<string, unknown> = {};
  if (orchestrationBudget) {
    metadata.orchestrationBudget = orchestrationBudget;
  }
  return {
    layer: "llm",
    input,
    metadata,
    terminate: false,
    startedAt: new Date(),
    spaceId: "space-1",
    agentId: "agent-1",
    turnId: "turn-1",
    ...overrides,
  };
}

function makeMessage(role: ModelMessage["role"], label: string, length: number): ModelMessage {
  const padding = Math.max(0, length - label.length - 1);
  return {
    role,
    content: `${label} ${"x".repeat(padding)}`,
  };
}

describe("context-window middleware — orchestration budget", () => {
  test("uses orchestration budget remaining instead of raw context window when present", async () => {
    const eventBus = new EventBus();
    const middleware = createContextWindowMiddleware({
      eventBus,
      // Large default window — should NOT trigger without budget
      getContextWindowSize: () => 1_000_000,
    });

    // Create a budget with very little remaining
    const budget = createBudget(1000, 0, 0);
    // Budget total = 750, spend 700 leaving only 50
    recordParticipantSpend(budget, "agent-prior", 700);

    const input: GenerateOptions = {
      messages: [
        // ~55 tokens without calibration → exceeds 50 remaining
        makeMessage("user", "u1", 200),
      ],
    };
    const ctx = makeContext(input, budget);

    let nextCalled = false;
    await middleware.process(ctx, async () => {
      nextCalled = true;
    });

    // Should have triggered summarization/compaction due to budget
    expect(nextCalled).toBe(true);
    expect(ctx.metadata.contextCompacted).toBe(true);
  });

  test("single-agent behavior unchanged when no budget present", async () => {
    const eventBus = new EventBus();
    const middleware = createContextWindowMiddleware({
      eventBus,
      getContextWindowSize: () => 100_000,
    });

    const input: GenerateOptions = {
      messages: [
        makeMessage("system", "sys", 40),
        makeMessage("user", "u1", 80),
      ],
    };
    const ctx = makeContext(input);

    let nextCalled = false;
    await middleware.process(ctx, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    // No compaction needed — small messages within large window
    expect(ctx.metadata.contextCompacted).toBeUndefined();
  });

  test("does not compact when orchestration budget has ample remaining", async () => {
    const eventBus = new EventBus();
    const middleware = createContextWindowMiddleware({
      eventBus,
      getContextWindowSize: () => 100_000,
    });

    // Budget with plenty of room
    const budget = createBudget(200_000, 0, 0);

    const input: GenerateOptions = {
      messages: [
        makeMessage("user", "u1", 100),
      ],
    };
    const ctx = makeContext(input, budget);

    let nextCalled = false;
    await middleware.process(ctx, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(ctx.metadata.contextCompacted).toBeUndefined();
  });
});

describe("context-window middleware — calibration", () => {
  test("updates calibration factor from actual usage after LLM call", async () => {
    const eventBus = new EventBus();
    const middleware = createContextWindowMiddleware({
      eventBus,
      getContextWindowSize: () => 100_000,
    });

    const input: GenerateOptions = {
      messages: [
        makeMessage("system", "sys", 40),
        makeMessage("user", "u1", 80),
      ],
    };
    const ctx = makeContext(input);

    // Simulate LLM call that sets actual usage on output
    await middleware.process(ctx, async () => {
      // Set output with actual usage — simulating what the LLM handler does
      const result: GenerateResult = {
        message: { role: "assistant", content: "response" },
        usage: {
          promptTokens: 100, // actual
          completionTokens: 20,
          totalTokens: 120,
        },
        finishReason: "stop",
      };
      ctx.output = result;
    });

    // Calibration factor should have been set on metadata
    expect(ctx.metadata.calibrationFactor).toBeDefined();
    expect(typeof ctx.metadata.calibrationFactor).toBe("number");
  });

  test("does not update calibration when no usage data available", async () => {
    const eventBus = new EventBus();
    const middleware = createContextWindowMiddleware({
      eventBus,
      getContextWindowSize: () => 100_000,
    });

    const input: GenerateOptions = {
      messages: [
        makeMessage("user", "u1", 80),
      ],
    };
    const ctx = makeContext(input);

    await middleware.process(ctx, async () => {
      // No output set — no usage data
    });

    // No calibration update without usage data
    expect(ctx.metadata.calibrationFactor).toBeUndefined();
  });

  test("keeps calibration isolated per model and agent scope", async () => {
    const eventBus = new EventBus();
    const middleware = createContextWindowMiddleware({
      eventBus,
      getContextWindowSize: () => 100_000,
    });

    const firstInput: GenerateOptions = {
      modelId: "model-a",
      messages: [
        makeMessage("user", "u1", 80),
      ],
    };
    const firstCtx = makeContext(firstInput);

    await middleware.process(firstCtx, async () => {
      firstCtx.output = {
        message: { role: "assistant", content: "response" },
        usage: {
          promptTokens: 100,
          completionTokens: 10,
          totalTokens: 110,
        },
        finishReason: "stop",
      } satisfies GenerateResult;
    });

    const sameScopeInput: GenerateOptions = {
      modelId: "model-a",
      messages: [
        makeMessage("user", "u2", 80),
      ],
    };
    const sameScopeCtx = makeContext(sameScopeInput);

    await middleware.process(sameScopeCtx, async () => {});

    const isolatedInput: GenerateOptions = {
      modelId: "model-b",
      messages: [
        makeMessage("user", "u3", 80),
      ],
    };
    const isolatedCtx = makeContext(isolatedInput, undefined, {
      agentId: "agent-2",
      spaceId: "space-2",
      turnId: "turn-2",
    });

    await middleware.process(isolatedCtx, async () => {});

    expect(sameScopeCtx.metadata._preEstimateTokens).toBeGreaterThan(25);
    expect(isolatedCtx.metadata._preEstimateTokens).toBe(25);
  });
});

describe("context-window middleware — regression: existing behavior", () => {
  test("passes modelId to context-window size resolver", async () => {
    const eventBus = new EventBus();
    let seenModelId: string | undefined;
    const middleware = createContextWindowMiddleware({
      eventBus,
      getContextWindowSize: (modelId?: string) => {
        seenModelId = modelId;
        return 100_000;
      },
    });

    const input: GenerateOptions = {
      modelId: "lmstudio/google/gemma-3-4b-it",
      messages: [
        makeMessage("system", "sys", 40),
        makeMessage("user", "u1", 80),
      ],
    };
    const ctx = makeContext(input);

    let nextCalled = false;
    await middleware.process(ctx, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(seenModelId).toBe("lmstudio/google/gemma-3-4b-it");
  });

  test("summarizes and compacts when over single-agent threshold", async () => {
    const eventBus = new EventBus();
    const middleware = createContextWindowMiddleware({
      eventBus,
      threshold: 1,
      keepRecentMessages: 2,
      getContextWindowSize: () => 100,
    });

    const input: GenerateOptions = {
      messages: [
        makeMessage("system", "sys", 20),
        makeMessage("user", "old", 300),
        makeMessage("assistant", "old-reply", 300),
        makeMessage("user", "recent-1", 50),
        makeMessage("assistant", "recent-2", 50),
      ],
    };
    const ctx = makeContext(input);

    await middleware.process(ctx, async () => {});

    expect(ctx.metadata.contextCompacted).toBe(true);
    expect(ctx.metadata.contextSummarized).toBe(true);
  });
});
