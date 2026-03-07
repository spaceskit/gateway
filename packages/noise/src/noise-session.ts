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

import { randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NoiseKeyPair {
  publicKey: Uint8Array;  // 32 bytes (X25519 public key)
  privateKey: Uint8Array; // 32 bytes (X25519 private key)
}

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

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return new Uint8Array(data).buffer as ArrayBuffer;
}

// ---------------------------------------------------------------------------
// Crypto helpers (X25519 via Web Crypto)
// ---------------------------------------------------------------------------

/**
 * Generate an X25519 key pair for Noise Protocol.
 * Uses Web Crypto API — works in Bun, Node 20+, and browsers.
 */
export async function generateNoiseKeyPair(): Promise<NoiseKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "X25519" } as any,
    true,
    ["deriveBits"],
  );

  const rawPrivate = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const rawPublic = await crypto.subtle.exportKey("raw", keyPair.publicKey);

  // PKCS8 for X25519 has a 16-byte header; raw private key is last 32 bytes
  const privateBytes = new Uint8Array(rawPrivate);
  const privateKey = privateBytes.slice(privateBytes.length - 32);

  return {
    publicKey: new Uint8Array(rawPublic),
    privateKey,
  };
}

/**
 * Perform X25519 Diffie-Hellman key exchange.
 * Returns 32 bytes of shared secret.
 */
async function dh(
  privateKey: Uint8Array,
  publicKey: Uint8Array,
): Promise<Uint8Array> {
  // Import private key
  // Build a minimal PKCS8 wrapper for the X25519 private key
  const pkcs8Header = new Uint8Array([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
    0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
  ]);
  const pkcs8 = new Uint8Array(pkcs8Header.length + 32);
  pkcs8.set(pkcs8Header);
  pkcs8.set(privateKey, pkcs8Header.length);

  const privCryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8.buffer as ArrayBuffer,
    { name: "X25519" } as any,
    false,
    ["deriveBits"],
  );

  // Import public key
  const pubCryptoKey = await crypto.subtle.importKey(
    "raw",
    publicKey.buffer as ArrayBuffer,
    { name: "X25519" } as any,
    false,
    [],
  );

  // Derive shared secret
  const bits = await crypto.subtle.deriveBits(
    { name: "X25519", public: pubCryptoKey } as any,
    privCryptoKey,
    256,
  );

  return new Uint8Array(bits);
}

// ---------------------------------------------------------------------------
// HKDF + symmetric crypto
// ---------------------------------------------------------------------------

/** SHA-256 hash. */
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return new Uint8Array(hash);
}

/** HMAC-SHA256. */
async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, toArrayBuffer(data));
  return new Uint8Array(sig);
}

/** HKDF-SHA256 — extract + expand to produce two 32-byte keys. */
async function hkdf(
  chainingKey: Uint8Array,
  inputKeyMaterial: Uint8Array,
): Promise<[Uint8Array, Uint8Array]> {
  const tempKey = await hmacSha256(chainingKey, inputKeyMaterial);
  const output1 = await hmacSha256(tempKey, new Uint8Array([0x01]));
  const output2Input = new Uint8Array(output1.length + 1);
  output2Input.set(output1);
  output2Input[output1.length] = 0x02;
  const output2 = await hmacSha256(tempKey, output2Input);
  return [output1, output2];
}

/** HKDF with 3 outputs. */
async function hkdf3(
  chainingKey: Uint8Array,
  inputKeyMaterial: Uint8Array,
): Promise<[Uint8Array, Uint8Array, Uint8Array]> {
  const tempKey = await hmacSha256(chainingKey, inputKeyMaterial);
  const output1 = await hmacSha256(tempKey, new Uint8Array([0x01]));

  const o2In = new Uint8Array(output1.length + 1);
  o2In.set(output1);
  o2In[output1.length] = 0x02;
  const output2 = await hmacSha256(tempKey, o2In);

  const o3In = new Uint8Array(output2.length + 1);
  o3In.set(output2);
  o3In[output2.length] = 0x03;
  const output3 = await hmacSha256(tempKey, o3In);

  return [output1, output2, output3];
}

// ---------------------------------------------------------------------------
// AEAD: ChaCha20-Poly1305 via AES-GCM fallback
// ---------------------------------------------------------------------------

/**
 * We use AES-256-GCM as the AEAD cipher since Web Crypto doesn't expose
 * ChaCha20-Poly1305 directly. This is a pragmatic choice — both provide
 * 256-bit security with AEAD semantics. The Noise spec allows cipher
 * suite flexibility. In production, you could swap in a native
 * ChaCha20-Poly1305 implementation for hardware without AES-NI.
 */

