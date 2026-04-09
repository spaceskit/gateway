import { existsSync, readFileSync } from "node:fs";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { join } from "node:path";
import type { Logger } from "@spaceskit/observability";
import type {
  CodexBarQuota,
  LocalUsageInstallHint,
  LocalUsageWindow,
} from "./local-usage-telemetry-types.js";

export type CodexBarMode = "off" | "auto" | "prefer";

export interface CodexBarUsageAdapterOptions {
  logger: Logger;
  executable?: string;
  timeoutMs?: number;
  enableWidgetSnapshot?: boolean;
  runCommand?: (
    executable: string,
    args: string[],
    timeoutMs: number,
  ) => SpawnSyncReturns<string>;
}

export interface CodexBarUsageReadOptions {
  allowCommandProbe?: boolean;
}

export class CodexBarUsageAdapter {
  private readonly logger: Logger;
  private readonly executable: string;
  private readonly timeoutMs: number;
  private readonly enableWidgetSnapshot: boolean;
  private readonly runCommand: (
    executable: string,
    args: string[],
    timeoutMs: number,
  ) => SpawnSyncReturns<string>;
  private binaryMissing = false;

  constructor(options: CodexBarUsageAdapterOptions) {
    this.logger = options.logger;
    this.executable = options.executable?.trim() || "codexbar";
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.enableWidgetSnapshot = options.enableWidgetSnapshot ?? true;
    this.runCommand = options.runCommand ?? defaultRunCommand;
  }

  readProviderUsage(providerId: string, options: CodexBarUsageReadOptions = {}): CodexBarQuota {
    if (this.enableWidgetSnapshot) {
      const snapshotQuota = this.readSnapshotQuota(providerId);
      if (snapshotQuota?.windows.length) {
        return snapshotQuota;
      }
    }

    if (options.allowCommandProbe !== true) {
      return {
        available: false,
        windows: [],
        message: "Passive CodexBar snapshot unavailable. Enable prefer mode for an explicit live probe.",
      };
    }

    if (this.binaryMissing) {
      return unavailableInstallHintPayload();
    }

    const sources = resolveSourceAttempts(providerId);
    let fallbackMessage: string | undefined;
    let fallbackQuota: CodexBarQuota | undefined;

    for (const source of sources) {
      const result = this.runCommand(
        this.executable,
        buildUsageArgs(providerId, source),
        this.timeoutMs,
      );
      const timedOut = isTimeoutError(result.error);

      if (result.error && isMissingBinaryError(result.error)) {
        this.binaryMissing = true;
        return unavailableInstallHintPayload();
      }

      const payload = parseCodexBarResponse(result.stdout, providerId);
      const parsedQuota = payload ? mapParsedQuota(payload) : undefined;
      const hasUsage = Boolean(
        (parsedQuota?.windows.length ?? 0) > 0 || parsedQuota?.creditsRemaining !== undefined,
      );
      if (hasUsage) {
        return {
          available: true,
          sourceLabel: parsedQuota?.sourceLabel ?? source,
          windows: parsedQuota?.windows ?? [],
          creditsRemaining: parsedQuota?.creditsRemaining,
          accountLabel: parsedQuota?.accountLabel,
          updatedAt: parsedQuota?.updatedAt,
        };
      }

      const errorMessage = firstDefined(
        parseCodexBarErrorMessage(payload),
        normalizeFailureMessage(result.stderr, result.stdout, result.error),
      );
      if (!fallbackMessage && errorMessage) {
        fallbackMessage = errorMessage;
      }

      if (!fallbackQuota && parsedQuota) {
        fallbackQuota = {
          available: false,
          sourceLabel: parsedQuota.sourceLabel ?? source,
          windows: parsedQuota.windows,
          creditsRemaining: parsedQuota.creditsRemaining,
          accountLabel: parsedQuota.accountLabel,
          updatedAt: parsedQuota.updatedAt,
        };
      }

      if (result.status === 0 && payload) {
        break;
      }
      if (timedOut) {
        break;
      }
    }

    return {
      available: false,
      sourceLabel: fallbackQuota?.sourceLabel,
      windows: fallbackQuota?.windows ?? [],
      creditsRemaining: fallbackQuota?.creditsRemaining,
      accountLabel: fallbackQuota?.accountLabel,
      updatedAt: fallbackQuota?.updatedAt,
      message: fallbackMessage ?? `CodexBar command failed for provider ${providerId}.`,
    };
  }

