import { randomUUID } from "node:crypto";
import type {
  ArtifactRepository,
  EventLogRepository,
  ExperienceRepository,
  GatewayMemoryDefaultsRepository,
  OrchestrationJournalRepository,
  PersonalityInsightRepository,
  SpaceAgentNotesRepository,
  SpaceReplaySessionRepository,
  SpaceReplaySessionRow,
  SpaceRepository,
  TurnRepository,
  AgentUsageSessionRepository,
} from "@spaceskit/persistence";
import type {
  GatewayMemoryDefaults,
  SpaceExperienceCaptureMode,
  SpaceMemoryPolicy,
  SpacePrivacyMode,
  ThinkingCapturePolicy,
} from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import {
  emptyDeletedCounts,
  normalizeGatewayExperienceCapture,
  normalizeRequired,
  normalizeTimestamp,
  parseSpaceConfig,
  parseSpaceMemoryPolicy,
  parseThinkingCapturePolicy,
  serializeSpaceMemoryPolicy,
} from "./space-memory-policy-service-helpers.js";

export interface EffectiveSpaceMemoryPolicy {
  experienceCapture: Exclude<SpaceExperienceCaptureMode, "INHERIT">;
  privacyMode: SpacePrivacyMode;
}

export interface SpaceMemoryPolicyResolution {
  configured: SpaceMemoryPolicy;
  effective: EffectiveSpaceMemoryPolicy;
  configuredThinkingCapturePolicy: ThinkingCapturePolicy;
  effectiveThinkingCapturePolicy: ThinkingCapturePolicy;
  activeReplaySession?: SpaceReplaySessionRow;
}

export interface SpaceMemoryPolicyServiceOptions {
  spaces: SpaceRepository;
  gatewayDefaults: GatewayMemoryDefaultsRepository;
  replaySessions: SpaceReplaySessionRepository;
  turns: TurnRepository;
  eventLog: EventLogRepository;
  orchestrationJournal: OrchestrationJournalRepository;
  artifacts: ArtifactRepository;
  experiences?: ExperienceRepository;
  personalityInsights?: PersonalityInsightRepository;
  agentNotes?: SpaceAgentNotesRepository;
  agentUsageSessions?: AgentUsageSessionRepository;
  inactivityTimeoutMs?: number;
  logger?: Logger;
  now?: () => Date;
  onSessionPurged?: (spaceId: string) => Promise<void> | void;
}

export interface EndIncognitoSessionResult {
  ended: boolean;
  purged: boolean;
  reason: "manual" | "inactivity" | "policy_change";
  sessionId?: string;
  purgedAt?: string;
  session?: SpaceReplaySessionRow;
  deleted: {
    turns: number;
    eventLog: number;
    orchestrationJournal: number;
    artifacts: number;
    experiences: number;
    personalityInsights: number;
    agentNotes: number;
    agentUsageSessions: number;
  };
}

const DEFAULT_INCOGNITO_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

