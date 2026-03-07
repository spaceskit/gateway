import { describe, expect, test } from "bun:test";
import { createValidationMiddleware } from "../src/middleware/builtin/validation-middleware.js";
import type { MiddlewareContext } from "../src/middleware/types.js";

function makeTurnContext(input: unknown, spaceId?: string): MiddlewareContext {
  return {
    layer: "turn",
    input,
    spaceId,
    metadata: {},
    terminate: false,
    startedAt: new Date(),
  };
}

describe("validation middleware", () => {
  test("accepts turn context spaceId and normalizes metadata", async () => {
    const middleware = createValidationMiddleware();
    const ctx = makeTurnContext("Plan the rollout.", " space-123 ");
    let nextCalled = false;

    await middleware.process(ctx, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(ctx.terminate).toBe(false);
    expect(ctx.spaceId).toBe("space-123");
    expect(ctx.metadata.spaceId).toBe("space-123");
    expect(ctx.metadata.validated).toBe(true);
  });

  test("rejects missing spaceId", async () => {
    const middleware = createValidationMiddleware();
    const ctx = makeTurnContext("Plan the rollout.");

    await expect(middleware.process(ctx, async () => {})).rejects.toThrow(
      "Validation failed: spaceId is required",
    );
    expect(ctx.terminate).toBe(true);
  });
});
