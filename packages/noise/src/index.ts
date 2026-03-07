/**
 * @spaceskit/noise — Noise Protocol transport for Spaceskit.
 *
 * Provides end-to-end encryption for WebSocket connections using
 * the Noise XX handshake pattern with X25519 key exchange.
 *
 * No domains. No certificates. No CAs.
 * Just Ed25519 identity keys and a pairing code.
 */

export {
  NoiseSession,
  generateNoiseKeyPair,
  type NoiseKeyPair,
  type NoiseSessionOptions,
  type NoiseHandshakeState,
  type NoiseEnvelope,
} from "./noise-session.js";

export {
  PairingManager,
  generatePairingCode,
  parsePairingCode,
  type PairingCode,
  type PairingRequest,
  type PairedDevice,
} from "./pairing.js";

export { PAIRING_WORDLIST } from "./wordlist.js";
