/**
 * DeadLetterRetryService — periodically retries pending dead letters.
 *
 * Runs on a configurable interval, picks up pending dead letters that
 * haven't exceeded their max retry count, and re-executes the turn
 * via SpaceManager. Uses exponential backoff between retries.
 *
 * Lifecycle: call start() to begin, stop() to halt.
 */

import type { EventBus } from "../events/event-bus.js";
import type { DeadLetterQueue, DeadLetter } from "./dead-letter.js";
import type { SpaceManager } from "./space-manager.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DeadLetterRetryOptions {
  eventBus: EventBus;
  deadLetterQueue: DeadLetterQueue;
  spaceManager: SpaceManager;
  /** Interval in ms between retry sweeps. Default: 60000 (1 min). */
  intervalMs?: number;
  /** Max items to retry per sweep. Default: 10. */
  batchSize?: number;
  /** Base delay in ms for exponential backoff. Default: 5000. */
  baseBackoffMs?: number;
  /** Max backoff in ms. Default: 300000 (5 min). */
  maxBackoffMs?: number;
  /** Auto-cleanup resolved/abandoned items older than N days. Default: 7. */
  cleanupAfterDays?: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class DeadLetterRetryService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private options: Required<DeadLetterRetryOptions>;

  constructor(opts: DeadLetterRetryOptions) {
    this.options = {
      intervalMs: opts.intervalMs ?? 60_000,
      batchSize: opts.batchSize ?? 10,
      baseBackoffMs: opts.baseBackoffMs ?? 5_000,
      maxBackoffMs: opts.maxBackoffMs ?? 300_000,
      cleanupAfterDays: opts.cleanupAfterDays ?? 7,
      eventBus: opts.eventBus,
      deadLetterQueue: opts.deadLetterQueue,
      spaceManager: opts.spaceManager,
    };
  }

  /** Start the periodic retry loop. */
  start(): void {
    if (this.timer) return; // Already running

    this.timer = setInterval(() => {
      this.sweep().catch((err) => {
        console.error("[DeadLetterRetry] Sweep error:", err);
      });
    }, this.options.intervalMs);

    // Run an immediate sweep
    this.sweep().catch((err) => {
      console.error("[DeadLetterRetry] Initial sweep error:", err);
    });
  }

  /** Stop the retry loop. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Run a single retry sweep. */
  async sweep(): Promise<{ retried: number; abandoned: number; cleaned: number }> {
    if (this.running) return { retried: 0, abandoned: 0, cleaned: 0 };
    this.running = true;

    let retried = 0;
    let abandoned = 0;

    try {
      const pending = await this.options.deadLetterQueue.listPending(this.options.batchSize);

      for (const dl of pending) {
        // Check if we should retry or abandon
        if (dl.retryCount >= dl.maxRetries) {
          await this.options.deadLetterQueue.abandon(dl.id);
          abandoned++;

          this.options.eventBus.emit({
            type: "dlq.abandoned",
            deadLetterId: dl.id,
            spaceId: dl.spaceId,
            turnId: dl.turnId,
            retryCount: dl.retryCount,
            maxRetries: dl.maxRetries,
            timestamp: new Date(),
          });
          continue;
        }

        // Check backoff — don't retry too soon
        if (!this.isReadyForRetry(dl)) {
          continue;
        }

        // Attempt retry
        try {
          await this.options.deadLetterQueue.markRetrying(dl.id);

          // Re-execute the turn
          await this.options.spaceManager.executeTurn(dl.spaceId, dl.input);

          // If we get here, the turn was accepted (it runs async)
          await this.options.deadLetterQueue.resolve(dl.id);
          retried++;

          this.options.eventBus.emit({
            type: "dlq.retried",
            deadLetterId: dl.id,
            spaceId: dl.spaceId,
            turnId: dl.turnId,
            attempt: dl.retryCount + 1,
            timestamp: new Date(),
          });
        } catch (retryErr) {
          // Retry failed — mark back as pending (retryCount already incremented by markRetrying)
          this.options.eventBus.emit({
            type: "dlq.retry_failed",
            deadLetterId: dl.id,
            spaceId: dl.spaceId,
            turnId: dl.turnId,
            attempt: dl.retryCount + 1,
            error: retryErr instanceof Error ? retryErr.message : String(retryErr),
            timestamp: new Date(),
          });
        }
      }

      // Periodic cleanup of old resolved/abandoned items
      const cleaned = await this.options.deadLetterQueue.cleanup(this.options.cleanupAfterDays);

      return { retried, abandoned, cleaned };
    } finally {
      this.running = false;
    }
  }

  /**
   * Check if enough time has passed since the last retry attempt
   * using exponential backoff.
   */
  private isReadyForRetry(dl: DeadLetter): boolean {
    if (dl.retryHistory.length === 0) return true;

    const lastRetry = new Date(dl.retryHistory[dl.retryHistory.length - 1]).getTime();
    const backoff = Math.min(
      this.options.baseBackoffMs * Math.pow(2, dl.retryCount),
      this.options.maxBackoffMs,
    );

    return Date.now() - lastRetry >= backoff;
  }
}
