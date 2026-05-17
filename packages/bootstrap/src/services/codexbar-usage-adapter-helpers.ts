import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  CodexBarQuota,
  LocalUsageInstallHint,
  LocalUsageWindow,
} from "./local-usage-telemetry-types.js";

export function defaultRunCommand(
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

export function parseCodexBarResponse(
  stdoutRaw: string,
  providerId: string,
): Record<string, unknown> | null {
  const text = stdoutRaw.trim();
  if (!text) return null;

  for (const parsed of parseJsonPayloads(text)) {
    const providerPayload = selectProviderPayload(parsed, providerId);
    if (providerPayload) {
      return providerPayload;
    }
  }

  return null;
}

export function buildUsageArgs(
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

export function resolveSourceAttempts(providerId: string): Array<"auto" | "cli"> {
  const normalized = providerId.trim().toLowerCase();
  if (normalized === "claude" || normalized === "codex" || normalized === "gemini") {
    return ["auto", "cli"];
  }
  return ["auto"];
}

export function parseJsonPayloads(text: string): unknown[] {
  const wholeDocument = tryParseJson(text);
  if (wholeDocument !== undefined) {
    return [wholeDocument];
  }

  const payloads: unknown[] = [];
  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === undefined) continue;

    if (startIndex < 0) {
      if (character === "{" || character === "[") {
        startIndex = index;
        depth = 1;
        inString = false;
        escapeNext = false;
      }
      continue;
    }

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (character === "\\") {
        escapeNext = true;
        continue;
      }
      if (character === "\"") {
        inString = false;
      }
      continue;
    }

    if (character === "\"") {
      inString = true;
      continue;
    }

    if (character === "{" || character === "[") {
      depth += 1;
      continue;
    }

    if (character === "}" || character === "]") {
      depth -= 1;
      if (depth === 0) {
        const candidate = text.slice(startIndex, index + 1);
        const parsedCandidate = tryParseJson(candidate);
        if (parsedCandidate !== undefined) {
          payloads.push(parsedCandidate);
        }
        startIndex = -1;
      }
    }
  }

  return payloads;
}

export function tryParseJson(candidate: string): unknown | undefined {
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

export function selectProviderPayload(
  parsed: unknown,
  providerId: string,
): Record<string, unknown> | null {
  if (Array.isArray(parsed)) {
    const firstMatching = parsed.find((entry) =>
      isObjectRecord(entry) && asString(entry.provider)?.toLowerCase() === providerId.toLowerCase(),
    );
    return isObjectRecord(firstMatching) ? firstMatching : null;
  }

  if (!isObjectRecord(parsed)) {
    return null;
  }

  const parsedProviderId = asString(parsed.provider)?.toLowerCase();
  if (!parsedProviderId) {
    return null;
  }

  return parsedProviderId === providerId.toLowerCase() ? parsed : null;
}

export function mapParsedQuota(payload: Record<string, unknown>): {
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

export function parseCodexBarErrorMessage(
  payload: Record<string, unknown> | null,
): string | undefined {
  if (!payload) return undefined;
  const errorRaw = payload.error;
  if (isObjectRecord(errorRaw)) {
    return asString(errorRaw.message) ?? asString(errorRaw.kind);
  }
  return undefined;
}

export function mapUsageWindows(usageRaw: unknown): LocalUsageWindow[] {
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

export function mapWidgetSnapshotWindows(snapshotEntry: Record<string, unknown>): LocalUsageWindow[] {
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

export function resolveWidgetSnapshotPath(): string | null {
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

export function normalizeResetsAt(value: unknown): string | undefined {
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

export function unavailableInstallHintPayload(): CodexBarQuota {
  return {
    available: false,
    windows: [],
    message: "CodexBar is not installed on the gateway host.",
    installHint: codexBarInstallHint(),
  };
}

export function codexBarInstallHint(): LocalUsageInstallHint {
  return {
    command: "brew install steipete/tap/codexbar",
    docsUrl: "https://github.com/steipete/CodexBar",
  };
}

export function normalizeFailureMessage(
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

export function resolveAccountLabel(accountRaw: unknown): string | undefined {
  if (!isObjectRecord(accountRaw)) return undefined;
  const label = asString(accountRaw.label);
  const email = asString(accountRaw.email);
  const plan = asString(accountRaw.planType) ?? asString(accountRaw.plan);
  return [plan, label, email].filter((entry) => Boolean(entry)).join(" • ") || undefined;
}

export function extractNumeric(payload: unknown, key: string): number | undefined {
  if (!isObjectRecord(payload)) return undefined;
  const value = payload[key];
  return extractNumber(value);
}

export function normalizePercent(value: unknown): number | undefined {
  const numeric = extractNumber(value);
  if (numeric === undefined) return undefined;
  return Math.max(0, Math.min(100, numeric));
}

export function extractNumber(value: unknown): number | undefined {
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

export function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function isMissingBinaryError(error: Error): boolean {
  return (error as Error & { code?: unknown }).code === "ENOENT";
}

export function isTimeoutError(error: Error | undefined): boolean {
  return (error as Error & { code?: unknown } | undefined)?.code === "ETIMEDOUT";
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}
