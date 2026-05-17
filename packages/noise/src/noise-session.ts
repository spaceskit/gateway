/**
 * Noise Protocol session for Spaceskit.
 *
 * Implements Noise_XX_25519_ChaChaPoly_SHA256:
 * - XX pattern: both sides send static keys (mutual authentication)
 * - X25519: Diffie-Hellman key exchange
 * - ChaCha20-Poly1305: AEAD encryption
 * - SHA-256: hash function
 *
 * The XX handshake:
 *   → e                         (initiator sends ephemeral key)
 *   ← e, ee, s, es             (responder sends ephemeral + static, DH)
 *   → s, se                    (initiator sends static, DH)
 *
 * After handshake: both sides have two CipherState objects for
 * encrypting/decrypting in each direction.
 *
 * Uses Web Crypto API (X25519 + manual ChaCha20-Poly1305 via subtle).
 * For Bun, this is backed by BoringSSL.
 */

import { decrypt, dh, encrypt, generateNoiseKeyPair, hkdf, type CipherState, type NoiseKeyPair } from "./noise-crypto.js";
import { decryptAndHash, encryptAndHash, initSymmetricState, mixHash, mixKey, type SymmetricState } from "./noise-symmetric-state.js";

export { generateNoiseKeyPair } from "./noise-crypto.js";
export type { NoiseKeyPair } from "./noise-crypto.js";

export interface NoiseSessionOptions {
  /** Our static Noise key pair (long-lived identity). */
  staticKeyPair: NoiseKeyPair;
  /** Remote static public key, if known (e.g., from pairing). */
  remoteStaticKey?: Uint8Array;
  /** Whether this session is the initiator (client) or responder (server). */
  isInitiator: boolean;
}

export type NoiseHandshakeState = "idle" | "waiting" | "ready" | "failed";

/**
 * Encrypted message envelope sent over WebSocket during and after handshake.
 */
export interface NoiseEnvelope {
  /** "handshake" during XX negotiation, "transport" after. */
  phase: "handshake" | "transport";
  /** Handshake step (0, 1, 2) or omitted for transport. */
  step?: number;
  /** Base64-encoded payload (handshake token or encrypted message). */
  data: string;
}

// ---------------------------------------------------------------------------
// NoiseSession — high-level API
// ---------------------------------------------------------------------------

/**
 * A Noise Protocol session that wraps a WebSocket connection
 * with end-to-end encryption using the XX handshake pattern.
 *
 * Usage:
 *
 * // Server (responder):
 * const session = new NoiseSession({ staticKeyPair, isInitiator: false });
 * // On receiving handshake message step 0 from client:
 * const reply = await session.processHandshake(msg0);
 * // Send reply (step 1), then receive step 2:
 * const finalReply = await session.processHandshake(msg2);
 * // Now session.isReady() — use encryptMessage / decryptMessage
 *
 * // Client (initiator):
 * const session = new NoiseSession({ staticKeyPair, isInitiator: true });
 * const msg0 = await session.startHandshake();
 * // Send msg0, receive reply (step 1):
 * const msg2 = await session.processHandshake(reply);
 * // Send msg2. Now session.isReady().
 */
export class NoiseSession {
  private ss: SymmetricState | null = null;
  private ephemeralKeyPair: NoiseKeyPair | null = null;
  private remoteEphemeralKey: Uint8Array | null = null;
  private remoteStaticKey: Uint8Array | null = null;
  private sendCipher: CipherState | null = null;
  private recvCipher: CipherState | null = null;
  private handshakeStep = 0;

  public state: NoiseHandshakeState = "idle";

  constructor(private options: NoiseSessionOptions) {
    if (options.remoteStaticKey) {
      this.remoteStaticKey = new Uint8Array(options.remoteStaticKey);
    }
  }

  /** The remote peer's static public key (available after handshake). */
  get remotePublicKey(): Uint8Array | null {
    return this.remoteStaticKey;
  }

  /** Whether the Noise handshake is complete and we can encrypt/decrypt. */
  isReady(): boolean {
    return this.state === "ready";
  }

  /**
   * Initiator: start the XX handshake. Returns the first message (step 0).
   *
   * → e
   */
  async startHandshake(): Promise<Uint8Array> {
    if (!this.options.isInitiator) {
      throw new Error("Only the initiator can start the handshake");
    }

    this.ss = await initSymmetricState();
    this.ephemeralKeyPair = await generateNoiseKeyPair();

    // → e: send ephemeral public key
    const e = this.ephemeralKeyPair.publicKey;
    await mixHash(this.ss, e);

    // The payload is empty for XX step 0
    const payload = await encryptAndHash(this.ss, new Uint8Array(0));

    this.state = "waiting";
    this.handshakeStep = 1;

    // Message = e || payload
    const msg = new Uint8Array(e.length + payload.length);
    msg.set(e);
    msg.set(payload, e.length);
    return msg;
  }

  /**
   * Process an incoming handshake message. Returns the response to send,
   * or null if the handshake is complete and no response is needed.
   */
  async processHandshake(message: Uint8Array): Promise<Uint8Array | null> {
    if (this.options.isInitiator) {
      return this.processHandshakeInitiator(message);
    } else {
      return this.processHandshakeResponder(message);
    }
  }

