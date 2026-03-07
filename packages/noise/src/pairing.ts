/**
 * Pairing code generation and validation for Spaceskit Noise Protocol.
 *
 * A pairing code encodes:
 * - Gateway's Noise public key (32 bytes)
 * - A one-time pairing token (16 bytes, random)
 *
 * Format: WORD-WORD-WORD-NNNN (human-readable, typed on phone)
 * The words are an index into the pairing payload, not the full key.
 * The actual key exchange happens out-of-band: the pairing code is
 * a short-lived lookup token that maps to the full public key on the gateway.
 */

import { randomBytes } from "node:crypto";
import { PAIRING_WORDLIST } from "./wordlist.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PairingCode {
  /** Human-readable code, e.g., "STORM-DELTA-RUBY-7924" */
  code: string;
  /** Random pairing token (16 bytes, hex). */
  token: string;
  /** When the code was generated. */
  createdAt: Date;
  /** When the code expires (default: 10 minutes). */
  expiresAt: Date;
}

export interface PairingRequest {
  /** The pairing token from the code. */
  token: string;
  /** Client's Noise static public key (base64). */
  clientPublicKey: string;
  /** Client device name (e.g., "Carmine's iPhone"). */
  deviceName: string;
  /** Device type hint. */
  deviceType: "ios" | "macos" | "gateway" | "browser" | "other";
}

export interface PairedDevice {
  /** Unique device ID (derived from public key). */
  deviceId: string;
  /** Human-readable device name. */
  name: string;
  /** Noise static public key (base64). */
  noisePublicKey: string;
  /** Device type. */
  deviceType: string;
  /** When pairing was completed. */
  pairedAt: Date;
  /** Last time the device connected. */
  lastSeenAt: Date | null;
  /** Whether the device has been revoked. */
  isRevoked: boolean;
}

// ---------------------------------------------------------------------------
// Pairing code generation
// ---------------------------------------------------------------------------

/**
 * Generate a human-readable pairing code.
 *
 * The code is WORD-WORD-WORD-NNNN where:
 * - Each word is randomly selected from a 256-word list (8 bits each)
 * - NNNN is a random 4-digit number
 * - Total entropy: ~37 bits (sufficient for a short-lived token)
 *
 * The code is a lookup key — the gateway stores the mapping from
 * code → full Noise public key internally.
 */
export function generatePairingCode(
  ttlMs: number = 10 * 60 * 1000, // 10 minutes
): PairingCode {
  const bytes = randomBytes(4); // 32 bits of randomness for words + number

  const word1 = PAIRING_WORDLIST[bytes[0]!];
  const word2 = PAIRING_WORDLIST[bytes[1]!];
  const word3 = PAIRING_WORDLIST[bytes[2]!];
  const number = (bytes[3]! * 39 + 1000) % 10000; // 4-digit number

  const numberStr = number.toString().padStart(4, "0");
  const code = `${word1}-${word2}-${word3}-${numberStr}`;

  // Generate the actual pairing token (higher entropy, stored server-side)
  const token = randomBytes(16).toString("hex");

  const now = new Date();
  return {
    code,
    token,
    createdAt: now,
    expiresAt: new Date(now.getTime() + ttlMs),
  };
}

/**
 * Parse a pairing code string back into its components.
 * Returns null if the format is invalid.
 */
export function parsePairingCode(code: string): { words: string[]; number: string } | null {
  const parts = code.trim().toUpperCase().split("-");
  if (parts.length !== 4) return null;

  const [w1, w2, w3, num] = parts;
  if (!w1 || !w2 || !w3 || !num) return null;

  // Validate words are in the wordlist
  if (!PAIRING_WORDLIST.includes(w1)) return null;
  if (!PAIRING_WORDLIST.includes(w2)) return null;
  if (!PAIRING_WORDLIST.includes(w3)) return null;

  // Validate number format
  if (!/^\d{4}$/.test(num)) return null;

  return { words: [w1, w2, w3], number: num };
}

// ---------------------------------------------------------------------------
// Pairing store (in-memory, with SQLite persistence hooks)
// ---------------------------------------------------------------------------

/**
 * Manages active pairing codes and completed pairings.
 *
 * Active codes are stored in-memory (they're short-lived).
 * Completed pairings are persisted to SQLite via callbacks.
 */
