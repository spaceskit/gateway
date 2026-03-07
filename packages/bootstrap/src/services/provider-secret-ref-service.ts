import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import type { Logger } from "@spaceskit/observability";
import {
  ProviderSecretRefRepository,
  type ProviderSecretRefRow,
} from "@spaceskit/persistence";

export interface ProviderSecretRefSummary {
  secretRef: string;
  providerId: string;
  label: string;
  backend: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export interface PutProviderSecretRefInput {
  secretRef?: string;
  providerId: string;
  label?: string;
  secret: string;
  backend?: string;
}

export interface PutProviderSecretRefResult {
  secretRef: ProviderSecretRefSummary;
  created: boolean;
}

export interface ResolveProviderSecretRefResult {
  summary: ProviderSecretRefSummary;
  secret: string;
}

export interface ProviderSecretRefServiceOptions {
  repository: ProviderSecretRefRepository;
  logger?: Logger;
  masterKey?: string;
}

export class ProviderSecretRefError extends Error {
  readonly code:
    | "INVALID_ARGUMENT"
    | "FAILED_PRECONDITION";

  constructor(code: ProviderSecretRefError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export class ProviderSecretRefService {
  /** V0 key — always available (SHA-256 of master key, or random bytes). */
  private readonly key: Buffer;
  /** Raw master key passphrase — available only when an explicit key was provided. */
  private readonly masterKeySource: string | null;

  constructor(private readonly options: ProviderSecretRefServiceOptions) {
    const explicitKey = options.masterKey?.trim();
    if (explicitKey) {
      this.key = deriveKey(explicitKey);
      this.masterKeySource = explicitKey;
      return;
    }

    this.key = randomBytes(32);
    this.masterKeySource = null;
    options.logger?.warn(
      "SPACESKIT_SECRET_REF_MASTER_KEY is not set; provider secret refs are process-scoped only",
    );
  }

  putSecretRef(input: PutProviderSecretRefInput): PutProviderSecretRefResult {
    const providerId = normalizeRequired(input.providerId, "providerId");
    const secret = normalizeRequired(input.secret, "secret");
    const secretRef = normalizeOptional(input.secretRef) ?? `secretref-${randomUUID()}`;
    const label = normalizeOptional(input.label) ?? `${providerId} secret`;
    const backend = normalizeOptional(input.backend) ?? "gateway_encrypted";
    const created = !this.options.repository.get(secretRef);

    const encrypted = this.encrypt(secret);
    const row = this.options.repository.upsert({
      secretRef,
      providerId,
      label,
      backend,
      encryptedSecret: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    });

    this.options.logger?.info("Provider secret ref upserted", {
      providerId,
      secretRef,
      created,
      backend,
    });

    return {
      secretRef: mapSummary(row),
      created,
    };
  }

  listSecretRefs(providerId?: string): ProviderSecretRefSummary[] {
    const normalizedProviderId = normalizeOptional(providerId);
    return this.options.repository.list(normalizedProviderId).map((row) => mapSummary(row));
  }

  getSecretRef(secretRef: string): ProviderSecretRefSummary | null {
    const normalized = normalizeRequired(secretRef, "secretRef");
    const row = this.options.repository.get(normalized);
    if (!row) return null;
    return mapSummary(row);
  }

  deleteSecretRef(secretRef: string): boolean {
    const normalized = normalizeRequired(secretRef, "secretRef");
    const deleted = this.options.repository.delete(normalized);
    if (deleted) {
      this.options.logger?.info("Provider secret ref deleted", { secretRef: normalized });
    }
    return deleted;
  }

  resolveSecret(secretRef: string): ResolveProviderSecretRefResult | null {
    const normalized = normalizeRequired(secretRef, "secretRef");
    const row = this.options.repository.get(normalized);
    if (!row) return null;

    const secret = this.decrypt(row);
    this.options.repository.touch(normalized);
    const touchedRow = this.options.repository.get(normalized) ?? row;

    return {
      summary: mapSummary(touchedRow),
      secret,
    };
  }

  private encrypt(secret: string): { ciphertext: string; iv: string; authTag: string } {
    const iv = randomBytes(12);

    // Use v1 (PBKDF2) when we have a passphrase master key, v0 otherwise
    if (this.masterKeySource) {
      const salt = randomBytes(PBKDF2_SALT_LENGTH);
      const derivedKey = deriveKeyV1(this.masterKeySource, salt);
      const cipher = createCipheriv("aes-256-gcm", derivedKey, iv);
      const ciphertext = Buffer.concat([
        cipher.update(secret, "utf8"),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();

      // iv column encodes: [version byte][salt][IV]
      const versionedIv = Buffer.concat([Buffer.from([KDF_V1]), salt, iv]);
      return {
        ciphertext: ciphertext.toString("base64"),
        iv: versionedIv.toString("base64"),
        authTag: authTag.toString("base64"),
      };
    }

    // v0 path: random key (no passphrase), SHA-256 derived
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(secret, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return {
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
    };
  }

  private decrypt(row: ProviderSecretRefRow): string {
    try {
      const ivData = Buffer.from(row.iv, "base64");
      let decryptionKey: Buffer;
      let iv: Buffer;

      // Detect v1 format: version byte (0x01) + 16-byte salt + 12-byte IV = 29 bytes
      if (ivData.length === 1 + PBKDF2_SALT_LENGTH + 12 && ivData[0] === KDF_V1 && this.masterKeySource) {
        const salt = ivData.subarray(1, 1 + PBKDF2_SALT_LENGTH);
        iv = ivData.subarray(1 + PBKDF2_SALT_LENGTH);
        decryptionKey = deriveKeyV1(this.masterKeySource, salt);
      } else {
        // v0 format: raw 12-byte IV, use SHA-256 derived key
        iv = ivData;
        decryptionKey = this.key;
      }

      const decipher = createDecipheriv("aes-256-gcm", decryptionKey, iv);
      decipher.setAuthTag(Buffer.from(row.auth_tag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(row.encrypted_secret, "base64")),
        decipher.final(),
      ]);
      return plaintext.toString("utf8");
    } catch (err) {
      this.options.logger?.error(
        "Failed to decrypt provider secret ref",
        err instanceof Error ? err : undefined,
        { secretRef: row.secret_ref, providerId: row.provider_id },
      );
      throw new ProviderSecretRefError(
        "FAILED_PRECONDITION",
        `Unable to decrypt provider secret ref: ${row.secret_ref}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// KDF versioning constants
// ---------------------------------------------------------------------------
const KDF_V0 = 0x00; // Legacy SHA-256 (no salt)
const KDF_V1 = 0x01; // PBKDF2-SHA256, 100k iterations, 16-byte salt
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_SALT_LENGTH = 16;
const KEY_LENGTH = 32;

/** V0 (legacy): simple SHA-256 hash. */
function deriveKeyV0(source: string): Buffer {
  return createHash("sha256").update(source).digest();
}

/** V1: PBKDF2-SHA256 with random salt. */
function deriveKeyV1(source: string, salt: Buffer): Buffer {
  return pbkdf2Sync(source, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha256");
}

/**
 * Legacy derive helper — used only during construction for the initial key
 * (v0 path). Kept for backward compatibility in the constructor.
 */
function deriveKey(source: string): Buffer {
  return deriveKeyV0(source);
}

function mapSummary(row: ProviderSecretRefRow): ProviderSecretRefSummary {
  return {
    secretRef: row.secret_ref,
    providerId: row.provider_id,
    label: row.label,
    backend: row.backend,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at ?? undefined,
  };
}

function normalizeOptional(value?: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized;
}

function normalizeRequired(value: string | undefined, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new ProviderSecretRefError("INVALID_ARGUMENT", `${field} is required`);
  }
  return normalized;
}
