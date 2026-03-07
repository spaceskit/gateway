import { describe, expect, test } from "bun:test";
import {
  parseInviteInput,
  prepareInviteJoin,
} from "../../src/sharing/invite-handler.js";
import { encodeInviteLink } from "../../src/sharing/invite-link-v2.js";
import type { InviteLinkV1, InviteLinkV2 } from "../../src/sharing/invite-link-v2.js";

// Helper: create a base64url-encoded v2 link
function makeEncodedV2(overrides?: Partial<InviteLinkV2>): string {
  const link: InviteLinkV2 = {
    version: "v2",
    spaceId: "space-test",
    token: "tok-test",
    ...overrides,
  };
  return encodeInviteLink(link);
}

// Helper: create a base64url-encoded v1 link
function makeEncodedV1(overrides?: Partial<InviteLinkV1>): string {
  const link: InviteLinkV1 = {
    version: "v1",
    gatewayUrl: "wss://gw.example.com",
    spaceId: "space-v1",
    token: "tok-v1",
    ...overrides,
  };
  return encodeInviteLink(link);
}

describe("parseInviteInput", () => {
  test("base64url encoded v2 link parses correctly", () => {
    const encoded = makeEncodedV2({ spaceId: "sp-abc", token: "tok-xyz" });
    const result = parseInviteInput(encoded);
    expect(result.version).toBe("v2");
    expect(result.spaceId).toBe("sp-abc");
    expect(result.token).toBe("tok-xyz");
  });

  test("base64url encoded v1 link parses correctly", () => {
    const encoded = makeEncodedV1();
    const result = parseInviteInput(encoded);
    expect(result.version).toBe("v1");
    expect(result.spaceId).toBe("space-v1");
    if (result.version === "v1") {
      expect(result.gatewayUrl).toBe("wss://gw.example.com");
    }
  });

  test("raw JSON v2 string parses correctly", () => {
    const json = JSON.stringify({
      version: "v2",
      spaceId: "sp-json",
      token: "tok-json",
    });
    const result = parseInviteInput(json);
    expect(result.version).toBe("v2");
    expect(result.spaceId).toBe("sp-json");
    expect(result.token).toBe("tok-json");
  });

  test("raw JSON v1 string parses correctly", () => {
    const json = JSON.stringify({
      version: "v1",
      gatewayUrl: "wss://gw.local",
      spaceId: "sp-v1-json",
      token: "tok-v1-json",
    });
    const result = parseInviteInput(json);
    expect(result.version).toBe("v1");
    expect(result.spaceId).toBe("sp-v1-json");
  });

  test("spaceskit://invite/ENCODED deep link parses correctly", () => {
    const encoded = makeEncodedV2({ spaceId: "sp-deep", token: "tok-deep" });
    const deepLink = `spaceskit://invite/${encoded}`;
    const result = parseInviteInput(deepLink);
    expect(result.version).toBe("v2");
    expect(result.spaceId).toBe("sp-deep");
    expect(result.token).toBe("tok-deep");
  });

  test("deep link with query string is stripped", () => {
    const encoded = makeEncodedV2({ spaceId: "sp-qs", token: "tok-qs" });
    const deepLink = `spaceskit://invite/${encoded}?ref=share`;
    const result = parseInviteInput(deepLink);
    expect(result.spaceId).toBe("sp-qs");
  });

  test("deep link with fragment is stripped", () => {
    const encoded = makeEncodedV2({ spaceId: "sp-frag", token: "tok-frag" });
    const deepLink = `spaceskit://invite/${encoded}#section`;
    const result = parseInviteInput(deepLink);
    expect(result.spaceId).toBe("sp-frag");
  });

  test("empty string throws", () => {
    expect(() => parseInviteInput("")).toThrow("empty string");
  });

  test("whitespace-only string throws", () => {
    expect(() => parseInviteInput("   ")).toThrow("empty string");
  });

  test("empty deep link payload throws", () => {
    expect(() => parseInviteInput("spaceskit://invite/")).toThrow(
      "empty deep link payload",
    );
  });

  test("invalid input (not base64, not JSON, not deep link) throws", () => {
    expect(() => parseInviteInput("hello world this is garbage")).toThrow(
      "not a recognized format",
    );
  });

  test("deep link with invalid base64 throws", () => {
    expect(() =>
      parseInviteInput("spaceskit://invite/!!!invalid!!!"),
    ).toThrow("deep link decode failed");
  });

  test("input with leading/trailing whitespace is trimmed", () => {
    const encoded = makeEncodedV2({ spaceId: "sp-trim", token: "tok-trim" });
    const result = parseInviteInput(`  ${encoded}  `);
    expect(result.spaceId).toBe("sp-trim");
  });
});

