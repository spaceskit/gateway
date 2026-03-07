/**
 * Sharing identity policy — determines identity requirements for join operations.
 *
 * Pure functions — no I/O, no logging, no env access.
 * Bootstrap is responsible for reading env vars and logging results.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SharingIdentityMode = "device_key" | "strict_apple_id";

export type SharingPolicyDenialReason =
  | "identity_assertion_missing"
  | "identity_assertion_invalid"
  | "identity_mode_not_supported";

export interface SharingIdentityPolicy {
  mode: SharingIdentityMode;
  /** If true, device_key joins are allowed even in strict mode as fallback */
  allowDeviceKeyFallback: boolean;
}

export interface SharingIdentityAssertionInput {
  /** The policy for this space/gateway */
  policy: SharingIdentityPolicy;
  /** Whether the joiner provided a device key (always present in current flow) */
  hasDeviceKey: boolean;
  /** Whether the joiner provided an Apple ID assertion */
  hasAppleIdAssertion: boolean;
  /** Optional: the raw assertion value for validation */
  appleIdAssertion?: string;
}

export interface SharingIdentityEvaluationResult {
  allowed: boolean;
  reason?: SharingPolicyDenialReason;
  identityMode: SharingIdentityMode;
  details: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_SHARING_IDENTITY_POLICY: SharingIdentityPolicy = {
  mode: "device_key",
  allowDeviceKeyFallback: true,
};

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a join request meets the identity policy requirements.
 */
export function evaluateSharingIdentity(
  input: SharingIdentityAssertionInput,
): SharingIdentityEvaluationResult {
  const { policy, hasDeviceKey, hasAppleIdAssertion } = input;

  if (policy.mode === "device_key") {
    if (hasDeviceKey) {
      return {
        allowed: true,
        identityMode: "device_key",
        details: "Device key present — identity requirement met",
      };
    }
    return {
      allowed: false,
      reason: "identity_assertion_missing",
      identityMode: "device_key",
      details: "Device key required but not provided",
    };
  }

  // strict_apple_id mode
  if (hasAppleIdAssertion) {
    return {
      allowed: true,
      identityMode: "strict_apple_id",
      details: "Apple ID assertion present — strict identity requirement met",
    };
  }

  if (policy.allowDeviceKeyFallback && hasDeviceKey) {
    return {
      allowed: true,
      identityMode: "device_key",
      details:
        "Apple ID assertion not provided — falling back to device key (fallback enabled)",
    };
  }

  return {
    allowed: false,
    reason: "identity_assertion_missing",
    identityMode: "strict_apple_id",
    details:
      "Apple ID assertion required but not provided (device key fallback disabled)",
  };
}
