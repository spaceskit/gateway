import {
  GLOBAL_SCOPE,
  type GatewayCapabilityGrantLevel,
  type GatewayCapabilityGrantRepository,
  type GatewayCapabilityGrantRow,
} from "@spaceskit/persistence";
import {
  capabilityGrantsFromIds,
  capabilityRequestFromInvocation,
  createGatewayCoreState,
  evaluateCapabilityRequest,
  grantCapability,
  type CapabilityRequestDecision,
  type GatewayCoreProfileId,
} from "@spaceskit/gateway-core";

export type GatewayCapabilityAccessErrorCode =
  | "INVALID_ARGUMENT"
  | "FAILED_PRECONDITION";

export class GatewayCapabilityAccessError extends Error {
  readonly code: GatewayCapabilityAccessErrorCode;

  constructor(code: GatewayCapabilityAccessErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface GatewayCapabilityGrantRecord {
  principalId: string;
  deviceId: string;
  capabilityId: string;
  level: GatewayCapabilityGrantLevel;
  source: string;
  reason: string;
  grantedBy: string;
  grantedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  updatedAt: string;
}

export interface ListCapabilityGrantsInput {
  principalId: string;
  deviceId?: string;
  includeRevoked?: boolean;
  includeExpired?: boolean;
}

export interface GrantCapabilityInput {
  principalId: string;
  deviceId?: string;
  capabilityId: string;
  reason?: string;
  grantedBy?: string;
  expiresAt?: string;
  source?: string;
}

export interface RevokeCapabilityInput {
  principalId: string;
  deviceId?: string;
  capabilityId: string;
  reason?: string;
  revokedBy?: string;
  source?: string;
}

export interface EvaluateCapabilityInvocationInput {
  capability: string;
  operation: string;
  principalId?: string;
  deviceId?: string;
}

export interface SeedStartupGrantsResult {
  applied: string[];
  skipped: string[];
  invalid: string[];
}

export interface GatewayCapabilityAccessServiceOptions {
  repository: GatewayCapabilityGrantRepository;
  profileId: GatewayCoreProfileId;
  now?: () => Date;
}

export class GatewayCapabilityAccessService {
  private readonly now: () => Date;

  constructor(private readonly options: GatewayCapabilityAccessServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  seedStartupGrants(capabilityIds: string[]): SeedStartupGrantsResult {
    const parsed = capabilityGrantsFromIds(capabilityIds, "startup_config");
    const applied: string[] = [];
    const skipped: string[] = [];

    for (const grant of parsed.grants) {
      try {
        this.assertGrantAllowedByProfile(grant.capabilityId, grant.level);
        this.options.repository.upsert({
          principalId: GLOBAL_SCOPE,
          deviceId: GLOBAL_SCOPE,
          capabilityId: grant.capabilityId,
          level: grant.level,
          source: "startup_config",
          reason: grant.reason ?? "Granted via startup configuration.",
          grantedBy: "system",
          grantedAt: this.now().toISOString(),
          expiresAt: grant.expiresAt?.toISOString(),
        });
        applied.push(grant.capabilityId);
      } catch (err) {
        if (err instanceof GatewayCapabilityAccessError) {
          skipped.push(grant.capabilityId);
          continue;
        }
        throw err;
      }
    }

    return {
      applied,
      skipped,
      invalid: parsed.invalid,
    };
  }

  evaluateInvocation(input: EvaluateCapabilityInvocationInput): {
    decision: CapabilityRequestDecision;
    requiredGrantId: string;
  } {
    const request = capabilityRequestFromInvocation(input.capability, input.operation);
    const state = this.buildEffectiveState(input.principalId, input.deviceId);
    const decision = evaluateCapabilityRequest(state, request, this.now());
    return {
      decision,
      requiredGrantId: request.capabilityId,
    };
  }

  listCapabilityGrants(input: ListCapabilityGrantsInput): GatewayCapabilityGrantRecord[] {
    const principalId = normalizeRequired(input.principalId, "principalId");
    const deviceId = normalizeOptional(input.deviceId);

    return this.options.repository.list({
      principalId,
      deviceId,
      includeRevoked: input.includeRevoked,
      includeExpired: input.includeExpired,
    }).map((row) => this.mapRow(row));
  }

  grantCapability(input: GrantCapabilityInput): GatewayCapabilityGrantRecord {
    const principalId = normalizeRequired(input.principalId, "principalId");
    const deviceId = normalizeOptional(input.deviceId) ?? GLOBAL_SCOPE;
    const capabilityIdRaw = normalizeRequired(input.capabilityId, "capabilityId");
    const parsed = capabilityGrantsFromIds([capabilityIdRaw], input.grantedBy ?? principalId);
    const parsedGrant = parsed.grants[0];
    if (!parsedGrant || parsed.invalid.length > 0) {
      throw new GatewayCapabilityAccessError(
        "INVALID_ARGUMENT",
        "capabilityId must end with .read, .write, or .execute",
      );
    }

    const expiresAt = parseOptionalIso(input.expiresAt, "expiresAt");
    this.assertGrantAllowedByProfile(parsedGrant.capabilityId, parsedGrant.level);

    const row = this.options.repository.upsert({
      principalId,
      deviceId,
      capabilityId: parsedGrant.capabilityId,
      level: parsedGrant.level,
      source: input.source ?? "runtime_api",
      reason: input.reason ?? "Granted via runtime API.",
      grantedBy: input.grantedBy ?? principalId,
      grantedAt: this.now().toISOString(),
      expiresAt: expiresAt?.toISOString(),
    });

    return this.mapRow(row);
  }

  revokeCapability(input: RevokeCapabilityInput): {
    revoked: boolean;
    capabilityId: string;
    principalId: string;
    deviceId: string;
    grant?: GatewayCapabilityGrantRecord;
  } {
    const principalId = normalizeRequired(input.principalId, "principalId");
    const deviceId = normalizeOptional(input.deviceId) ?? GLOBAL_SCOPE;
    const capabilityIdRaw = normalizeRequired(input.capabilityId, "capabilityId");
    const parsed = capabilityGrantsFromIds([capabilityIdRaw], input.revokedBy ?? principalId);
    const normalizedCapabilityId = parsed.grants[0]?.capabilityId ?? capabilityIdRaw;

    const row = this.options.repository.revoke({
      principalId,
      deviceId,
      capabilityId: normalizedCapabilityId,
      reason: input.reason ?? "Revoked via runtime API.",
      revokedBy: input.revokedBy ?? principalId,
      source: input.source ?? "runtime_api",
    });

    return {
      revoked: Boolean(row?.revoked_at),
      capabilityId: normalizedCapabilityId,
      principalId,
      deviceId,
      grant: row ? this.mapRow(row) : undefined,
    };
  }

  private buildEffectiveState(principalIdRaw?: string, deviceIdRaw?: string) {
    const principalId = normalizeOptional(principalIdRaw);
    const deviceId = normalizeOptional(deviceIdRaw);
    const state = createGatewayCoreState({ profileId: this.options.profileId });
    const grants = this.options.repository.listEffective({
      principalId,
      deviceId,
      nowIso: this.now().toISOString(),
    });

    let next = state;
    for (const grant of grants) {
      try {
        next = grantCapability(next, {
          capabilityId: grant.capability_id,
          level: grant.level,
          grantedBy: grant.granted_by,
          grantedAt: new Date(grant.granted_at),
          expiresAt: grant.expires_at ? new Date(grant.expires_at) : undefined,
          reason: grant.reason,
        });
      } catch {
        // Ignore malformed grants to keep evaluation resilient.
      }
    }
    return next;
  }

  private assertGrantAllowedByProfile(capabilityId: string, level: GatewayCapabilityGrantLevel): void {
    const state = createGatewayCoreState({ profileId: this.options.profileId });
    try {
      grantCapability(state, {
        capabilityId,
        level,
        grantedBy: "validation",
      });
    } catch (err) {
      throw new GatewayCapabilityAccessError(
        "FAILED_PRECONDITION",
        err instanceof Error ? err.message : "Capability blocked by gateway profile",
      );
    }
  }

  private mapRow(row: GatewayCapabilityGrantRow): GatewayCapabilityGrantRecord {
    return {
      principalId: row.principal_id,
      deviceId: row.device_id,
      capabilityId: row.capability_id,
      level: row.level,
      source: row.source,
      reason: row.reason,
      grantedBy: row.granted_by,
      grantedAt: row.granted_at,
      expiresAt: row.expires_at ?? undefined,
      revokedAt: row.revoked_at ?? undefined,
      updatedAt: row.updated_at,
    };
  }
}

function normalizeRequired(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new GatewayCapabilityAccessError("INVALID_ARGUMENT", `${field} is required`);
  }
  return normalized;
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parseOptionalIso(value: string | undefined, field: string): Date | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new GatewayCapabilityAccessError("INVALID_ARGUMENT", `${field} must be a valid ISO timestamp`);
  }
  return parsed;
}
