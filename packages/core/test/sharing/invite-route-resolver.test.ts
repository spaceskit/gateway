import { describe, expect, test } from "bun:test";
import { resolveInviteRoute } from "../../src/sharing/invite-route-resolver.js";
import type { InviteLinkV1, InviteLinkV2 } from "../../src/sharing/invite-link-v2.js";
import type { RouteResolverInput } from "../../src/sharing/invite-route-resolver.js";

describe("resolveInviteRoute", () => {
  const v1Link: InviteLinkV1 = {
    version: "v1",
    gatewayUrl: "wss://gw.example.com",
    spaceId: "space-1",
    token: "tok-1",
  };

  const v2LinkFull: InviteLinkV2 = {
    version: "v2",
    spaceId: "space-2",
    token: "tok-2",
    gatewayUrl: "wss://gw.local:9320",
    relayHint: "https://relay.example.com",
  };

  const v2LinkNoGateway: InviteLinkV2 = {
    version: "v2",
    spaceId: "space-3",
    token: "tok-3",
    relayHint: "https://relay.example.com",
  };

  const v2LinkBare: InviteLinkV2 = {
    version: "v2",
    spaceId: "space-4",
    token: "tok-4",
  };

  test("v1 link always returns direct route", () => {
    const result = resolveInviteRoute({ link: v1Link });
    expect(result.route).toBe("direct");
    expect(result.endpoint).toBe("wss://gw.example.com");
    expect(result.reason).toBeTruthy();
  });

  test("v2 link + direct reachable + gatewayUrl returns direct with relay fallback", () => {
    const result = resolveInviteRoute({
      link: v2LinkFull,
      directReachable: true,
    });
    expect(result.route).toBe("direct");
    expect(result.endpoint).toBe("wss://gw.local:9320");
    expect(result.fallbackEndpoint).toBe("https://relay.example.com");
    expect(result.reason).toBeTruthy();
  });

  test("v2 link + direct reachable + relay endpoint overrides relayHint for fallback", () => {
    const result = resolveInviteRoute({
      link: v2LinkFull,
      directReachable: true,
      relayEndpoint: "https://custom-relay.com",
    });
    expect(result.route).toBe("direct");
    expect(result.endpoint).toBe("wss://gw.local:9320");
    expect(result.fallbackEndpoint).toBe("https://custom-relay.com");
  });

  test("v2 link + not direct reachable + relay endpoint returns relay_proxy", () => {
    const result = resolveInviteRoute({
      link: v2LinkFull,
      directReachable: false,
      relayEndpoint: "https://relay.prod.com",
    });
    expect(result.route).toBe("relay_proxy");
    expect(result.endpoint).toBe("https://relay.prod.com");
    expect(result.fallbackEndpoint).toBe("wss://gw.local:9320");
    expect(result.reason).toBeTruthy();
  });

  test("v2 link + not direct reachable + relayHint (no explicit relay) returns relay_proxy", () => {
    const result = resolveInviteRoute({
      link: v2LinkFull,
      directReachable: false,
    });
    expect(result.route).toBe("relay_proxy");
    expect(result.endpoint).toBe("https://relay.example.com");
    expect(result.fallbackEndpoint).toBe("wss://gw.local:9320");
  });

  test("v2 link + not direct reachable + no relay endpoint returns direct (only option)", () => {
    const v2NoRelay: InviteLinkV2 = {
      version: "v2",
      spaceId: "space-5",
      token: "tok-5",
      gatewayUrl: "wss://gw.local:9320",
    };
    const result = resolveInviteRoute({
      link: v2NoRelay,
      directReachable: false,
    });
    expect(result.route).toBe("direct");
    expect(result.endpoint).toBe("wss://gw.local:9320");
    expect(result.reason).toContain("no relay");
  });

  test("v2 link + no gatewayUrl + relay endpoint returns relay_proxy", () => {
    const result = resolveInviteRoute({
      link: v2LinkNoGateway,
      relayEndpoint: "https://relay.prod.com",
    });
    expect(result.route).toBe("relay_proxy");
    expect(result.endpoint).toBe("https://relay.prod.com");
    expect(result.fallbackEndpoint).toBeUndefined();
    expect(result.reason).toContain("no direct gateway URL");
  });

  test("v2 link + no gatewayUrl + relayHint returns relay_proxy via hint", () => {
    const result = resolveInviteRoute({
      link: v2LinkNoGateway,
    });
    expect(result.route).toBe("relay_proxy");
    expect(result.endpoint).toBe("https://relay.example.com");
  });

  test("v2 link + no gatewayUrl + no relay returns direct with empty endpoint", () => {
    const result = resolveInviteRoute({
      link: v2LinkBare,
    });
    expect(result.route).toBe("direct");
    expect(result.endpoint).toBe("");
    expect(result.reason).toContain("no relay or gateway URL");
  });

  test("all results have non-empty reason string", () => {
    const inputs: RouteResolverInput[] = [
      { link: v1Link },
      { link: v2LinkFull, directReachable: true },
      { link: v2LinkFull, directReachable: false, relayEndpoint: "https://r.com" },
      { link: v2LinkBare },
      { link: v2LinkNoGateway, relayEndpoint: "https://r.com" },
    ];
    for (const input of inputs) {
      const result = resolveInviteRoute(input);
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});