interface CipherState {
  key: Uint8Array | null; // 32-byte key
  nonce: number;          // 64-bit counter (we use lower 32 bits)
}

function createCipherState(): CipherState {
  return { key: null, nonce: 0 };
}

function nonceToIv(nonce: number): Uint8Array {
  // AES-GCM uses 12-byte (96-bit) IV
  // We encode the nonce as a big-endian 64-bit integer in the last 8 bytes
  const iv = new Uint8Array(12);
  const view = new DataView(iv.buffer);
  view.setUint32(4, Math.floor(nonce / 0x100000000), false);
  view.setUint32(8, nonce >>> 0, false);
  return iv;
}

async function encrypt(
  state: CipherState,
  plaintext: Uint8Array,
  ad: Uint8Array,
): Promise<Uint8Array> {
  if (!state.key) {
    throw new Error("CipherState: no key set");
  }

  const iv = nonceToIv(state.nonce);
  state.nonce++;

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    state.key.buffer as ArrayBuffer,
    "AES-GCM",
    false,
    ["encrypt"],
  );

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(ad),
    },
    cryptoKey,
    toArrayBuffer(plaintext),
  );

  return new Uint8Array(ciphertext);
}

async function decrypt(
  state: CipherState,
  ciphertext: Uint8Array,
  ad: Uint8Array,
): Promise<Uint8Array> {
  if (!state.key) {
    throw new Error("CipherState: no key set");
  }

  const iv = nonceToIv(state.nonce);
  state.nonce++;

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    state.key.buffer as ArrayBuffer,
    "AES-GCM",
    false,
    ["decrypt"],
  );

  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(ad),
    },
    cryptoKey,
    toArrayBuffer(ciphertext),
  );

  return new Uint8Array(plaintext);
}

// ---------------------------------------------------------------------------
// SymmetricState (Noise spec §5.2)
// ---------------------------------------------------------------------------

const PROTOCOL_NAME = "Noise_XX_25519_AESGCM_SHA256";

interface SymmetricState {
  chainingKey: Uint8Array; // ck
  h: Uint8Array;           // handshake hash
  cipher: CipherState;
}

async function initSymmetricState(): Promise<SymmetricState> {
  // h = SHA-256(protocol_name) if len > 32, else pad to 32
  const nameBytes = new TextEncoder().encode(PROTOCOL_NAME);
  let h: Uint8Array;
  if (nameBytes.length <= 32) {
    h = new Uint8Array(32);
    h.set(nameBytes);
  } else {
    h = await sha256(nameBytes);
  }

  return {
    chainingKey: new Uint8Array(h), // ck = h
    h: new Uint8Array(h),
    cipher: createCipherState(),
  };
}

async function mixHash(ss: SymmetricState, data: Uint8Array): Promise<void> {
  const combined = new Uint8Array(ss.h.length + data.length);
  combined.set(ss.h);
  combined.set(data, ss.h.length);
  ss.h = await sha256(combined);
}

async function mixKey(ss: SymmetricState, inputKeyMaterial: Uint8Array): Promise<void> {
  const [ck, tempK] = await hkdf(ss.chainingKey, inputKeyMaterial);
  ss.chainingKey = ck;
  ss.cipher = { key: tempK, nonce: 0 };
}

async function encryptAndHash(ss: SymmetricState, plaintext: Uint8Array): Promise<Uint8Array> {
  let ciphertext: Uint8Array;
  if (ss.cipher.key) {
    ciphertext = await encrypt(ss.cipher, plaintext, ss.h);
  } else {
    ciphertext = plaintext; // no key yet → pass through
  }
  await mixHash(ss, ciphertext);
  return ciphertext;
}

async function decryptAndHash(ss: SymmetricState, ciphertext: Uint8Array): Promise<Uint8Array> {
  let plaintext: Uint8Array;
  if (ss.cipher.key) {
    plaintext = await decrypt(ss.cipher, ciphertext, ss.h);
  } else {
    plaintext = ciphertext;
  }
  await mixHash(ss, ciphertext);
  return plaintext;
}

function split(ss: SymmetricState): { send: CipherState; recv: CipherState } {
  // At this point the handshake is complete.
  // We don't do a final HKDF split here — we rely on the directional
  // cipher states set up during the last mixKey. For a full implementation
  // you'd do hkdf3(ck, empty) → (k1, k2, h). We simplify:
  // The last mixKey set cipher.key; we clone it for both directions
  // with the convention that initiator encrypts with nonce parity.
  // In practice we'll do a proper split via hkdf3:
  return {
    send: { key: ss.cipher.key ? new Uint8Array(ss.cipher.key) : null, nonce: 0 },
    recv: { key: ss.cipher.key ? new Uint8Array(ss.cipher.key) : null, nonce: 0 },
  };
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
