/**
 * Invite token signing — Ed25519 signed payloads for v2 invite tokens.
 *
 * Token format: `<payload-b64url>.<sig-b64url>` where payload is JSON
 *   { tid, sid, mode, iat, exp, kid }
 * encoded as base64url. The signature covers the raw payload bytes
 * (pre-base64) and is produced with the dedicated invite-signing key
 * (auth_keys role = "invite-signing").
 *
 * The signing key is decoupled from the gateway principal key for clean
 * rotation: rotating the invite key does not invalidate device sessions
 * or the gateway's identity on the WebSocket.
 *
 * Slice 4d (register_device_via_invite) consumes this module's
 * `verifyInviteToken` to validate tokens presented by un-registered
 * devices on the funnel-exposed endpoints.
 */

import type { AuthKeyRepository, AuthKeyRow } from "@spaceskit/persistence";

export const INVITE_SIGNING_ROLE = "invite-signing";
export const INVITE_TOKEN_MAX_TTL_SECONDS = 24 * 60 * 60; // 24h hard cap.
export const INVITE_TOKEN_DEFAULT_TTL_SECONDS = 60 * 60; // 1h default.

export interface InviteTokenPayload {
  /** Token id (also the primary key in `invite_tokens`). */
  tid: string;
  /** Space id this invite grants access to. */
  sid: string;
  /** Access mode (e.g. "read_only", "collaborator"). */
  mode: string;
  /** Issued-at ISO timestamp. */
  iat: string;
  /** Expires-at ISO timestamp. */
  exp: string;
  /** Key id used to sign this token. */
  kid: string;
}

export interface IssuedInviteToken {
  tokenId: string;
  signedToken: string;
  payload: InviteTokenPayload;
  signingKid: string;
  expiresAt: string;
}

export interface SignInviteTokenInput {
  tokenId: string;
  spaceId: string;
  mode: string;
  ttlSeconds: number;
  now?: Date;
}

export interface InviteSigningKeyMaterial {
  kid: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyBase64: string;
}

/**
 * Resolve (or lazily create) the dedicated invite-signing keypair from
 * the auth_keys table. Returns CryptoKey handles and the kid.
 *
 * Keys are stored as base64-encoded raw Ed25519 (public) and PKCS#8
 * DER (private) — Web Crypto's import formats for Ed25519.
 */
export async function ensureInviteSigningKey(
  authKeys: AuthKeyRepository,
): Promise<InviteSigningKeyMaterial> {
  const existing = authKeys.getActiveByRole(INVITE_SIGNING_ROLE);
  if (existing) {
    return importExistingKey(existing);
  }

  const generated = await generateEd25519KeyPair();
  authKeys.create({
    kid: generated.kid,
    role: INVITE_SIGNING_ROLE,
    algorithm: "Ed25519",
    publicKey: generated.publicKeyBase64,
    privateKey: generated.privateKeyPkcs8Base64,
  });
  return {
    kid: generated.kid,
    privateKey: generated.privateKey,
    publicKey: generated.publicKey,
    publicKeyBase64: generated.publicKeyBase64,
  };
}

/**
 * Produce a signed invite token bound to a freshly-generated tokenId.
 * Caller persists the returned token in `invite_tokens`.
 */
export async function signInviteToken(
  key: InviteSigningKeyMaterial,
  input: SignInviteTokenInput,
): Promise<IssuedInviteToken> {
  const ttl = clampTtlSeconds(input.ttlSeconds);
  const now = input.now ?? new Date();
  const expires = new Date(now.getTime() + ttl * 1000);

  const payload: InviteTokenPayload = {
    tid: input.tokenId,
    sid: input.spaceId,
    mode: input.mode,
    iat: now.toISOString(),
    exp: expires.toISOString(),
    kid: key.kid,
  };

  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign({ name: "Ed25519" }, key.privateKey, toArrayBuffer(payloadBytes)),
  );

  const signedToken = `${base64UrlEncode(payloadBytes)}.${base64UrlEncode(sigBytes)}`;

  return {
    tokenId: input.tokenId,
    signedToken,
    payload,
    signingKid: key.kid,
    expiresAt: expires.toISOString(),
  };
}

export type InviteVerificationResult =
  | { ok: true; payload: InviteTokenPayload }
  | { ok: false; reason: InviteVerificationFailure };