  /**
   * Responder: process messages from the initiator.
   */
  private async processHandshakeResponder(message: Uint8Array): Promise<Uint8Array | null> {
    if (this.handshakeStep === 0) {
      // Step 0: receive → e from initiator
      this.ss = await initSymmetricState();
      this.ephemeralKeyPair = await generateNoiseKeyPair();

      // Read remote ephemeral key (first 32 bytes)
      this.remoteEphemeralKey = message.slice(0, 32);
      await mixHash(this.ss, this.remoteEphemeralKey);

      // Decrypt payload (empty)
      await decryptAndHash(this.ss, message.slice(32));

      // Step 1: ← e, ee, s, es
      const e = this.ephemeralKeyPair.publicKey;
      await mixHash(this.ss, e);

      // ee: DH(e_responder, e_initiator)
      const ee = await dh(this.ephemeralKeyPair.privateKey, this.remoteEphemeralKey);
      await mixKey(this.ss, ee);

      // s: encrypt and send our static key
      const encryptedS = await encryptAndHash(this.ss, this.options.staticKeyPair.publicKey);

      // es: DH(s_responder, e_initiator)
      const es = await dh(this.options.staticKeyPair.privateKey, this.remoteEphemeralKey);
      await mixKey(this.ss, es);

      // Encrypt payload (empty)
      const payload = await encryptAndHash(this.ss, new Uint8Array(0));

      this.handshakeStep = 2;
      this.state = "waiting";

      // Message = e || encrypted_s || payload
      const msg = new Uint8Array(e.length + encryptedS.length + payload.length);
      msg.set(e);
      msg.set(encryptedS, e.length);
      msg.set(payload, e.length + encryptedS.length);
      return msg;
    }

    if (this.handshakeStep === 2) {
      // Step 2: receive → s, se from initiator
      // Read encrypted static key (32 bytes + 16 byte tag = 48 bytes)
      const encryptedS = message.slice(0, 48);
      const remoteS = await decryptAndHash(this.ss!, encryptedS);
      this.remoteStaticKey = remoteS;

      // se: DH(e_responder, s_initiator)
      const se = await dh(this.ephemeralKeyPair!.privateKey, this.remoteStaticKey);
      await mixKey(this.ss!, se);

      // Decrypt payload (empty)
      await decryptAndHash(this.ss!, message.slice(48));

      // Handshake complete — split into transport cipher states
      this.finalize(false);
      return null; // No response needed
    }

    throw new Error(`Unexpected responder handshake step: ${this.handshakeStep}`);
  }

  /**
   * Initiator: process the responder's reply.
   */
  private async processHandshakeInitiator(message: Uint8Array): Promise<Uint8Array | null> {
    if (this.handshakeStep === 1) {
      // Step 1: receive ← e, ee, s, es

      // Read remote ephemeral key
      this.remoteEphemeralKey = message.slice(0, 32);
      await mixHash(this.ss!, this.remoteEphemeralKey);

      // ee: DH(e_initiator, e_responder)
      const ee = await dh(this.ephemeralKeyPair!.privateKey, this.remoteEphemeralKey);
      await mixKey(this.ss!, ee);

      // Read encrypted static key (48 bytes: 32 key + 16 tag)
      const encryptedS = message.slice(32, 80);
      const remoteS = await decryptAndHash(this.ss!, encryptedS);
      this.remoteStaticKey = remoteS;

      // es: DH(e_initiator, s_responder)
      const es = await dh(this.ephemeralKeyPair!.privateKey, this.remoteStaticKey);
      await mixKey(this.ss!, es);

      // Decrypt payload (empty)
      await decryptAndHash(this.ss!, message.slice(80));

      // Step 2: → s, se
      // Encrypt and send our static key
      const encryptedOurS = await encryptAndHash(this.ss!, this.options.staticKeyPair.publicKey);

      // se: DH(s_initiator, e_responder)
      const se = await dh(this.options.staticKeyPair.privateKey, this.remoteEphemeralKey);
      await mixKey(this.ss!, se);

      // Encrypt payload (empty)
      const payload = await encryptAndHash(this.ss!, new Uint8Array(0));

      // Handshake complete — split into transport cipher states
      this.finalize(true);

      // Return final handshake message
      const msg = new Uint8Array(encryptedOurS.length + payload.length);
      msg.set(encryptedOurS);
      msg.set(payload, encryptedOurS.length);
      return msg;
    }

    throw new Error(`Unexpected initiator handshake step: ${this.handshakeStep}`);
  }

  /**
   * Split the symmetric state into directional cipher states.
   */
  private async finalize(isInitiator: boolean): Promise<void> {
    const [k1, k2] = await hkdf(this.ss!.chainingKey, new Uint8Array(0));

    if (isInitiator) {
      this.sendCipher = { key: k1, nonce: 0 };
      this.recvCipher = { key: k2, nonce: 0 };
    } else {
      this.sendCipher = { key: k2, nonce: 0 };
      this.recvCipher = { key: k1, nonce: 0 };
    }

    this.state = "ready";

    // Clear handshake state
    this.ss = null;
    this.ephemeralKeyPair = null;
  }

  /**
   * Encrypt a message for sending over the transport.
   * Can only be called after handshake is complete.
   */
  async encryptMessage(plaintext: Uint8Array): Promise<Uint8Array> {
    if (!this.sendCipher?.key) {
      throw new Error("Noise session not ready — handshake incomplete");
    }
    return encrypt(this.sendCipher, plaintext, new Uint8Array(0));
  }

  /**
   * Decrypt a received message.
   * Can only be called after handshake is complete.
   */
  async decryptMessage(ciphertext: Uint8Array): Promise<Uint8Array> {
    if (!this.recvCipher?.key) {
      throw new Error("Noise session not ready — handshake incomplete");
    }
    return decrypt(this.recvCipher, ciphertext, new Uint8Array(0));
  }
}
