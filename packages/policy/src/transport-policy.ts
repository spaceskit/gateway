/**
 * Transport policy evaluation for gateway connections.
 *
 * Pure functions — no I/O, no logging, no env access.
 * Bootstrap is responsible for reading env vars and logging results.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GatewayTransportPosture =
  | "encrypted"
  | "plaintext_loopback"
  | "plaintext_denied";

export type TransportPolicyDenialReason =
  | "non_loopback_insecure";

export interface TransportPolicyResult {
  posture: GatewayTransportPosture;
  denied: boolean;
  reason?: TransportPolicyDenialReason;
  details: string;
}

export interface TransportPolicyInput {
  host: string;
  port: number;
  gatewayProfile: "embedded" | "external";
  noiseEnabled: boolean;
  enforcementOverride?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * Returns true if the host is a loopback address.
 * Note: `0.0.0.0` binds to ALL interfaces (including external) and is NOT loopback.
 */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

export function evaluateTransportPolicy(input: TransportPolicyInput): TransportPolicyResult {
  const host = input.host.trim().toLowerCase();

  // Loopback is always allowed — plaintext on localhost is fine
  if (isLoopbackHost(host)) {
    return {
      posture: "plaintext_loopback",
      denied: false,
      details: `Loopback bind (${host}) — plaintext allowed`,
    };
  }

  // Non-loopback with Noise → encrypted, always allowed
  if (input.noiseEnabled) {
    return {
      posture: "encrypted",
      denied: false,
      details: `Non-loopback bind (${host}) with Noise transport — encrypted`,
    };
  }

  // Non-loopback without encryption — determine enforcement
  const enforced = input.enforcementOverride ?? (input.gatewayProfile === "external");

  return {
    posture: "plaintext_denied",
    denied: enforced,
    reason: "non_loopback_insecure",
    details: `Non-loopback bind (${host}) without encrypted transport (Noise) is insecure`,
  };
}
