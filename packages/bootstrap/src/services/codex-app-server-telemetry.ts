import { spawn } from "node:child_process";
import type { ProviderTelemetryWindowPayload } from "@spaceskit/server";
import {
  asInteger,
  asIsoFromEpochSeconds,
  asString,
  isObjectRecord,
  normalizePercentage,
} from "../gateway-admin-value-normalizers.js";

export interface CodexAppServerTelemetryResult {
  rateLimits?: unknown;
  account?: unknown;
  error?: string;
}

export function normalizeCodexTelemetryWindows(
  rateLimitsPayload: Record<string, unknown> | null,
): ProviderTelemetryWindowPayload[] {
  if (!rateLimitsPayload) {
    return [];
  }

  const entryByScopeId = new Map<string, Record<string, unknown>>();
  const pushEntry = (entryRaw: unknown) => {
    if (!isObjectRecord(entryRaw)) return;
    const scopeId = asString(entryRaw.limitId) || "codex";
    entryByScopeId.set(scopeId, entryRaw);
  };

  pushEntry(rateLimitsPayload.rateLimits);

  const byLimitId = rateLimitsPayload.rateLimitsByLimitId;
  if (isObjectRecord(byLimitId)) {
    for (const value of Object.values(byLimitId)) {
      pushEntry(value);
    }
  }

  const windows: ProviderTelemetryWindowPayload[] = [];
  for (const [scopeId, entry] of entryByScopeId.entries()) {
    const scopeName = asString(entry.limitName) || undefined;
    windows.push(...codexWindowEntries(scopeId, scopeName, entry));
  }

  return windows.sort((lhs, rhs) => {
    if (lhs.scopeId !== rhs.scopeId) {
      return lhs.scopeId.localeCompare(rhs.scopeId);
    }
    if (lhs.window === rhs.window) return 0;
    return lhs.window === "primary" ? -1 : 1;
  });
}

function codexWindowEntries(
  scopeId: string,
  scopeName: string | undefined,
  entry: Record<string, unknown>,
): ProviderTelemetryWindowPayload[] {
  const windows: ProviderTelemetryWindowPayload[] = [];

  for (const key of ["primary", "secondary"] as const) {
    const payload = entry[key];
    if (!isObjectRecord(payload)) {
      continue;
    }

    const usedPercent = normalizePercentage(payload.usedPercent);
    const windowDurationMins = asInteger(payload.windowDurationMins);
    const resetsAt = asIsoFromEpochSeconds(payload.resetsAt);

    windows.push({
      scopeId,
      scopeName,
      window: key,
      usedPercent,
      remainingPercent: usedPercent !== undefined
        ? Math.max(0, Math.min(100, 100 - usedPercent))
        : undefined,
      resetsAt,
      windowDurationMins,
    });
  }

  return windows;
}

export async function queryCodexAppServerTelemetry(
  executablePath: string,
): Promise<CodexAppServerTelemetryResult> {
  return new Promise((resolve) => {
    const child = spawn(executablePath, ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let settled = false;
    let initialized = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let rateLimits: unknown;
    let account: unknown;
    let rateLimitsDone = false;
    let accountDone = false;
    let errorMessage: string | undefined;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const finish = (result: CodexAppServerTelemetryResult) => {
      if (settled) return;
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      if (!child.killed) {
        child.kill("SIGTERM");
      }
      resolve(result);
    };

    const send = (message: Record<string, unknown>) => {
      if (settled) return;
      if (!child.stdin.writable) return;
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const parseLine = (line: string) => {
      if (!line) return;

      let payload: unknown;
      try {
        payload = JSON.parse(line);
      } catch {
        return;
      }

      if (!isObjectRecord(payload)) {
        return;
      }

      const id = asInteger(payload.id);
      if (id === 1 && !initialized) {
        initialized = true;
        send({ jsonrpc: "2.0", method: "initialized" });
        send({ jsonrpc: "2.0", id: 2, method: "account/rateLimits/read", params: {} });
        send({ jsonrpc: "2.0", id: 3, method: "account/read", params: { refreshToken: false } });
        return;
      }

      if (id === 2) {
        if (payload.result !== undefined) {
          rateLimits = payload.result;
        } else if (isObjectRecord(payload.error)) {
          errorMessage = asString(payload.error.message) || "Codex rate-limit request failed.";
        }
        rateLimitsDone = true;
      } else if (id === 3) {
        if (payload.result !== undefined) {
          account = payload.result;
        } else if (isObjectRecord(payload.error)) {
          errorMessage = asString(payload.error.message) || "Codex account request failed.";
        }
        accountDone = true;
      }

      if (rateLimitsDone && accountDone) {
        finish({
          rateLimits,
          account,
          error: errorMessage,
        });
      }
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString();
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        parseLine(line);
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrBuffer += chunk.toString();
    });

    child.on("error", (err) => {
      finish({
        rateLimits,
        account,
        error: err.message || "Failed to start Codex app-server.",
      });
    });

    child.on("exit", (code, signal) => {
      if (settled) return;
      const normalizedStderr = stderrBuffer.trim();
      finish({
        rateLimits,
        account,
        error: errorMessage
          || normalizedStderr
          || `Codex app-server exited before telemetry completed (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
      });
    });

    timeout = setTimeout(() => {
      finish({
        rateLimits,
        account,
        error: errorMessage || "Timed out waiting for Codex app-server telemetry.",
      });
    }, 4_500);

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "spaces-gateway",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: true,
        },
      },
    });
  });
}
