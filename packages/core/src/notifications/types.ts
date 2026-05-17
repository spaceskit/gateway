/**
 * Notification types — user-facing alerts from gateway events.
 *
 * Notifications flow through WebSocket push, A2A push, and the EventBus.
 * Clients subscribe to categories and targets to filter what they receive.
 */

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type NotificationCategory =
  | "space.started"
  | "space.failed"
  | "space.paused"
  | "task.progress"
  | "task.input-required"
  | "turn.completed"
  | "turn.failed"
  | "feedback.requested"
  | "feedback.expired"
  | "capability.error"
  | "capability.unavailable"
  | "memory.saved"
  | "memory.consolidated"
  | "experience.created"
  | "experience.accepted"
  | "budget.warning"
  | "budget.exceeded"
  | "security.alert"
  | "agent.delegated"
  | "system.health";

export type NotificationSeverity = "info" | "warning" | "error" | "critical";

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

export type NotificationTarget =
  | { type: "broadcast" }
  | { type: "user"; userId: string }
  | { type: "client"; clientId: string }
  | { type: "space"; spaceId: string }
  | { type: "agent"; agentId: string };

// ---------------------------------------------------------------------------
// Notification
// ---------------------------------------------------------------------------

export interface Notification {
  notificationId: string;
  category: NotificationCategory;
  title: string;
  message: string;
  severity: NotificationSeverity;
  /** Structured payload — shape depends on category. */
  payload: Record<string, unknown>;
  /** Who should receive this notification. */
  targets: NotificationTarget[];
  /** Action URL or deep-link (optional). */
  actionUrl?: string;
  createdAt: Date;
  /** Auto-expire after this time (optional). */
  expiresAt?: Date;
  /** Whether the user has read/dismissed this notification. */
  read?: boolean;
}

export type NotificationPushHandler = (clientId: string, notification: Notification) => Promise<void>;

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export interface NotificationSubscription {
  subscriptionId: string;
  clientId: string;
  /** Categories to receive. Empty = all categories. */
  categories: NotificationCategory[];
  /** Targets to filter. Empty = all targets. */
  targets: NotificationTarget[];
  /** Minimum severity to receive. Default: "info". */
  minSeverity?: NotificationSeverity;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface NotificationService {
  /** Send a notification to matching subscribers. */
  send(notification: Notification): Promise<void>;

  /** Bind or clear the live push delivery callback. */
  setPushHandler(onPush?: NotificationPushHandler): void;

  /** Subscribe a client to notifications. */
  subscribe(
    clientId: string,
    categories: NotificationCategory[],
    targets?: NotificationTarget[],
    minSeverity?: NotificationSeverity,
  ): Promise<NotificationSubscription>;

  /** Unsubscribe a client from a specific subscription. */
  unsubscribe(subscriptionId: string): Promise<void>;

  /** Unsubscribe all subscriptions for a client (on disconnect). */
  unsubscribeAll(clientId: string): Promise<void>;

  /** Get all subscriptions for a client. */
  getSubscriptions(clientId: string): Promise<NotificationSubscription[]>;

  /** Get unread notifications for a client. */
  getUnread(clientId: string, limit?: number): Promise<Notification[]>;

  /** Mark notifications as read. */
  markRead(notificationIds: string[]): Promise<void>;

  /** Get notification delivery stats. */
  getStats(): NotificationStats;
}

export interface NotificationStats {
  totalSent: number;
  totalSubscriptions: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
}
