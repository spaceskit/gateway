import { describe, expect, test } from "bun:test";
import {
  buildNotificationSubscriptionResponseMessage,
  normalizeNotificationCategories,
} from "../src/notification-subscription-protocol.js";
import { MessageTypes } from "../src/protocol.js";

describe("notification subscription protocol helpers", () => {
  test("keeps string categories and drops non-string values", () => {
    expect(normalizeNotificationCategories({
      categories: [" feedback.requested ", "*", 42, null],
    })).toEqual([" feedback.requested ", "*"]);
  });

  test("defaults missing categories to empty", () => {
    expect(normalizeNotificationCategories({})).toEqual([]);
    expect(normalizeNotificationCategories(null)).toEqual([]);
  });

  test("builds notification subscription response envelopes", () => {
    const message = buildNotificationSubscriptionResponseMessage({
      type: MessageTypes.UNSUBSCRIBE_NOTIFICATIONS,
      replyTo: "request-1",
      categories: ["*"],
    });

    expect(message.type).toBe(MessageTypes.UNSUBSCRIBE_NOTIFICATIONS);
    expect(message.replyTo).toBe("request-1");
    expect(message.payload).toEqual({ categories: ["*"] });
    expect(typeof message.id).toBe("string");
    expect(typeof message.ts).toBe("string");
  });
});