export type InviteVerificationFailure =
  | "malformed"
  | "unknown_kid"
  | "bad_signature"
  | "expired";

/**
 * Verify a signed invite token's signature, payload shape, and expiry.
 *
 * Does NOT consult `invite_tokens` — callers should look up by tokenId
 * (`payload.tid`) and then `consumeOnce()` to enforce single-shot
 * semantics. Slice 4d uses this verifier for the funnel-exposed
 * `register_device_via_invite` path.
 */
export async function verifyInviteToken(
  signedToken: string,
  authKeys: Pick<AuthKeyRepository, "getByKid">,
  now: Date = new Date(),
): Promise<InviteVerificationResult> {
  const parts = signedToken.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };

  const [payloadB64, sigB64] = parts;
  let payloadBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    payloadBytes = base64UrlDecode(payloadB64);
    sigBytes = base64UrlDecode(sigB64);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  let payload: InviteTokenPayload;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as unknown;
    if (!isInviteTokenPayload(parsed)) {
      return { ok: false, reason: "malformed" };
    }
    payload = parsed;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const keyRow = authKeys.getByKid(payload.kid);
  if (!keyRow || keyRow.role !== INVITE_SIGNING_ROLE) {
    return { ok: false, reason: "unknown_kid" };
  }

  const publicKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(base64Decode(keyRow.public_key)),
    { name: "Ed25519" },
    false,
    ["verify"],
  );

  const valid = await crypto.subtle.verify(
    { name: "Ed25519" },
    publicKey,
    toArrayBuffer(sigBytes),
    toArrayBuffer(payloadBytes),
  );
  if (!valid) {
    return { ok: false, reason: "bad_signature" };
  }

  if (Date.parse(payload.exp) <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload };
}

/**
 * Build the deep-link URL the recipient opens. When a Funnel URL is
 * available we link to the funnel host's invite preview path; the app's
 * `spaces://invite/<encoded>` deep link is constructed by the caller
 * from the encoded payload separately.
 */
export function buildInvitePreviewUrl(funnelUrl: string | undefined, tokenId: string): string | undefined {
  if (!funnelUrl) return undefined;
  const trimmed = funnelUrl.replace(/\/+$/, "");
  return `${trimmed}/.well-known/spaces/invite/${encodeURIComponent(tokenId)}`;
}

function clampTtlSeconds(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) {
    return INVITE_TOKEN_DEFAULT_TTL_SECONDS;
  }
  const clamped = Math.min(Math.floor(raw), INVITE_TOKEN_MAX_TTL_SECONDS);
  return clamped;
}

async function generateEd25519KeyPair(): Promise<{
  kid: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyBase64: string;
  privateKeyPkcs8Base64: string;
}> {
  const keyPair = (await crypto.subtle.generateKey(
    { name: "Ed25519" } as any,
    true,
    ["sign", "verify"],
  )) as unknown as CryptoKeyPair;
  const rawPublic = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pkcs8Private = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  return {
    kid: `invite-${crypto.randomUUID()}`,
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeyBase64: base64Encode(new Uint8Array(rawPublic)),
    privateKeyPkcs8Base64: base64Encode(new Uint8Array(pkcs8Private)),
  };
}

async function importExistingKey(row: AuthKeyRow): Promise<InviteSigningKeyMaterial> {
  const publicKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(base64Decode(row.public_key)),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    toArrayBuffer(base64Decode(row.private_key)),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  return {
    kid: row.kid,
    privateKey,
    publicKey,
    publicKeyBase64: row.public_key,
  };
}

function isInviteTokenPayload(value: unknown): value is InviteTokenPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.tid === "string" && v.tid.length > 0
    && typeof v.sid === "string" && v.sid.length > 0
    && typeof v.mode === "string" && v.mode.length > 0
    && typeof v.iat === "string"
    && typeof v.exp === "string"
    && typeof v.kid === "string" && v.kid.length > 0;
}

function base64Encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64Decode(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  let normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  if (pad === 2) normalized += "==";
  else if (pad === 3) normalized += "=";
  return base64Decode(normalized);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // Web Crypto BufferSource requires a strict ArrayBuffer-backed view; copy to detach
  // any SharedArrayBuffer/ArrayBufferLike typing surface from callers.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}