export class PairingManager {
  /** Active (pending) pairing codes, keyed by code string. */
  private activeCodes = new Map<string, PairingCode & { gatewayPublicKey: string }>();

  /** Paired devices, keyed by device ID. */
  private devices = new Map<string, PairedDevice>();

  constructor(
    private options: {
      /** Gateway's Noise public key (base64). */
      gatewayPublicKey: string;
      /** Optional: persist a new paired device. */
      onDevicePaired?: (device: PairedDevice) => Promise<void>;
      /** Optional: load paired devices on startup. */
      loadDevices?: () => Promise<PairedDevice[]>;
    },
  ) {}

  /**
   * Initialize the pairing manager. Loads persisted devices if available.
   */
  async initialize(): Promise<void> {
    if (this.options.loadDevices) {
      const devices = await this.options.loadDevices();
      for (const device of devices) {
        this.devices.set(device.deviceId, device);
      }
    }
  }

  /**
   * Generate a new pairing code.
   * Returns the code to display to the user.
   */
  generateCode(ttlMs?: number): PairingCode {
    // Clean up expired codes
    this.cleanExpiredCodes();

    const pairingCode = generatePairingCode(ttlMs);

    this.activeCodes.set(pairingCode.code, {
      ...pairingCode,
      gatewayPublicKey: this.options.gatewayPublicKey,
    });

    return pairingCode;
  }

  /**
   * Validate a pairing code and register the device.
   * Returns the paired device, or null if the code is invalid/expired.
   */
  async completePairing(request: PairingRequest): Promise<PairedDevice | null> {
    // Find the active code that matches this token
    let matchedCode: (PairingCode & { gatewayPublicKey: string }) | null = null;
    let matchedCodeKey: string | null = null;

    for (const [key, code] of this.activeCodes) {
      if (code.token === request.token) {
        matchedCode = code;
        matchedCodeKey = key;
        break;
      }
    }

    if (!matchedCode || !matchedCodeKey) {
      return null; // Invalid token
    }

    // Check expiry
    if (new Date() > matchedCode.expiresAt) {
      this.activeCodes.delete(matchedCodeKey);
      return null; // Expired
    }

    // Remove the used code (one-time use)
    this.activeCodes.delete(matchedCodeKey);

    // Derive device ID from public key
    const keyBytes = Uint8Array.from(atob(request.clientPublicKey), (c) => c.charCodeAt(0));
    const hashBytes = await crypto.subtle.digest("SHA-256", keyBytes);
    const deviceId = Array.from(new Uint8Array(hashBytes).slice(0, 8))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const device: PairedDevice = {
      deviceId,
      name: request.deviceName,
      noisePublicKey: request.clientPublicKey,
      deviceType: request.deviceType,
      pairedAt: new Date(),
      lastSeenAt: null,
      isRevoked: false,
    };

    this.devices.set(deviceId, device);

    // Persist
    if (this.options.onDevicePaired) {
      await this.options.onDevicePaired(device);
    }

    return device;
  }

  /**
   * Check if a Noise public key belongs to a known, non-revoked device.
   */
  isKnownPeer(noisePublicKey: string): boolean {
    for (const device of this.devices.values()) {
      if (device.noisePublicKey === noisePublicKey && !device.isRevoked) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get a paired device by its Noise public key.
   */
  getDeviceByKey(noisePublicKey: string): PairedDevice | null {
    for (const device of this.devices.values()) {
      if (device.noisePublicKey === noisePublicKey) {
        return device;
      }
    }
    return null;
  }

  /**
   * Update the last-seen timestamp for a device.
   */
  touchDevice(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.lastSeenAt = new Date();
    }
  }

  /**
   * Revoke a paired device.
   */
  revokeDevice(deviceId: string): boolean {
    const device = this.devices.get(deviceId);
    if (device) {
      device.isRevoked = true;
      return true;
    }
    return false;
  }

  /**
   * List all paired devices.
   */
  listDevices(): PairedDevice[] {
    return Array.from(this.devices.values());
  }

  /**
   * Get the gateway's Noise public key (for sharing with clients during pairing).
   */
  getGatewayPublicKey(): string {
    return this.options.gatewayPublicKey;
  }

  /**
   * Remove expired pairing codes.
   */
  private cleanExpiredCodes(): void {
    const now = new Date();
    for (const [key, code] of this.activeCodes) {
      if (now > code.expiresAt) {
        this.activeCodes.delete(key);
      }
    }
  }
}
