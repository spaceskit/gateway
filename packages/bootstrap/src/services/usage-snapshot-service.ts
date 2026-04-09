import type { Database } from "bun:sqlite";
import { UsageAnalyticsRepository, type VoiceUsageRepository } from "@spaceskit/persistence";

export interface UsageWindowSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  spentUsd: number;
  tokenAccuracy: "reported" | "estimated" | "mixed";
  usageSource: "ledger" | "local_scanner" | "legacy_turns";
}

export interface BudgetSummary {
  softCapUsd: number;
  hardCapUsd: number;
  warningThreshold: number;
  spentUsd: number;
  leftUsd: number;
}

export interface ProviderUsageSnapshot {
  providerId: string;
  status: "available" | "unavailable" | "unknown";
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  spentUsd: number;
  tokenAccuracy: "reported" | "estimated" | "mixed";
  usageSource: "ledger" | "local_scanner" | "legacy_turns";
  message?: string;
}

export interface VoiceUsageWindowSummary {
  sttSeconds: number;
  ttsChars: number;
  ttsSeconds: number;
  estimatedCostUsd: number;
}

export interface VoiceUsageSourceSummary extends VoiceUsageWindowSummary {
  source: "managed" | "byok" | "local_model" | "apple_speech" | "unknown";
}

export interface VoiceUsageProviderSummary extends VoiceUsageWindowSummary {
  source: "managed" | "byok" | "local_model" | "apple_speech" | "unknown";
  channel: "stt" | "tts" | "session" | "unknown";
  providerId: string;
}

export interface VoiceUsageLockSummary {
  enabled: boolean;
  managedSttSecondsMonthlyLimit?: number;
  managedTtsCharsMonthlyLimit?: number;
  managedTtsSecondsMonthlyLimit?: number;
  managedCurrentMonthSttSeconds?: number;
  managedCurrentMonthTtsChars?: number;
  managedCurrentMonthTtsSeconds?: number;
}

export interface VoiceUsageSnapshot {
  windows: {
    last5h: VoiceUsageWindowSummary;
    last7d: VoiceUsageWindowSummary;
    last30d: VoiceUsageWindowSummary;
    lifetime: VoiceUsageWindowSummary;
  };
  bySource: VoiceUsageSourceSummary[];
  byProvider: VoiceUsageProviderSummary[];
  lock?: VoiceUsageLockSummary;
}

export interface UsageSnapshot {
  computedAt: string;
  currency: "USD";
  windows: {
    last5h: UsageWindowSummary;
    last7d: UsageWindowSummary;
    last30d: UsageWindowSummary;
    lifetime: UsageWindowSummary;
  };
  budget: BudgetSummary;
  providerUsage: ProviderUsageSnapshot[];
  voice?: VoiceUsageSnapshot;
}

export interface UsageSnapshotServiceOptions {
  db: Database;
  usageRepo: UsageAnalyticsRepository;
  voiceUsageRepo?: VoiceUsageRepository;
  loadVoiceLockState?: () => VoiceUsageLockSummary | undefined;
  now?: () => Date;
  inputPricePer1k?: number;
  outputPricePer1k?: number;
}

export class UsageSnapshotService {
  private readonly now: () => Date;
  private readonly inputPricePer1k: number;
  private readonly outputPricePer1k: number;

  constructor(private readonly options: UsageSnapshotServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.inputPricePer1k = options.inputPricePer1k ?? 0.003;
    this.outputPricePer1k = options.outputPricePer1k ?? 0.015;
  }

  getSnapshot(): UsageSnapshot {
    const computedAtDate = this.now();
    const computedAt = computedAtDate.toISOString();

    const last5h = this.windowSummary(hoursAgo(computedAtDate, 5));
    const last7d = this.windowSummary(daysAgo(computedAtDate, 7));
    const last30d = this.windowSummary(daysAgo(computedAtDate, 30));
    const lifetime = this.windowSummary(undefined);

    const budgetPolicy = this.loadBudgetPolicy();
    const spentUsd = lifetime.spentUsd;
    const leftUsd = Math.max(0, budgetPolicy.hardCapUsd - spentUsd);

    const providerUsage: ProviderUsageSnapshot[] = this.options.usageRepo.aggregateByProvider().map(
      (provider): ProviderUsageSnapshot => ({
        providerId: provider.providerId,
        status: provider.providerId === "unknown" ? "unknown" : "available",
        inputTokens: provider.inputTokens,
        outputTokens: provider.outputTokens,
        totalTokens: provider.totalTokens,
        spentUsd: roundMoney(this.estimateCostUsd(provider.inputTokens, provider.outputTokens)),
        tokenAccuracy: provider.tokenAccuracy,
        usageSource: provider.usageSource,
      }),
    );

    if (providerUsage.length === 0) {
      providerUsage.push({
        providerId: "unknown",
        status: "unknown",
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        spentUsd: 0,
        tokenAccuracy: "reported",
        usageSource: "ledger",
        message: "No provider usage recorded yet",
      });
    }

    const voice = this.voiceSnapshot(computedAtDate);

    return {
      computedAt,
      currency: "USD",
      windows: {
        last5h,
        last7d,
        last30d,
        lifetime,
      },
      budget: {
        softCapUsd: budgetPolicy.softCapUsd,
        hardCapUsd: budgetPolicy.hardCapUsd,
        warningThreshold: budgetPolicy.warningThreshold,
        spentUsd: roundMoney(spentUsd),
        leftUsd: roundMoney(leftUsd),
      },
      providerUsage,
      voice: voice ?? undefined,
    };
  }

