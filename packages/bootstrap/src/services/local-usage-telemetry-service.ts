import type { Logger } from "@spaceskit/observability";
import type {
  ProviderTelemetryPayload,
  ProviderTelemetryWindowPayload,
} from "@spaceskit/server";
import { CodexBarUsageAdapter, type CodexBarMode } from "./codexbar-usage-adapter.js";
import type {
  CodexBarQuota,
  LocalProviderUsageTelemetry,
  LocalUsageSession,
  LocalUsageSummary,
  LocalUsageWindow,
} from "./local-usage-telemetry-types.js";
import {
  type LocalUsageSessionRecord,
  type LocalUsageSessionScanner,
} from "./local-usage-scanner.js";
import { CodexSessionScanner } from "./scan-codex-sessions.js";
import { ClaudeSessionScanner } from "./scan-claude-sessions.js";
import { GeminiSessionScanner } from "./scan-gemini-sessions.js";

export interface LocalUsageTelemetryServiceOptions {
  logger: Logger;
  windowDays?: number;
  maxSessions?: number;
  refreshMinSecs?: number;
  codexBarMode?: CodexBarMode;
  codexBarAdapter?: CodexBarUsageAdapter;
  scanners?: Partial<Record<string, LocalUsageSessionScanner>>;
  now?: () => Date;
}

export interface GetLocalUsageTelemetryInput {
  providerIds: string[];
  fallbackTelemetry?: ProviderTelemetryPayload[];
}

interface LocalUsageTelemetryCache {
  generatedAtMs: number;
  byProviderId: Map<string, LocalProviderUsageTelemetry>;
}

const INPUT_COST_PER_1K = 0.003;
const OUTPUT_COST_PER_1K = 0.015;

export class LocalUsageTelemetryService {
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly windowDays: number;
  private readonly maxSessions: number;
  private readonly refreshMinSecs: number;
  private readonly codexBarMode: CodexBarMode;
  private readonly codexBarAdapter: CodexBarUsageAdapter;
  private readonly scanners: Map<string, LocalUsageSessionScanner>;
  private cache: LocalUsageTelemetryCache | null = null;

  constructor(options: LocalUsageTelemetryServiceOptions) {
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
    this.windowDays = normalizeInteger(options.windowDays, 30);
    this.maxSessions = normalizeInteger(options.maxSessions, 10);
    this.refreshMinSecs = Math.max(0, normalizeInteger(options.refreshMinSecs, 60));
    this.codexBarMode = normalizeCodexBarMode(options.codexBarMode);
    this.codexBarAdapter = options.codexBarAdapter ?? new CodexBarUsageAdapter({
      logger: this.logger.child({ module: "codexbar-usage-adapter" }),
    });

    const scannerEntries: Array<[string, LocalUsageSessionScanner]> = [
      ["codex", new CodexSessionScanner()],
      ["claude", new ClaudeSessionScanner()],
      ["gemini", new GeminiSessionScanner()],
    ];
    this.scanners = new Map(scannerEntries);
    for (const [providerId, scanner] of Object.entries(options.scanners ?? {})) {
      if (!providerId || !scanner) continue;
      this.scanners.set(providerId.trim().toLowerCase(), scanner);
    }
  }

  async getTelemetry(input: GetLocalUsageTelemetryInput): Promise<LocalProviderUsageTelemetry[]> {
    const providerIds = Array.from(
      new Set(
        (input.providerIds ?? [])
          .map((providerId) => providerId.trim().toLowerCase())
          .filter((providerId) => providerId.length > 0),
      ),
    );
    if (providerIds.length === 0) {
      return [];
    }

    const now = this.now();
    if (this.canReuseCache(providerIds, now)) {
      return providerIds
        .map((providerId) => this.cache?.byProviderId.get(providerId))
        .filter((entry): entry is LocalProviderUsageTelemetry => Boolean(entry))
        .map((entry) => ({ ...entry }));
    }

    const fallbackByProvider = new Map<string, ProviderTelemetryPayload>();
    for (const fallback of input.fallbackTelemetry ?? []) {
      const providerId = fallback.providerId.trim().toLowerCase();
      if (!providerId) continue;
      fallbackByProvider.set(providerId, fallback);
    }

    const windowStartMs = now.getTime() - (this.windowDays * 24 * 60 * 60 * 1_000);
    const fetchedAtIso = now.toISOString();
    const telemetry = await Promise.all(providerIds.map(async (providerId) => {
      const fallback = fallbackByProvider.get(providerId);
      const scanner = this.scanners.get(providerId);
      const sessionRecords = scanner
        ? await scanner.scan(windowStartMs)
        : [];
      const summary = resolveUsageSummary(
        summarizeSessions(sessionRecords, this.windowDays),
        fallback,
      );
      const sessions = toSessionPayloads(sessionRecords, this.maxSessions);
      const quota = this.resolveQuota(providerId, fallback, fetchedAtIso);
      const status = resolveProviderStatus(summary, quota, fallback);
      const message = firstDefined(
        quota.message,
        fallback?.message,
      );

      return {
        providerId,
        status,
        fetchedAt: fetchedAtIso,
        message,
        quota,
        summary,
        sessions,
      } satisfies LocalProviderUsageTelemetry;
    }));

    this.cache = {
      generatedAtMs: now.getTime(),
      byProviderId: new Map<string, LocalProviderUsageTelemetry>(
        telemetry.map((entry: LocalProviderUsageTelemetry) => [entry.providerId, entry]),
      ),
    };

    return telemetry;
  }

