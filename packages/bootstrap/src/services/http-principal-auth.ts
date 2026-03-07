import { createHmac, timingSafeEqual } from "node:crypto";

export type HttpPrincipalAuthMethod =
  | "none"
  | "legacy_header"
  | "legacy_bearer"
  | "jwt_hs256";

export interface VerifiedPrincipalContext {
  principalId?: string;
  deviceId?: string;
  authMethod: HttpPrincipalAuthMethod;
  verifiedAt?: string;
}

export interface HttpPrincipalAuthOptions {
  /**
   * If true, only signed HS256 bearer tokens are accepted.
   * If false, verifier falls back to legacy header/bearer extraction.
   */
  strictVerification?: boolean;
  /**
   * Shared secret used to verify HS256 bearer tokens.
   * Signed token verification is skipped when unset in non-strict mode.
   */
  hs256Secret?: string;
  /**
   * Maximum allowed clock skew when checking exp/nbf claims.
   * Default: 60 seconds.
   */
  maxClockSkewSeconds?: number;
  /**
   * Clock provider for deterministic tests.
   */
  now?: () => Date;
}

export interface IssueHttpPrincipalTokenOptions {
  principalId: string;
  deviceId?: string;
  hs256Secret: string;
  /**
   * Requested token lifetime in seconds.
   * Clamped to 30..3600, default: 300.
   */
  ttlSeconds?: number;
  /**
   * Clock provider for deterministic tests.
   */
  now?: () => Date;
}

export interface IssuedHttpPrincipalToken {
  token: string;
  tokenType: "Bearer";
  principalId: string;
  deviceId?: string;
  issuedAt: string;
  expiresAt: string;
  ttlSeconds: number;
}

export type HttpPrincipalAuthFailureReason =
  | "missing_bearer_token"
  | "invalid_token"
  | "expired_token"
  | "token_not_yet_valid";

export interface HttpPrincipalAuthFailure {
  code: "UNAUTHENTICATED";
  reason: HttpPrincipalAuthFailureReason;
  message: string;
}

export type HttpPrincipalAuthResult =
  | { ok: true; context: VerifiedPrincipalContext }
  | { ok: false; error: HttpPrincipalAuthFailure };

const DEFAULT_ISSUED_HTTP_PRINCIPAL_TOKEN_TTL_SECONDS = 300;
const MIN_ISSUED_HTTP_PRINCIPAL_TOKEN_TTL_SECONDS = 30;
const MAX_ISSUED_HTTP_PRINCIPAL_TOKEN_TTL_SECONDS = 3600;

type SignedBearerVerificationResult =
  | { ok: true; principalId: string; deviceId?: string }
  | { ok: false; error: HttpPrincipalAuthFailure };

export function issueHttpPrincipalToken(
  input: IssueHttpPrincipalTokenOptions,
): IssuedHttpPrincipalToken {
  const principalId = normalizeOptionalString(input.principalId);
  if (!principalId) {
    throw new Error("principalId is required");
  }
  const secret = normalizeOptionalString(input.hs256Secret);
  if (!secret) {
    throw new Error("hs256Secret is required");
  }

  const deviceId = normalizeOptionalString(input.deviceId);
  const now = input.now ?? (() => new Date());
  const nowDate = now();
  const issuedAtEpochSeconds = Math.floor(nowDate.getTime() / 1000);
  const ttlSeconds = normalizeIssuedTokenTtlSeconds(input.ttlSeconds);
  const expiresAtEpochSeconds = issuedAtEpochSeconds + ttlSeconds;

  const headerSegment = encodeBase64UrlJson({
    alg: "HS256",
    typ: "JWT",
  });
  const payloadSegment = encodeBase64UrlJson({
    sub: principalId,
    iat: issuedAtEpochSeconds,
    nbf: issuedAtEpochSeconds,
    exp: expiresAtEpochSeconds,
    ...(deviceId ? { device_id: deviceId } : {}),
  });
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signatureSegment = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");
  const token = `${signingInput}.${signatureSegment}`;

  return {
    token,
    tokenType: "Bearer",
    principalId,
    ...(deviceId ? { deviceId } : {}),
    issuedAt: new Date(issuedAtEpochSeconds * 1000).toISOString(),
    expiresAt: new Date(expiresAtEpochSeconds * 1000).toISOString(),
    ttlSeconds,
  };
}

