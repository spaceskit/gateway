import type {
  AgentSecurityScope,
  CapabilityExecutionRoutingInput,
} from "@spaceskit/core";
import { SpaceWorkspaceService } from "./services/space-workspace-service.js";
import { isRecord, uniqueStrings } from "./state-utils.js";

export function collectFilesystemPathCandidatesByKeys(
  args: Record<string, unknown>,
  pathArgs: string[],
): string[] {
  const candidates: string[] = [];
  const pushCandidate = (value: unknown) => {
    if (typeof value !== "string") return;
    const normalized = value.trim();
    if (!normalized) return;
    candidates.push(normalized);
  };

  for (const key of pathArgs) {
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    for (const value of resolvePathArgValues(args, normalizedKey)) {
      pushCandidate(value);
    }
  }

  return uniqueStrings(candidates);
}

export function resolvePathArgValues(args: Record<string, unknown>, pathArg: string): unknown[] {
  const parts = pathArg.split(".").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (parts.length === 0) return [];

  const walk = (value: unknown, idx: number): unknown[] => {
    if (idx >= parts.length) return [value];
    if (!isRecord(value)) return [];
    const next = value[parts[idx]];
    if (Array.isArray(next)) {
      return next.flatMap((entry) => walk(entry, idx + 1));
    }
    return walk(next, idx + 1);
  };

  return walk(args, 0);
}

