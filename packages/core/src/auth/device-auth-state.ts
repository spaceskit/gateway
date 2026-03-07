/**
 * Device authentication state model.
 * Tracks the local device's auth lifecycle: unregistered -> registered -> authenticated.
 * Biometric/secure enclave access is app-side; this models the state transitions.
 */

export type DeviceAuthPhase =
  | "unregistered"      // No device identity registered with gateway
  | "pending_biometric" // Awaiting local biometric verification
  | "biometric_failed"  // Biometric cancelled or failed, can retry
  | "registered"        // Device registered, keys available
  | "authenticated";    // Active authenticated session

export type BiometricAvailability =
  | "available"         // Touch ID / Face ID available
  | "not_available"     // No biometric hardware
  | "not_enrolled"      // Hardware present but not set up
  | "locked_out";       // Too many failed attempts

export interface DeviceAuthState {
  phase: DeviceAuthPhase;
  deviceId?: string;
  principalId?: string;
  biometricAvailability: BiometricAvailability;
  /** Whether this is the first-ever connect (no stored device identity) */
  isFirstConnect: boolean;
  /** Last error message if phase is biometric_failed */
  lastError?: string;
  /** ISO timestamp of last successful auth */
  lastAuthenticatedAt?: string;
}

export interface DeviceAuthTransition {
  from: DeviceAuthPhase;
  to: DeviceAuthPhase;
  trigger: string;
  timestamp: string;
}

export const INITIAL_DEVICE_AUTH_STATE: DeviceAuthState = {
  phase: "unregistered",
  biometricAvailability: "available",
  isFirstConnect: true,
};

export type DeviceAuthEvent =
  | { type: "biometric_requested" }
  | { type: "biometric_succeeded"; deviceId: string; principalId: string }
  | { type: "biometric_failed"; error: string }
  | { type: "biometric_cancelled" }
  | { type: "device_registered"; deviceId: string; principalId: string }
  | { type: "session_authenticated"; timestamp: string }
  | { type: "session_disconnected" }
  | { type: "device_revoked" };

/**
 * Compute the next auth state based on the current state and a trigger event.
 * Pure state machine -- no side effects.
 */
export function transitionDeviceAuth(
  current: DeviceAuthState,
  event: DeviceAuthEvent,
): DeviceAuthState {
  switch (current.phase) {
    case "unregistered": {
      if (event.type === "biometric_requested") {
        return { ...current, phase: "pending_biometric", lastError: undefined };
      }
      return current;
    }

    case "pending_biometric": {
      if (event.type === "biometric_succeeded") {
        return {
          ...current,
          phase: "registered",
          deviceId: event.deviceId,
          principalId: event.principalId,
          isFirstConnect: false,
          lastError: undefined,
        };
      }
      if (event.type === "biometric_failed") {
        return { ...current, phase: "biometric_failed", lastError: event.error };
      }
      if (event.type === "biometric_cancelled") {
        return { ...current, phase: "biometric_failed", lastError: "cancelled" };
      }
      return current;
    }

    case "biometric_failed": {
      if (event.type === "biometric_requested") {
        return { ...current, phase: "pending_biometric", lastError: undefined };
      }
      return current;
    }

    case "registered": {
      if (event.type === "device_registered") {
        return {
          ...current,
          deviceId: event.deviceId,
          principalId: event.principalId,
        };
      }
      if (event.type === "session_authenticated") {
        return {
          ...current,
          phase: "authenticated",
          lastAuthenticatedAt: event.timestamp,
        };
      }
      return current;
    }

    case "authenticated": {
      if (event.type === "session_disconnected") {
        return { ...current, phase: "registered" };
      }
      if (event.type === "device_revoked") {
        return {
          ...INITIAL_DEVICE_AUTH_STATE,
          biometricAvailability: current.biometricAvailability,
          isFirstConnect: false,
        };
      }
      return current;
    }

    default:
      return current;
  }
}
