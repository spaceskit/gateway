/**
 * Resilience middleware — rate limiting and circuit breakers.
 *
 * Rate limiting: Token bucket algorithm per space/agent.
 * Circuit breaker: Opens after N failures, resets after cooldown.
 */

import type { Middleware, MiddlewareContext } from "../types.js";
import { RateLimitError, CircuitOpenError } from "../../errors/runtime-errors.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ResilienceMiddlewareOptions {
  /** Max LLM requests per minute per space. Default: 60. */
  requestsPerMinute?: number;
  /** Consecutive failures before circuit opens. Default: 5. */
  circuitBreakerThreshold?: number;
  /** Milliseconds before a tripped circuit resets. Default: 60000. */
  circuitBreakerResetMs?: number;
  /** Milliseconds after which idle entries are evicted. Default: 600000 (10 min). */
  evictionTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  lastAccessedAt: number;
}

interface CircuitState {
  failures: number;
  openedAt: number;
  state: "closed" | "open" | "half-open";
  lastAccessedAt: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createResilienceMiddleware(options: ResilienceMiddlewareOptions = {}): Middleware {
  const {
    requestsPerMinute = 60,
    circuitBreakerThreshold = 5,
    circuitBreakerResetMs = 60000,
    evictionTimeoutMs = 600000,
  } = options;

  const buckets = new Map<string, TokenBucket>();
  const circuits = new Map<string, CircuitState>();

  function evictStaleEntries(now: number): void {
    for (const [key, bucket] of buckets) {
      if (now - bucket.lastAccessedAt > evictionTimeoutMs) {
        buckets.delete(key);
      }
    }
    for (const [key, circuit] of circuits) {
      if (now - circuit.lastAccessedAt > evictionTimeoutMs) {
        circuits.delete(key);
      }
    }
  }

  return {
    name: "resilience",
    layer: "llm",
    order: 3, // Before budget (order 20), after tracing (order 2)
    async process(ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> {
      // Per-space isolation: each space gets its own rate limit + circuit breaker
      const key = ctx.spaceId ?? "global";
      const now = Date.now();

      // Evict stale entries before processing
      evictStaleEntries(now);

      // ---- Rate limiting ----
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tokens: requestsPerMinute, lastRefill: now, lastAccessedAt: now };
        buckets.set(key, bucket);
      }

      bucket.lastAccessedAt = now;

      // Refill tokens based on elapsed time
      const elapsed = now - bucket.lastRefill;
      const refill = (elapsed / 60000) * requestsPerMinute;
      bucket.tokens = Math.min(requestsPerMinute, bucket.tokens + refill);
      bucket.lastRefill = now;

      if (bucket.tokens < 1) {
        const retryAfterMs = Math.ceil(60000 / requestsPerMinute);
        ctx.terminate = true;
        ctx.metadata.rateLimited = true;
        throw new RateLimitError({
          retryAfterMs,
          spaceId: ctx.spaceId,
          message:
            `Rate limit exceeded for ${key}: ${requestsPerMinute} requests/min. ` +
            `Try again in ${Math.ceil(retryAfterMs / 1000)}s.`,
        });
      }

      bucket.tokens -= 1;

      // ---- Circuit breaker ----
      let circuit = circuits.get(key);
      if (!circuit) {
        circuit = { failures: 0, openedAt: 0, state: "closed", lastAccessedAt: now };
        circuits.set(key, circuit);
      }

      circuit.lastAccessedAt = now;

      if (circuit.state === "open") {
        // Check if cooldown has passed
        if (now - circuit.openedAt >= circuitBreakerResetMs) {
          circuit.state = "half-open";
        } else {
          const resetAfterMs = circuitBreakerResetMs - (now - circuit.openedAt);
          ctx.terminate = true;
          ctx.metadata.circuitBroken = true;
          throw new CircuitOpenError({
            resetAfterMs,
            spaceId: ctx.spaceId,
            consecutiveFailures: circuit.failures,
            message:
              `Circuit breaker open for ${key}. ` +
              `Resets in ${Math.ceil(resetAfterMs / 1000)}s.`,
          });
        }
      }

      // ---- Execute ----
      try {
        await next();

        // Success: reset circuit
        if (circuit.state === "half-open" || circuit.failures > 0) {
          circuit.failures = 0;
          circuit.state = "closed";
        }
      } catch (err) {
        // Failure: increment circuit counter
        circuit.failures++;

        if (circuit.failures >= circuitBreakerThreshold) {
          circuit.state = "open";
          circuit.openedAt = now;
        }

        throw err;
      }
    },
  };
}
