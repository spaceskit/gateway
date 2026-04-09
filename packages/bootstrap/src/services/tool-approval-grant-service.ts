import type {
  ToolApprovalGrantMode,
  ToolApprovalGrantRepository,
  ToolApprovalGrantRow,
} from "@spaceskit/persistence";

export type ToolApprovalGrantErrorCode =
  | "INVALID_ARGUMENT"
  | "FAILED_PRECONDITION";

export class ToolApprovalGrantServiceError extends Error {
  readonly code: ToolApprovalGrantErrorCode;

  constructor(code: ToolApprovalGrantErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface ToolApprovalGrantRecord {
  principalId: string;
  deviceId: string;
  spaceId: string;
  toolId: string;
  mode: ToolApprovalGrantMode;
  source: string;
  reason: string;
  grantedBy: string;
  grantedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  updatedAt: string;
}

export interface GrantToolApprovalInput {
  principalId: string;
  deviceId?: string;
  spaceId: string;
  toolId: string;
  mode: ToolApprovalGrantMode;
  reason?: string;
  grantedBy?: string;
  expiresAt?: string;
  source?: string;
}

export interface ListToolApprovalGrantsInput {
  principalId: string;
  deviceId?: string;
  spaceId?: string;
  toolId?: string;
  includeExpired?: boolean;
  includeRevoked?: boolean;
}

export interface RevokeToolApprovalInput {
  principalId: string;
  deviceId?: string;
  spaceId: string;
  toolId: string;
  reason?: string;
  revokedBy?: string;
  source?: string;
}

export interface HasActiveToolApprovalInput {
  principalId?: string;
  deviceId?: string;
  spaceId: string;
  toolId: string;
}

export interface ToolApprovalGrantServiceOptions {
  repository: ToolApprovalGrantRepository;
  now?: () => Date;
}

export class ToolApprovalGrantService {
  private readonly now: () => Date;

  constructor(private readonly options: ToolApprovalGrantServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  hasActiveGrant(input: HasActiveToolApprovalInput): boolean {
    const principalId = normalizeOptional(input.principalId);
    if (!principalId) {
      return false;
    }

    const spaceId = normalizeRequired(input.spaceId, "spaceId");
    const toolId = normalizeRequired(input.toolId, "toolId");
    const grants = this.options.repository.listEffective({
      principalId,
      deviceId: normalizeOptional(input.deviceId),
      spaceId,
      toolId,
      nowIso: this.now().toISOString(),
    });
    return grants.length > 0;
  }

  listGrants(input: ListToolApprovalGrantsInput): ToolApprovalGrantRecord[] {
    return this.options.repository.list({
      principalId: normalizeRequired(input.principalId, "principalId"),
      deviceId: normalizeOptional(input.deviceId),
      spaceId: normalizeOptional(input.spaceId),
      toolId: normalizeOptional(input.toolId),
      includeExpired: input.includeExpired,
      includeRevoked: input.includeRevoked,
    }).map((row) => this.mapRow(row));
  }

  grantApproval(input: GrantToolApprovalInput): ToolApprovalGrantRecord {
    const principalId = normalizeRequired(input.principalId, "principalId");
    const spaceId = normalizeRequired(input.spaceId, "spaceId");
    const toolId = normalizeRequired(input.toolId, "toolId");
    const mode = parseMode(input.mode);
    const expiresAt = parseOptionalIso(input.expiresAt, "expiresAt");
    if (mode === "durable" && expiresAt) {
      throw new ToolApprovalGrantServiceError(
        "INVALID_ARGUMENT",
        "durable approval grants must not include expiresAt",
      );
    }

    const row = this.options.repository.upsert({
      principalId,
      deviceId: normalizeOptional(input.deviceId) ?? "*",
      spaceId,
      toolId,
      mode,
      source: input.source ?? "feedback_resume",
      reason: input.reason ?? defaultReason(mode),
      grantedBy: input.grantedBy ?? principalId,
      grantedAt: this.now().toISOString(),
      expiresAt: expiresAt?.toISOString(),
    });
    return this.mapRow(row);
  }

  revokeGrant(input: RevokeToolApprovalInput): {
    revoked: boolean;
    principalId: string;
    deviceId: string;
    spaceId: string;
    toolId: string;
    grant?: ToolApprovalGrantRecord;
  } {
    const principalId = normalizeRequired(input.principalId, "principalId");
    const deviceId = normalizeOptional(input.deviceId) ?? "*";
    const spaceId = normalizeRequired(input.spaceId, "spaceId");
    const toolId = normalizeRequired(input.toolId, "toolId");

    const row = this.options.repository.revoke({
      principalId,
      deviceId,
      spaceId,
      toolId,
      source: input.source ?? "runtime_api",
      reason: input.reason ?? "Revoked by user.",
      revokedBy: input.revokedBy ?? principalId,
    });

    return {
      revoked: Boolean(row?.revoked_at),
      principalId,
      deviceId,
      spaceId,
      toolId,
      grant: row ? this.mapRow(row) : undefined,
    };
  }

  private mapRow(row: ToolApprovalGrantRow): ToolApprovalGrantRecord {
    return {
      principalId: row.principal_id,
      deviceId: row.device_id,
      spaceId: row.space_id,
      toolId: row.tool_id,
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
}

function parseMode(value: unknown): ToolApprovalGrantMode {
  if (value === "time_window" || value === "durable") {
    return value;
  }
  throw new ToolApprovalGrantServiceError(
    "INVALID_ARGUMENT",
    "mode must be \"time_window\" or \"durable\"",
  );
}

function defaultReason(mode: ToolApprovalGrantMode): string {
  return mode === "durable"
    ? "Allowed for this tool in the current space."
    : "Allowed for this tool for a limited time in the current space.";
}

function normalizeRequired(value: unknown, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new ToolApprovalGrantServiceError("INVALID_ARGUMENT", `${field} is required.`);
  }
  return normalized;
}

function normalizeOptional(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function parseOptionalIso(value: unknown, field: string): Date | undefined {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    return undefined;
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new ToolApprovalGrantServiceError("INVALID_ARGUMENT", `${field} must be an ISO timestamp.`);
  }
  return date;
}