describe("prepareInviteJoin", () => {
  test("valid v2 link with relay endpoint -> status=joining with relay route", () => {
    const encoded = makeEncodedV2({
      spaceId: "sp-relay",
      token: "tok-relay",
    });
    const result = prepareInviteJoin({
      rawInput: encoded,
      source: "clipboard",
      relayEndpoint: "https://relay.example.com",
    });
    expect(result.status).toBe("joining");
    expect(result.link).toBeDefined();
    expect(result.link!.spaceId).toBe("sp-relay");
    expect(result.route).toBeDefined();
    expect(result.route!.route).toBe("relay_proxy");
    expect(result.route!.endpoint).toBe("https://relay.example.com");
    expect(result.details).toContain("sp-relay");
  });

  test("valid v2 link with direct reachable + gatewayUrl -> direct route", () => {
    const encoded = makeEncodedV2({
      spaceId: "sp-direct",
      token: "tok-direct",
      gatewayUrl: "wss://gw.local:9320",
    });
    const result = prepareInviteJoin({
      rawInput: encoded,
      source: "paste",
      directReachable: true,
    });
    expect(result.status).toBe("joining");
    expect(result.route!.route).toBe("direct");
    expect(result.route!.endpoint).toBe("wss://gw.local:9320");
  });

  test("valid v1 link -> direct route", () => {
    const encoded = makeEncodedV1({
      gatewayUrl: "wss://gw.v1.com",
      spaceId: "sp-v1",
      token: "tok-v1",
    });
    const result = prepareInviteJoin({
      rawInput: encoded,
      source: "deep_link",
    });
    expect(result.status).toBe("joining");
    expect(result.link!.version).toBe("v1");
    expect(result.route!.route).toBe("direct");
    expect(result.route!.endpoint).toBe("wss://gw.v1.com");
  });

  test("invalid input -> status=failed with error", () => {
    const result = prepareInviteJoin({
      rawInput: "totally-invalid-stuff-here-not-base64",
      source: "paste",
    });
    expect(result.status).toBe("failed");
    expect(result.error).toBeDefined();
    expect(result.link).toBeUndefined();
    expect(result.route).toBeUndefined();
    expect(result.details).toContain("Failed to parse");
  });

  test("empty input -> status=failed", () => {
    const result = prepareInviteJoin({
      rawInput: "",
      source: "clipboard",
    });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("empty string");
  });

  test("source is reflected in error details", () => {
    const result = prepareInviteJoin({
      rawInput: "bad-input",
      source: "qr_scan",
    });
    expect(result.status).toBe("failed");
    expect(result.details).toContain("qr_scan");
  });

  test("v2 link with relayHint uses relay route when not directly reachable", () => {
    const encoded = makeEncodedV2({
      spaceId: "sp-hint",
      token: "tok-hint",
      relayHint: "https://relay.hint.com",
      gatewayUrl: "wss://gw.unreachable.com",
    });
    const result = prepareInviteJoin({
      rawInput: encoded,
      source: "deep_link",
      directReachable: false,
    });
    expect(result.status).toBe("joining");
    expect(result.route!.route).toBe("relay_proxy");
    expect(result.route!.endpoint).toBe("https://relay.hint.com");
    expect(result.route!.fallbackEndpoint).toBe("wss://gw.unreachable.com");
  });

  test("v2 direct reachable with relay fallback", () => {
    const encoded = makeEncodedV2({
      spaceId: "sp-both",
      token: "tok-both",
      gatewayUrl: "wss://gw.local:9320",
      relayHint: "https://relay.fallback.com",
    });
    const result = prepareInviteJoin({
      rawInput: encoded,
      source: "clipboard",
      directReachable: true,
    });
    expect(result.status).toBe("joining");
    expect(result.route!.route).toBe("direct");
    expect(result.route!.endpoint).toBe("wss://gw.local:9320");
    expect(result.route!.fallbackEndpoint).toBe("https://relay.fallback.com");
  });
});