  private canReuseCache(providerIds: string[], now: Date): boolean {
    if (!this.cache) return false;
    if (this.refreshMinSecs <= 0) return false;
    const ageMs = now.getTime() - this.cache.generatedAtMs;
    if (ageMs > this.refreshMinSecs * 1_000) {
      return false;
    }
    return providerIds.every((providerId) => this.cache?.byProviderId.has(providerId));
  }

  private resolveQuota(
    providerId: string,
    fallback: ProviderTelemetryPayload | undefined,
    updatedAt: string,
  ): CodexBarQuota {
    const fallbackWindows = mapFallbackWindows(fallback?.windows);
    const fallbackSourceLabel = fallback ? mapFallbackSourceLabel(fallback.source) : undefined;

    if (this.codexBarMode === "off") {
      return {
        available: fallbackWindows.length > 0,
        sourceLabel: fallbackSourceLabel,
        windows: fallbackWindows,
        accountLabel: fallback?.accountLabel,
        updatedAt,
        message: fallback?.message ?? "CodexBar integration disabled (SPACESKIT_CODEXBAR_MODE=off).",
      };
    }

    let codexBarQuota: CodexBarQuota;
    try {
      codexBarQuota = this.codexBarAdapter.readProviderUsage(providerId, {
        allowCommandProbe: this.codexBarMode === "prefer",
      });
    } catch (err) {
      this.logger.warn("CodexBar usage probe failed", {
        providerId,
        error: err instanceof Error ? err.message : String(err),
      });
      codexBarQuota = {
        available: false,
        windows: [],
        message: "CodexBar usage probe failed unexpectedly.",
      };
    }

    const useCodexBarWindows = codexBarQuota.windows.length > 0;
    const fallbackHasUsage = Boolean(fallback?.usage);
    const useFallbackTelemetry = !useCodexBarWindows
      && (fallbackWindows.length > 0 || fallbackHasUsage);
    const windows = useCodexBarWindows ? codexBarQuota.windows : fallbackWindows;
    const sourceLabel = useCodexBarWindows
      ? (codexBarQuota.sourceLabel ?? fallbackSourceLabel)
      : (fallbackSourceLabel ?? codexBarQuota.sourceLabel);
    const accountLabel = codexBarQuota.accountLabel ?? fallback?.accountLabel;
    const available = codexBarQuota.available || windows.length > 0;
    const message = useFallbackTelemetry
      ? fallback?.message
      : firstDefined(
        codexBarQuota.message,
        fallback?.message,
      );

    return {
      available,
      sourceLabel,
      windows,
      creditsRemaining: codexBarQuota.creditsRemaining,
      accountLabel,
      updatedAt: codexBarQuota.updatedAt ?? updatedAt,
      message,
      installHint: codexBarQuota.installHint,
    };
  }
}

function resolveProviderStatus(
  summary: LocalUsageSummary,
  quota: CodexBarQuota,
  fallback: ProviderTelemetryPayload | undefined,
): LocalProviderUsageTelemetry["status"] {
  if (quota.windows.length > 0 || quota.available) {
    return "available";
  }
  if (summary.sessionCount > 0 || summary.totalTokens > 0) {
    return "available";
  }
  if (fallback?.status) {
    return fallback.status;
  }
  return "unknown";
}