  private readSnapshotQuota(providerId: string): CodexBarQuota | null {
    const snapshotPath = resolveWidgetSnapshotPath();
    if (!snapshotPath) return null;

    try {
      const raw = readFileSync(snapshotPath, "utf8").trim();
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!isObjectRecord(parsed) || !Array.isArray(parsed.entries)) {
        return null;
      }

      const providerEntry = parsed.entries.find((entry) =>
        isObjectRecord(entry) && asString(entry.provider)?.toLowerCase() === providerId.toLowerCase(),
      );
      if (!isObjectRecord(providerEntry)) {
        return null;
      }

      const windows = mapWidgetSnapshotWindows(providerEntry);
      const creditsRemaining = extractNumber(providerEntry.creditsRemaining);
      const updatedAt = asString(providerEntry.updatedAt) ?? asString(parsed.generatedAt);
      const available = windows.length > 0 || creditsRemaining !== undefined;
      if (!available) {
        return null;
      }

      return {
        available: true,
        sourceLabel: "codexbar-widget",
        windows,
        creditsRemaining,
        updatedAt,
      };
    } catch (error) {
      this.logger.debug("Failed to read CodexBar widget snapshot", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

function defaultRunCommand(
  executable: string,
  args: string[],
  timeoutMs: number,
): SpawnSyncReturns<string> {
  return spawnSync(executable, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
  });
}

function parseCodexBarResponse(
  stdoutRaw: string,
  providerId: string,
): Record<string, unknown> | null {
  const text = stdoutRaw.trim();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      const firstMatching = parsed.find((entry) =>
        isObjectRecord(entry) && asString(entry.provider)?.toLowerCase() === providerId.toLowerCase(),
      );
      const firstObject = parsed.find(isObjectRecord);
      return isObjectRecord(firstMatching)
        ? firstMatching
        : (isObjectRecord(firstObject) ? firstObject : null);
    }
    return isObjectRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildUsageArgs(
  providerId: string,
  source: "auto" | "cli",
): string[] {
  return [
    "usage",
    "--provider",
    providerId,
    "--format",
    "json",
    "--json-only",
    "--source",
    source,
    "--web-timeout",
    "8",
  ];
}

function resolveSourceAttempts(providerId: string): Array<"auto" | "cli"> {
  const normalized = providerId.trim().toLowerCase();
  if (normalized === "claude" || normalized === "codex" || normalized === "gemini") {
    return ["auto", "cli"];
  }
  return ["auto"];
}

function mapParsedQuota(payload: Record<string, unknown>): {
  sourceLabel?: string;
  windows: LocalUsageWindow[];
  creditsRemaining?: number;
  accountLabel?: string;
  updatedAt?: string;
} {
  return {
    sourceLabel: asString(payload.source),
    windows: mapUsageWindows(payload.usage),
    creditsRemaining: extractNumeric(payload.credits, "remaining"),
    accountLabel: asString(payload.accountLabel) ?? resolveAccountLabel(payload.account),
    updatedAt: asString(payload.updatedAt),
  };
}

function parseCodexBarErrorMessage(
  payload: Record<string, unknown> | null,
): string | undefined {
  if (!payload) return undefined;
  const errorRaw = payload.error;
  if (isObjectRecord(errorRaw)) {
    return asString(errorRaw.message) ?? asString(errorRaw.kind);
  }
  return undefined;
}

function mapUsageWindows(usageRaw: unknown): LocalUsageWindow[] {
  if (!isObjectRecord(usageRaw)) return [];

  const windows: LocalUsageWindow[] = [];
  const windowKeys: Array<"primary" | "secondary" | "tertiary"> = [
    "primary",
    "secondary",
    "tertiary",
  ];
  for (const key of windowKeys) {
    const payload = usageRaw[key];
    if (!isObjectRecord(payload)) continue;
    const usedPercent = normalizePercent(payload.usedPercent);
    windows.push({
      window: key,
      label: key === "primary" ? "session" : (key === "secondary" ? "weekly" : "tertiary"),
      usedPercent,
      remainingPercent: usedPercent !== undefined
        ? Math.max(0, Math.min(100, 100 - usedPercent))
        : undefined,
      windowMinutes: extractNumber(payload.windowMinutes),
      resetsAt: normalizeResetsAt(payload.resetsAt),
      resetDescription: asString(payload.resetDescription),
    });
  }

  return windows;
}

function mapWidgetSnapshotWindows(snapshotEntry: Record<string, unknown>): LocalUsageWindow[] {
  const windows: LocalUsageWindow[] = [];
  const keys: Array<"primary" | "secondary" | "tertiary"> = ["primary", "secondary", "tertiary"];
  for (const key of keys) {
    const raw = snapshotEntry[key];
    if (!isObjectRecord(raw)) continue;
    const usedPercent = normalizePercent(raw.usedPercent);
    windows.push({
      window: key,
      label: key === "primary" ? "session" : (key === "secondary" ? "weekly" : "tertiary"),
      usedPercent,
      remainingPercent: usedPercent !== undefined
        ? Math.max(0, Math.min(100, 100 - usedPercent))
        : undefined,
      windowMinutes: extractNumber(raw.windowMinutes),
      resetsAt: normalizeResetsAt(raw.resetsAt),
      resetDescription: asString(raw.resetDescription),
    });
  }
  return windows;
}

function resolveWidgetSnapshotPath(): string | null {
  const homeDir = process.env.HOME?.trim();
  if (!homeDir) return null;
  const path = join(
    homeDir,
    "Library",
    "Group Containers",
    "group.com.steipete.codexbar",
    "widget-snapshot.json",
  );
  return existsSync(path) ? path : null;
}

function normalizeResetsAt(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const timestampMs = value > 1_000_000_000_000 ? value : value * 1_000;
    return new Date(timestampMs).toISOString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return undefined;
}

function unavailableInstallHintPayload(): CodexBarQuota {
  return {
    available: false,
    windows: [],
    message: "CodexBar is not installed on the gateway host.",
    installHint: codexBarInstallHint(),
  };
}

function codexBarInstallHint(): LocalUsageInstallHint {
  return {
    command: "brew install steipete/tap/codexbar",
    docsUrl: "https://github.com/steipete/CodexBar",
  };
}

function normalizeFailureMessage(
  stderrRaw: string,
  stdoutRaw: string,
  error?: Error,
): string | undefined {
  if (error) {
    if (isTimeoutError(error)) {
      return "CodexBar usage command timed out.";
    }
    const message = error.message.trim();
    if (message) return message;
  }
  const stderr = stderrRaw.trim();
  if (stderr) return stderr;
  const stdout = stdoutRaw.trim();
  return stdout || undefined;
}

function resolveAccountLabel(accountRaw: unknown): string | undefined {
  if (!isObjectRecord(accountRaw)) return undefined;
  const label = asString(accountRaw.label);
  const email = asString(accountRaw.email);
  const plan = asString(accountRaw.planType) ?? asString(accountRaw.plan);
  return [plan, label, email].filter((entry) => Boolean(entry)).join(" • ") || undefined;
}

function extractNumeric(payload: unknown, key: string): number | undefined {
  if (!isObjectRecord(payload)) return undefined;
  const value = payload[key];
  return extractNumber(value);
}

function normalizePercent(value: unknown): number | undefined {
  const numeric = extractNumber(value);
  if (numeric === undefined) return undefined;
  return Math.max(0, Math.min(100, numeric));
}

function extractNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isMissingBinaryError(error: Error): boolean {
  return (error as Error & { code?: unknown }).code === "ENOENT";
}

function isTimeoutError(error: Error | undefined): boolean {
  return (error as Error & { code?: unknown } | undefined)?.code === "ETIMEDOUT";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}
