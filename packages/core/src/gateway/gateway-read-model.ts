/**
 * Gateway read model — metadata types for multi-gateway management surfaces.
 * Used by the app to display gateway list/detail with transport posture and risk state.
 */

/**
 * Transport security posture.
 * Mirrors `GatewayTransportPosture` from `@spaceskit/policy` — duplicated here
 * to avoid a circular dependency (policy already depends on core).
 */
export type GatewayTransportPosture =
  | "encrypted"
  | "plaintext_loopback"
  | "plaintext_denied";

export type GatewayConnectionStatus =
  | "connected"
  | "connecting"
  | "disconnected"
  | "error";

export type GatewayRiskLevel = "none" | "low" | "elevated" | "high";

export interface GatewayReadModel {
  /** Gateway identifier (user-assigned or auto-generated) */
  gatewayId: string;
  /** Display name */
  name: string;
  /** WebSocket URL */
  url: string;
  /** Gateway profile */
  profile: "embedded" | "external";
  /** Current connection status */
  connectionStatus: GatewayConnectionStatus;
  /** Transport security posture */
  transportPosture: GatewayTransportPosture;
  /** Overall risk assessment */
  riskLevel: GatewayRiskLevel;
  /** Number of active spaces */
  spaceCount: number;
  /** Whether this is the primary/default gateway */
  isPrimary: boolean;
  /** ISO timestamp of last successful connection */
  lastConnectedAt?: string;
  /** Human-readable risk summary */
  riskSummary?: string;
}

/**
 * Derive risk level from transport posture and connection status.
 */
export function deriveRiskLevel(
  posture: GatewayTransportPosture,
  connectionStatus: GatewayConnectionStatus,
): GatewayRiskLevel {
  if (connectionStatus === "error" || connectionStatus === "disconnected") {
    return "elevated";
  }
  if (connectionStatus === "connecting") {
    return "low";
  }
  // connected
  switch (posture) {
    case "encrypted":
      return "none";
    case "plaintext_loopback":
      return "low";
    case "plaintext_denied":
      return "high";
  }
}

/**
 * Generate a human-readable risk summary string.
 */
export function riskSummary(
  posture: GatewayTransportPosture,
  riskLevel: GatewayRiskLevel,
): string {
  switch (riskLevel) {
    case "none":
      return "Encrypted transport — no risk";
    case "low":
      if (posture === "plaintext_loopback") {
        return "Plaintext on loopback — acceptable for local development";
      }
      return "Connection in progress";
    case "elevated":
      return "Connection unavailable — posture cannot be verified";
    case "high":
      return "Plaintext on non-loopback interface — traffic is exposed";
  }
}