export function resolveHttpPrincipalContext(
  req: Request,
  options: HttpPrincipalAuthOptions = {},
): HttpPrincipalAuthResult {
  const strictVerification = options.strictVerification === true;
  const now = options.now ?? (() => new Date());
  const nowEpochSeconds = Math.floor(now().getTime() / 1000);
  const maxClockSkewSeconds = normalizeClockSkewSeconds(options.maxClockSkewSeconds);
  const secret = normalizeOptionalString(options.hs256Secret);

  const authorization = normalizeOptionalString(req.headers.get("authorization"));
  const bearerToken = parseBearerToken(authorization);
  const headerPrincipal = normalizeOptionalString(req.headers.get("x-spaceskit-principal-id"));
  const headerDeviceId = normalizeOptionalString(req.headers.get("x-spaceskit-device-id"));

  if (strictVerification) {
    if (!secret) {
      return unauthenticated(
        "invalid_token",
        "Authenticated principal token is invalid",
      );
    }
    if (!bearerToken) {
      return unauthenticated(
        "missing_bearer_token",
        "Authenticated principal token is required",
      );
    }
    const verified = verifySignedBearerToken({
      token: bearerToken,
      secret,
      nowEpochSeconds,
      maxClockSkewSeconds,
    });
    if (!verified.ok) {
      return verified;
    }
    return {
      ok: true,
      context: {
        principalId: verified.principalId,
        deviceId: verified.deviceId ?? headerDeviceId,
        authMethod: "jwt_hs256",
        verifiedAt: now().toISOString(),
      },
    };
  }

  if (bearerToken && secret && looksLikeJwt(bearerToken)) {
    const verified = verifySignedBearerToken({
      token: bearerToken,
      secret,
      nowEpochSeconds,
      maxClockSkewSeconds,
    });
    if (!verified.ok) {
      return verified;
    }
    return {
      ok: true,
      context: {
        principalId: verified.principalId,
        deviceId: verified.deviceId ?? headerDeviceId,
        authMethod: "jwt_hs256",
        verifiedAt: now().toISOString(),
      },
    };
  }

  if (bearerToken) {
    return {
      ok: true,
      context: {
        principalId: bearerToken,
        deviceId: headerDeviceId,
        authMethod: "legacy_bearer",
      },
    };
  }

  if (headerPrincipal) {
    return {
      ok: true,
      context: {
        principalId: headerPrincipal,
        deviceId: headerDeviceId,
        authMethod: "legacy_header",
      },
    };
  }

  return {
    ok: true,
    context: {
      deviceId: headerDeviceId,
      authMethod: "none",
    },
  };
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeClockSkewSeconds(raw: number | undefined): number {
  if (raw === undefined) return 60;
  if (!Number.isFinite(raw)) return 60;
  return Math.max(0, Math.floor(raw));
}

function normalizeIssuedTokenTtlSeconds(raw: number | undefined): number {
  if (raw === undefined) {
    return DEFAULT_ISSUED_HTTP_PRINCIPAL_TOKEN_TTL_SECONDS;
  }
  if (!Number.isFinite(raw)) {
    return DEFAULT_ISSUED_HTTP_PRINCIPAL_TOKEN_TTL_SECONDS;
  }
  const normalized = Math.floor(raw);
  return Math.min(
    MAX_ISSUED_HTTP_PRINCIPAL_TOKEN_TTL_SECONDS,
    Math.max(MIN_ISSUED_HTTP_PRINCIPAL_TOKEN_TTL_SECONDS, normalized),
  );
}

function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const separator = authorization.indexOf(" ");
  if (separator <= 0) return null;
  const scheme = authorization.slice(0, separator).trim().toLowerCase();
  const token = authorization.slice(separator + 1).trim();
  if (scheme !== "bearer" || token.length === 0) {
    return null;
  }
  return token;
}

