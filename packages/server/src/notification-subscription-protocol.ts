import { randomUUID } from "node:crypto";
import { MessageTypes, type GatewayMessage } from "./protocol.js";

export function normalizeNotificationCategories(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const categories = (payload as { categories?: unknown }).categories;
  return Array.isArray(categories)
    ? categories.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function buildNotificationSubscriptionResponseMessage(input: {
  type: typeof MessageTypes.SUBSCRIBE_NOTIFICATIONS | typeof MessageTypes.UNSUBSCRIBE_NOTIFICATIONS;
  replyTo: string;
  categories: string[];
}): GatewayMessage {
  return {
    type: input.type,
    id: randomUUID(),
    replyTo: input.replyTo,
    ts: new Date().toISOString(),
    payload: {
      categories: input.categories,
    },
  };
}
