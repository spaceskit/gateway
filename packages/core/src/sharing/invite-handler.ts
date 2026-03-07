/**
 * Invite handler pipeline — parses invite links from deep links, clipboard, and paste,
 * then orchestrates join via relay-first route resolution.
 */

import type { InviteLink } from "./invite-link-v2.js";
import type { InviteRouteDecision } from "./invite-route-resolver.js";
import { decodeInviteLink } from "./invite-link-v2.js";
import { resolveInviteRoute } from "./invite-route-resolver.js";

export type InviteSource = "deep_link" | "clipboard" | "paste" | "qr_scan";

export type InviteHandlerStatus =
  | "parsing"
  | "resolving_route"
  | "joining"
  | "completed"
  | "failed";

export interface InviteHandlerInput {
  /** Raw input string (URL, base64 link, or paste) */
  rawInput: string;
  /** Source of the invite */
  source: InviteSource;
  /** Configured relay endpoint (if any) */
  relayEndpoint?: string;
  /** Whether direct gateway is reachable (pre-checked by caller) */
  directReachable?: boolean;
}

export interface InviteHandlerResult {
  status: InviteHandlerStatus;
  link?: InviteLink;
  route?: InviteRouteDecision;
  error?: string;
  details: string;
}

const DEEP_LINK_PREFIX = "spaceskit://invite/";

/**
 * Parse an invite from any input format.
 * Supports: base64url encoded links, raw JSON, spaceskit:// deep link URLs.
 */
export function parseInviteInput(rawInput: string): InviteLink {
  const trimmed = rawInput.trim();

  if (trimmed.length === 0) {
    throw new Error("Invalid invite input: empty string");
  }

  // 1. Try base64url decode (most common format)
  try {
    return decodeInviteLink(trimmed);
  } catch {
    // Not base64url, continue
  }

  // 2. Try parsing as raw JSON
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      if (obj.version === "v1" || obj.version === "v2") {
        // Re-encode and decode to validate through the canonical path
        const json = JSON.stringify(parsed);
        const bytes = new TextEncoder().encode(json);
        const base64 = btoa(String.fromCharCode(...bytes));
        const base64url = base64
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
        return decodeInviteLink(base64url);
      }
    }
  } catch {
    // Not JSON, continue
  }

  // 3. Try spaceskit:// deep link URL
  if (trimmed.startsWith(DEEP_LINK_PREFIX)) {
    const encoded = trimmed.slice(DEEP_LINK_PREFIX.length);
    if (encoded.length === 0) {
      throw new Error("Invalid invite input: empty deep link payload");
    }
    // Strip any query string or fragment
    const clean = encoded.split("?")[0]!.split("#")[0]!;
    try {
      return decodeInviteLink(clean);
    } catch (err) {
      throw new Error(
        `Invalid invite input: deep link decode failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  throw new Error(
    "Invalid invite input: not a recognized format (expected base64url, JSON, or spaceskit:// deep link)",
  );
}

/**
 * Full pipeline: parse -> resolve route -> return ready-to-join result.
 * Does NOT actually call the join API — that is the caller's responsibility.
 */
export function prepareInviteJoin(input: InviteHandlerInput): InviteHandlerResult {
  // Parse
  let link: InviteLink;
  try {
    link = parseInviteInput(input.rawInput);
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      details: `Failed to parse invite from ${input.source}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Resolve route
  let route: InviteRouteDecision;
  try {
    route = resolveInviteRoute({
      link,
      relayEndpoint: input.relayEndpoint,
      directReachable: input.directReachable,
    });
  } catch (err) {
    return {
      status: "failed",
      link,
      error: err instanceof Error ? err.message : String(err),
      details: `Parsed invite for space ${link.spaceId} but route resolution failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return {
    status: "joining",
    link,
    route,
    details: `Ready to join space ${link.spaceId} via ${route.route} (${route.reason})`,
  };
}
