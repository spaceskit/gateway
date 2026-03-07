/**
 * NotificationHandler — WebSocket integration for push notifications.
 *
 * Bridges the core NotificationService to GatewayServer's WebSocket layer.
 * Registers clients on connect, auto-subscribes to defaults, and cleans up
 * on disconnect.
 */

import type { ServerWebSocket } from "bun";
import type { Notification, NotificationService, NotificationCategory } from "@spaceskit/core";
import type { WSData } from "./gateway-server.js";

export interface NotificationHandlerOptions {
  notificationService: NotificationService;
}

/** Default notification categories clients are auto-subscribed to. */
const DEFAULT_CATEGORIES: NotificationCategory[] = [
  "space.completed",
  "space.failed",
  "turn.completed",
  "turn.failed",
  "feedback.requested",
  "budget.warning",
  "budget.exceeded",
  "security.alert",
  "experience.created",
];

export class NotificationHandler {
  private notificationService: NotificationService;
  private clientSockets = new Map<string, ServerWebSocket<WSData>>();

  constructor(options: NotificationHandlerOptions) {
    this.notificationService = options.notificationService;
  }

  /**
   * Register a client's WebSocket for push notifications.
   * Called when a client connects to the gateway.
   */
  async registerClient(clientId: string, socket: ServerWebSocket<WSData>): Promise<void> {
    this.clientSockets.set(clientId, socket);

    // Auto-subscribe to default notification categories
    await this.notificationService.subscribe(
      clientId,
      DEFAULT_CATEGORIES,
      [{ type: "broadcast" }],
    );
  }

  /**
   * Unregister a client when they disconnect.
   * Cleans up all subscriptions.
   */
  async unregisterClient(clientId: string): Promise<void> {
    this.clientSockets.delete(clientId);
    await this.notificationService.unsubscribeAll(clientId);
  }

  /**
   * Push a notification to a specific client via WebSocket.
   * This is the callback wired into DefaultNotificationService.
   */
  async pushToClient(clientId: string, notification: Notification): Promise<void> {
    const socket = this.clientSockets.get(clientId);
    if (!socket) return;

    try {
      const message = JSON.stringify({
        type: "notification",
        id: notification.notificationId,
        ts: notification.createdAt.toISOString(),
        payload: {
          category: notification.category,
          title: notification.title,
          message: notification.message,
          severity: notification.severity,
          actionUrl: notification.actionUrl,
          data: notification.payload,
        },
      });
      socket.send(message);
    } catch (err) {
      console.error(`Failed to push notification to client ${clientId}:`, err);
      // Socket might be dead — clean up
      this.clientSockets.delete(clientId);
    }
  }

  /** Get the number of connected clients. */
  get connectedClients(): number {
    return this.clientSockets.size;
  }
}