function resolveUsageSummary(
  localSummary: LocalUsageSummary,
  fallback: ProviderTelemetryPayload | undefined,
): LocalUsageSummary {
  if (localSummary.sessionCount > 0 || localSummary.totalTokens > 0) {
    return localSummary;
  }

  const fallbackUsage = fallback?.usage;
  if (!fallbackUsage) {
    return localSummary;
  }

  return {
    windowDays: localSummary.windowDays,
    sessionCount: 0,
    inputTokens: fallbackUsage.inputTokens,
    outputTokens: fallbackUsage.outputTokens,
    totalTokens: fallbackUsage.totalTokens,
    ...(fallbackUsage.spentUsd > 0 ? { estimatedCostUsd: fallbackUsage.spentUsd } : {}),
    tokenAccuracy: fallbackUsage.tokenAccuracy,
    usageSource: fallbackUsage.usageSource,
  };
}

function summarizeSessions(
  sessions: LocalUsageSessionRecord[],
  windowDays: number,
): LocalUsageSummary {
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;

  for (const session of sessions) {
    inputTokens += session.inputTokens;
    cachedInputTokens += session.cachedInputTokens;
    outputTokens += session.outputTokens;
  }

  const totalTokens = sessions.reduce(
    (sum, session) => sum + resolveSessionTotalTokens(session),
    0,
  );
  const estimatedCostUsd = estimateCostUsd(inputTokens, outputTokens);
  return {
    windowDays,
    sessionCount: sessions.length,
    inputTokens,
    ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
    outputTokens,
    totalTokens,
    ...(estimatedCostUsd > 0 ? { estimatedCostUsd } : {}),
    tokenAccuracy: "estimated",
    usageSource: "local_scanner",
  };
}

function toSessionPayloads(
  sessions: LocalUsageSessionRecord[],
  maxSessions: number,
): LocalUsageSession[] {
  return sessions
    .slice(0, maxSessions)
    .map((session) => {
      const totalTokens = resolveSessionTotalTokens(session);
      const estimatedCostUsd = estimateCostUsd(session.inputTokens, session.outputTokens);
      return {
        sessionId: session.sessionId,
        model: session.model,
        startedAt: toIsoString(session.startedAtMs),
        lastActivityAt: toIsoString(session.lastActivityAtMs) ?? new Date().toISOString(),
        inputTokens: session.inputTokens,
        ...(session.cachedInputTokens > 0 ? { cachedInputTokens: session.cachedInputTokens } : {}),
        outputTokens: session.outputTokens,
        totalTokens,
        ...(estimatedCostUsd > 0 ? { estimatedCostUsd } : {}),
        tokenAccuracy: "estimated",
        usageSource: "local_scanner",
      };
    });
}

function resolveSessionTotalTokens(session: LocalUsageSessionRecord): number {
  return session.totalTokens ?? (session.inputTokens + session.cachedInputTokens + session.outputTokens);
}

function mapFallbackWindows(
  windowsRaw: ProviderTelemetryWindowPayload[] | undefined,
): LocalUsageWindow[] {
  if (!windowsRaw || windowsRaw.length === 0) {
    return [];
  }

  return windowsRaw.map((window) => ({
    window: window.window,
    label: window.window === "primary" ? "session" : "weekly",
    usedPercent: window.usedPercent,
    remainingPercent: window.remainingPercent,
    windowMinutes: window.windowDurationMins,
    resetsAt: window.resetsAt,
  }));
}

function mapFallbackSourceLabel(source: ProviderTelemetryPayload["source"]): string {
  switch (source) {
    case "codex_app_server":
      return "codex-cli";
    case "claude_cli":
      return "claude-cli";
    case "gemini_cli":
      return "gemini-cli";
    case "lmstudio_runtime":
      return "runtime";
    case "usage_snapshot":
      return "api";
    default:
      return source;
  }
}

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  const cost = ((inputTokens / 1_000) * INPUT_COST_PER_1K)
    + ((outputTokens / 1_000) * OUTPUT_COST_PER_1K);
  return roundCost(cost);
}

function roundCost(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100_000) / 100_000;
}

function toIsoString(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  try {
    return new Date(value).toISOString();
  } catch {
    return undefined;
  }
}

function normalizeInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

function normalizeCodexBarMode(mode: CodexBarMode | undefined): CodexBarMode {
  switch (mode) {
    case "off":
    case "auto":
    case "prefer":
      return mode;
    default:
      return "auto";
  }
}

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}
