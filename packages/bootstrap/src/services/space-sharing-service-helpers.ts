import { createHash, randomBytes } from "node:crypto";
import type { SpaceShareAccessMode } from "@spaceskit/persistence";
import {
  SpaceSharingError,
  type SharingIdentityMode,
  type SharingIdentityPolicy,
  type SharingPolicyDenialReason,
  type SpaceParticipant,
  type SpaceShareInvite,
} from "./space-sharing-service-types.js";

export function normalizeNonEmpty(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new SpaceSharingError("INVALID_ARGUMENT", `${field} is required`);
  }
  return normalized;
}

export function sanitizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export function normalizeSharingIdentityPolicy(policy: SharingIdentityPolicy): SharingIdentityPolicy {
  const mode = normalizeIdentityModeHint(policy.mode) ?? "device_key";
  return {
    mode,
    allowDeviceKeyFallback: policy.allowDeviceKeyFallback !== false,
  };
}

export function normalizeIdentityModeHint(value: string | undefined): SharingIdentityMode | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (normalized === "device_key" || normalized === "strict_apple_id") {
    return normalized;
  }
  return undefined;
}

export function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function evaluateSharingIdentity(input: {
  policy: SharingIdentityPolicy;
  hasDeviceKey: boolean;
  hasAppleIdAssertion: boolean;
  appleIdAssertion?: string;
}): (
  | { allowed: true; identityMode: SharingIdentityMode; details: string }
  | {
      allowed: false;
      identityMode: SharingIdentityMode;
      details: string;
      denialReason: SharingPolicyDenialReason;
    }
) {
  const { policy, hasDeviceKey, hasAppleIdAssertion } = input;
  if (policy.mode === "device_key") {
    if (hasDeviceKey) {
      return {
        allowed: true,
        identityMode: "device_key",
        details: "Device key present - identity requirement met",
      };
    }
    return {
      allowed: false,
      identityMode: "device_key",
      details: "Device key required but not provided",
      denialReason: "identity_assertion_missing",
    };
  }

  if (hasAppleIdAssertion) {
    return {
      allowed: true,
      identityMode: "strict_apple_id",
      details: "Apple ID assertion present - strict identity requirement met",
    };
  }

  if (policy.allowDeviceKeyFallback && hasDeviceKey) {
    return {
      allowed: true,
      identityMode: "device_key",
      details: "Apple ID assertion missing - device key fallback allowed",
    };
  }

  return {
    allowed: false,
    identityMode: "strict_apple_id",
    details: "Apple ID assertion required for strict_apple_id mode",
    denialReason: "identity_assertion_missing",
  };
}

export function buildIdentityDenialMessage(input: {
  identityMode: SharingIdentityMode;
  details: string;
  denialReason: SharingPolicyDenialReason;
}): string {
  const remediation = input.identityMode === "strict_apple_id"
    ? "Provide an Apple ID assertion or enable device-key fallback for this space."
    : "Provide both deviceId and devicePublicKey and retry.";
  return `Sharing identity policy denied join (${input.denialReason}): ${input.details}. ${remediation}`;
}

export function normalizeAccessMode(value: string): SpaceShareAccessMode {
  const normalized = value.trim().toLowerCase();
  if (normalized === "read_only" || normalized === "collaborator") {
    return normalized;
  }
  throw new SpaceSharingError(
    "INVALID_ARGUMENT",
    `Unsupported access mode: ${value}`,
  );
}

export function normalizeInviteStatus(value: string): SpaceShareInvite["status"] {
  switch (value) {
    case "active":
    case "used":
    case "revoked":
    case "expired":
      return value;
    default:
      return "active";
  }
}

export function normalizeParticipantStatus(value: string): SpaceParticipant["status"] {
  switch (value) {
    case "active":
    case "revoked":
      return value;
    default:
      return "active";
  }
}

export function generateInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function clampInviteTtlSeconds(value: number): number {
  const min = 60;
  const max = 30 * 24 * 60 * 60;
  if (!Number.isFinite(value)) return 24 * 60 * 60;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
