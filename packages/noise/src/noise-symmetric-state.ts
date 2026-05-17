import { createCipherState, decrypt, encrypt, hkdf, toArrayBuffer, type CipherState } from "./noise-crypto.js";

/** SHA-256 hash. */
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return new Uint8Array(hash);
}

const PROTOCOL_NAME = "Noise_XX_25519_AESGCM_SHA256";

export interface SymmetricState {
  chainingKey: Uint8Array; // ck
  h: Uint8Array;           // handshake hash
  cipher: CipherState;
}

export async function initSymmetricState(): Promise<SymmetricState> {
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

export async function mixHash(ss: SymmetricState, data: Uint8Array): Promise<void> {
  const combined = new Uint8Array(ss.h.length + data.length);
  combined.set(ss.h);
  combined.set(data, ss.h.length);
  ss.h = await sha256(combined);
}

export async function mixKey(ss: SymmetricState, inputKeyMaterial: Uint8Array): Promise<void> {
  const [ck, tempK] = await hkdf(ss.chainingKey, inputKeyMaterial);
  ss.chainingKey = ck;
  ss.cipher = { key: tempK, nonce: 0 };
}

export async function encryptAndHash(ss: SymmetricState, plaintext: Uint8Array): Promise<Uint8Array> {
  let ciphertext: Uint8Array;
  if (ss.cipher.key) {
    ciphertext = await encrypt(ss.cipher, plaintext, ss.h);
  } else {
    ciphertext = plaintext; // no key yet → pass through
  }
  await mixHash(ss, ciphertext);
  return ciphertext;
}

export async function decryptAndHash(ss: SymmetricState, ciphertext: Uint8Array): Promise<Uint8Array> {
  let plaintext: Uint8Array;
  if (ss.cipher.key) {
    plaintext = await decrypt(ss.cipher, ciphertext, ss.h);
  } else {
    plaintext = ciphertext;
  }
  await mixHash(ss, ciphertext);
  return plaintext;
}
