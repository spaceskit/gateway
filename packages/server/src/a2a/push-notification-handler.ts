/**
 * A2A Push Notification Handler — webhook-based push per A2A spec.
 *
 * When a task completes or changes status, pushes a notification
 * to the webhook URL provided by the task creator. Supports
 * exponential backoff retry.
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PushStatus = "queued" | "sending" | "sent" | "failed" | "retrying";

export interface A2APushNotification {
  pushId: string;
  taskId: string;
  event: "task.completed" | "task.failed" | "task.progress" | "task.input-required";
  payload: Record<string, unknown>;
  webhookUrl: string;
  status: PushStatus;
  retryCount: number;
  maxRetries: number;
  lastError?: string;
  sentAt?: Date;
  createdAt: Date;
}

export interface A2APushConfig {
  /** Max retry attempts. Default: 3. */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms. Default: 1000. */
  baseDelayMs?: number;
  /** Request timeout in ms. Default: 10000. */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export class A2APushNotificationHandler {
  private queue: A2APushNotification[] = [];
  private config: Required<A2APushConfig>;

  constructor(config: A2APushConfig = {}) {
    this.config = {
      maxRetries: config.maxRetries ?? 3,
      baseDelayMs: config.baseDelayMs ?? 1000,
      timeoutMs: config.timeoutMs ?? 10000,
    };
  }

  /**
   * Queue a push notification for delivery.
   */
  async push(
    taskId: string,
    event: A2APushNotification["event"],
    payload: Record<string, unknown>,
    webhookUrl: string,
  ): Promise<A2APushNotification> {
    const notification: A2APushNotification = {
      pushId: randomUUID(),
      taskId,
      event,
      payload,
      webhookUrl,
      status: "queued",
      retryCount: 0,
      maxRetries: this.config.maxRetries,
      createdAt: new Date(),
    };

    this.queue.push(notification);

    // Prune old resolved notifications to prevent unbounded growth
    const MAX_QUEUE_SIZE = 5000;
    if (this.queue.length > MAX_QUEUE_SIZE) {
      this.queue = this.queue.filter(
        (n) => n.status === "queued" || n.status === "retrying" ||
               (Date.now() - n.createdAt.getTime() < 60 * 60 * 1000), // keep < 1 hour
      );
    }

    // Process immediately (fire-and-forget)
    this.deliver(notification).catch((err) => {
      console.error(`A2A push delivery failed for task ${taskId}:`, err);
    });

    return notification;
  }

  /**
   * Get delivery stats.
   */
  getStats(): {
    queued: number;
    sent: number;
    failed: number;
    retrying: number;
  } {
    return {
      queued: this.queue.filter((n) => n.status === "queued").length,
      sent: this.queue.filter((n) => n.status === "sent").length,
      failed: this.queue.filter((n) => n.status === "failed").length,
      retrying: this.queue.filter((n) => n.status === "retrying").length,
    };
  }

  /**
   * Get recent push notifications.
   */
  getRecent(limit = 20): A2APushNotification[] {
    return this.queue.slice(-limit).reverse();
  }

  // -----------------------------------------------------------------------
  // Delivery
  // -----------------------------------------------------------------------

  private async deliver(notification: A2APushNotification): Promise<void> {
    for (let attempt = 0; attempt <= notification.maxRetries; attempt++) {
      notification.status = attempt === 0 ? "sending" : "retrying";
      notification.retryCount = attempt;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

        const response = await fetch(notification.webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-A2A-Event": notification.event,
            "X-A2A-Task-Id": notification.taskId,
            "X-A2A-Push-Id": notification.pushId,
            "X-A2A-Attempt": String(attempt + 1),
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: notification.event,
            params: {
              taskId: notification.taskId,
              ...notification.payload,
            },
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.ok) {
          notification.status = "sent";
          notification.sentAt = new Date();
          return;
        }

        notification.lastError = `HTTP ${response.status}: ${response.statusText}`;
      } catch (err) {
        notification.lastError = err instanceof Error ? err.message : String(err);
      }

      // Wait before retry (exponential backoff)
      if (attempt < notification.maxRetries) {
        const delay = this.config.baseDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    notification.status = "failed";
  }
}
