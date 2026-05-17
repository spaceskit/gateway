import type { InviteLinkV2, EventBus } from "@spaceskit/core";
import type { AuthKeyRepository, InviteTokenRepository } from "@spaceskit/persistence";
import type { SpaceSharingService } from "./space-sharing-service.js";
import type { DeviceIdentity, DeviceIdentityService } from "./device-identity-service.js";
import {
  resolveHttpPrincipalContext,
  type HttpPrincipalAuthOptions,
} from "./http-principal-auth.js";
import { verifyInviteToken } from "./invite-signing.js";
import {
  createInviteV2,
  DEFAULT_REGISTER_VIA_INVITE_LIMIT,
  extractErrorCode,
  jsonError,
  jsonOk,
  mapServiceError,
  normalizeIdentityModeHint,
  normalizeOptionalString,
  parseJsonBody,
  REGISTER_VIA_INVITE_PATH,
} from "./share-relay-api-helpers.js";

export {
  verifyInviteToken,
  INVITE_SIGNING_ROLE,
  INVITE_TOKEN_MAX_TTL_SECONDS,
  INVITE_TOKEN_DEFAULT_TTL_SECONDS,
} from "./invite-signing.js";
export type {
  InviteTokenPayload,
  InviteVerificationResult,
  InviteVerificationFailure,
} from "./invite-signing.js";

export interface ShareRelayApiServiceOptions {
  spaceSharingService?: Pick<
    SpaceSharingService,
    "resolveRelayInvite" | "proxyJoinRelayInvite"
  >;
  eventBus?: Pick<EventBus, "emit">;
  principalAuth?: HttpPrincipalAuthOptions;
  /**
   * If true, matched routes require an authenticated principal identity.
   */
  requireAuthenticatedPrincipal?: boolean;
  /**
   * Repositories required for v2 invite issuance. Both must be present
   * for `createInvite` to succeed; otherwise the method throws
   * FAILED_PRECONDITION.
   */
  inviteTokens?: InviteTokenRepository;
  authKeys?: AuthKeyRepository;
  /**
   * Source of the gateway's public Funnel URL for the v2 invite payload.
   * Returns undefined when funnel is disabled or not yet ready — in that
   * case the invite link is created without a `gatewayUrl` and the
   * recipient must rely on a relay/LAN path.
   */
  currentFunnelUrl?: () => string | undefined;
  /**
   * Device identity service used by `register_device_via_invite` to
   * register the recipient's fresh device against the invite issuer's
   * principal. Without it, the route returns 412 FAILED_PRECONDITION.
   */
  deviceIdentityService?: Pick<DeviceIdentityService, "registerDeviceForInvite">;
  /**
   * Per-IP attempt cap for `register_device_via_invite` (token bucket).
   * Default: 10 attempts per 60 seconds. Excess returns 429.
   */
  registerViaInviteRateLimit?: {
    maxAttempts: number;
    windowMs: number;
  };
  /**
   * Clock used by the route's expiry/rate-limit checks. Tests override.
   */
  now?: () => Date;
  /**
   * Resolves the source IP for an incoming request. Production wiring
   * passes Bun's `server.requestIP(req)` extractor; tests provide a
   * deterministic value.
   */
  resolveClientIp?: (req: Request) => string;
}

export interface CreateInviteV2Input {
  spaceId: string;
  mode: "read_only" | "collaborator";
  /** Token TTL in seconds. Server clamps to <= 24h. Default 1h. */
  ttlSeconds?: number;
  /** Principal id of the issuer (for audit on the persisted token). */
  issuedByPrincipalId?: string;
}

export interface CreateInviteV2Result {
  tokenId: string;
  signedToken: string;
  encodedLink: string;
  link: InviteLinkV2;
  expiresAt: string;
  signingKid: string;
  funnelUrl?: string;
  previewUrl?: string;
}

export class ShareRelayApiService {
  private readonly registerViaInviteAttempts = new Map<string, number[]>();

  constructor(private readonly options: ShareRelayApiServiceOptions) {}

  private get clock(): () => Date {
    return this.options.now ?? (() => new Date());
  }

