import type {
  VoiceUsageAggregate,
  VoiceUsageRepository,
  VoiceUsageSource,
} from "@spaceskit/persistence";
import type { VoiceChannel, VoiceProviderSource } from "./voice-routing-service.js";

export interface VoiceUsageDelta {
  sttSeconds?: number;
  ttsChars?: number;
  ttsSeconds?: number;
}

export interface VoiceUsageLockPolicy {
  enabled: boolean;
  managedSttSecondsMonthlyLimit?: number;
  managedTtsCharsMonthlyLimit?: number;
  managedTtsSecondsMonthlyLimit?: number;
}

export interface VoiceUsageLockSnapshot {
  policy: VoiceUsageLockPolicy;
  managedCurrentMonth: VoiceUsageAggregate;
  monthStart: string;
}

export interface VoiceUsageLockDecision extends VoiceUsageLockSnapshot {
  source: VoiceProviderSource;
  allowed: boolean;
  reason:
    | "allowed"
    | "not_managed_source"
    | "lock_disabled"
    | "usage_repo_unavailable"
    | "managed_stt_limit_reached"
    | "managed_tts_chars_limit_reached"
    | "managed_tts_seconds_limit_reached";
  projectedManagedCurrentMonth: VoiceUsageAggregate;
  blockedMetric?: "sttSeconds" | "ttsChars" | "ttsSeconds";
  limit?: number;
}

export interface VoiceUsageLockServiceOptions {
  usageRepo?: VoiceUsageRepository | null;
  loadPolicy?: () => VoiceUsageLockPolicy;
  now?: () => Date;
}

const EMPTY_USAGE: VoiceUsageAggregate = {
  sttSeconds: 0,
  ttsChars: 0,
  ttsSeconds: 0,
  estimatedCostUsd: 0,
};

export class VoiceUsageLockService {
  private readonly now: () => Date;

