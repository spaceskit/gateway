import type {
  AccessGrantMode,
  AccessGrantRepository,
  AccessGrantTargetKind,
  AccessGrantRow,
} from "@spaceskit/persistence";

export interface AccessGrantRecord {
  principalId: string;
  deviceId: string;
  spaceId: string;
  targetKind: AccessGrantTargetKind;
  targetId: string;
  mode: AccessGrantMode;
  source: string;
  reason: string;
  grantedBy: string;
  grantedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  updatedAt: string;
}

export interface GrantAccessInput {
  principalId: string;
  deviceId?: string;
  spaceId: string;
  targetKind: AccessGrantTargetKind;
  targetId: string;
  mode: AccessGrantMode;
  reason?: string;
  grantedBy?: string;
  expiresAt?: string;
  source?: string;
}

export interface RevokeAccessInput {
  principalId: string;
  deviceId?: string;
  spaceId: string;
  targetKind: AccessGrantTargetKind;
  targetId: string;
  reason?: string;
  revokedBy?: string;
  source?: string;
}

export interface HasActiveAccessGrantInput {
  principalId?: string;
  deviceId?: string;
  spaceId: string;
  targetKind?: AccessGrantTargetKind;
  targetIds: string[];
}

export interface AccessGrantServiceOptions {
  repository: AccessGrantRepository;
  now?: () => Date;
}

export class AccessGrantService {
  private readonly now: () => Date;

  constructor(private readonly options: AccessGrantServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  hasActiveGrant(input: HasActiveAccessGrantInput): boolean {
    return this.options.repository.listEffective({
      principalId: input.principalId,
      deviceId: input.deviceId,
      spaceId: input.spaceId,
      targetKind: input.targetKind,
      targetIds: input.targetIds,
      nowIso: this.now().toISOString(),
    }).length > 0;
  }

  grantAccess(input: GrantAccessInput): AccessGrantRecord {
    const row = this.options.repository.upsert({
      principalId: normalizeRequired(input.principalId, "principalId"),
      deviceId: normalizeOptional(input.deviceId) ?? "*",
      spaceId: normalizeRequired(input.spaceId, "spaceId"),
      targetKind: input.targetKind,
      targetId: normalizeRequired(input.targetId, "targetId"),
      mode: input.mode,
      source: input.source ?? "feedback_resume",
      reason: input.reason ?? defaultReason(input.targetKind, input.targetId, input.mode),
      grantedBy: input.grantedBy ?? normalizeRequired(input.principalId, "principalId"),
      grantedAt: this.now().toISOString(),
      expiresAt: normalizeOptional(input.expiresAt) ?? null,
    });
    return mapRow(row);
  }

  revokeAccess(input: RevokeAccessInput): AccessGrantRecord | null {
    const row = this.options.repository.revoke({
      principalId: normalizeRequired(input.principalId, "principalId"),
      deviceId: normalizeOptional(input.deviceId) ?? "*",
      spaceId: normalizeRequired(input.spaceId, "spaceId"),
      targetKind: input.targetKind,
      targetId: normalizeRequired(input.targetId, "targetId"),
      reason: input.reason ?? `Revoked ${input.targetKind}:${input.targetId}.`,
      revokedBy: input.revokedBy ?? normalizeRequired(input.principalId, "principalId"),
      source: input.source ?? "runtime_api",
    });
    return row ? mapRow(row) : null;
  }
}

function defaultReason(
  targetKind: AccessGrantTargetKind,
  targetId: string,
  mode: AccessGrantMode,
): string {
  const duration = mode === "durable" ? "durably" : "for a limited window";
  return `Granted ${targetKind}:${targetId} ${duration}.`;
}

function mapRow(row: AccessGrantRow): AccessGrantRecord {
  return {
    principalId: row.principal_id,
    deviceId: row.device_id,
    spaceId: row.space_id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    mode: row.mode,
    source: row.source,
    reason: row.reason,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at,
    expiresAt: row.expires_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

function normalizeRequired(value: unknown, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function normalizeOptional(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}
