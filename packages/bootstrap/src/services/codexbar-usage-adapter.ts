import type { SpawnSyncReturns } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Logger } from "@spaceskit/observability";
import type { CodexBarQuota } from "./local-usage-telemetry-types.js";
import {
  asString,
  buildUsageArgs,
  defaultRunCommand,
  extractNumber,
  firstDefined,
  isMissingBinaryError,
  isObjectRecord,
  isTimeoutError,
  mapParsedQuota,
  mapWidgetSnapshotWindows,
  normalizeFailureMessage,
  parseCodexBarErrorMessage,
  parseCodexBarResponse,
  resolveSourceAttempts,
  resolveWidgetSnapshotPath,
  unavailableInstallHintPayload,
} from "./codexbar-usage-adapter-helpers.js";

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
    const allowCommandProbe = options.allowCommandProbe !== false;
    if (!allowCommandProbe) {
      if (this.enableWidgetSnapshot) {
        const snapshotQuota = this.readSnapshotQuota(providerId);
        if (snapshotQuota?.windows.length) {
          return snapshotQuota;
        }
      }
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
        payload ? normalizeFailureMessage(result.stderr, "", result.error) : undefined,
        payload ? undefined : normalizeFailureMessage(result.stderr, result.stdout, result.error),
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

    if (this.enableWidgetSnapshot) {
      const snapshotQuota = this.readSnapshotQuota(providerId);
      if (snapshotQuota?.windows.length) {
        return snapshotQuota;
      }
    }

    return {
      available: false,
      sourceLabel: fallbackQuota?.sourceLabel,
      windows: fallbackQuota?.windows ?? [],
      creditsRemaining: fallbackQuota?.creditsRemaining,
      accountLabel: fallbackQuota?.accountLabel,
      updatedAt: fallbackQuota?.updatedAt,
      message: fallbackMessage ?? "Not available for provider.",
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