function looksLikeJwt(token: string): boolean {
  const segments = token.split(".");
  return segments.length === 3
    && segments.every((segment) => segment.length > 0);
}

function verifySignedBearerToken(input: {
  token: string;
  secret: string;
  nowEpochSeconds: number;
  maxClockSkewSeconds: number;
}): SignedBearerVerificationResult {
  const segments = input.token.split(".");
  if (segments.length !== 3) {
    return unauthenticated("invalid_token", "Authenticated principal token is invalid");
  }
  const [headerSegment, payloadSegment, signatureSegment] = segments;
  if (!headerSegment || !payloadSegment || !signatureSegment) {
    return unauthenticated("invalid_token", "Authenticated principal token is invalid");
  }

  const header = decodeJsonSegment(headerSegment);
  const payload = decodeJsonSegment(payloadSegment);
  if (!header || !payload) {
    return unauthenticated("invalid_token", "Authenticated principal token is invalid");
  }

  const alg = normalizeOptionalString(header.alg);
  if (alg !== "HS256") {
    return unauthenticated("invalid_token", "Authenticated principal token is invalid");
  }

  const expectedSignature = createHmac("sha256", input.secret)
    .update(`${headerSegment}.${payloadSegment}`)
    .digest();
  const providedSignature = decodeBase64Url(signatureSegment);
  if (!providedSignature || providedSignature.length !== expectedSignature.length) {
    return unauthenticated("invalid_token", "Authenticated principal token is invalid");
  }
  if (!timingSafeEqual(providedSignature, expectedSignature)) {
    return unauthenticated("invalid_token", "Authenticated principal token is invalid");
  }

  const principalId = normalizeOptionalString(payload.sub);
  if (!principalId) {
    return unauthenticated("invalid_token", "Authenticated principal token is invalid");
  }

  const expiresAt = parseNumericClaim(payload.exp);
  if (
    expiresAt !== undefined
    && input.nowEpochSeconds > expiresAt + input.maxClockSkewSeconds
  ) {
    return unauthenticated("expired_token", "Authenticated principal token has expired");
  }

  const notBefore = parseNumericClaim(payload.nbf);
  if (
    notBefore !== undefined
    && input.nowEpochSeconds + input.maxClockSkewSeconds < notBefore
  ) {
    return unauthenticated("token_not_yet_valid", "Authenticated principal token is not active yet");
  }

  const issuedAt = parseNumericClaim(payload.iat);
  if (
    issuedAt !== undefined
    && issuedAt > input.nowEpochSeconds + input.maxClockSkewSeconds
  ) {
    return unauthenticated("invalid_token", "Authenticated principal token is invalid");
  }

  const deviceId = normalizeOptionalString(payload.device_id)
    ?? normalizeOptionalString(payload.deviceId);
  return {
    ok: true,
    principalId,
    deviceId,
  };
}

function decodeJsonSegment(segment: string): Record<string, unknown> | null {
  const decoded = decodeBase64Url(segment);
  if (!decoded) return null;
  try {
    const parsed = JSON.parse(decoded.toString("utf8"));
    if (!isRecord(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function decodeBase64Url(segment: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  const base64 = segment
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
  try {
    return Buffer.from(padded, "base64");
  } catch {
    return null;
  }
}

function parseNumericClaim(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function encodeBase64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unauthenticated(
  reason: HttpPrincipalAuthFailureReason,
  message: string,
): { ok: false; error: HttpPrincipalAuthFailure } {
  return {
    ok: false,
    error: {
      code: "UNAUTHENTICATED",
      reason,
      message,
    },
  };
}
