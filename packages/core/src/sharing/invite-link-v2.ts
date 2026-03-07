/**
 * InviteLinkV2 — relay-first invite link format.
 * V1 links are direct gateway URLs. V2 adds relay routing metadata.
 */

export type InviteLinkVersion = "v1" | "v2";

export interface InviteLinkV1 {
  version: "v1";
  /** ws:// or wss:// direct gateway URL */
  gatewayUrl: string;
  spaceId: string;
  token: string;
}

export interface InviteLinkV2 {
  version: "v2";
  spaceId: string;
  token: string;
  /** Optional direct URL (for local/LAN) */
  gatewayUrl?: string;
  /** Relay endpoint hint */
  relayHint?: string;
}

export type InviteLink = InviteLinkV1 | InviteLinkV2;

/**
 * Encode an invite link as a base64url JSON string.
 */
export function encodeInviteLink(link: InviteLink): string {
  const json = JSON.stringify(link);
  const bytes = new TextEncoder().encode(json);
  // base64url: standard base64 with +→-, /→_, no padding
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode a base64url JSON string back to an InviteLink.
 * Throws if the encoded string is malformed or missing required fields.
 */
export function decodeInviteLink(encoded: string): InviteLink {
  // Restore standard base64 from base64url
  let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  // Re-add padding
  const pad = base64.length % 4;
  if (pad === 2) base64 += "==";
  else if (pad === 3) base64 += "=";

  let json: string;
  try {
    json = atob(base64);
  } catch {
    throw new Error("Invalid invite link: malformed base64");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid invite link: malformed JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid invite link: expected object");
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.version !== "v1" && obj.version !== "v2") {
    throw new Error(`Invalid invite link: unknown version "${String(obj.version)}"`);
  }

  if (typeof obj.spaceId !== "string" || obj.spaceId.length === 0) {
    throw new Error("Invalid invite link: missing or empty spaceId");
  }

  if (typeof obj.token !== "string" || obj.token.length === 0) {
    throw new Error("Invalid invite link: missing or empty token");
  }

  if (obj.version === "v1") {
    if (typeof obj.gatewayUrl !== "string" || obj.gatewayUrl.length === 0) {
      throw new Error("Invalid invite link: v1 link requires gatewayUrl");
    }
    return {
      version: "v1",
      gatewayUrl: obj.gatewayUrl,
      spaceId: obj.spaceId,
      token: obj.token,
    };
  }

  // v2
  const result: InviteLinkV2 = {
    version: "v2",
    spaceId: obj.spaceId,
    token: obj.token,
  };
  if (typeof obj.gatewayUrl === "string" && obj.gatewayUrl.length > 0) {
    result.gatewayUrl = obj.gatewayUrl;
  }
  if (typeof obj.relayHint === "string" && obj.relayHint.length > 0) {
    result.relayHint = obj.relayHint;
  }
  return result;
}

/**
 * Type guard: returns true if the link is a v2 invite link.
 */
export function isV2Link(link: InviteLink): link is InviteLinkV2 {
  return link.version === "v2";
}
