import { describe, expect, test } from "bun:test";
import {
  encodeInviteLink,
  decodeInviteLink,
  isV2Link,
} from "../../src/sharing/invite-link-v2.js";
import type { InviteLinkV1, InviteLinkV2 } from "../../src/sharing/invite-link-v2.js";

describe("encodeInviteLink / decodeInviteLink", () => {
  test("v1 link roundtrip", () => {
    const v1: InviteLinkV1 = {
      version: "v1",
      gatewayUrl: "wss://gw.example.com",
      spaceId: "space-abc",
      token: "tok-123",
    };
    const encoded = encodeInviteLink(v1);
    expect(typeof encoded).toBe("string");
    expect(encoded.length).toBeGreaterThan(0);

    const decoded = decodeInviteLink(encoded);
    expect(decoded).toEqual(v1);
  });

  test("v2 link with all fields roundtrip", () => {
    const v2: InviteLinkV2 = {
      version: "v2",
      spaceId: "space-def",
      token: "tok-456",
      gatewayUrl: "wss://gw.local:9320",
      relayHint: "https://relay.example.com",
    };
    const encoded = encodeInviteLink(v2);
    const decoded = decodeInviteLink(encoded);
    expect(decoded).toEqual(v2);
  });

  test("v2 link with only required fields roundtrip", () => {
    const v2: InviteLinkV2 = {
      version: "v2",
      spaceId: "space-minimal",
      token: "tok-min",
    };
    const encoded = encodeInviteLink(v2);
    const decoded = decodeInviteLink(encoded);
    expect(decoded).toEqual(v2);
  });

  test("encoded string is base64url (no +, /, or =)", () => {
    const link: InviteLinkV2 = {
      version: "v2",
      spaceId: "space-special/chars+here",
      token: "tok==padded",
    };
    const encoded = encodeInviteLink(link);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
  });

  test("decode invalid base64 throws", () => {
    expect(() => decodeInviteLink("!!!not-base64!!!")).toThrow("malformed base64");
  });

  test("decode valid base64 but invalid JSON throws", () => {
    // btoa("not json") → base64url
    const encoded = btoa("not json").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(() => decodeInviteLink(encoded)).toThrow("malformed JSON");
  });

  test("decode object without version throws", () => {
    const encoded = btoa(JSON.stringify({ spaceId: "x", token: "y" }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(() => decodeInviteLink(encoded)).toThrow("unknown version");
  });

  test("decode object with missing spaceId throws", () => {
    const encoded = btoa(JSON.stringify({ version: "v2", token: "y" }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(() => decodeInviteLink(encoded)).toThrow("missing or empty spaceId");
  });

  test("decode object with missing token throws", () => {
    const encoded = btoa(JSON.stringify({ version: "v2", spaceId: "x" }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(() => decodeInviteLink(encoded)).toThrow("missing or empty token");
  });

  test("decode v1 without gatewayUrl throws", () => {
    const encoded = btoa(JSON.stringify({ version: "v1", spaceId: "x", token: "y" }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(() => decodeInviteLink(encoded)).toThrow("v1 link requires gatewayUrl");
  });

  test("decode non-object value throws", () => {
    const encoded = btoa('"just a string"')
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(() => decodeInviteLink(encoded)).toThrow("expected object");
  });
});

describe("isV2Link", () => {
  test("returns true for v2 link", () => {
    expect(isV2Link({ version: "v2", spaceId: "s", token: "t" })).toBe(true);
  });

  test("returns false for v1 link", () => {
    expect(
      isV2Link({ version: "v1", gatewayUrl: "wss://x", spaceId: "s", token: "t" }),
    ).toBe(false);
  });
});
