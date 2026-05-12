import { describe, expect, test } from "bun:test";
import {
  buildSubscribeResponseMessage,
  normalizeSubscribePayload,
} from "../src/subscription-protocol.js";

describe("subscription protocol helpers", () => {
  test("normalizes subscription spaceUids by trimming and deduping", () => {
    const result = normalizeSubscribePayload({
      spaceUids: [" space-a ", "", "space-a", "space-b", 42],
    });

    expect(result).toEqual({
      ok: true,
      spaceUids: ["space-a", "space-b"],
    });
  });

  test("rejects missing or empty subscription spaceUids", () => {
    expect(normalizeSubscribePayload({})).toEqual({
      ok: false,
      message: "spaceUids[] is required",
    });
    expect(normalizeSubscribePayload({ spaceUids: [" ", 123] })).toEqual({
      ok: false,
      message: "spaceUids[] must include at least one valid spaceUid",
    });
  });

  test("builds subscribe ack envelope", () => {
    const ack = buildSubscribeResponseMessage({
      replyTo: "request-1",
      subscribedSpaceUids: ["space-a"],
      denied: [{ spaceUid: "space-b", reason: "denied" }],
    });

    expect(ack.type).toBe("subscribe");
    expect(ack.replyTo).toBe("request-1");
    expect(ack.payload).toEqual({
      subscribedSpaceUids: ["space-a"],
      denied: [{ spaceUid: "space-b", reason: "denied" }],
    });
    expect(typeof ack.id).toBe("string");
    expect(typeof ack.ts).toBe("string");
  });
});
