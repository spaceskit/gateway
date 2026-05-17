import { encodeInviteLink, type InviteLinkV2 } from "@spaceskit/core";
import type { AuthKeyRepository, InviteTokenRepository } from "@spaceskit/persistence";
import {
  buildInvitePreviewUrl,
  ensureInviteSigningKey,
  INVITE_TOKEN_DEFAULT_TTL_SECONDS,
  INVITE_TOKEN_MAX_TTL_SECONDS,
  signInviteToken,
} from "./invite-signing.js";
import type { CreateInviteV2Input, CreateInviteV2Result } from "./share-relay-api-service.js";

export const REGISTER_VIA_INVITE_PATH = "/v1/share/relay/register_device_via_invite";
export const DEFAULT_REGISTER_VIA_INVITE_LIMIT = { maxAttempts: 10, windowMs: 60_000 };

export async function createInviteV2(
  input: CreateInviteV2Input,
  deps: {
    inviteTokens?: InviteTokenRepository;
    authKeys?: AuthKeyRepository;
    currentFunnelUrl?: () => string | undefined;
    emitRelayEvent: (type: string, payload: Record<string, unknown>) => void;
  },
): Promise<CreateInviteV2Result> {
  if (!deps.inviteTokens || !deps.authKeys) {
    throw {
      code: "FAILED_PRECONDITION",
      message: "Invite issuance is unavailable on this gateway build",
    };
  }
  const spaceId = input.spaceId.trim();
  if (!spaceId) {
    throw { code: "INVALID_ARGUMENT", message: "spaceId is required" };
  }
  const mode = normalizeAccessMode(input.mode);
  if (!mode) {
    throw { code: "INVALID_ARGUMENT", message: "mode must be read_only or collaborator" };
  }

  const ttlSeconds = clampInviteTtl(input.ttlSeconds);
  const tokenId = `invite-${crypto.randomUUID()}`;

  const key = await ensureInviteSigningKey(deps.authKeys);
  const issued = await signInviteToken(key, {
    tokenId,
    spaceId,
    mode,
    ttlSeconds,
  });

  deps.inviteTokens.create({
    tokenId: issued.tokenId,
    spaceId,
    signedToken: issued.signedToken,
    mode,
    signingKid: issued.signingKid,
    issuedByPrincipalId: input.issuedByPrincipalId?.trim() || "",
    expiresAt: issued.expiresAt,
  });

  const funnelUrl = deps.currentFunnelUrl?.();
  const link: InviteLinkV2 = {
    version: "v2",
    spaceId,
    token: issued.signedToken,
  };
  if (funnelUrl) {
    link.gatewayUrl = funnelUrl;
  }
  const encoded = encodeInviteLink(link);
  const previewUrl = buildInvitePreviewUrl(funnelUrl, issued.tokenId);

  deps.emitRelayEvent("share.invite.v2.created", {
    spaceId,
    mode,
    hasFunnelUrl: Boolean(funnelUrl),
    ttlSeconds,
  });

  return {
    tokenId: issued.tokenId,
    signedToken: issued.signedToken,
    encodedLink: encoded,
    link,
    expiresAt: issued.expiresAt,
    signingKid: issued.signingKid,
    funnelUrl,
    previewUrl,
  };
}

export async function parseJsonBody(req: Request): Promise<
  { ok: true; value: Record<string, unknown> } | { ok: false; response: Response }
> {
  try {
    const parsed = await req.json();
    if (!isRecord(parsed)) {
      return {
        ok: false,
        response: jsonError(400, "INVALID_ARGUMENT", "JSON body must be an object"),
      };
    }
    return { ok: true, value: parsed };
  } catch {
    return {
      ok: false,
      response: jsonError(400, "INVALID_ARGUMENT", "Malformed JSON body"),
    };
  }
}

export function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeIdentityModeHint(value: unknown): "device_key" | "strict_apple_id" | undefined {
  if (value === "device_key" || value === "strict_apple_id") {
    return value;
  }
  return undefined;
}

export function extractErrorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === "string") {
    const normalized = error.code.trim().toUpperCase();
    if (normalized.length > 0) return normalized;
  }
  return "INTERNAL";
}

export function jsonOk(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function mapServiceError(error: unknown): Response {
  const code = isRecord(error) && typeof error.code === "string"
    ? error.code
    : "INTERNAL";
  const message = error instanceof Error ? error.message : "Unexpected error";
  switch (code) {
    case "UNAUTHENTICATED":
      return jsonError(401, code, message);
    case "INVALID_ARGUMENT":
      return jsonError(400, code, message);
    case "NOT_FOUND":
      return jsonError(404, code, message);
    case "PERMISSION_DENIED":
      return jsonError(403, code, message);
    case "FAILED_PRECONDITION":
      return jsonError(412, code, message);
    default:
      return jsonError(500, "INTERNAL", message);
  }
}

function normalizeAccessMode(value: unknown): "read_only" | "collaborator" | undefined {
  if (value === "read_only" || value === "collaborator") return value;
  return undefined;
}

function clampInviteTtl(raw: number | undefined): number {
  if (raw === undefined || raw === null) return INVITE_TOKEN_DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(raw) || raw <= 0) return INVITE_TOKEN_DEFAULT_TTL_SECONDS;
  return Math.min(Math.floor(raw), INVITE_TOKEN_MAX_TTL_SECONDS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
