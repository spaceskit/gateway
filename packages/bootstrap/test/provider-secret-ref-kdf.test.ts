import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Logger } from "@spaceskit/observability";
import { initDatabase, ProviderSecretRefRepository } from "@spaceskit/persistence";
import { ProviderSecretRefService } from "../src/services/provider-secret-ref-service.js";

function createContext(masterKey?: string) {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-kdf-${crypto.randomUUID()}`,
  });
  const repository = new ProviderSecretRefRepository(db.db);
  const service = new ProviderSecretRefService({
    repository,
    logger: new Logger({ minLevel: "error", module: "kdf-test" }),
    masterKey,
  });
  return { db, repository, service };
}

describe("KDF versioning", () => {
  test("v1 encrypt/decrypt round-trip works with explicit master key", () => {
    const ctx = createContext("my-strong-passphrase");
    try {
      const put = ctx.service.putSecretRef({
        providerId: "openai",
        secret: "sk-secret-value-12345",
      });

      const resolved = ctx.service.resolveSecret(put.secretRef.secretRef);
      expect(resolved).not.toBeNull();
      expect(resolved!.secret).toBe("sk-secret-value-12345");

      // Verify the IV column contains versioned data (29 bytes: 1 + 16 + 12)
      const row = ctx.repository.get(put.secretRef.secretRef);
      const ivBuf = Buffer.from(row!.iv, "base64");
      expect(ivBuf.length).toBe(29); // version byte + 16-byte salt + 12-byte IV
      expect(ivBuf[0]).toBe(0x01); // KDF_V1
    } finally {
      ctx.db.close();
    }
  });

  test("v0 encrypted data can be decrypted by v1-aware service (backward compat)", () => {
    // First, encrypt with a service that has no master key (v0 path)
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-kdf-compat-${crypto.randomUUID()}`,
    });
    const repository = new ProviderSecretRefRepository(db.db);

    try {
      // Create v0 data manually: encrypt with SHA-256 derived key, raw 12-byte IV
      const masterKey = "compat-test-key";
      const key = createHash("sha256").update(masterKey).digest();

      // Use node:crypto to create v0-format encrypted data
      const { createCipheriv, randomBytes } = require("node:crypto");
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([
        cipher.update("legacy-secret-value", "utf8"),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();

      // Insert v0 row directly
      repository.upsert({
        secretRef: "secretref-legacy",
        providerId: "anthropic",
        label: "Legacy Secret",
        backend: "gateway_encrypted",
        encryptedSecret: ciphertext.toString("base64"),
        iv: iv.toString("base64"), // raw 12-byte IV (v0 format)
        authTag: authTag.toString("base64"),
      });

      // Now create a v1-aware service with the same master key
      const service = new ProviderSecretRefService({
        repository,
        logger: new Logger({ minLevel: "error", module: "kdf-compat-test" }),
        masterKey,
      });

      // Should be able to decrypt v0 data
      const resolved = service.resolveSecret("secretref-legacy");
      expect(resolved).not.toBeNull();
      expect(resolved!.secret).toBe("legacy-secret-value");
    } finally {
      db.close();
    }
  });

  test("v1 uses different derived keys for different salts (same passphrase)", () => {
    const ctx = createContext("same-passphrase");
    try {
      // Encrypt two secrets — each should get a unique salt
      const put1 = ctx.service.putSecretRef({
        providerId: "provider-a",
        secret: "secret-one",
      });
      const put2 = ctx.service.putSecretRef({
        providerId: "provider-b",
        secret: "secret-two",
      });

      const row1 = ctx.repository.get(put1.secretRef.secretRef);
      const row2 = ctx.repository.get(put2.secretRef.secretRef);

      // Both should be v1 format
      const iv1 = Buffer.from(row1!.iv, "base64");
      const iv2 = Buffer.from(row2!.iv, "base64");
      expect(iv1.length).toBe(29);
      expect(iv2.length).toBe(29);

      // Salts (bytes 1-16) should differ
      const salt1 = iv1.subarray(1, 17).toString("hex");
      const salt2 = iv2.subarray(1, 17).toString("hex");
      expect(salt1).not.toBe(salt2);

      // Both should still decrypt correctly
      expect(ctx.service.resolveSecret(put1.secretRef.secretRef)!.secret).toBe("secret-one");
      expect(ctx.service.resolveSecret(put2.secretRef.secretRef)!.secret).toBe("secret-two");
    } finally {
      ctx.db.close();
    }
  });

  test("different passphrases produce different encrypted outputs", () => {
    const ctx1 = createContext("passphrase-alpha");
    const ctx2 = createContext("passphrase-beta");
    try {
      const put1 = ctx1.service.putSecretRef({
        providerId: "provider",
        secret: "same-secret",
      });
      const put2 = ctx2.service.putSecretRef({
        providerId: "provider",
        secret: "same-secret",
      });

      const row1 = ctx1.repository.get(put1.secretRef.secretRef);
      const row2 = ctx2.repository.get(put2.secretRef.secretRef);

      // Encrypted ciphertexts should differ
      expect(row1!.encrypted_secret).not.toBe(row2!.encrypted_secret);
    } finally {
      ctx1.db.close();
      ctx2.db.close();
    }
  });

  test("service without master key uses v0 format (12-byte IV)", () => {
    // No master key => random key, v0 format
    const ctx = createContext(undefined);
    try {
      const put = ctx.service.putSecretRef({
        providerId: "test-provider",
        secret: "ephemeral-secret",
      });

      const row = ctx.repository.get(put.secretRef.secretRef);
      const ivBuf = Buffer.from(row!.iv, "base64");
      // v0: raw 12-byte IV (no version byte, no salt)
      expect(ivBuf.length).toBe(12);

      // Should still round-trip
      const resolved = ctx.service.resolveSecret(put.secretRef.secretRef);
      expect(resolved!.secret).toBe("ephemeral-secret");
    } finally {
      ctx.db.close();
    }
  });
});