  /**
   * Issue a v2 invite link for the given space. The returned payload
   * embeds the gateway's public Funnel URL when available; if funnel is
   * not READY the link is still produced (without gatewayUrl) for LAN /
   * relay paths.
   *
   * Tokens are signed with the dedicated invite-signing key (auth_keys
   * role = "invite-signing") and persisted as one-shot rows in
   * `invite_tokens`. Slice 4d's register_device_via_invite handler will
   * verify and atomically consume them.
   */
  async createInvite(input: CreateInviteV2Input): Promise<CreateInviteV2Result> {
    return createInviteV2(input, {
      inviteTokens: this.options.inviteTokens,
      authKeys: this.options.authKeys,
      currentFunnelUrl: this.options.currentFunnelUrl,
      emitRelayEvent: (type, payload) => this.emitRelayEvent(type, payload),
    });
  }

  async handleRequest(req: Request, url: URL): Promise<Response | null> {
    const resolveRoute = url.pathname === "/v1/share/relay/resolve";
    const joinRoute = url.pathname === "/v1/share/relay/join";
    const registerViaInviteRoute = url.pathname === REGISTER_VIA_INVITE_PATH;
    if (!resolveRoute && !joinRoute && !registerViaInviteRoute) {
      return null;
    }

    if (registerViaInviteRoute) {
      return this.handleRegisterDeviceViaInvite(req);
    }

    const auth = resolveHttpPrincipalContext(req, this.options.principalAuth);
    if (!auth.ok) {
      if (resolveRoute) {
        this.emitRelayEvent("share.relay.resolve.attempt", {
          authenticated: false,
        });
        this.emitRelayEvent("share.relay.resolve.failed", {
          code: auth.error.code,
          reason: auth.error.reason,
        });
      } else {
        this.emitRelayEvent("share.relay.join.attempt", {
          authenticated: false,
        });
        this.emitRelayEvent("share.relay.join.failed", {
          code: auth.error.code,
          reason: auth.error.reason,
        });
      }
      return jsonError(401, auth.error.code, auth.error.message);
    }

    const principalId = auth.context.principalId ?? null;

    if (resolveRoute) {
      if (this.options.requireAuthenticatedPrincipal && !principalId) {
        this.emitRelayEvent("share.relay.resolve.attempt", {
          authenticated: false,
        });
        this.emitRelayEvent("share.relay.resolve.failed", {
          code: "UNAUTHENTICATED",
          reason: "missing_principal",
        });
        return jsonError(401, "UNAUTHENTICATED", "Authenticated principal identity is required");
      }
      return this.handleResolve(req, principalId);
    }

    if (joinRoute) {
      if (!principalId) {
        this.emitRelayEvent("share.relay.join.attempt", {
          authenticated: false,
        });
        this.emitRelayEvent("share.relay.join.failed", {
          code: "UNAUTHENTICATED",
          reason: "missing_principal",
        });
        return jsonError(401, "UNAUTHENTICATED", "Authenticated principal identity is required");
      }
      return this.handleJoin(req, principalId);
    }

    return null;
  }

  private async handleResolve(req: Request, principalId: string | null): Promise<Response> {
    if (req.method !== "POST") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Expected POST");
    }
    this.emitRelayEvent("share.relay.resolve.attempt", {
      authenticated: Boolean(principalId),
    });

    if (!this.options.spaceSharingService) {
      this.emitRelayEvent("share.relay.resolve.failed", {
        code: "FAILED_PRECONDITION",
        reason: "service_unavailable",
      });
      return jsonError(412, "FAILED_PRECONDITION", "Space sharing service unavailable");
    }

    const body = await parseJsonBody(req);
    if (!body.ok) {
      this.emitRelayEvent("share.relay.resolve.failed", {
        code: "INVALID_ARGUMENT",
        reason: "invalid_body",
      });
      return body.response;
    }
    const relayInviteId = normalizeOptionalString(body.value.relayInviteId);
    if (!relayInviteId) {
      this.emitRelayEvent("share.relay.resolve.failed", {
        code: "INVALID_ARGUMENT",
        reason: "missing_relay_invite_id",
      });
      return jsonError(400, "INVALID_ARGUMENT", "relayInviteId is required");
    }

