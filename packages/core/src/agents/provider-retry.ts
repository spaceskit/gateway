/**
 * Rate limit auto-retry with exponential backoff for provider 429 responses.
 * Pure utility — caller handles actual I/O.
 */

export interface ProviderRetryConfig {
  baseBackoffMs: number;    // default 1000
  maxBackoffMs: number;     // default 60000
  maxAttempts: number;      // default 3
}

export const DEFAULT_PROVIDER_RETRY_CONFIG: ProviderRetryConfig = {
  baseBackoffMs: 1000,
  maxBackoffMs: 60000,
  maxAttempts: 3,
};

export interface RetryDecision {
  shouldRetry: boolean;
  delayMs: number;
  attempt: number;
  maxAttempts: number;
}

/**
 * Given a 429 response and current attempt count, decide whether to retry and how long to wait.
 * Uses exponential backoff with jitter.
 */
export function computeRetryDecision(
  attempt: number,
  config: ProviderRetryConfig = DEFAULT_PROVIDER_RETRY_CONFIG,
  retryAfterHeaderMs?: number,
): RetryDecision {
  if (attempt >= config.maxAttempts) {
    return { shouldRetry: false, delayMs: 0, attempt, maxAttempts: config.maxAttempts };
  }

  // Prefer Retry-After header if provided
  if (retryAfterHeaderMs !== undefined && retryAfterHeaderMs > 0) {
    const delay = Math.min(retryAfterHeaderMs, config.maxBackoffMs);
    return { shouldRetry: true, delayMs: delay, attempt, maxAttempts: config.maxAttempts };
  }

  // Exponential backoff with jitter
  const exponential = config.baseBackoffMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, config.maxBackoffMs);
  const jittered = capped * (0.5 + Math.random() * 0.5);

  return {
    shouldRetry: true,
    delayMs: Math.round(jittered),
    attempt,
    maxAttempts: config.maxAttempts,
  };
}
