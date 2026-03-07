import { describe, expect, test } from "bun:test";
import {
  computeRetryDecision,
  DEFAULT_PROVIDER_RETRY_CONFIG,
} from "../../src/agents/provider-retry.js";
import type { ProviderRetryConfig } from "../../src/agents/provider-retry.js";

describe("DEFAULT_PROVIDER_RETRY_CONFIG", () => {
  test("has expected default values", () => {
    expect(DEFAULT_PROVIDER_RETRY_CONFIG.baseBackoffMs).toBe(1000);
    expect(DEFAULT_PROVIDER_RETRY_CONFIG.maxBackoffMs).toBe(60000);
    expect(DEFAULT_PROVIDER_RETRY_CONFIG.maxAttempts).toBe(3);
  });
});

describe("computeRetryDecision", () => {
  const config: ProviderRetryConfig = {
    baseBackoffMs: 1000,
    maxBackoffMs: 60000,
    maxAttempts: 3,
  };

  test("first attempt returns shouldRetry true with backoff", () => {
    const decision = computeRetryDecision(0, config);

    expect(decision.shouldRetry).toBe(true);
    expect(decision.delayMs).toBeGreaterThan(0);
    expect(decision.attempt).toBe(0);
    expect(decision.maxAttempts).toBe(3);
    // Backoff for attempt 0: base * 2^0 = 1000, with jitter [500, 1000]
    expect(decision.delayMs).toBeGreaterThanOrEqual(500);
    expect(decision.delayMs).toBeLessThanOrEqual(1000);
  });

  test("second attempt has larger backoff", () => {
    const decision = computeRetryDecision(1, config);

    expect(decision.shouldRetry).toBe(true);
    // Backoff for attempt 1: base * 2^1 = 2000, with jitter [1000, 2000]
    expect(decision.delayMs).toBeGreaterThanOrEqual(1000);
    expect(decision.delayMs).toBeLessThanOrEqual(2000);
  });

  test("max attempts reached returns shouldRetry false", () => {
    const decision = computeRetryDecision(3, config);

    expect(decision.shouldRetry).toBe(false);
    expect(decision.delayMs).toBe(0);
    expect(decision.attempt).toBe(3);
    expect(decision.maxAttempts).toBe(3);
  });

  test("beyond max attempts returns shouldRetry false", () => {
    const decision = computeRetryDecision(5, config);

    expect(decision.shouldRetry).toBe(false);
    expect(decision.delayMs).toBe(0);
  });

  test("retryAfterHeader is respected", () => {
    const decision = computeRetryDecision(0, config, 5000);

    expect(decision.shouldRetry).toBe(true);
    expect(decision.delayMs).toBe(5000);
  });

  test("retryAfterHeader is capped at maxBackoffMs", () => {
    const decision = computeRetryDecision(0, config, 120000);

    expect(decision.shouldRetry).toBe(true);
    expect(decision.delayMs).toBe(60000); // capped
  });

  test("retryAfterHeader zero or negative falls back to exponential", () => {
    const decisionZero = computeRetryDecision(0, config, 0);
    expect(decisionZero.shouldRetry).toBe(true);
    // Falls through to exponential because retryAfterHeaderMs is not > 0
    expect(decisionZero.delayMs).toBeGreaterThanOrEqual(500);
    expect(decisionZero.delayMs).toBeLessThanOrEqual(1000);

    const decisionNeg = computeRetryDecision(0, config, -100);
    expect(decisionNeg.shouldRetry).toBe(true);
    expect(decisionNeg.delayMs).toBeGreaterThanOrEqual(500);
  });

  test("jitter produces varying delays", () => {
    const delays = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const decision = computeRetryDecision(0, config);
      delays.add(decision.delayMs);
    }
    // With 20 attempts and random jitter, we should get more than 1 unique delay
    expect(delays.size).toBeGreaterThan(1);
  });

  test("backoff is capped at maxBackoffMs", () => {
    const smallCap: ProviderRetryConfig = {
      baseBackoffMs: 1000,
      maxBackoffMs: 3000,
      maxAttempts: 10,
    };

    // Attempt 5: base * 2^5 = 32000, should be capped to 3000
    const decision = computeRetryDecision(5, smallCap);

    expect(decision.shouldRetry).toBe(true);
    expect(decision.delayMs).toBeLessThanOrEqual(3000);
  });

  test("uses DEFAULT_PROVIDER_RETRY_CONFIG when no config provided", () => {
    const decision = computeRetryDecision(0);

    expect(decision.shouldRetry).toBe(true);
    expect(decision.maxAttempts).toBe(3);
    expect(decision.delayMs).toBeGreaterThan(0);
  });
});
