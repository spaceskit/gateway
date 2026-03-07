/**
 * Usage read model — lightweight types for lazy loading gateway detail.
 * Pure functions — no I/O, no logging.
 */

// ---------------------------------------------------------------------------
// Load Phases
// ---------------------------------------------------------------------------

/** Three phases of gateway detail loading */
export type UsageLoadPhase = "core" | "usage_summary" | "usage_detail";

/**
 * Returns true if usage data should be deferred (not loaded in core phase).
 */
export function shouldDeferUsageLoad(phase: UsageLoadPhase): boolean {
  return phase !== "core";
}

// ---------------------------------------------------------------------------
// Lightweight Summary (no sessions, no per-provider breakdown)
// ---------------------------------------------------------------------------

export interface UsageSummaryReadModel {
  windowLabel: string;          // e.g. "last5h", "last7d", "last30d", "lifetime"
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  spentUsd: number;
  computedAt: string;           // ISO timestamp
}

// ---------------------------------------------------------------------------
// Core Summary (provider metadata only, NO usage)
// ---------------------------------------------------------------------------

export interface GatewayCoreSummary {
  providerId: string;
  model: string;
  status: string;               // e.g. "configured", "active", "error"
  connectionStatus: string;     // e.g. "connected", "disconnected"
}

// ---------------------------------------------------------------------------
// Full Detail (deferred load)
// ---------------------------------------------------------------------------

export interface UsageDetailReadModel {
  windowLabel: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  spentUsd: number;
  providerBreakdown: ProviderUsageSummary[];
  sessionCount: number;
  computedAt: string;
}

export interface ProviderUsageSummary {
  providerId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  spentUsd: number;
}

// ---------------------------------------------------------------------------
// Staleness Check
// ---------------------------------------------------------------------------

/**
 * Returns true if the cached usage snapshot is older than maxAgeMs.
 * Default maxAge: 30000ms (30 seconds).
 */
export function isUsageStale(computedAtIso: string, maxAgeMs: number = 30000): boolean {
  const computedAt = new Date(computedAtIso).getTime();
  const now = Date.now();
  return (now - computedAt) >= maxAgeMs;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

export interface UsageWindowInput {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  spentUsd: number;
}

/**
 * Maps a usage window from a full snapshot to a lightweight summary.
 */
export function toUsageSummary(
  window: UsageWindowInput | undefined,
  windowLabel: string,
  computedAtIso: string,
): UsageSummaryReadModel {
  if (!window) {
    return {
      windowLabel,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      spentUsd: 0,
      computedAt: computedAtIso,
    };
  }

  return {
    windowLabel,
    inputTokens: window.inputTokens,
    outputTokens: window.outputTokens,
    totalTokens: window.totalTokens,
    spentUsd: window.spentUsd,
    computedAt: computedAtIso,
  };
}
