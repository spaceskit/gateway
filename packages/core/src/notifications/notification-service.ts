/**
 * DefaultNotificationService — manages subscriptions and delivery.
 *
 * Hooks into EventBus to automatically convert gateway events into
 * user-facing notifications. Pushes to clients via a WebSocket callback.
 *
 * Architecture:
 * EventBus → NotificationService → WebSocket push → Client
 *                                → A2A push → External agent
 *                                → In-memory store → getUnread()
 */

import type { EventBus, GatewayEvent } from "../events/event-bus.js";
import type {
  Notification,
  NotificationCategory,
  NotificationPushHandler,
  NotificationService,
  NotificationSubscription,
  NotificationTarget,
  NotificationSeverity,
  NotificationStats,
} from "./types.js";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Severity ordering for filtering
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<NotificationSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

// ---------------------------------------------------------------------------
// Event → Notification mapping
// ---------------------------------------------------------------------------

interface EventMapping {
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: (event: GatewayEvent) => string;
  message: (event: GatewayEvent) => string;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

const EVENT_MAPPINGS: Record<string, EventMapping> = {
  "space.turn_started": {
    category: "space.started",
    severity: "info",
    title: () => "Space started",
    message: (e) => `Turn started in space ${readString(e.spaceId)}`,
  },
  "task.progress": {
    category: "task.progress",
    severity: "info",
    title: () => "Task progress",
    message: (e) => normalizeEventMessage(readRecord(e.data)?.message) ?? "Task is still running",
  },
  "task.input-required": {
    category: "task.input-required",
    severity: "warning",
    title: () => "Task input required",
    message: (e) => normalizeEventMessage(readRecord(e.data)?.message) ?? "Task needs additional input",
  },
  "space.turn_event": {
    category: "turn.completed",
    severity: "info",
    title: () => "Turn update",
    message: (e) => {
      const event = readRecord(e.event);
      if (event?.type === "error") {
        const errorMessage = readString(readRecord(event.error)?.message) ?? "Unknown error";
        return `Turn failed: ${errorMessage}`;
      }
      if (event?.type === "turn_completed") return "Agent completed turn";
      if (event?.type === "feedback_requested") return "Agent needs your input";
      return "Turn progress update";
    },
  },
  "budget.warning": {
    category: "budget.warning",
    severity: "warning",
    title: () => "Budget warning",
    message: (e) => `Token budget at ${readNumber(e.percentUsed) ?? "?"}%`,
  },
  "budget.blocked": {
    category: "budget.exceeded",
    severity: "error",
    title: () => "Budget exceeded",
    message: () => "Token budget exhausted — turn blocked",
  },
  "security.secrets_detected": {
    category: "security.alert",
    severity: "critical",
    title: () => "Security alert",
    message: (e) => `Secrets detected in output: ${readNumber(e.count) ?? "?"} items`,
  },
  "experience.created": {
    category: "experience.created",
    severity: "info",
    title: () => "Experience saved",
    message: (e) => `New experience from space ${readString(e.spaceId)}`,
  },
};

function normalizeEventMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DefaultNotificationServiceOptions {
  eventBus: EventBus;
  /** Callback to push a notification to a specific client via WebSocket. */
  onPush?: NotificationPushHandler;
  /** Max notifications to keep in memory per client. Default: 200. */
  maxStoredPerClient?: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class DefaultNotificationService implements NotificationService {
  private subscriptions = new Map<string, NotificationSubscription>();
  private clientSubscriptions = new Map<string, Set<string>>();
  private storedNotifications: Notification[] = [];
  private onPush?: NotificationPushHandler;
  private maxStored: number;
  private stats: NotificationStats = {
    totalSent: 0,
    totalSubscriptions: 0,
    byCategory: {},
    bySeverity: {},
  };

  constructor(options: DefaultNotificationServiceOptions) {
    this.onPush = options.onPush;
    this.maxStored = options.maxStoredPerClient ?? 200;

    // Auto-hook EventBus
    this.hookEventBus(options.eventBus);
  }

  setPushHandler(onPush?: NotificationPushHandler): void {
    this.onPush = onPush;
  }

  private hookEventBus(eventBus: EventBus): void {
    for (const [eventType, mapping] of Object.entries(EVENT_MAPPINGS)) {
      eventBus.on(eventType, async (event: GatewayEvent) => {
        const spaceId = readString(event.spaceId);

        // For turn events, only notify on significant sub-events
        if (eventType === "space.turn_event") {
          const subEvent = readRecord(event.event);
          if (!subEvent) return;
          // Only notify on completions, errors, and feedback requests
          const subEventType = readString(subEvent.type);
          if (!subEventType || !["turn_completed", "error", "feedback_requested"].includes(subEventType)) {
            return;
          }

          // Upgrade severity for errors and feedback
          let severity = mapping.severity;
          let category = mapping.category;
          if (subEventType === "error") {
            severity = "error";
            category = "turn.failed";
          } else if (subEventType === "feedback_requested") {
            severity = "warning";
            category = "feedback.requested";
          }

          await this.send({
            notificationId: randomUUID(),
            category,
            title: mapping.title(event),
            message: mapping.message(event),
            severity,
            payload: event as Record<string, unknown>,
            targets: spaceId ? [{ type: "space", spaceId }] : [{ type: "broadcast" }],
            createdAt: new Date(),
          });
          return;
        }

        await this.send({
          notificationId: randomUUID(),
          category: mapping.category,
          title: mapping.title(event),
          message: mapping.message(event),
          severity: mapping.severity,
          payload: event as Record<string, unknown>,
          targets: spaceId ? [{ type: "space", spaceId }] : [{ type: "broadcast" }],
          createdAt: new Date(),
        });
      });
    }
  }

  // -----------------------------------------------------------------------
  // Send
  // -----------------------------------------------------------------------

  async send(notification: Notification): Promise<void> {
    // Store notification with bounded capacity
    this.storedNotifications.push(notification);
    if (this.storedNotifications.length > this.maxStored) {
      this.storedNotifications = this.storedNotifications.slice(-Math.floor(this.maxStored * 0.8));
    }

    // Update stats
    this.stats.totalSent++;
    this.stats.byCategory[notification.category] = (this.stats.byCategory[notification.category] ?? 0) + 1;
    this.stats.bySeverity[notification.severity] = (this.stats.bySeverity[notification.severity] ?? 0) + 1;

    // Snapshot subscriptions to avoid concurrent modification during async push
    const matchingSubs = Array.from(this.subscriptions.values())
      .filter((sub) => this.subscriptionMatches(sub, notification));

    // Push via WebSocket callback
    for (const sub of matchingSubs) {
      if (this.onPush) {
        try {
          await this.onPush(sub.clientId, notification);
        } catch (err) {
          console.error(`Notification push failed for client ${sub.clientId}:`, err);
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Subscriptions
  // -----------------------------------------------------------------------

  async subscribe(
    clientId: string,
    categories: NotificationCategory[],
    targets: NotificationTarget[] = [],
    minSeverity?: NotificationSeverity,
  ): Promise<NotificationSubscription> {
    const subscriptionId = randomUUID();
    const subscription: NotificationSubscription = {
      subscriptionId,
      clientId,
      categories,
      targets,
      minSeverity,
      createdAt: new Date(),
    };

    this.subscriptions.set(subscriptionId, subscription);

    if (!this.clientSubscriptions.has(clientId)) {
      this.clientSubscriptions.set(clientId, new Set());
    }
    this.clientSubscriptions.get(clientId)!.add(subscriptionId);

    this.stats.totalSubscriptions = this.subscriptions.size;
    return subscription;
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    const sub = this.subscriptions.get(subscriptionId);
    if (sub) {
      this.subscriptions.delete(subscriptionId);
      this.clientSubscriptions.get(sub.clientId)?.delete(subscriptionId);
    }
    this.stats.totalSubscriptions = this.subscriptions.size;
  }

  async unsubscribeAll(clientId: string): Promise<void> {
    const subIds = this.clientSubscriptions.get(clientId);
    if (subIds) {
      for (const id of subIds) {
        this.subscriptions.delete(id);
      }
      this.clientSubscriptions.delete(clientId);
    }
    this.stats.totalSubscriptions = this.subscriptions.size;
  }

  async getSubscriptions(clientId: string): Promise<NotificationSubscription[]> {
    const subIds = this.clientSubscriptions.get(clientId) ?? new Set<string>();
    return Array.from(subIds)
      .map((id) => this.subscriptions.get(id))
      .filter((s): s is NotificationSubscription => s !== undefined);
  }

  // -----------------------------------------------------------------------
  // Stored notifications
  // -----------------------------------------------------------------------

  async getUnread(clientId: string, limit = 50): Promise<Notification[]> {
    // Get client's subscribed targets/categories
    const subs = await this.getSubscriptions(clientId);
    if (subs.length === 0) return [];

    return this.storedNotifications
      .filter((n) => !n.read && subs.some((s) => this.subscriptionMatches(s, n)))
      .slice(-limit)
      .reverse();
  }

  async markRead(notificationIds: string[]): Promise<void> {
    const idSet = new Set(notificationIds);
    for (const n of this.storedNotifications) {
      if (idSet.has(n.notificationId)) {
        n.read = true;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  getStats(): NotificationStats {
    return { ...this.stats };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private subscriptionMatches(sub: NotificationSubscription, notification: Notification): boolean {
    // Category filter
    if (sub.categories.length > 0 && !sub.categories.includes(notification.category)) {
      return false;
    }

    // Severity filter
    if (sub.minSeverity) {
      if (SEVERITY_ORDER[notification.severity] < SEVERITY_ORDER[sub.minSeverity]) {
        return false;
      }
    }

    // Target filter (if subscription has targets, at least one must match)
    if (sub.targets.length > 0) {
      const hasMatch = sub.targets.some((subTarget) =>
        notification.targets.some((nTarget) => this.targetMatches(subTarget, nTarget)),
      );
      if (!hasMatch) return false;
    }

    // Check expiry
    if (notification.expiresAt && notification.expiresAt < new Date()) {
      return false;
    }

    return true;
  }

  private targetMatches(subTarget: NotificationTarget, nTarget: NotificationTarget): boolean {
    if (subTarget.type === "broadcast" || nTarget.type === "broadcast") return true;
    if (subTarget.type !== nTarget.type) return false;

    switch (subTarget.type) {
      case "user": return nTarget.type === "user" && subTarget.userId === nTarget.userId;
      case "client": return nTarget.type === "client" && subTarget.clientId === nTarget.clientId;
      case "space": return nTarget.type === "space" && subTarget.spaceId === nTarget.spaceId;
      case "agent": return nTarget.type === "agent" && subTarget.agentId === nTarget.agentId;
      default: return false;
    }
  }
}
