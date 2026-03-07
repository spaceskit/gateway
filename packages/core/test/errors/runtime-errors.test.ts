import { describe, expect, test } from "bun:test";
import {
  RateLimitError,
  CircuitOpenError,
  ProviderRateLimitError,
} from "../../src/errors/runtime-errors.js";

describe("RateLimitError", () => {
  test("sets code, name, retryAfterMs, and is instanceof Error", () => {
    const err = new RateLimitError({ retryAfterMs: 5000 });

    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.name).toBe("RateLimitError");
    expect(err.retryAfterMs).toBe(5000);
    expect(err.message).toContain("5000ms");
  });

  test("includes spaceId when provided", () => {
    const err = new RateLimitError({ retryAfterMs: 1000, spaceId: "space-42" });

    expect(err.spaceId).toBe("space-42");
  });

  test("uses custom message when provided", () => {
    const err = new RateLimitError({ retryAfterMs: 1000, message: "custom msg" });

    expect(err.message).toBe("custom msg");
  });

  test("generates default message when none provided", () => {
    const err = new RateLimitError({ retryAfterMs: 3000 });

    expect(err.message).toBe("Rate limited — retry after 3000ms");
  });
});

describe("CircuitOpenError", () => {
  test("sets code, name, resetAfterMs, consecutiveFailures, and is instanceof Error", () => {
    const err = new CircuitOpenError({
      resetAfterMs: 60000,
      consecutiveFailures: 7,
    });

    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("CIRCUIT_OPEN");
    expect(err.name).toBe("CircuitOpenError");
    expect(err.resetAfterMs).toBe(60000);
    expect(err.consecutiveFailures).toBe(7);
    expect(err.message).toContain("7 failures");
    expect(err.message).toContain("60000ms");
  });

  test("includes spaceId when provided", () => {
    const err = new CircuitOpenError({
      resetAfterMs: 1000,
      consecutiveFailures: 3,
      spaceId: "space-99",
    });

    expect(err.spaceId).toBe("space-99");
  });

  test("uses custom message when provided", () => {
    const err = new CircuitOpenError({
      resetAfterMs: 1000,
      consecutiveFailures: 5,
      message: "circuit tripped",
    });

    expect(err.message).toBe("circuit tripped");
  });
});

describe("ProviderRateLimitError", () => {
  test("sets code, provider, attempt, maxAttempts, and is instanceof Error", () => {
    const err = new ProviderRateLimitError({
      retryAfterMs: 2000,
      provider: "openai",
      attempt: 1,
      maxAttempts: 3,
    });

    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("PROVIDER_RATE_LIMITED");
    expect(err.name).toBe("ProviderRateLimitError");
    expect(err.retryAfterMs).toBe(2000);
    expect(err.provider).toBe("openai");
    expect(err.attempt).toBe(1);
    expect(err.maxAttempts).toBe(3);
    expect(err.message).toContain("openai");
    expect(err.message).toContain("1/3");
  });
});