  constructor(private readonly options: VoiceUsageLockServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  getSnapshot(): VoiceUsageLockSnapshot {
    const policy = this.loadPolicy();
    const monthStart = startOfMonthIso(this.now());
    const managedCurrentMonth = this.aggregateManaged(monthStart);
    return { policy, managedCurrentMonth, monthStart };
  }

  evaluate(
    source: VoiceProviderSource,
    delta: VoiceUsageDelta = {},
  ): VoiceUsageLockDecision {
    const snapshot = this.getSnapshot();
    const projectedManagedCurrentMonth: VoiceUsageAggregate = {
      sttSeconds: snapshot.managedCurrentMonth.sttSeconds + sanitizeFloat(delta.sttSeconds),
      ttsChars: snapshot.managedCurrentMonth.ttsChars + sanitizeInt(delta.ttsChars),
      ttsSeconds: snapshot.managedCurrentMonth.ttsSeconds + sanitizeFloat(delta.ttsSeconds),
      estimatedCostUsd: snapshot.managedCurrentMonth.estimatedCostUsd,
    };

    if (source !== "managed") {
      return {
        ...snapshot,
        source,
        allowed: true,
        reason: "not_managed_source",
        projectedManagedCurrentMonth,
      };
    }

    if (!snapshot.policy.enabled) {
      return {
        ...snapshot,
        source,
        allowed: true,
        reason: "lock_disabled",
        projectedManagedCurrentMonth,
      };
    }

    if (!this.options.usageRepo) {
      return {
        ...snapshot,
        source,
        allowed: true,
        reason: "usage_repo_unavailable",
        projectedManagedCurrentMonth,
      };
    }

    const sttLimit = normalizeLimit(snapshot.policy.managedSttSecondsMonthlyLimit);
    if (sttLimit !== undefined && projectedManagedCurrentMonth.sttSeconds > sttLimit) {
      return {
        ...snapshot,
        source,
        allowed: false,
        reason: "managed_stt_limit_reached",
        blockedMetric: "sttSeconds",
        limit: sttLimit,
        projectedManagedCurrentMonth,
      };
    }

    const ttsCharsLimit = normalizeLimit(snapshot.policy.managedTtsCharsMonthlyLimit);
    if (ttsCharsLimit !== undefined && projectedManagedCurrentMonth.ttsChars > ttsCharsLimit) {
      return {
        ...snapshot,
        source,
        allowed: false,
        reason: "managed_tts_chars_limit_reached",
        blockedMetric: "ttsChars",
        limit: ttsCharsLimit,
        projectedManagedCurrentMonth,
      };
    }

    const ttsSecondsLimit = normalizeLimit(snapshot.policy.managedTtsSecondsMonthlyLimit);
    if (ttsSecondsLimit !== undefined && projectedManagedCurrentMonth.ttsSeconds > ttsSecondsLimit) {
      return {
        ...snapshot,
        source,
        allowed: false,
        reason: "managed_tts_seconds_limit_reached",
        blockedMetric: "ttsSeconds",
        limit: ttsSecondsLimit,
        projectedManagedCurrentMonth,
      };
    }

    return {
      ...snapshot,
      source,
      allowed: true,
      reason: "allowed",
      projectedManagedCurrentMonth,
    };
  }

  evaluateChannel(
    channel: VoiceChannel,
    source: VoiceProviderSource,
    delta: VoiceUsageDelta = {},
  ): VoiceUsageLockDecision {
    const snapshot = this.getSnapshot();
    const projectedManagedCurrentMonth: VoiceUsageAggregate = {
      sttSeconds: snapshot.managedCurrentMonth.sttSeconds + sanitizeFloat(delta.sttSeconds),
      ttsChars: snapshot.managedCurrentMonth.ttsChars + sanitizeInt(delta.ttsChars),
      ttsSeconds: snapshot.managedCurrentMonth.ttsSeconds + sanitizeFloat(delta.ttsSeconds),
      estimatedCostUsd: snapshot.managedCurrentMonth.estimatedCostUsd,
    };

    if (source !== "managed") {
      return {
        ...snapshot,
        source,
        allowed: true,
        reason: "not_managed_source",
        projectedManagedCurrentMonth,
      };
    }

    if (!snapshot.policy.enabled) {
      return {
        ...snapshot,
        source,
        allowed: true,
        reason: "lock_disabled",
        projectedManagedCurrentMonth,
      };
    }

    if (!this.options.usageRepo) {
      return {
        ...snapshot,
        source,
        allowed: true,
        reason: "usage_repo_unavailable",
        projectedManagedCurrentMonth,
      };
    }

    if (channel === "stt") {
      const sttLimit = normalizeLimit(snapshot.policy.managedSttSecondsMonthlyLimit);
      if (sttLimit !== undefined && projectedManagedCurrentMonth.sttSeconds > sttLimit) {
        return {
          ...snapshot,
          source,
          allowed: false,
          reason: "managed_stt_limit_reached",
          blockedMetric: "sttSeconds",
          limit: sttLimit,
          projectedManagedCurrentMonth,
        };
      }
    } else {
      const ttsCharsLimit = normalizeLimit(snapshot.policy.managedTtsCharsMonthlyLimit);
      if (ttsCharsLimit !== undefined && projectedManagedCurrentMonth.ttsChars > ttsCharsLimit) {
        return {
          ...snapshot,
          source,
          allowed: false,
          reason: "managed_tts_chars_limit_reached",
          blockedMetric: "ttsChars",
          limit: ttsCharsLimit,
          projectedManagedCurrentMonth,
        };
      }

      const ttsSecondsLimit = normalizeLimit(snapshot.policy.managedTtsSecondsMonthlyLimit);
      if (ttsSecondsLimit !== undefined && projectedManagedCurrentMonth.ttsSeconds > ttsSecondsLimit) {
        return {
          ...snapshot,
          source,
          allowed: false,
          reason: "managed_tts_seconds_limit_reached",
          blockedMetric: "ttsSeconds",
          limit: ttsSecondsLimit,
          projectedManagedCurrentMonth,
        };
      }
    }

    return {
      ...snapshot,
      source,
      allowed: true,
      reason: "allowed",
      projectedManagedCurrentMonth,
    };
  }

  private loadPolicy(): VoiceUsageLockPolicy {
    const fromLoader = this.options.loadPolicy?.();
    if (fromLoader) {
      return {
        enabled: fromLoader.enabled !== false,
        managedSttSecondsMonthlyLimit: normalizeLimit(fromLoader.managedSttSecondsMonthlyLimit),
        managedTtsCharsMonthlyLimit: normalizeLimit(fromLoader.managedTtsCharsMonthlyLimit),
        managedTtsSecondsMonthlyLimit: normalizeLimit(fromLoader.managedTtsSecondsMonthlyLimit),
      };
    }
    return {
      enabled: true,
      managedSttSecondsMonthlyLimit: undefined,
      managedTtsCharsMonthlyLimit: undefined,
      managedTtsSecondsMonthlyLimit: undefined,
    };
  }

  private aggregateManaged(monthStartIso: string): VoiceUsageAggregate {
    if (!this.options.usageRepo) {
      return EMPTY_USAGE;
    }

    const rows = this.options.usageRepo.aggregateBySource(monthStartIso);
    const managed = rows.find((row) => row.source === "managed");
    if (!managed) {
      return EMPTY_USAGE;
    }
    return {
      sttSeconds: managed.sttSeconds,
      ttsChars: managed.ttsChars,
      ttsSeconds: managed.ttsSeconds,
      estimatedCostUsd: managed.estimatedCostUsd,
    };
  }
}

function startOfMonthIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function normalizeLimit(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  const normalized = Number(value);
  if (normalized < 0) return undefined;
  return normalized;
}

function sanitizeFloat(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Number(value));
}

function sanitizeInt(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(Number(value)));
}

export function parseVoiceUsagePolicyFromGlobalFlags(
  globalFlags: Record<string, unknown> | null | undefined,
): VoiceUsageLockPolicy {
  const voiceFlags = globalFlags?.voice;
  const voice = (
    voiceFlags && typeof voiceFlags === "object" && !Array.isArray(voiceFlags)
      ? voiceFlags
      : {}
  ) as Record<string, unknown>;

  return {
    enabled: coerceBoolean(voice.enabled, true),
    managedSttSecondsMonthlyLimit: coerceNumber(voice.managedSttSecondsMonthlyLimit),
    managedTtsCharsMonthlyLimit: coerceNumber(voice.managedTtsCharsMonthlyLimit),
    managedTtsSecondsMonthlyLimit: coerceNumber(voice.managedTtsSecondsMonthlyLimit),
  };
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

export function isVoiceUsageSource(value: string): value is VoiceUsageSource {
  return (
    value === "managed"
    || value === "byok"
    || value === "local_model"
    || value === "apple_speech"
    || value === "unknown"
  );
}
