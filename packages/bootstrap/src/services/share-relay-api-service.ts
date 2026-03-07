import type { EventBus } from "@spaceskit/core";
import type { SpaceSharingService } from "./space-sharing-service.js";
import {
  resolveHttpPrincipalContext,
  type HttpPrincipalAuthOptions,
} from "./http-principal-auth.js";

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
}

export class ShareRelayApiService {
  constructor(private readonly options: ShareRelayApiServiceOptions) {}

  async handleRequest(req: Request, url: URL): Promise<Response | null> {
    const resolveRoute = url.pathname === "/v1/share/relay/resolve";
    const joinRoute = url.pathname === "/v1/share/relay/join";
    if (!resolveRoute && !joinRoute) {
      return null;
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

  private emitRelayEvent(type: string, payload: Record<string, unknown>): void {
    this.options.eventBus?.emit({
      type,
      timestamp: new Date(),
      ...payload,
    });
  }
}

async function parseJsonBody(req: Request): Promise<
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

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeIdentityModeHint(value: unknown): "device_key" | "strict_apple_id" | undefined {
  if (value === "device_key" || value === "strict_apple_id") {
    return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractErrorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === "string") {
    const normalized = error.code.trim().toUpperCase();
    if (normalized.length > 0) return normalized;
  }
  return "INTERNAL";
}

function jsonOk(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mapServiceError(error: unknown): Response {
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