  private windowSummary(sinceIso: string | undefined): UsageWindowSummary {
    const aggregate = this.options.usageRepo.aggregateTokens(sinceIso);
    const spentUsd = this.estimateCostUsd(aggregate.inputTokens, aggregate.outputTokens);
    return {
      inputTokens: aggregate.inputTokens,
      outputTokens: aggregate.outputTokens,
      totalTokens: aggregate.totalTokens,
      spentUsd: roundMoney(spentUsd),
      tokenAccuracy: aggregate.tokenAccuracy,
      usageSource: aggregate.usageSource,
    };
  }

  private loadBudgetPolicy(): {
    softCapUsd: number;
    hardCapUsd: number;
    warningThreshold: number;
  } {
    const row = this.options.db.query(`
      SELECT soft_cap_usd, hard_cap_usd, warning_threshold
      FROM usage_budget_policy WHERE singleton_id = 1
    `).get() as {
      soft_cap_usd: number;
      hard_cap_usd: number;
      warning_threshold: number;
    } | null;

    if (!row) {
      return {
        softCapUsd: 20.0,
        hardCapUsd: 50.0,
        warningThreshold: 0.8,
      };
    }

    return {
      softCapUsd: row.soft_cap_usd,
      hardCapUsd: row.hard_cap_usd,
      warningThreshold: row.warning_threshold,
    };
  }

  private estimateCostUsd(inputTokens: number, outputTokens: number): number {
    return (
      (inputTokens / 1000) * this.inputPricePer1k
      + (outputTokens / 1000) * this.outputPricePer1k
    );
  }

  private voiceSnapshot(now: Date): VoiceUsageSnapshot | null {
    const voiceRepo = this.options.voiceUsageRepo;
    if (!voiceRepo) return null;

    const last5h = this.voiceWindowSummary(hoursAgo(now, 5));
    const last7d = this.voiceWindowSummary(daysAgo(now, 7));
    const last30d = this.voiceWindowSummary(daysAgo(now, 30));
    const lifetime = this.voiceWindowSummary(undefined);

    const bySource = voiceRepo.aggregateBySource().map((row): VoiceUsageSourceSummary => ({
      source: row.source,
      sttSeconds: roundMoney(row.sttSeconds),
      ttsChars: row.ttsChars,
      ttsSeconds: roundMoney(row.ttsSeconds),
      estimatedCostUsd: roundMoney(row.estimatedCostUsd),
    }));
    const byProvider = voiceRepo.aggregateByProviderChannel().map((row): VoiceUsageProviderSummary => ({
      source: row.source,
      channel: row.channel,
      providerId: row.providerId,
      sttSeconds: roundMoney(row.sttSeconds),
      ttsChars: row.ttsChars,
      ttsSeconds: roundMoney(row.ttsSeconds),
      estimatedCostUsd: roundMoney(row.estimatedCostUsd),
    }));

    const lock = this.options.loadVoiceLockState?.();

    return {
      windows: {
        last5h,
        last7d,
        last30d,
        lifetime,
      },
      bySource,
      byProvider,
      lock,
    };
  }

  private voiceWindowSummary(sinceIso: string | undefined): VoiceUsageWindowSummary {
    const voiceRepo = this.options.voiceUsageRepo;
    if (!voiceRepo) {
      return {
        sttSeconds: 0,
        ttsChars: 0,
        ttsSeconds: 0,
        estimatedCostUsd: 0,
      };
    }

    const aggregate = voiceRepo.aggregate(sinceIso);
    return {
      sttSeconds: roundMoney(aggregate.sttSeconds),
      ttsChars: aggregate.ttsChars,
      ttsSeconds: roundMoney(aggregate.ttsSeconds),
      estimatedCostUsd: roundMoney(aggregate.estimatedCostUsd),
    };
  }
}

function hoursAgo(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function roundMoney(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
