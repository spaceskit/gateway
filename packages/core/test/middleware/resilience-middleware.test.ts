import { describe, test, expect } from "bun:test";
import { createResilienceMiddleware } from "../../src/middleware/builtin/resilience-middleware.js";
import { RateLimitError, CircuitOpenError } from "../../src/errors/runtime-errors.js";
import type { MiddlewareContext } from "../../src/middleware/types.js";

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

const noop = async () => {};

describe("resilience middleware — rate limiting", () => {
  test("allows requests under threshold", async () => {
    const mw = createResilienceMiddleware({ requestsPerMinute: 10 });
    const ctx = makeContext({ spaceId: "space-rl-under" });
    let nextCalled = false;

    await mw.process(ctx, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(ctx.terminate).toBe(false);
    expect(ctx.metadata.rateLimited).toBeUndefined();
  });

  test("denies when bucket exhausted", async () => {
    const mw = createResilienceMiddleware({ requestsPerMinute: 2 });
    const spaceId = "space-rl-exhaust";

    // Consume all tokens
    for (let i = 0; i < 2; i++) {
      const ctx = makeContext({ spaceId });
      await mw.process(ctx, noop);
    }

    // Third request should be denied
    const ctx = makeContext({ spaceId });
    await expect(mw.process(ctx, noop)).rejects.toThrow(
      /Rate limit exceeded/,
    );
    expect(ctx.terminate).toBe(true);
    expect(ctx.metadata.rateLimited).toBe(true);
  });

  test("throws RateLimitError with typed fields", async () => {
    const mw = createResilienceMiddleware({ requestsPerMinute: 1 });
    const spaceId = "space-rl-typed";

    await mw.process(makeContext({ spaceId }), noop);

    const ctx = makeContext({ spaceId });
    try {
      await mw.process(ctx, noop);
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).code).toBe("RATE_LIMITED");
      expect((err as RateLimitError).retryAfterMs).toBeGreaterThan(0);
      expect((err as RateLimitError).spaceId).toBe(spaceId);
    }
  });

  test("rate limiting is per-space", async () => {
    const mw = createResilienceMiddleware({ requestsPerMinute: 1 });

    await mw.process(makeContext({ spaceId: "space-a" }), noop);

    // space-b should still work
    let called = false;
    await mw.process(makeContext({ spaceId: "space-b" }), async () => { called = true; });
    expect(called).toBe(true);
  });
});

describe("resilience middleware — circuit breaker", () => {
  test("stays closed on success", async () => {
    const mw = createResilienceMiddleware({
      requestsPerMinute: 100,
      circuitBreakerThreshold: 3,
    });
    const ctx = makeContext({ spaceId: "space-cb-ok" });
    let nextCalled = false;

    await mw.process(ctx, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(ctx.terminate).toBe(false);
    expect(ctx.metadata.circuitBroken).toBeUndefined();
  });

  test("opens after N consecutive failures and throws CircuitOpenError", async () => {
    const threshold = 3;
    const mw = createResilienceMiddleware({
      requestsPerMinute: 100,
      circuitBreakerThreshold: threshold,
      circuitBreakerResetMs: 60000,
    });
    const spaceId = "space-cb-fail";

    // Cause N consecutive failures
    for (let i = 0; i < threshold; i++) {
      const ctx = makeContext({ spaceId });
      try {
        await mw.process(ctx, async () => {
          throw new Error("downstream failure");
        });
      } catch {
        // expected
      }
    }

    // Next request should be rejected by open circuit
    const ctx = makeContext({ spaceId });
    try {
      await mw.process(ctx, noop);
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitOpenError);
      expect((err as CircuitOpenError).code).toBe("CIRCUIT_OPEN");
      expect((err as CircuitOpenError).consecutiveFailures).toBe(threshold);
      expect((err as CircuitOpenError).resetAfterMs).toBeGreaterThan(0);
      expect((err as CircuitOpenError).spaceId).toBe(spaceId);
    }
    expect(ctx.terminate).toBe(true);
    expect(ctx.metadata.circuitBroken).toBe(true);
  });

  test("half-opens after cooldown", async () => {
    const mw = createResilienceMiddleware({
      requestsPerMinute: 100,
      circuitBreakerThreshold: 1,
      circuitBreakerResetMs: 1, // 1ms cooldown for testing
    });
    const spaceId = "space-cb-halfopen";

    // Trip the circuit
    const ctx1 = makeContext({ spaceId });
    try {
      await mw.process(ctx1, async () => {
        throw new Error("fail");
      });
    } catch {
      // expected
    }

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 10));

    // Should allow through in half-open state
    const ctx2 = makeContext({ spaceId });
    let nextCalled = false;
    await mw.process(ctx2, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(ctx2.terminate).toBe(false);
  });

  test("closes on success in half-open state", async () => {
    const mw = createResilienceMiddleware({
      requestsPerMinute: 100,
      circuitBreakerThreshold: 1,
      circuitBreakerResetMs: 1,
    });
    const spaceId = "space-cb-reclose";

    // Trip the circuit
    const ctx1 = makeContext({ spaceId });
    try {
      await mw.process(ctx1, async () => {
        throw new Error("fail");
      });
    } catch {
      // expected
    }

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 10));

    // Succeed in half-open state — should close circuit
    const ctx2 = makeContext({ spaceId });
    await mw.process(ctx2, noop);

    // Now subsequent requests should succeed normally (circuit closed)
    const ctx3 = makeContext({ spaceId });
    let nextCalled = false;
    await mw.process(ctx3, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(ctx3.terminate).toBe(false);
    expect(ctx3.metadata.circuitBroken).toBeUndefined();
  });
});

