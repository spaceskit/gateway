import type { DeviceIdentityRepository } from "@spaceskit/persistence";

export type DeviceLifecycleErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "FAILED_PRECONDITION";

export class DeviceLifecycleError extends Error {
  readonly code: DeviceLifecycleErrorCode;

  constructor(code: DeviceLifecycleErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface DeviceIdentity {
  deviceId: string;
  principalId: string;
  publicKey: string;
  platform?: string;
  keyVersion: string;
  status: "active" | "revoked" | "rotated";
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
}

export interface RegisterDeviceInput {
  principalId: string;
  deviceId: string;
  publicKey: string;
  platform?: string;
}

export interface RotateDeviceKeyInput {
  principalId: string;
  deviceId: string;
  nextPublicKey: string;
  platform?: string;
}

export interface RevokeDeviceInput {
  principalId: string;
  deviceId: string;
}

export interface ValidateAuthenticatedDeviceInput {
  principalId: string;
  deviceId: string;
  publicKey: string;
  platform?: string;
}

export interface DeviceIdentityServiceOptions {
  repository: DeviceIdentityRepository;
  now?: () => Date;
  /**
   * If true, authentication requires a pre-registered device.
   * If false, first successful auth auto-registers the device.
   */
  requirePreRegistered?: boolean;
  onDeviceRevoked?: (input: { principalId: string; deviceId: string }) => void;
}

export class DeviceIdentityService {
  private readonly now: () => Date;
  private readonly requirePreRegistered: boolean;

  constructor(private readonly options: DeviceIdentityServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.requirePreRegistered = options.requirePreRegistered ?? false;
  }

  registerDevice(input: RegisterDeviceInput): { device: DeviceIdentity; created: boolean } {
    const principalId = normalizeRequired(input.principalId, "principalId");
    const deviceId = normalizeRequired(input.deviceId, "deviceId");
    const publicKey = normalizeRequired(input.publicKey, "publicKey");

    const existing = this.options.repository.getByPrincipalAndDevice(principalId, deviceId);
    if (!existing) {
      const created = this.options.repository.create({
        principalId,
        deviceId,
        publicKey,
        platform: input.platform,
      });
      return { device: this.mapRow(created), created: true };
    }

    if (normalizeStatus(existing.status) === "revoked") {
      throw new DeviceLifecycleError(
        "FAILED_PRECONDITION",
        `Device is revoked and must be rotated with a new deviceId: ${deviceId}`,
      );
    }

    if (existing.public_key !== publicKey) {
      throw new DeviceLifecycleError(
        "FAILED_PRECONDITION",
        `Device key mismatch for ${deviceId}; use auth.rotate_device_key`,
      );
    }

    this.options.repository.touchLastSeen(principalId, deviceId);
    return {
      device: this.mapRow(this.options.repository.getByPrincipalAndDevice(principalId, deviceId)!),
      created: false,
    };
  }

  rotateDeviceKey(input: RotateDeviceKeyInput): DeviceIdentity {
    const principalId = normalizeRequired(input.principalId, "principalId");
    const deviceId = normalizeRequired(input.deviceId, "deviceId");
    const nextPublicKey = normalizeRequired(input.nextPublicKey, "nextPublicKey");

    const existing = this.options.repository.getByPrincipalAndDevice(principalId, deviceId);
    if (!existing) {
      throw new DeviceLifecycleError("NOT_FOUND", `Device not found: ${deviceId}`);
    }

    if (normalizeStatus(existing.status) === "revoked") {
      throw new DeviceLifecycleError(
        "FAILED_PRECONDITION",
        `Cannot rotate key for revoked device: ${deviceId}`,
      );
    }

    const rotated = this.options.repository.rotateKey({
      principalId,
      deviceId,
      nextPublicKey,
      platform: input.platform,
    });

    if (!rotated) {
      throw new DeviceLifecycleError("NOT_FOUND", `Device not found: ${deviceId}`);
    }

    return this.mapRow(rotated);
  }

  revokeDevice(input: RevokeDeviceInput): { deviceId: string; revoked: boolean; device?: DeviceIdentity } {
    const principalId = normalizeRequired(input.principalId, "principalId");
    const deviceId = normalizeRequired(input.deviceId, "deviceId");

    const existing = this.options.repository.getByPrincipalAndDevice(principalId, deviceId);
    if (!existing) {
      throw new DeviceLifecycleError("NOT_FOUND", `Device not found: ${deviceId}`);
    }

    const revoked = this.options.repository.revoke(principalId, deviceId);
    if (revoked) {
      this.options.onDeviceRevoked?.({ principalId, deviceId });
    }

    const next = this.options.repository.getByPrincipalAndDevice(principalId, deviceId);
    return {
      deviceId,
      revoked,
      device: next ? this.mapRow(next) : undefined,
    };
  }

  listDevices(principalId: string, includeRevoked = true): DeviceIdentity[] {
    const normalizedPrincipalId = normalizeRequired(principalId, "principalId");
    return this.options.repository
      .listByPrincipal(normalizedPrincipalId, includeRevoked)
      .map((row: any) => this.mapRow(row));
  }

  validateAuthenticatedDevice(input: ValidateAuthenticatedDeviceInput): {
    allowed: boolean;
    reason?: string;
    device?: DeviceIdentity;
    created?: boolean;
  } {
    const principalId = normalizeRequired(input.principalId, "principalId");
    const deviceId = normalizeRequired(input.deviceId, "deviceId");
    const publicKey = normalizeRequired(input.publicKey, "publicKey");

    const existing = this.options.repository.getByPrincipalAndDevice(principalId, deviceId);
    if (!existing) {
      if (this.requirePreRegistered) {
        return {
          allowed: false,
          reason: `Device is not registered: ${deviceId}`,
        };
      }

      const created = this.options.repository.create({
        principalId,
        deviceId,
        publicKey,
        platform: input.platform,
      });
      return {
        allowed: true,
        created: true,
        device: this.mapRow(created),
      };
    }

    if (normalizeStatus(existing.status) === "revoked") {
      return {
        allowed: false,
        reason: `Device revoked: ${deviceId}`,
      };
    }

    if (existing.public_key !== publicKey) {
      return {
        allowed: false,
        reason: `Device key mismatch for ${deviceId}; rotate with auth.rotate_device_key`,
      };
    }

    this.options.repository.touchLastSeen(principalId, deviceId);
    const touched = this.options.repository.getByPrincipalAndDevice(principalId, deviceId) ?? existing;
    return {
      allowed: true,
      created: false,
      device: this.mapRow(touched),
    };
  }

  private mapRow(row: {
    device_id: string;
    principal_id: string;
    public_key: string;
    platform: string;
    key_version: number;
    status: string;
    created_at: string;
    updated_at: string;
    last_seen_at: string | null;
    revoked_at: string | null;
  }): DeviceIdentity {
    return {
      deviceId: row.device_id,
      principalId: row.principal_id,
      publicKey: row.public_key,
      platform: row.platform || undefined,
      keyVersion: String(row.key_version),
      status: normalizeStatus(row.status),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastSeenAt: row.last_seen_at ?? undefined,
      revokedAt: row.revoked_at ?? undefined,
    };
  }
}

function normalizeRequired(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new DeviceLifecycleError("INVALID_ARGUMENT", `${field} is required`);
  }
  return normalized;
}

function normalizeStatus(value: string): "active" | "revoked" | "rotated" {
  if (value === "revoked") return "revoked";
  if (value === "rotated") return "rotated";
  return "active";
}
