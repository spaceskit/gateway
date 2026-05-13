/**
 * Filesystem/shell scope evaluation helpers for DefaultToolExecutor.
 *
 * Extracted from `default-tool-executor.ts` to keep permission/scope
 * enforcement logic isolated from routing/execution. Behavior is unchanged —
 * these helpers are the same functions previously defined inline.
 */

import { resolve as resolvePath, sep as pathSep } from "node:path";
import type { ToolCall } from "./model-provider.js";
import type { CapabilityOperationMetadata } from "../capabilities/types.js";
import type { AgentSecurityScope } from "../security/types.js";

export function evaluateFilesystemScope(
  toolCall: ToolCall,
  scope: AgentSecurityScope,
  operationMetadata?: CapabilityOperationMetadata,
): string | null {
  const [capType] = toolCall.name.split(".");
  if (capType !== "filesystem" && capType !== "files") return null;

  const targetPath = extractToolPath(
    toolCall.arguments,
    operationMetadata?.pathArgs,
  );
  if (!targetPath) return null;

  const scopes = normalizeFilesystemScopes(scope);
  if (scopes.length === 0) {
    return "Filesystem access denied: no scope configured";
  }

  if (scopes.includes("/")) {
    return null;
  }

  const normalizedTarget = normalizePathValue(targetPath);
  const allowed = scopes.some((entry) => isWithinScope(normalizedTarget, entry));
  if (!allowed) {
    return `Filesystem access denied: ${targetPath} is outside agent scope`;
  }

  return null;
}

function extractToolPath(args: Record<string, unknown>, pathArgs?: string[]): string | null {
  const candidates = pathArgs && pathArgs.length > 0
    ? pathArgs
    : ["path", "filePath", "targetPath", "directory", "cwd"];
  for (const key of candidates) {
    const value = args[key];
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return null;
}

export function extractShellCommand(
  args: Record<string, unknown>,
  operationMetadata: CapabilityOperationMetadata,
): string | undefined {
  const keys = operationMetadata.commandArgs?.length
    ? operationMetadata.commandArgs
    : ["command", "cmd", "script", "program"];
  for (const key of keys) {
    const value = args[key];
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized.length > 0) return normalized;
  }
  return undefined;
}

export function matchesCommandAllowRule(command: string, ruleRaw: string): boolean {
  const rule = ruleRaw.trim();
  if (!rule) return false;
  if (rule === "*") return true;
  if (rule.endsWith("*")) {
    const prefix = rule.slice(0, -1);
    return command.startsWith(prefix);
  }
  return command === rule;
}

function normalizeFilesystemScopes(scope: AgentSecurityScope): string[] {
  const raw = scope.filesystemScopes?.length
    ? scope.filesystemScopes
    : [scope.filesystemScope];
  return Array.from(
    new Set(
      raw
        .map((entry) => normalizePathValue(entry))
        .filter((entry) => entry.length > 0),
    ),
  );
}

function normalizePathValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("file://")) {
    try {
      const url = new URL(trimmed);
      return resolvePath(decodeURIComponent(url.pathname));
    } catch {
      return "";
    }
  }

  return resolvePath(trimmed);
}

function isWithinScope(targetPath: string, scopePath: string): boolean {
  if (!scopePath) return false;
  if (targetPath === scopePath) return true;
  return targetPath.startsWith(`${scopePath}${pathSep}`);
}
