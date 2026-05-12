import { randomUUID } from "node:crypto";
import {
  MessageTypes,
  type GatewayMessage,
  type SubscribeResponsePayload,
} from "./protocol.js";

export type SubscribePayloadNormalization =
  | { ok: true; spaceUids: string[] }
  | { ok: false; message: string };

export function normalizeSubscribePayload(payload: unknown): SubscribePayloadNormalization {
  if (
    !payload
    || typeof payload !== "object"
    || !Array.isArray((payload as { spaceUids?: unknown }).spaceUids)
  ) {
    return { ok: false, message: "spaceUids[] is required" };
  }

  const requestedSpaceUids = Array.from(
    new Set(
      (payload as { spaceUids: unknown[] }).spaceUids
        .filter((spaceUid): spaceUid is string => typeof spaceUid === "string")
        .map((spaceUid) => spaceUid.trim())
        .filter((spaceUid) => spaceUid.length > 0),
    ),
  );

  if (requestedSpaceUids.length === 0) {
    return {
      ok: false,
      message: "spaceUids[] must include at least one valid spaceUid",
    };
  }

  return { ok: true, spaceUids: requestedSpaceUids };
}

export function buildSubscribeResponseMessage(input: {
  replyTo: string;
  subscribedSpaceUids: string[];
  denied: SubscribeResponsePayload["denied"];
}): GatewayMessage {
  return {
    type: MessageTypes.SUBSCRIBE,
    id: randomUUID(),
    replyTo: input.replyTo,
    ts: new Date().toISOString(),
    payload: {
      subscribedSpaceUids: input.subscribedSpaceUids,
      denied: input.denied,
    } satisfies SubscribeResponsePayload,
  };
}
