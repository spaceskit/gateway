import type { InviteLink } from "./invite-link-v2.js";

export type InviteRoute = "direct" | "relay_proxy";

export interface InviteRouteDecision {
  route: InviteRoute;
  /** Resolved gateway or relay URL */
  endpoint: string;
  /** Secondary route */
  fallbackEndpoint?: string;
  reason: string;
}

export interface RouteResolverInput {
  link: InviteLink;
  /** Configured relay service URL */
  relayEndpoint?: string;
  /** Pre-check if gateway is reachable */
  directReachable?: boolean;
}

/**
 * Determines the best route for joining an invite.
 * Priority: direct if reachable + gateway URL available, else relay.
 *
 * Decision matrix:
 * - v1 link → always direct (v1 only has gatewayUrl)
 * - v2 + directReachable + gatewayUrl → direct, with relay fallback if available
 * - v2 + not reachable or no gatewayUrl → relay_proxy if relay configured
 * - No relay endpoint configured → direct (only option, even if not reachable)
 */
export function resolveInviteRoute(input: RouteResolverInput): InviteRouteDecision {
  const { link, relayEndpoint, directReachable } = input;

  // V1 links: always direct
  if (link.version === "v1") {
    return {
      route: "direct",
      endpoint: link.gatewayUrl,
      reason: "v1 link: direct gateway connection",
    };
  }

  // V2 link with direct reachability and a gateway URL
  if (directReachable && link.gatewayUrl) {
    const decision: InviteRouteDecision = {
      route: "direct",
      endpoint: link.gatewayUrl,
      reason: "v2 link: gateway directly reachable",
    };
    // Add relay as fallback if available
    const relay = relayEndpoint ?? link.relayHint;
    if (relay) {
      decision.fallbackEndpoint = relay;
    }
    return decision;
  }

  // V2 link where direct is not available — try relay
  const relay = relayEndpoint ?? link.relayHint;
  if (relay) {
    const decision: InviteRouteDecision = {
      route: "relay_proxy",
      endpoint: relay,
      reason: link.gatewayUrl
        ? "v2 link: gateway not reachable, using relay"
        : "v2 link: no direct gateway URL, using relay",
    };
    // Add direct as fallback if we have a URL (even though not confirmed reachable)
    if (link.gatewayUrl) {
      decision.fallbackEndpoint = link.gatewayUrl;
    }
    return decision;
  }

  // No relay configured — direct is the only option
  if (link.gatewayUrl) {
    return {
      route: "direct",
      endpoint: link.gatewayUrl,
      reason: "v2 link: no relay configured, falling back to direct",
    };
  }

  // Neither relay nor direct gateway URL available — best-effort empty
  return {
    route: "direct",
    endpoint: "",
    reason: "v2 link: no relay or gateway URL available",
  };
}