export class SpaceMemoryPolicyService {
  private readonly inactivityTimeoutMs: number;
  private readonly now: () => Date;
  private readonly inactivityTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly options: SpaceMemoryPolicyServiceOptions) {
    this.inactivityTimeoutMs = options.inactivityTimeoutMs ?? DEFAULT_INCOGNITO_INACTIVITY_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
    this.resumeActiveIncognitoTimeouts();
  }

  getGatewayDefaults(): GatewayMemoryDefaults {
    const row = this.options.gatewayDefaults.get();
    return {
      defaultExperienceCapture: normalizeGatewayExperienceCapture(row.default_experience_capture),
      defaultSpacePrivacyMode: "STANDARD",
      updatedAt: new Date(row.updated_at),
    };
  }

  setGatewayDefaults(input: {
    defaultExperienceCapture: Exclude<SpaceExperienceCaptureMode, "INHERIT">;
    defaultSpacePrivacyMode?: "STANDARD";
  }): GatewayMemoryDefaults {
    const row = this.options.gatewayDefaults.set({
      defaultExperienceCapture: normalizeGatewayExperienceCapture(input.defaultExperienceCapture),
      defaultSpacePrivacyMode: "STANDARD",
    });
    return {
      defaultExperienceCapture: normalizeGatewayExperienceCapture(row.default_experience_capture),
      defaultSpacePrivacyMode: "STANDARD",
      updatedAt: new Date(row.updated_at),
    };
  }

  getGatewayMemoryDefaults(): {
    defaultExperienceCapture: Exclude<SpaceExperienceCaptureMode, "INHERIT">;
    defaultSpacePrivacyMode: "STANDARD";
    updatedAt: string;
  } {
    const defaults = this.getGatewayDefaults();
    return {
      defaultExperienceCapture: defaults.defaultExperienceCapture,
      defaultSpacePrivacyMode: defaults.defaultSpacePrivacyMode,
      updatedAt: defaults.updatedAt.toISOString(),
    };
  }

  setGatewayMemoryDefaults(input: {
    defaultExperienceCapture: Exclude<SpaceExperienceCaptureMode, "INHERIT">;
    defaultSpacePrivacyMode?: "STANDARD";
  }): {
    defaultExperienceCapture: Exclude<SpaceExperienceCaptureMode, "INHERIT">;
    defaultSpacePrivacyMode: "STANDARD";
    updatedAt: string;
  } {
    const defaults = this.setGatewayDefaults(input);
    return {
      defaultExperienceCapture: defaults.defaultExperienceCapture,
      defaultSpacePrivacyMode: defaults.defaultSpacePrivacyMode,
      updatedAt: defaults.updatedAt.toISOString(),
    };
  }

  resolveSpacePolicy(spaceIdRaw: string): SpaceMemoryPolicyResolution {
    const spaceId = normalizeRequired(spaceIdRaw, "spaceId");
    const space = this.options.spaces.getById(spaceId);
    if (!space) {
      throw new Error(`Space not found: ${spaceId}`);
    }

    const parsedConfig = parseSpaceConfig(space.space_config_json);
    const configured = parseSpaceMemoryPolicy(parsedConfig.memoryPolicy);
    const configuredThinkingCapturePolicy = parseThinkingCapturePolicy(parsedConfig.thinkingCapturePolicy);
    const defaults = this.getGatewayDefaults();
    const effectiveExperienceCapture = configured.privacyMode === "INCOGNITO_SESSION"
      ? "DISABLED"
      : configured.experienceCapture === "INHERIT"
        ? defaults.defaultExperienceCapture
        : configured.experienceCapture;
    const effectiveThinkingCapturePolicy = configured.privacyMode === "INCOGNITO_SESSION"
      ? "OFF"
      : configuredThinkingCapturePolicy;

    return {
      configured,
      effective: {
        experienceCapture: effectiveExperienceCapture,
        privacyMode: configured.privacyMode,
      },
      configuredThinkingCapturePolicy,
      effectiveThinkingCapturePolicy,
      activeReplaySession: this.options.replaySessions.getActive(spaceId),
    };
  }

  shouldGenerateExperiences(spaceId: string): boolean {
    return this.resolveSpacePolicy(spaceId).effective.experienceCapture === "ENABLED";
  }

  shouldPersistTrace(spaceId: string): boolean {
    return this.resolveSpacePolicy(spaceId).effective.privacyMode !== "INCOGNITO_SESSION";
  }

  shouldPersistTurnTrace(spaceId: string): boolean {
    return this.shouldPersistTrace(spaceId);
  }

  shouldPersistWorkspaceLogs(spaceId: string): boolean {
    return this.shouldPersistTrace(spaceId);
  }

  shouldPersistOrchestrationJournal(spaceId: string): boolean {
    return this.shouldPersistTrace(spaceId);
  }

  getEffectiveThinkingCapturePolicy(spaceId: string): ThinkingCapturePolicy {
    return this.resolveSpacePolicy(spaceId).effectiveThinkingCapturePolicy;
  }

  getThinkingCapturePolicy(spaceId: string): ThinkingCapturePolicy {
    return this.resolveSpacePolicy(spaceId).configuredThinkingCapturePolicy;
  }

  getSpaceMemoryPolicy(spaceId: string): SpaceMemoryPolicy {
    return this.resolveSpacePolicy(spaceId).configured;
  }

  resolveEffectiveThinkingCapturePolicy(spaceId: string): ThinkingCapturePolicy {
    return this.getEffectiveThinkingCapturePolicy(spaceId);
  }

  setThinkingCapturePolicy(
    spaceIdRaw: string,
    thinkingCapturePolicyRaw: ThinkingCapturePolicy,
  ): ThinkingCapturePolicy {
    const spaceId = normalizeRequired(spaceIdRaw, "spaceId");
    const row = this.options.spaces.getById(spaceId);
    if (!row) {
      throw new Error(`Space not found: ${spaceId}`);
    }

    const parsedConfig = parseSpaceConfig(row.space_config_json);
    const thinkingCapturePolicy = parseThinkingCapturePolicy(thinkingCapturePolicyRaw);
    parsedConfig.thinkingCapturePolicy = thinkingCapturePolicy;
    this.options.spaces.updateConfig(spaceId, JSON.stringify(parsedConfig));
    return thinkingCapturePolicy;
  }

  async setSpaceMemoryPolicy(
    spaceIdRaw: string,
    memoryPolicyInput: SpaceMemoryPolicy,
  ): Promise<EndIncognitoSessionResult | undefined> {
    const spaceId = normalizeRequired(spaceIdRaw, "spaceId");
    const row = this.options.spaces.getById(spaceId);
    if (!row) {
      throw new Error(`Space not found: ${spaceId}`);
    }

    const parsedConfig = parseSpaceConfig(row.space_config_json);
    const previous = parseSpaceMemoryPolicy(parsedConfig.memoryPolicy);
    const next = parseSpaceMemoryPolicy(memoryPolicyInput);
    parsedConfig.memoryPolicy = serializeSpaceMemoryPolicy(next);
    this.options.spaces.updateConfig(spaceId, JSON.stringify(parsedConfig));
    return this.handleSpaceMemoryPolicyTransition(spaceId, previous, next);
  }

  noteTurnPersisted(spaceIdRaw: string, occurredAtRaw?: string): {
    session: SpaceReplaySessionRow;
    shouldGenerateExperience: boolean;
  } {
    const spaceId = normalizeRequired(spaceIdRaw, "spaceId");
    const occurredAt = normalizeTimestamp(occurredAtRaw) ?? this.now().toISOString();
    const resolution = this.resolveSpacePolicy(spaceId);
    let session = resolution.activeReplaySession;

    if (!session || session.privacy_mode !== resolution.effective.privacyMode) {
      if (session) {
        this.options.replaySessions.close(session.session_id, {
          closedAt: occurredAt,
          lastActivityAt: occurredAt,
          summary: session.summary,
        });
      }
      session = this.options.replaySessions.create({
        sessionId: `srs-${randomUUID()}`,
        spaceId,
        privacyMode: resolution.effective.privacyMode,
        startedAt: occurredAt,
        lastActivityAt: occurredAt,
      });
    }

    session = this.options.replaySessions.touch(session.session_id, {
      lastActivityAt: occurredAt,
      turnCountDelta: 1,
    });

    if (session.privacy_mode === "INCOGNITO_SESSION") {
      this.scheduleIncognitoTimeout(spaceId, session);
    } else {
      this.clearIncognitoTimeout(spaceId);
    }

    const shouldGenerateExperience = resolution.effective.experienceCapture === "ENABLED"
      && (session.turn_count - session.last_self_check_turn_count) >= 10;

    return { session, shouldGenerateExperience };
  }

  async recordCompletedTurn(spaceIdRaw: string, occurredAtRaw?: string): Promise<SpaceReplaySessionRow> {
    return this.noteTurnPersisted(spaceIdRaw, occurredAtRaw).session;
  }

  markExperienceSelfCheckCompleted(spaceIdRaw: string): SpaceReplaySessionRow | undefined {
    const spaceId = normalizeRequired(spaceIdRaw, "spaceId");
    const session = this.options.replaySessions.getActive(spaceId);
    if (!session) {
      return undefined;
    }
    return this.options.replaySessions.touch(session.session_id, {
      lastSelfCheckTurnCount: session.turn_count,
    });
  }

  markSelfCheckCompleted(spaceIdRaw: string, turnCount?: number): SpaceReplaySessionRow | undefined {
    const spaceId = normalizeRequired(spaceIdRaw, "spaceId");
    const session = this.options.replaySessions.getActive(spaceId);
    if (!session) {
      return undefined;
    }
    return this.options.replaySessions.touch(session.session_id, {
      lastSelfCheckTurnCount: typeof turnCount === "number" && Number.isFinite(turnCount)
        ? Math.max(0, Math.floor(turnCount))
        : session.turn_count,
    });
  }

  async handleSpaceMemoryPolicyTransition(
    spaceIdRaw: string,
    previous: SpaceMemoryPolicy,
    next: SpaceMemoryPolicy,
  ): Promise<EndIncognitoSessionResult | undefined> {
    const spaceId = normalizeRequired(spaceIdRaw, "spaceId");
    if (previous.privacyMode === "INCOGNITO_SESSION" && next.privacyMode !== "INCOGNITO_SESSION") {
      return this.endIncognitoSession(spaceId, "policy_change");
    }
    if (next.privacyMode !== "INCOGNITO_SESSION") {
      this.clearIncognitoTimeout(spaceId);
    }
    return undefined;
  }

  async endIncognitoSession(
    spaceIdRaw: string,
    reason: "manual" | "inactivity" | "policy_change" = "manual",
  ): Promise<EndIncognitoSessionResult> {
    const spaceId = normalizeRequired(spaceIdRaw, "spaceId");
    const session = this.options.replaySessions.getActive(spaceId);
    if (!session || session.privacy_mode !== "INCOGNITO_SESSION") {
      this.clearIncognitoTimeout(spaceId);
      return {
        ended: false,
        purged: false,
        reason,
        sessionId: session?.session_id,
        session,
        deleted: emptyDeletedCounts(),
      };
    }

    this.clearIncognitoTimeout(spaceId);

    const closedAt = this.now().toISOString();
    const range = {
      createdAtGte: session.started_at,
      createdAtLte: closedAt,
    };

    const deleted = {
      turns: this.options.turns.deleteBySpace(spaceId, range),
      eventLog: this.options.eventLog.deleteBySpace(spaceId, range),
      orchestrationJournal: this.options.orchestrationJournal.deleteBySpace(spaceId, range),
      artifacts: this.options.artifacts.deleteBySpace(spaceId, {
        ...range,
        retentionScope: "space_local",
      }),
      experiences: this.options.experiences?.deleteBySpace(spaceId, range) ?? 0,
      personalityInsights: this.options.personalityInsights?.deleteBySpace(spaceId, range) ?? 0,
      agentNotes: this.options.agentNotes?.deleteBySpace(spaceId) ?? 0,
      agentUsageSessions: this.options.agentUsageSessions?.deleteBySpace(spaceId) ?? 0,
    };

    const closedSession = this.options.replaySessions.close(session.session_id, {
      closedAt,
      purgedAt: closedAt,
      lastActivityAt: closedAt,
      summary: reason,
    });

    if (this.options.onSessionPurged) {
      Promise.resolve(this.options.onSessionPurged(spaceId)).catch((error) => {
        this.options.logger?.warn("Failed to purge incognito workspace projection", {
          spaceId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    this.options.logger?.info("Incognito replay session ended and purged", {
      spaceId,
      sessionId: session.session_id,
      reason,
      ...deleted,
    });

    return {
      ended: true,
      purged: true,
      reason,
      sessionId: session.session_id,
      purgedAt: closedAt,
      session: closedSession,
      deleted,
    };
  }

  private resumeActiveIncognitoTimeouts(): void {
    for (const session of this.options.replaySessions.listActiveIncognito()) {
      this.scheduleIncognitoTimeout(session.space_id, session);
    }
  }

  private scheduleIncognitoTimeout(spaceId: string, session: SpaceReplaySessionRow): void {
    this.clearIncognitoTimeout(spaceId);
    const lastActivity = Date.parse(session.last_activity_at);
    const elapsedMs = Number.isFinite(lastActivity)
      ? Math.max(0, this.now().getTime() - lastActivity)
      : 0;
    const remainingMs = this.inactivityTimeoutMs - elapsedMs;
    if (remainingMs <= 0) {
      queueMicrotask(() => {
        this.endIncognitoSession(spaceId, "inactivity");
      });
      return;
    }

    const timer = setTimeout(() => {
      this.endIncognitoSession(spaceId, "inactivity");
    }, remainingMs);
    timer.unref?.();
    this.inactivityTimers.set(spaceId, timer);
  }

  private clearIncognitoTimeout(spaceId: string): void {
    const timer = this.inactivityTimers.get(spaceId);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.inactivityTimers.delete(spaceId);
  }
}