    try {
      const result = this.options.spaceSharingService.resolveRelayInvite({
        relayInviteId,
        directReachable: body.value.directReachable === true,
        principalId: principalId ?? undefined,
      });
      this.emitRelayEvent("share.relay.resolve.success", {
        gatewayRoute: result.gatewayRoute,
        directReachable: body.value.directReachable === true,
      });
      return jsonOk(result);
    } catch (error) {
      this.emitRelayEvent("share.relay.resolve.failed", {
        code: extractErrorCode(error),
      });
      return mapServiceError(error);
    }
  }

  private async handleJoin(req: Request, principalId: string): Promise<Response> {
    if (req.method !== "POST") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Expected POST");
    }
    this.emitRelayEvent("share.relay.join.attempt", {
      authenticated: true,
    });

    if (!this.options.spaceSharingService) {
      this.emitRelayEvent("share.relay.join.failed", {
        code: "FAILED_PRECONDITION",
        reason: "service_unavailable",
      });
      return jsonError(412, "FAILED_PRECONDITION", "Space sharing service unavailable");
    }

    const body = await parseJsonBody(req);
    if (!body.ok) {
      this.emitRelayEvent("share.relay.join.failed", {
        code: "INVALID_ARGUMENT",
        reason: "invalid_body",
      });
      return body.response;
    }
    const relaySessionToken = normalizeOptionalString(body.value.relaySessionToken);
    if (!relaySessionToken) {
      this.emitRelayEvent("share.relay.join.failed", {
        code: "INVALID_ARGUMENT",
        reason: "missing_relay_session_token",
      });
      return jsonError(400, "INVALID_ARGUMENT", "relaySessionToken is required");
    }
    const identityModeHintRaw = normalizeOptionalString(body.value.identityModeHint);
    if (identityModeHintRaw && !normalizeIdentityModeHint(identityModeHintRaw)) {
      this.emitRelayEvent("share.relay.join.failed", {
        code: "INVALID_ARGUMENT",
        reason: "invalid_identity_mode_hint",
      });
      return jsonError(400, "INVALID_ARGUMENT", "identityModeHint must be one of: device_key, strict_apple_id");
    }

    try {
      const participant = this.options.spaceSharingService.proxyJoinRelayInvite({
        relaySessionToken,
        principalId,
        principalType: "public_key",
        deviceId: normalizeOptionalString(body.value.deviceId),
        devicePublicKey: normalizeOptionalString(body.value.devicePublicKey),
        identityModeHint: identityModeHintRaw,
        appleIdAssertion: normalizeOptionalString(body.value.appleIdAssertion),
      });
      this.emitRelayEvent("share.relay.join.success", {
        mode: participant.mode,
      });
      return jsonOk({ participant });
    } catch (error) {
      this.emitRelayEvent("share.relay.join.failed", {
        code: extractErrorCode(error),
      });
      return mapServiceError(error);
    }
  }

  private async handleRegisterDeviceViaInvite(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Expected POST");
    }

    const clientIp = this.resolveRequestClientIp(req);
    if (!this.tryConsumeRegisterViaInviteSlot(clientIp)) {
      this.emitRelayEvent("share.invite.register_device.rate_limited", { clientIp });
      return jsonError(429, "RESOURCE_EXHAUSTED", "Too many registration attempts; retry shortly");
    }

    this.emitRelayEvent("share.invite.register_device.attempt", { clientIp });

    if (!this.options.inviteTokens || !this.options.authKeys || !this.options.deviceIdentityService) {
      this.emitRelayEvent("share.invite.register_device.failed", {
        code: "FAILED_PRECONDITION",
        reason: "service_unavailable",
      });
      return jsonError(412, "FAILED_PRECONDITION", "Invite registration is unavailable on this gateway build");
    }

    const body = await parseJsonBody(req);
    if (!body.ok) {
      this.emitRelayEvent("share.invite.register_device.failed", {
        code: "INVALID_ARGUMENT",
        reason: "invalid_body",
      });
      return body.response;
    }

    const inviteToken = normalizeOptionalString(body.value.invite_token)
      ?? normalizeOptionalString(body.value.inviteToken);
    const devicePublicKey = normalizeOptionalString(body.value.device_public_key)
      ?? normalizeOptionalString(body.value.devicePublicKey);
    const deviceId = normalizeOptionalString(body.value.device_id)
      ?? normalizeOptionalString(body.value.deviceId);
    const platform = normalizeOptionalString(body.value.platform);

    if (!inviteToken) {
      this.emitRelayEvent("share.invite.register_device.failed", {
        code: "INVALID_ARGUMENT",
        reason: "missing_invite_token",
      });
      return jsonError(400, "INVALID_ARGUMENT", "invite_token is required");
    }
    if (!devicePublicKey) {
      this.emitRelayEvent("share.invite.register_device.failed", {
        code: "INVALID_ARGUMENT",
        reason: "missing_device_public_key",
      });
      return jsonError(400, "INVALID_ARGUMENT", "device_public_key is required");
    }
    if (!deviceId) {
      this.emitRelayEvent("share.invite.register_device.failed", {
        code: "INVALID_ARGUMENT",
        reason: "missing_device_id",
      });
      return jsonError(400, "INVALID_ARGUMENT", "device_id is required");
    }

    const verification = await verifyInviteToken(inviteToken, this.options.authKeys, this.clock());
    if (!verification.ok) {
      this.emitRelayEvent("share.invite.register_device.failed", {
        code: "INVALID_ARGUMENT",
        reason: verification.reason,
      });
      switch (verification.reason) {
        case "expired":
          return jsonError(410, "GONE", "Invite token expired");
        case "malformed":
        case "bad_signature":
          return jsonError(400, "INVALID_ARGUMENT", "Invite token is invalid");
        case "unknown_kid":
          return jsonError(400, "INVALID_ARGUMENT", "Invite token signing key is unknown");
        default:
          return jsonError(400, "INVALID_ARGUMENT", "Invite token is invalid");
      }
    }

    const tokenRow = this.options.inviteTokens.getByTokenId(verification.payload.tid);
    if (!tokenRow) {
      this.emitRelayEvent("share.invite.register_device.failed", {
        code: "NOT_FOUND",
        reason: "unknown_token",
      });
      return jsonError(404, "NOT_FOUND", "Invite token is not recognized");
    }

    const consumedNowIso = this.clock().toISOString();
    const consumed = this.options.inviteTokens.consumeOnce(verification.payload.tid, consumedNowIso);
    if (!consumed) {
      this.emitRelayEvent("share.invite.register_device.failed", {
        code: "GONE",
        reason: "already_consumed",
      });
      return jsonError(410, "GONE", "Invite token has already been used");
    }

    const invitePrincipalId = (tokenRow.issued_by_principal_id ?? "").trim();
    if (!invitePrincipalId) {
      this.emitRelayEvent("share.invite.register_device.failed", {
        code: "FAILED_PRECONDITION",
        reason: "missing_invite_principal",
      });
      return jsonError(
        412,
        "FAILED_PRECONDITION",
        "Invite is missing an issuing principal; cannot register a device",
      );
    }

    let device: DeviceIdentity;
    let created: boolean;
    try {
      const result = this.options.deviceIdentityService.registerDeviceForInvite({
        invitePrincipalId,
        deviceId,
        publicKey: devicePublicKey,
        platform,
      });
      device = result.device;
      created = result.created;
    } catch (error) {
      this.emitRelayEvent("share.invite.register_device.failed", {
        code: extractErrorCode(error),
        reason: "device_registration_error",
      });
      return mapServiceError(error);
    }

    this.emitRelayEvent("share.invite.register_device.success", {
      spaceId: verification.payload.sid,
      principalId: invitePrincipalId,
      deviceId: device.deviceId,
      created,
    });

    return jsonOk({
      device,
      space_id: verification.payload.sid,
      principal_id: invitePrincipalId,
    });
  }

  private resolveRequestClientIp(req: Request): string {
    if (this.options.resolveClientIp) {
      const resolved = this.options.resolveClientIp(req).trim();
      if (resolved.length > 0) return resolved;
    }
    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded) {
      const head = forwarded.split(",")[0]?.trim();
      if (head && head.length > 0) return head;
    }
    const realIp = req.headers.get("x-real-ip")?.trim();
    if (realIp) return realIp;
    return "unknown";
  }

  private tryConsumeRegisterViaInviteSlot(clientIp: string): boolean {
    const limit = this.options.registerViaInviteRateLimit ?? DEFAULT_REGISTER_VIA_INVITE_LIMIT;
    const nowMs = this.clock().getTime();
    const cutoff = nowMs - limit.windowMs;
    const stamps = this.registerViaInviteAttempts.get(clientIp) ?? [];
    const fresh = stamps.filter((t) => t > cutoff);
    if (fresh.length >= limit.maxAttempts) {
      this.registerViaInviteAttempts.set(clientIp, fresh);
      return false;
    }
    fresh.push(nowMs);
    this.registerViaInviteAttempts.set(clientIp, fresh);
    return true;
  }

  private emitRelayEvent(type: string, payload: Record<string, unknown>): void {
    this.options.eventBus?.emit({
      type,
      timestamp: new Date(),
      ...payload,
    });
  }
}