describe("resilience middleware — eviction", () => {
  test("evicts stale entries after evictionTimeoutMs", async () => {
    const mw = createResilienceMiddleware({
      requestsPerMinute: 1,
      evictionTimeoutMs: 50,
    });

    // Exhaust tokens for space-ev
    await mw.process(makeContext({ spaceId: "space-ev" }), noop);

    // Should be rate limited now
    await expect(mw.process(makeContext({ spaceId: "space-ev" }), noop)).rejects.toThrow();

    // Wait for eviction timeout
    await new Promise((r) => setTimeout(r, 100));

    // After eviction, the bucket is gone and a fresh one is created
    let called = false;
    await mw.process(makeContext({ spaceId: "space-ev" }), async () => { called = true; });
    expect(called).toBe(true);
  });

  test("does not evict recently accessed entries", async () => {
    const mw = createResilienceMiddleware({
      requestsPerMinute: 100,
      circuitBreakerThreshold: 1,
      circuitBreakerResetMs: 300000,
      evictionTimeoutMs: 50,
    });

    const fail = async () => { throw new Error("fail"); };

    // Trip circuit
    await expect(mw.process(makeContext({ spaceId: "space-noev" }), fail)).rejects.toThrow("fail");

    // Immediately try again — entry was just accessed, should NOT be evicted
    const ctx = makeContext({ spaceId: "space-noev" });
    try {
      await mw.process(ctx, noop);
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitOpenError);
    }
  });

  test("evicts circuit state for stale spaces", async () => {
    const mw = createResilienceMiddleware({
      requestsPerMinute: 100,
      circuitBreakerThreshold: 1,
      circuitBreakerResetMs: 300000, // Long reset so circuit stays open
      evictionTimeoutMs: 50,
    });

    const fail = async () => { throw new Error("fail"); };

    // Trip circuit for space-ev-cb
    await expect(mw.process(makeContext({ spaceId: "space-ev-cb" }), fail)).rejects.toThrow("fail");

    // Verify circuit is open
    await expect(mw.process(makeContext({ spaceId: "space-ev-cb" }), noop)).rejects.toThrow();

    // Wait for eviction
    await new Promise((r) => setTimeout(r, 100));

    // After eviction, circuit state is gone — fresh circuit is closed
    let called = false;
    await mw.process(makeContext({ spaceId: "space-ev-cb" }), async () => { called = true; });
    expect(called).toBe(true);
  });
});
