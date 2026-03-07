/**
 * Typed runtime errors for resilience and provider routing.
 * These map to GatewayErrorCode values in protocol.ts.
 */

export class RateLimitError extends Error {
  readonly code = "RATE_LIMITED" as const;
  readonly retryAfterMs: number;
  readonly spaceId?: string;

  constructor(opts: { retryAfterMs: number; spaceId?: string; message?: string }) {
    super(opts.message ?? `Rate limited — retry after ${opts.retryAfterMs}ms`);
    this.name = "RateLimitError";
    this.retryAfterMs = opts.retryAfterMs;
    this.spaceId = opts.spaceId;
  }
}

export class CircuitOpenError extends Error {
  readonly code = "CIRCUIT_OPEN" as const;
  readonly resetAfterMs: number;
  readonly spaceId?: string;
  readonly consecutiveFailures: number;

  constructor(opts: { resetAfterMs: number; spaceId?: string; consecutiveFailures: number; message?: string }) {
    super(opts.message ?? `Circuit open — ${opts.consecutiveFailures} failures, resets in ${opts.resetAfterMs}ms`);
    this.name = "CircuitOpenError";
    this.resetAfterMs = opts.resetAfterMs;
    this.spaceId = opts.spaceId;
    this.consecutiveFailures = opts.consecutiveFailures;
  }
}

export class ProviderRateLimitError extends Error {
  readonly code = "PROVIDER_RATE_LIMITED" as const;
  readonly retryAfterMs: number;
  readonly provider: string;
  readonly attempt: number;
  readonly maxAttempts: number;

  constructor(opts: { retryAfterMs: number; provider: string; attempt: number; maxAttempts: number }) {
    super(`Provider ${opts.provider} rate limited (attempt ${opts.attempt}/${opts.maxAttempts}) — retry after ${opts.retryAfterMs}ms`);
    this.name = "ProviderRateLimitError";
    this.retryAfterMs = opts.retryAfterMs;
    this.provider = opts.provider;
    this.attempt = opts.attempt;
    this.maxAttempts = opts.maxAttempts;
  }
}
