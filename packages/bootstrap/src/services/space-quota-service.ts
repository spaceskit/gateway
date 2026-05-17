import type {
  AgentTokenAggregate,
  AgentUsageSessionRow,
  ParticipantUsageCounterRow,
  SpaceUsageCounterRow,
} from "@spaceskit/persistence";
import {
  dayWindowToken,
  hourWindowToken,
  mapParticipantQuotaPolicy,
  mapParticipantUsage,
  mapSpaceQuotaPolicy,
  mapSpaceUsage,
  normalizeOptional,
  normalizeRequired,
  resolveAgentRole,
  resolveMonthWindow,
  resolveParticipantLimit,
  roundMoney,
} from "./space-quota-service-helpers.js";
import {
  SpaceQuotaServiceError,
  type AgentUsageSessionSnapshot,
  type GetSpaceQuotaResult,
  type GetSpaceUsageResult,
  type GlobalUsageSummary,
  type SpaceQuotaPolicy,
  type SpaceQuotaServiceOptions,
  type UpdateSpaceQuotaPolicyInput,
} from "./space-quota-service-types.js";

export {
  SpaceQuotaServiceError,
  type AgentUsageSessionSnapshot,
  type GetSpaceQuotaResult,
  type GetSpaceUsageResult,
  type GlobalUsageSummary,
  type ParticipantQuotaPolicy,
  type ParticipantUsageSnapshot,
  type SpaceQuotaPolicy,
  type SpaceQuotaServiceErrorCode,
  type SpaceQuotaServiceOptions,
  type SpaceUsageSnapshot,
  type UpdateSpaceQuotaPolicyInput,
} from "./space-quota-service-types.js";

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
    this.options.onAgentUsageSessionReset?.(spaceId, agentId);

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
    const activeRowsByAgent = new Map(
      this.options.agentUsageSessions
        .listBySpace(spaceId, { status: "active", limit: 5000 })
        .map((row) => [row.agent_id, row]),
    );
    const sessions: AgentUsageSessionSnapshot[] = [];
    const processedAgentIds = new Set<string>();

    for (const aggregate of agentAggregates) {
      const existingRow = activeRowsByAgent.get(aggregate.agentId);
      const sessionRow = existingRow ?? this.options.agentUsageSessions.ensureActive({
        spaceId,
        agentId: aggregate.agentId,
        agentRole: resolveAgentRole(undefined, aggregate.agentId),
        nowIso: aggregate.earliestActivityAt ?? aggregate.lastActivityAt,
      });
      activeRowsByAgent.set(aggregate.agentId, sessionRow);

      const sessionUsage = this.options.usageAnalytics.aggregateAgentTokensBySpaceAndAgent(
        sessionRow.space_id,
        sessionRow.agent_id,
        sessionRow.started_at,
      );
      const row = sessionUsage.runCount > 0 && sessionUsage.lastActivityAt
        ? this.options.agentUsageSessions.touch(
          spaceId,
          aggregate.agentId,
          sessionUsage.lastActivityAt,
        )
        : sessionRow;
      activeRowsByAgent.set(aggregate.agentId, row);
      processedAgentIds.add(aggregate.agentId);
      sessions.push(this.toAgentSessionSnapshot(row, sessionUsage));
    }

    for (const [agentId, row] of activeRowsByAgent.entries()) {
      if (processedAgentIds.has(agentId)) {
        continue;
      }
      sessions.push(this.emptyAgentSessionSnapshot(row));
    }

    return sessions.sort((lhs, rhs) => rhs.lastActivityAt.localeCompare(lhs.lastActivityAt));
  }

  private toAgentSessionSnapshot(
    row: AgentUsageSessionRow,
    aggregate: AgentTokenAggregate,
  ): AgentUsageSessionSnapshot {
    const lastActivity = aggregate.lastActivityAt ?? row.last_activity_at;

    return {
      sessionId: row.session_id,
      spaceId: row.space_id,
      agentId: row.agent_id,
      agentRole: row.agent_role,
      displayTitle: row.display_title || undefined,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      lastActivityAt: lastActivity,
      turnCount: aggregate.runCount,
      inputTokens: aggregate.inputTokens,
      outputTokens: aggregate.outputTokens,
      totalTokens: aggregate.totalTokens,
      spentUsd: roundMoney(this.estimateCostUsd(aggregate)),
      tokenAccuracy: aggregate.tokenAccuracy,
      usageSource: aggregate.usageSource,
    };
  }

  private emptyAgentSessionSnapshot(row: AgentUsageSessionRow): AgentUsageSessionSnapshot {
    return {
      sessionId: row.session_id,
      spaceId: row.space_id,
      agentId: row.agent_id,
      agentRole: row.agent_role,
      displayTitle: row.display_title || undefined,
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
