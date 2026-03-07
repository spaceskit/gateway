import {
  AgentUsageSessionRepository,
  ParticipantQuotaPolicyRepository,
  ParticipantUsageCounterRepository,
  SpaceChangeSetFileRepository,
  SpaceChangeSetRepository,
  SpaceQuotaPolicyRepository,
  SpaceRepository,
  SpaceUsageCounterRepository,
  UsageAnalyticsRepository,
  type AgentTokenAggregate,
  type AgentUsageSessionRow,
  type ParticipantQuotaPolicyRow,
  type ParticipantUsageCounterRow,
  type SpaceQuotaPolicyRow,
  type SpaceUsageCounterRow,
} from "@spaceskit/persistence";

export type SpaceQuotaServiceErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "QUOTA_EXCEEDED";

export class SpaceQuotaServiceError extends Error {
  readonly code: SpaceQuotaServiceErrorCode;

  constructor(code: SpaceQuotaServiceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface SpaceQuotaPolicy {
  spaceId: string;
  maxStagingBytes: number;
  maxOpenChangeSets: number;
  maxAppliedChangeSetsPerMonth: number;
  tokenBudget: number;
  maxParticipantStagingBytes: number;
  maxUploadsPerDay: number;
  maxOpenChangeSetsPerParticipant: number;
  maxToolCallsPerHour: number;
  updatedBy: string;
  updatedAt: string;
}

export interface ParticipantQuotaPolicy {
  spaceId: string;
  principalId: string;
  maxStagingBytes: number;
  maxUploadsPerDay: number;
  maxOpenChangeSets: number;
  maxToolCallsPerHour: number;
  updatedBy: string;
  updatedAt: string;
}

export interface SpaceUsageSnapshot {
  spaceId: string;
  stagingBytes: number;
  openChangeSets: number;
  appliedChangeSetsPerMonth: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenSpendUsd: number;
  tokenAccuracy: "reported" | "estimated" | "mixed";
  usageSource: "ledger" | "local_scanner" | "legacy_turns";
  updatedAt: string;
}

export interface ParticipantUsageSnapshot {
  spaceId: string;
  principalId: string;
  stagingBytes: number;
  uploadsToday: number;
  openChangeSets: number;
  toolCallsPerHour: number;
  updatedAt: string;
}

export interface GetSpaceQuotaResult {
  spacePolicy: SpaceQuotaPolicy;
  participantPolicy?: ParticipantQuotaPolicy;
}

export interface GetSpaceUsageResult {
  spaceUsage: SpaceUsageSnapshot;
  participantUsage?: ParticipantUsageSnapshot;
  agentSessions?: AgentUsageSessionSnapshot[];
  globalLifetime?: GlobalUsageSummary;
}

export interface AgentUsageSessionSnapshot {
  sessionId: string;
  spaceId: string;
  agentId: string;
  agentRole: string;
  status: "active" | "closed";
  startedAt: string;
  endedAt?: string;
  lastActivityAt: string;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  spentUsd: number;
  tokenAccuracy: "reported" | "estimated" | "mixed";
  usageSource: "ledger" | "local_scanner" | "legacy_turns";
}

export interface GlobalUsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  spentUsd: number;
  tokenAccuracy: "reported" | "estimated" | "mixed";
  usageSource: "ledger" | "local_scanner" | "legacy_turns";
}

export interface UpdateSpaceQuotaPolicyInput {
  spaceId: string;
  updatedBy: string;
  maxStagingBytes?: number;
  maxOpenChangeSets?: number;
  maxAppliedChangeSetsPerMonth?: number;
  tokenBudget?: number;
  maxParticipantStagingBytes?: number;
  maxUploadsPerDay?: number;
  maxOpenChangeSetsPerParticipant?: number;
  maxToolCallsPerHour?: number;
}

export interface SpaceQuotaServiceOptions {
  spaces: SpaceRepository;
  spaceQuotaPolicies: SpaceQuotaPolicyRepository;
  participantQuotaPolicies: ParticipantQuotaPolicyRepository;
  spaceUsageCounters: SpaceUsageCounterRepository;
  participantUsageCounters: ParticipantUsageCounterRepository;
  changeSets: SpaceChangeSetRepository;
  changeSetFiles: SpaceChangeSetFileRepository;
  usageAnalytics: UsageAnalyticsRepository;
  agentUsageSessions: AgentUsageSessionRepository;
  now?: () => Date;
  inputPricePer1k?: number;
  outputPricePer1k?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export class SpaceQuotaService {
  private readonly now: () => Date;
  private readonly uploadsWindow = new Map<string, string>();
  private readonly toolWindow = new Map<string, string>();
  private readonly inputPricePer1k: number;
  private readonly outputPricePer1k: number;

  constructor(private readonly options: SpaceQuotaServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.inputPricePer1k = options.inputPricePer1k ?? 0.003;
    this.outputPricePer1k = options.outputPricePer1k ?? 0.015;
  }

  getQuota(spaceIdRaw: string, principalIdRaw?: string): GetSpaceQuotaResult {
    const spaceId = normalizeRequired(spaceIdRaw, "spaceId");
    this.assertSpaceExists(spaceId);
    const spacePolicyRow = this.options.spaceQuotaPolicies.ensure(spaceId);
    const principalId = normalizeOptional(principalIdRaw);

    return {
      spacePolicy: mapSpaceQuotaPolicy(spacePolicyRow),
      participantPolicy: principalId
        ? mapParticipantQuotaPolicy(this.options.participantQuotaPolicies.get(spaceId, principalId))
        : undefined,
    };
  }

  updateQuotaPolicy(input: UpdateSpaceQuotaPolicyInput): SpaceQuotaPolicy {
    const spaceId = normalizeRequired(input.spaceId, "spaceId");
    this.assertSpaceExists(spaceId);
    const updatedBy = normalizeRequired(input.updatedBy, "updatedBy");
    const row = this.options.spaceQuotaPolicies.upsert({
      spaceId,
      maxStagingBytes: input.maxStagingBytes,
      maxOpenChangeSets: input.maxOpenChangeSets,
      maxAppliedChangeSetsMonthly: input.maxAppliedChangeSetsPerMonth,
      maxTokenSpendUsd: input.tokenBudget,
      maxParticipantStagingBytes: input.maxParticipantStagingBytes,
      maxParticipantUploadsPerDay: input.maxUploadsPerDay,
      maxOpenChangeSetsPerParticipant: input.maxOpenChangeSetsPerParticipant,
      maxToolCallsPerHour: input.maxToolCallsPerHour,
      updatedBy,
    });
    return mapSpaceQuotaPolicy(row);
  }

  getUsage(
    spaceIdRaw: string,
    principalIdRaw?: string,
    options?: {
      includeAgentSessions?: boolean;
      includeGlobalLifetime?: boolean;
    },
  ): GetSpaceUsageResult {
    const spaceId = normalizeRequired(spaceIdRaw, "spaceId");
    this.assertSpaceExists(spaceId);
    const principalId = normalizeOptional(principalIdRaw);
    if (principalId) {
      this.ensureUsageWindows(spaceId, principalId);
    }

    const reconciledSpace = this.reconcileSpaceUsage(spaceId);
    const spaceTokens = this.options.usageAnalytics.aggregateTokensBySpace(spaceId);
    const includeAgentSessions = options?.includeAgentSessions ?? false;
    const includeGlobalLifetime = options?.includeGlobalLifetime ?? false;
    const agentSessions = includeAgentSessions
      ? this.listAgentSessions(spaceId)
      : undefined;
    const globalLifetime = includeGlobalLifetime
      ? this.resolveGlobalLifetime()
      : undefined;

    return {
      spaceUsage: mapSpaceUsage(reconciledSpace, spaceTokens, this.estimateCostUsd(spaceTokens)),
      participantUsage: principalId
        ? mapParticipantUsage(this.reconcileParticipantUsage(spaceId, principalId))
        : undefined,
      agentSessions,
      globalLifetime,
    };
  }

  resetAgentUsageSession(spaceIdRaw: string, agentIdRaw: string, principalIdRaw: string): {
    closedSessionId?: string;
    activeSession: AgentUsageSessionSnapshot;
  } {
    const spaceId = normalizeRequired(spaceIdRaw, "spaceId");
    const agentId = normalizeRequired(agentIdRaw, "agentId");
    const principalId = normalizeRequired(principalIdRaw, "principalId");
    this.assertSpaceExists(spaceId);

    const reset = this.options.agentUsageSessions.resetActive({
      spaceId,
      agentId,
      resetBy: principalId,
    });

    return {
      closedSessionId: reset.closedSession?.session_id,
      activeSession: this.emptyAgentSessionSnapshot(reset.activeSession),
    };
  }

  assertCanCreateChangeSet(spaceIdRaw: string, principalIdRaw: string): void {
    const spaceId = normalizeRequired(spaceIdRaw, "spaceId");
    const principalId = normalizeRequired(principalIdRaw, "principalId");
    const { spacePolicy, participantPolicy } = this.getQuota(spaceId, principalId);

    const spaceOpen = this.options.changeSets.countOpenBySpace(spaceId);
    if (spaceOpen >= spacePolicy.maxOpenChangeSets) {
      throw new SpaceQuotaServiceError(
        "QUOTA_EXCEEDED",
        `Space open changesets quota exceeded (${spaceOpen}/${spacePolicy.maxOpenChangeSets})`,
      );
    }

    const participantOpen = this.options.changeSets.countOpenBySpaceAndPrincipal(spaceId, principalId);
    const participantLimit = resolveParticipantLimit(
      participantPolicy?.maxOpenChangeSets,
      spacePolicy.maxOpenChangeSetsPerParticipant,
    );
    if (participantOpen >= participantLimit) {
      throw new SpaceQuotaServiceError(
        "QUOTA_EXCEEDED",
        `Participant open changesets quota exceeded (${participantOpen}/${participantLimit})`,
      );
    }
  }

  assertCanUpload(spaceIdRaw: string, principalIdRaw: string, incomingBytesRaw: number): void {
    const spaceId = normalizeRequired(spaceIdRaw, "spaceId");
    const principalId = normalizeRequired(principalIdRaw, "principalId");
    const incomingBytes = Math.max(0, Math.floor(incomingBytesRaw));
    const { spacePolicy, participantPolicy } = this.getQuota(spaceId, principalId);

    const currentSpaceStaging = this.options.changeSetFiles.sumSizeBySpace(spaceId);
    if (currentSpaceStaging + incomingBytes > spacePolicy.maxStagingBytes) {
      throw new SpaceQuotaServiceError(
        "QUOTA_EXCEEDED",
        `Space staging bytes quota exceeded (${currentSpaceStaging + incomingBytes}/${spacePolicy.maxStagingBytes})`,
      );
    }

    const currentParticipantStaging = this.options.changeSetFiles.sumSizeBySpaceAndPrincipal(spaceId, principalId);
    const participantStagingLimit = resolveParticipantLimit(
      participantPolicy?.maxStagingBytes,
      spacePolicy.maxParticipantStagingBytes,
    );
    if (currentParticipantStaging + incomingBytes > participantStagingLimit) {
      throw new SpaceQuotaServiceError(
        "QUOTA_EXCEEDED",
        `Participant staging bytes quota exceeded (${currentParticipantStaging + incomingBytes}/${participantStagingLimit})`,
      );
    }

    this.ensureUsageWindows(spaceId, principalId);
    const participantUsage = this.options.participantUsageCounters.ensure(spaceId, principalId);
    const uploadLimit = resolveParticipantLimit(
      participantPolicy?.maxUploadsPerDay,
      spacePolicy.maxUploadsPerDay,
    );
    if (participantUsage.uploads_today >= uploadLimit) {
      throw new SpaceQuotaServiceError(
        "QUOTA_EXCEEDED",
        `Participant uploads/day quota exceeded (${participantUsage.uploads_today}/${uploadLimit})`,
      );
    }
  }

  assertCanApply(spaceIdRaw: string, principalIdRaw: string): void {
    const spaceId = normalizeRequired(spaceIdRaw, "spaceId");
    normalizeRequired(principalIdRaw, "principalId");
    const { spacePolicy } = this.getQuota(spaceId);
    const now = this.now();
    const window = resolveMonthWindow(now);
    const appliedThisMonth = this.options.changeSets.countAppliedBySpaceInRange(
      spaceId,
      window.startIso,
      window.endIso,
    );
    if (appliedThisMonth >= spacePolicy.maxAppliedChangeSetsPerMonth) {
      throw new SpaceQuotaServiceError(
        "QUOTA_EXCEEDED",
        `Space applied changesets/month quota exceeded (${appliedThisMonth}/${spacePolicy.maxAppliedChangeSetsPerMonth})`,
      );
    }
  }

  recordChangeSetCreated(spaceIdRaw: string, principalIdRaw: string): void {
    const spaceId = normalizeRequired(spaceIdRaw, "spaceId");
    const principalId = normalizeRequired(principalIdRaw, "principalId");
    this.options.spaceUsageCounters.applyDelta(spaceId, { openChangeSetsDelta: 1 });
    this.options.participantUsageCounters.applyDelta(spaceId, principalId, { openChangeSetsDelta: 1 });
  }

  recordChangeSetClosed(spaceIdRaw: string, principalIdRaw: string): void {
    const spaceId = normalizeRequired(spaceIdRaw, "spaceId");
    const principalId = normalizeRequired(principalIdRaw, "principalId");
    this.options.spaceUsageCounters.applyDelta(spaceId, { openChangeSetsDelta: -1 });
    this.options.participantUsageCounters.applyDelta(spaceId, principalId, { openChangeSetsDelta: -1 });
  }

  recordUpload(spaceIdRaw: string, principalIdRaw: string, bytesRaw: number): void {
    const spaceId = normalizeRequired(spaceIdRaw, "spaceId");
    const principalId = normalizeRequired(principalIdRaw, "principalId");
    const bytes = Number.isFinite(bytesRaw) ? Math.floor(bytesRaw) : 0;
    this.ensureUsageWindows(spaceId, principalId);
    this.options.spaceUsageCounters.applyDelta(spaceId, { stagingBytesDelta: bytes });
    this.options.participantUsageCounters.applyDelta(spaceId, principalId, {
      stagingBytesDelta: bytes,
      uploadsTodayDelta: bytes > 0 ? 1 : 0,
    });
  }

  recordApply(spaceIdRaw: string, principalIdRaw: string): void {
    const spaceId = normalizeRequired(spaceIdRaw, "spaceId");
    const principalId = normalizeRequired(principalIdRaw, "principalId");
    this.options.spaceUsageCounters.applyDelta(spaceId, {
      appliedChangeSetsMonthlyDelta: 1,
    });
    this.options.participantUsageCounters.ensure(spaceId, principalId);
  }

  recordToolInvocation(spaceIdRaw: string, principalIdRaw: string): void {
    const spaceId = normalizeRequired(spaceIdRaw, "spaceId");
    const principalId = normalizeRequired(principalIdRaw, "principalId");
    this.ensureUsageWindows(spaceId, principalId);
    this.options.participantUsageCounters.applyDelta(spaceId, principalId, {
      toolCallsLastHourDelta: 1,
    });
  }

  assertToolInvocationAllowed(spaceIdRaw: string, principalIdRaw: string): void {
    const spaceId = normalizeRequired(spaceIdRaw, "spaceId");
    const principalId = normalizeRequired(principalIdRaw, "principalId");
    this.ensureUsageWindows(spaceId, principalId);
    const { spacePolicy, participantPolicy } = this.getQuota(spaceId, principalId);
    const usage = this.options.participantUsageCounters.ensure(spaceId, principalId);
    const maxToolCalls = resolveParticipantLimit(
      participantPolicy?.maxToolCallsPerHour,
      spacePolicy.maxToolCallsPerHour,
    );
    if (usage.tool_calls_last_hour >= maxToolCalls) {
      throw new SpaceQuotaServiceError(
        "QUOTA_EXCEEDED",
        `Participant tool calls/hour quota exceeded (${usage.tool_calls_last_hour}/${maxToolCalls})`,
      );
    }
  }

  reconcileMonthlyCounters(): void {
    const now = this.now();
    const window = resolveMonthWindow(now);
    const spaces = this.options.spaces.list({ limit: 5000 });
    for (const space of spaces) {
      const applied = this.options.changeSets.countAppliedBySpaceInRange(
        space.space_id,
        window.startIso,
        window.endIso,
      );
      this.options.spaceUsageCounters.setAppliedChangeSetsMonthly(space.space_id, applied);
    }
  }

  private ensureUsageWindows(spaceId: string, principalId: string): void {
    const key = `${spaceId}:${principalId}`;
    const now = this.now();
    const dayToken = dayWindowToken(now);
    const hourToken = hourWindowToken(now);

    if (this.uploadsWindow.get(key) !== dayToken) {
      this.uploadsWindow.set(key, dayToken);
      this.options.participantUsageCounters.resetUploadsToday(spaceId, principalId);
    }

    if (this.toolWindow.get(key) !== hourToken) {
      this.toolWindow.set(key, hourToken);
      this.options.participantUsageCounters.resetToolCallsLastHour(spaceId, principalId);
    }
  }

  private assertSpaceExists(spaceId: string): void {
    if (!this.options.spaces.getById(spaceId)) {
      throw new SpaceQuotaServiceError("NOT_FOUND", `Space not found: ${spaceId}`);
    }
  }

  private reconcileSpaceUsage(spaceId: string): SpaceUsageCounterRow {
    const current = this.options.spaceUsageCounters.ensure(spaceId);
    const actualStaging = this.options.changeSetFiles.sumSizeBySpace(spaceId);
    const actualOpen = this.options.changeSets.countOpenBySpace(spaceId);
    return this.options.spaceUsageCounters.applyDelta(spaceId, {
      stagingBytesDelta: actualStaging - current.staging_bytes,
      openChangeSetsDelta: actualOpen - current.open_changesets,
    });
  }

  private reconcileParticipantUsage(spaceId: string, principalId: string): ParticipantUsageCounterRow {
    const current = this.options.participantUsageCounters.ensure(spaceId, principalId);
    const actualStaging = this.options.changeSetFiles.sumSizeBySpaceAndPrincipal(spaceId, principalId);
    const actualOpen = this.options.changeSets.countOpenBySpaceAndPrincipal(spaceId, principalId);
    return this.options.participantUsageCounters.applyDelta(spaceId, principalId, {
      stagingBytesDelta: actualStaging - current.staging_bytes,
      openChangeSetsDelta: actualOpen - current.open_changesets,
    });
  }

  private listAgentSessions(spaceId: string): AgentUsageSessionSnapshot[] {
    const agentAggregates = this.options.usageAnalytics.listAgentAggregatesBySpace(spaceId);
    const sessions: AgentUsageSessionSnapshot[] = [];

    for (const aggregate of agentAggregates) {
      const sessionRow = this.options.agentUsageSessions.ensureActive({
        spaceId,
        agentId: aggregate.agentId,
        agentRole: resolveAgentRole(undefined, aggregate.agentId),
      });
      const touched = this.options.agentUsageSessions.touch(
        spaceId,
        aggregate.agentId,
        aggregate.lastActivityAt ?? sessionRow.last_activity_at,
      );
      sessions.push(this.toAgentSessionSnapshot(touched, aggregate));
    }

    if (agentAggregates.length === 0) {
      return [];
    }

    return sessions.sort((lhs, rhs) => rhs.lastActivityAt.localeCompare(lhs.lastActivityAt));
  }

  private toAgentSessionSnapshot(
    row: AgentUsageSessionRow,
    aggregate: AgentTokenAggregate,
  ): AgentUsageSessionSnapshot {
    const sinceBoundary = aggregate.earliestActivityAt && aggregate.earliestActivityAt < row.started_at
      ? aggregate.earliestActivityAt
      : row.started_at;
    const usage = sinceBoundary === row.started_at
      ? aggregate
      : this.options.usageAnalytics.aggregateTokensBySpaceAndAgent(
        row.space_id,
        row.agent_id,
        sinceBoundary,
      );
    const turnCount = aggregate.runCount;
    const lastActivity = aggregate.lastActivityAt ?? row.last_activity_at;

    return {
      sessionId: row.session_id,
      spaceId: row.space_id,
      agentId: row.agent_id,
      agentRole: row.agent_role,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      lastActivityAt: lastActivity,
      turnCount,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      spentUsd: roundMoney(this.estimateCostUsd(usage)),
      tokenAccuracy: usage.tokenAccuracy,
      usageSource: usage.usageSource,
    };
  }

  private emptyAgentSessionSnapshot(row: AgentUsageSessionRow): AgentUsageSessionSnapshot {
    return {
      sessionId: row.session_id,
      spaceId: row.space_id,
      agentId: row.agent_id,
      agentRole: row.agent_role,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      lastActivityAt: row.last_activity_at,
      turnCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      spentUsd: 0,
      tokenAccuracy: "reported",
      usageSource: "ledger",
    };
  }

  private resolveGlobalLifetime(): GlobalUsageSummary {
    const aggregate = this.options.usageAnalytics.aggregateTokens();
    return {
      inputTokens: aggregate.inputTokens,
      outputTokens: aggregate.outputTokens,
      totalTokens: aggregate.totalTokens,
      spentUsd: roundMoney(this.estimateCostUsd(aggregate)),
      tokenAccuracy: aggregate.tokenAccuracy,
      usageSource: aggregate.usageSource,
    };
  }

  private estimateCostUsd(tokens: { inputTokens: number; outputTokens: number }): number {
    return (
      (tokens.inputTokens / 1000) * this.inputPricePer1k
      + (tokens.outputTokens / 1000) * this.outputPricePer1k
    );
  }
}

function mapSpaceQuotaPolicy(row: SpaceQuotaPolicyRow): SpaceQuotaPolicy {
  return {
    spaceId: row.space_id,
    maxStagingBytes: row.max_staging_bytes,
    maxOpenChangeSets: row.max_open_changesets,
    maxAppliedChangeSetsPerMonth: row.max_applied_changesets_monthly,
    tokenBudget: row.max_token_spend_usd,
    maxParticipantStagingBytes: row.max_participant_staging_bytes,
    maxUploadsPerDay: row.max_participant_uploads_per_day,
    maxOpenChangeSetsPerParticipant: row.max_open_changesets_per_participant,
    maxToolCallsPerHour: row.max_tool_calls_per_hour,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

function mapParticipantQuotaPolicy(row?: ParticipantQuotaPolicyRow): ParticipantQuotaPolicy | undefined {
  if (!row) return undefined;
  return {
    spaceId: row.space_id,
    principalId: row.principal_id,
    maxStagingBytes: row.max_staging_bytes,
    maxUploadsPerDay: row.max_uploads_per_day,
    maxOpenChangeSets: row.max_open_changesets,
    maxToolCallsPerHour: row.max_tool_calls_per_hour,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

function mapSpaceUsage(
  row: SpaceUsageCounterRow,
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    tokenAccuracy: "reported" | "estimated" | "mixed";
    usageSource: "ledger" | "local_scanner" | "legacy_turns";
  },
  estimatedSpendUsd: number,
): SpaceUsageSnapshot {
  return {
    spaceId: row.space_id,
    stagingBytes: row.staging_bytes,
    openChangeSets: row.open_changesets,
    appliedChangeSetsPerMonth: row.applied_changesets_monthly,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    tokenSpendUsd: roundMoney(Math.max(row.token_spend_usd, estimatedSpendUsd)),
    tokenAccuracy: usage.tokenAccuracy,
    usageSource: usage.usageSource,
    updatedAt: row.updated_at,
  };
}

function mapParticipantUsage(row: ParticipantUsageCounterRow): ParticipantUsageSnapshot {
  return {
    spaceId: row.space_id,
    principalId: row.principal_id,
    stagingBytes: row.staging_bytes,
    uploadsToday: row.uploads_today,
    openChangeSets: row.open_changesets,
    toolCallsPerHour: row.tool_calls_last_hour,
    updatedAt: row.updated_at,
  };
}

function resolveParticipantLimit(overrideValue: number | undefined, fallback: number): number {
  if (typeof overrideValue === "number" && Number.isFinite(overrideValue) && overrideValue > 0) {
    return Math.floor(overrideValue);
  }
  return Math.max(1, Math.floor(fallback));
}

function resolveMonthWindow(now: Date): { startIso: string; endIso: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function dayWindowToken(now: Date): string {
  const start = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
  return start.toISOString().slice(0, 10);
}

function hourWindowToken(now: Date): string {
  const start = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
  return start.toISOString().slice(0, 13);
}

function normalizeRequired(value: string, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new SpaceQuotaServiceError("INVALID_ARGUMENT", `${field} is required`);
  }
  return normalized;
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function resolveAgentRole(actorType: string | undefined, agentId: string): string {
  const normalizedActorType = actorType?.trim().toLowerCase() ?? "";
  const normalizedAgentId = agentId.trim().toLowerCase();
  if (normalizedActorType === "orchestrator" || normalizedAgentId.includes("orchestrator")) {
    return "orchestrator";
  }
  return "agent";
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
