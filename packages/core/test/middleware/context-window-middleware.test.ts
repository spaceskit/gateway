import { describe, test, expect } from "bun:test";
import { createContextWindowMiddleware } from "../../src/middleware/builtin/context-window-middleware.js";
import type { MiddlewareContext } from "../../src/middleware/types.js";
import type { GenerateOptions, ModelMessage } from "../../src/agents/model-provider.js";
import { EventBus } from "../../src/events/event-bus.js";

function estimateTokens(messages: ModelMessage[]): number {
  let chars = 0;
  for (const message of messages) {
    chars += message.content.length;
    chars += 20;
  }
  return Math.ceil(chars / 4);
}

function makeContext(input: GenerateOptions): MiddlewareContext {
  return {
    layer: "llm",
    input,
    metadata: {},
    terminate: false,
    startedAt: new Date(),
    spaceId: "space-1",
    agentId: "agent-1",
    turnId: "turn-1",
  };
}

function makeMessage(role: ModelMessage["role"], label: string, length: number): ModelMessage {
  const padding = Math.max(0, length - label.length - 1);
  return {
    role,
    content: `${label} ${"x".repeat(padding)}`,
  };
}

describe("context-window middleware", () => {
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

  test("truncates summary and drops oldest kept non-system messages to fit budget", async () => {
    const eventBus = new EventBus();
    const summarizedEvents: Array<Record<string, unknown>> = [];
    eventBus.on("context.summarized", (event) => summarizedEvents.push(event));

    const middleware = createContextWindowMiddleware({
      eventBus,
      threshold: 1,
      keepRecentMessages: 3,
      getContextWindowSize: () => 300,
      summarize: async () => "S".repeat(2_000),
    });

    const input: GenerateOptions = {
      modelId: "lmstudio/google/gemma-3-4b-it",
      messages: [
        makeMessage("system", "sys", 40),
        makeMessage("user", "old-u1", 600),
        makeMessage("assistant", "old-a1", 600),
        makeMessage("user", "keep-u1", 500),
        makeMessage("assistant", "keep-a2", 500),
        makeMessage("user", "keep-u3", 500),
      ],
    };
    const ctx = makeContext(input);

    await middleware.process(ctx, async () => {});

    const compacted = (ctx.input as GenerateOptions).messages;
    expect(compacted.length).toBeGreaterThan(0);
    expect(estimateTokens(compacted)).toBeLessThanOrEqual(300);

    const contents = compacted.map((message) => message.content);
    expect(contents.some((content) => content.includes("keep-u1"))).toBe(false);
    expect(contents.some((content) => content.includes("keep-a2"))).toBe(true);
    expect(contents.some((content) => content.includes("keep-u3"))).toBe(true);

    const summary = compacted.find((message) => message.role === "user" && !message.content.includes("keep-u"));
    if (summary) {
      expect(summary.content.length).toBeLessThan(2_000);
    }
    expect(ctx.metadata.summaryTruncated).toBe(true);

    expect(summarizedEvents.length).toBe(1);
    expect((summarizedEvents[0].droppedRecentMessages as number) >= 1).toBe(true);
  });

  test("drops oldest non-system messages deterministically when no summary bucket exists", async () => {
    const eventBus = new EventBus();
    const middleware = createContextWindowMiddleware({
      eventBus,
      threshold: 1,
      keepRecentMessages: 5,
      getContextWindowSize: () => 250,
    });

    const input: GenerateOptions = {
      modelId: "lmstudio/test",
      messages: [
        makeMessage("system", "sys", 40),
        makeMessage("user", "keep-1", 700),
        makeMessage("assistant", "keep-2", 700),
        makeMessage("user", "keep-3", 700),
      ],
    };
    const ctx = makeContext(input);

    await middleware.process(ctx, async () => {});

    const compacted = (ctx.input as GenerateOptions).messages;
    expect(estimateTokens(compacted)).toBeLessThanOrEqual(250);
    expect(compacted.filter((message) => message.role !== "system").length).toBe(1);
    expect(compacted.some((message) => message.content.includes("keep-3"))).toBe(true);
    expect(compacted.some((message) => message.content.includes("keep-1"))).toBe(false);
    expect(compacted.some((message) => message.content.includes("keep-2"))).toBe(false);
  });
});