function clampFraction(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

export function evaluateSandboxSlo(input: {
  succeeded: number;
  failed: number;
  minSuccessRate: number;
  minSamples: number;
}): {
  samples: number;
  successRate: number;
  evaluated: boolean;
  meetsSlo: boolean;
} {
  const succeeded = Math.max(0, input.succeeded);
  const failed = Math.max(0, input.failed);
  const samples = succeeded + failed;
  const successRate = samples === 0 ? 1 : succeeded / samples;
  const evaluated = samples >= Math.max(1, input.minSamples);
  const meetsSlo = !evaluated || successRate >= clampFraction(input.minSuccessRate, 0.99);
  return {
    samples,
    successRate,
    evaluated,
    meetsSlo,
  };
}

export function resolveCapabilityOperationMetadata(
  capabilityRegistry: Record<string, unknown>,
  invocation: {
    capability: string;
    operation: string;
    args: Record<string, unknown>;
    targetProvider?: string;
  },
  spaceId?: string,
): {
  filesystemWrite: boolean;
  pathArgs: string[];
} {
  const fallback = {
    filesystemWrite:
      invocation.capability === "files" && isLikelyFilesystemWriteOperationName(invocation.operation),
    pathArgs: [
      "path",
      "filePath",
      "targetPath",
      "sourcePath",
      "destinationPath",
      "directory",
      "cwd",
    ],
  };

  const maybeResolver = capabilityRegistry.getOperationMetadata;
  if (typeof maybeResolver !== "function") {
    return fallback;
  }

  try {
    const resolved = maybeResolver.call(capabilityRegistry, invocation, spaceId);
    if (!isRecord(resolved)) {
      return fallback;
    }
    const pathArgs = Array.isArray(resolved.pathArgs)
      ? resolved.pathArgs.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : fallback.pathArgs;
    const filesystemWrite = typeof resolved.filesystemWrite === "boolean"
      ? resolved.filesystemWrite
      : fallback.filesystemWrite;
    return {
      filesystemWrite,
      pathArgs,
    };
  } catch {
    return fallback;
  }
}

export function resolveCapabilityExecutionRoute(
  input: CapabilityExecutionRoutingInput,
  options: {
    enforceSandboxRouting: boolean;
  },
): {
  backend: "host" | "sandbox";
  reason?: string;
} {
  const isFilesystemOperation = input.invocation.capability === "files";
  const requiresRiskyExecution = input.operationMetadata.requiresShell === true
    || isFilesystemOperation
    || input.operationMetadata.filesystemWrite === true;
  if (!requiresRiskyExecution) {
    return { backend: "host" };
  }
  if (!options.enforceSandboxRouting) {
    return { backend: "host" };
  }

  const isGuestOrigin = input.context?.executionOrigin === "guest";
  if (isGuestOrigin) {
    return {
      backend: "sandbox",
      reason: "guest_risky_operation_requires_sandbox",
    };
  }

  const isConnectorOrigin = input.context?.executionOrigin === "connector"
    || input.provider.source === "connector";
  if (isConnectorOrigin) {
    return {
      backend: "sandbox",
      reason: "connector_risky_operation_requires_sandbox",
    };
  }

  return { backend: "host" };
}

export function isLikelyFilesystemWriteOperationName(operationRaw: string): boolean {
  const operation = operationRaw.trim().toLowerCase();
  if (!operation) return false;
  return (
    operation.includes("write")
    || operation.includes("append")
    || operation.includes("create")
    || operation.includes("update")
    || operation.includes("save")
    || operation.includes("delete")
    || operation.includes("remove")
    || operation.includes("rename")
    || operation.includes("move")
    || operation.includes("mkdir")
    || operation.includes("touch")
    || operation.includes("copy")
  );
}

export function extractFilesystemScopes(scope: AgentSecurityScope | undefined): string[] {
  if (!scope) return [];
  const raw = scope.filesystemScopes?.length ? scope.filesystemScopes : [scope.filesystemScope];
  return raw.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

export function fileUriToFilesystemPath(uri: string): string | null {
  const normalized = uri.trim();
  if (!normalized) return null;
  if (normalized.startsWith("file://")) {
    try {
      const url = new URL(normalized);
      return decodeURIComponent(url.pathname);
    } catch {
      return null;
    }
  }
  return normalized;
}

export function firstPreferredModelFromConfig(raw: string | null | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as { preferredModels?: unknown };
    if (!Array.isArray(parsed.preferredModels)) return undefined;
    const first = parsed.preferredModels.find((entry): entry is string =>
      typeof entry === "string" && entry.trim().length > 0,
    );
    return first?.trim();
  } catch {
    return undefined;
  }
}

export function applyEffectiveSkillContext(
  systemPrompt: string,
  skillIds: string[],
  activeSkillMarkdownById?: Map<string, string>,
): string {
  const normalizedSkillIds = uniqueStrings(
    skillIds.map((skillId) => skillId.trim()).filter((skillId) => skillId.length > 0),
  );

  if (normalizedSkillIds.length === 0) {
    return systemPrompt;
  }

  // Sort skills: system/* first (platform knowledge), role/* second (persona knowledge), others last.
  normalizedSkillIds.sort((a, b) => skillSortKey(a) - skillSortKey(b));

  const resolvedSections: string[] = [];
  const unresolvedSkillIds: string[] = [];

  for (const skillId of normalizedSkillIds) {
    const markdown = activeSkillMarkdownById?.get(skillId)?.trim();
    if (markdown && markdown.length > 0) {
      resolvedSections.push(`## ${skillId}\n${markdown}`);
    } else {
      unresolvedSkillIds.push(skillId);
    }
  }

  const appendixParts: string[] = [];
  if (resolvedSections.length > 0) {
    appendixParts.push("Active skill context from gateway catalog:");
    appendixParts.push(...resolvedSections);
  }
  if (unresolvedSkillIds.length > 0) {
    appendixParts.push("Active skill IDs (content unavailable):");
    appendixParts.push(...unresolvedSkillIds.map((skillId) => `- ${skillId}`));
  }

  const appendix = appendixParts.join("\n\n");
  const trimmed = systemPrompt.trim();
  if (!trimmed) return appendix;
  return `${trimmed}\n\n${appendix}`;
}

export async function buildWorkspaceContextBlock(
  workspaceService: SpaceWorkspaceService,
  spaceId: string,
  agentId: string,
): Promise<string | undefined> {
  const workspace = await workspaceService.ensureWorkspace(spaceId);
  const scratchpadPath = await workspaceService.getAgentScratchpadPath(spaceId, agentId);
  const lines = [
    "Workspace context:",
    `- Workspace root: ${workspace.effectiveWorkspaceRoot}`,
    `- Work directory: ${workspace.workPath}`,
    `- Shared context directory: ${workspace.sharedContextPath}`,
    `- Your scratchpad file: ${scratchpadPath}`,
    "Rules:",
    "- Shared-context writes must target Markdown files (.md).",
    "- Scratchpad writes must target your own scratchpad file only.",
  ];
  return lines.join("\n");
}

export function appendWorkspaceContext(systemPrompt: string, workspaceContext?: string): string {
  const trimmedPrompt = systemPrompt.trim();
  const trimmedWorkspace = workspaceContext?.trim();
  if (!trimmedWorkspace) return trimmedPrompt;
  if (!trimmedPrompt) return trimmedWorkspace;
  return `${trimmedPrompt}\n\n${trimmedWorkspace}`;
}

/**
 * Append mission context (spawnContext) to the system prompt.
 * Layer 3 of the 5-layer prompt stack — per-space task-specific instructions.
 */
export function appendMissionContext(systemPrompt: string, spawnContext?: string | null): string {
  const trimmedPrompt = systemPrompt.trim();
  const trimmedMission = spawnContext?.trim();
  if (!trimmedMission) return trimmedPrompt;
  const block = `Mission context:\n${trimmedMission}`;
  if (!trimmedPrompt) return block;
  return `${trimmedPrompt}\n\n${block}`;
}

const TOOL_USAGE_GUIDANCE_MARKER = "Tool execution guidance:";

export function appendToolUsageGuidance(systemPrompt: string): string {
  const trimmedPrompt = systemPrompt.trim();
  if (trimmedPrompt.includes(TOOL_USAGE_GUIDANCE_MARKER)) {
    return trimmedPrompt;
  }

  const guidance = [
    TOOL_USAGE_GUIDANCE_MARKER,
    "- If a user asks for external or system data (for example reminders, files, calendar, network, or shell output), use relevant tools/capabilities when available.",
    "- Do not claim you lack access until you check or attempt relevant tools.",
    "- If no relevant tools are available, state that clearly and name the missing capability/tool.",
  ].join("\n");

  if (!trimmedPrompt) {
    return guidance;
  }
  return `${trimmedPrompt}\n\n${guidance}`;
}

/** Skill sort key: system/* = 0, role/* = 1, everything else = 2. */
function skillSortKey(skillId: string): number {
  if (skillId.startsWith("system/")) return 0;
  if (skillId.startsWith("role/")) return 1;
  return 2;
}

export function appendNativeCliToolUsageGuidance(systemPrompt: string, providerId: string): string {
  const trimmedPrompt = systemPrompt.trim();
  const guidance = [
    "Native executor tooling guidance:",
    `- You are running through the ${providerId} native CLI executor.`,
    "- Use the selected workspace as your execution root when invoking native executor tools.",
    "- Spaces gateway connectors/tools are not available on this execution path.",
    "- If you use native executor tools, say so plainly in the response when it matters to the outcome.",
  ].join("\n");

  if (!trimmedPrompt) {
    return guidance;
  }
  return `${trimmedPrompt}\n\n${guidance}`;
}
