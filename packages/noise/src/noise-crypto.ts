export interface NoiseKeyPair {
  publicKey: Uint8Array;  // 32 bytes (X25519 public key)
  privateKey: Uint8Array; // 32 bytes (X25519 private key)
}

export function toArrayBuffer(data: Uint8Array): ArrayBuffer {
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
export async function dh(
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
export async function hkdf(
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

export interface CipherState {
  key: Uint8Array | null; // 32-byte key
  nonce: number;          // 64-bit counter (we use lower 32 bits)
}

export function createCipherState(): CipherState {
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

export async function encrypt(
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

export async function decrypt(
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
