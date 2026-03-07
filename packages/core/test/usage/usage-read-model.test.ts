import { describe, expect, test } from "bun:test";
import {
  shouldDeferUsageLoad,
  isUsageStale,
  toUsageSummary,
} from "../../src/usage/usage-read-model.js";
import type {
  UsageLoadPhase,
  GatewayCoreSummary,
  UsageDetailReadModel,
  UsageSummaryReadModel,
} from "../../src/usage/usage-read-model.js";

// ---------------------------------------------------------------------------
// shouldDeferUsageLoad
// ---------------------------------------------------------------------------

describe("shouldDeferUsageLoad", () => {
  test("core phase returns false (not deferred)", () => {
    expect(shouldDeferUsageLoad("core")).toBe(false);
  });

  test("usage_summary phase returns true (deferred)", () => {
    expect(shouldDeferUsageLoad("usage_summary")).toBe(true);
  });

  test("usage_detail phase returns true (deferred)", () => {
    expect(shouldDeferUsageLoad("usage_detail")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isUsageStale
// ---------------------------------------------------------------------------

describe("isUsageStale", () => {
  test("fresh timestamp (1s ago) returns false", () => {
    const oneSecondAgo = new Date(Date.now() - 1_000).toISOString();
    expect(isUsageStale(oneSecondAgo)).toBe(false);
  });

  test("stale timestamp (60s ago) returns true", () => {
    const sixtySecondsAgo = new Date(Date.now() - 60_000).toISOString();
    expect(isUsageStale(sixtySecondsAgo)).toBe(true);
  });

  test("custom maxAgeMs is respected", () => {
    const fiveSecondsAgo = new Date(Date.now() - 5_000).toISOString();
    // 5s old with 3s max -> stale
    expect(isUsageStale(fiveSecondsAgo, 3_000)).toBe(true);
    // 5s old with 10s max -> fresh
    expect(isUsageStale(fiveSecondsAgo, 10_000)).toBe(false);
  });

  test("exact boundary (age === maxAge) returns true", () => {
    const now = Date.now();
    const exactlyAtBoundary = new Date(now - 30_000).toISOString();
    // At the boundary, (now - computedAt) >= maxAgeMs should be true
    expect(isUsageStale(exactlyAtBoundary, 30_000)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// toUsageSummary
// ---------------------------------------------------------------------------

describe("toUsageSummary", () => {
  const computedAt = "2026-02-28T12:00:00.000Z";

  test("maps window fields correctly", () => {
    const window = {
      inputTokens: 1000,
      outputTokens: 2000,
      totalTokens: 3000,
      spentUsd: 0.045,
    };
    const result = toUsageSummary(window, "last5h", computedAt);

    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(2000);
    expect(result.totalTokens).toBe(3000);
    expect(result.spentUsd).toBe(0.045);
  });

  test("handles undefined window (returns zeros)", () => {
    const result = toUsageSummary(undefined, "last7d", computedAt);

    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.totalTokens).toBe(0);
    expect(result.spentUsd).toBe(0);
  });

  test("preserves windowLabel and computedAt", () => {
    const window = {
      inputTokens: 500,
      outputTokens: 750,
      totalTokens: 1250,
      spentUsd: 0.012,
    };
    const result = toUsageSummary(window, "lifetime", computedAt);

    expect(result.windowLabel).toBe("lifetime");
    expect(result.computedAt).toBe(computedAt);
  });
});

// ---------------------------------------------------------------------------
// Type shape checks
// ---------------------------------------------------------------------------

describe("GatewayCoreSummary", () => {
  test("has no usage-related fields", () => {
    const summary: GatewayCoreSummary = {
      providerId: "openai",
      model: "gpt-4",
      status: "configured",
      connectionStatus: "connected",
    };

    const keys = Object.keys(summary);
    expect(keys).not.toContain("inputTokens");
    expect(keys).not.toContain("outputTokens");
    expect(keys).not.toContain("totalTokens");
    expect(keys).not.toContain("spentUsd");
    expect(keys).not.toContain("sessionCount");
    expect(keys.sort()).toEqual(["connectionStatus", "model", "providerId", "status"]);
  });
});

describe("UsageDetailReadModel", () => {
  test("includes providerBreakdown and sessionCount", () => {
    const detail: UsageDetailReadModel = {
      windowLabel: "last30d",
      inputTokens: 10000,
      outputTokens: 20000,
      totalTokens: 30000,
      spentUsd: 1.5,
      providerBreakdown: [
        {
          providerId: "openai",
          inputTokens: 10000,
          outputTokens: 20000,
          totalTokens: 30000,
          spentUsd: 1.5,
        },
      ],
      sessionCount: 42,
      computedAt: "2026-02-28T12:00:00.000Z",
    };

    expect(detail.providerBreakdown).toHaveLength(1);
    expect(detail.providerBreakdown[0].providerId).toBe("openai");
    expect(detail.sessionCount).toBe(42);
  });
});
