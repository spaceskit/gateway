import type { GenerateOptions, GenerateResult } from "./model-provider.js";
import type { AgentConfig, TurnContext } from "./agent-runtime.js";

function isCliExecutorProvider(providerId: string): boolean {
  return providerId === "claude" || providerId === "codex" || providerId === "gemini";
}

export function resolveTurnAccessMode(
  requested: GenerateOptions["accessMode"] | TurnContext["accessMode"] | AgentConfig["accessMode"],
  configured: AgentConfig["accessMode"],
  providerId: string,
  legacyNativeCliToolsEnabled?: boolean,
): GenerateOptions["accessMode"] {
  if (requested === "default" || requested === "full_access") {
    return requested;
  }
  if (configured === "default" || configured === "full_access") {
    return configured;
  }
  if (legacyNativeCliToolsEnabled && isCliExecutorProvider(providerId)) {
    return "full_access";
  }
  return "default";
}

export function isNativeCliToolsMode(
  providerId: string,
  accessMode?: GenerateOptions["accessMode"],
  legacyNativeCliToolsEnabled?: boolean,
): boolean {
  if (!isCliExecutorProvider(providerId)) return false;
  // full_access CLI turns use the native tool path (executor manages its own tools)
  if (accessMode === "full_access") return true;
  // default-mode CLI turns use the mediated path — gateway tools injected as text
  if (accessMode === "default") return false;
  return legacyNativeCliToolsEnabled === true;
}

export function decorateNativeCliToolsResult(
  result: GenerateResult,
  _providerId: string,
  _modelId: string,
): GenerateResult {
  // No longer prepend a misleading notice — the CLI executor manages its own
  // tools natively. The previous "Spaces gateway connectors were not available"
  // notice was confusing since the CLI does have tools; they just come from its
  // own runtime rather than the gateway's capability registry.
  return result;
}

export function buildCliExecutorAccessModeGuidance(
  providerId: string,
  accessMode: GenerateOptions["accessMode"],
  options: { isMediated?: boolean } = {},
): string | undefined {
  if (!isCliExecutorProvider(providerId)) {
    return undefined;
  }

  const executor = providerId.trim() || "selected executor";
  if (accessMode === "full_access") {
    return `[[SPACESKIT_EXECUTOR_ACCESS_MODE_V1]]
This turn is running in FULL ACCESS mode for the ${executor} executor.
- You may use the executor's native tools within the selected workspace when they are available.
- Approval bypass is enabled — you may execute actions without requiring human confirmation.
- Prefer visible tool progress over vague claims of hidden work.
- Keep file and system actions scoped to the active workspace.`;
  }

  if (providerId === "gemini" && options.isMediated) {
    return `[[SPACESKIT_EXECUTOR_ACCESS_MODE_V1]]
This turn is running in DEFAULT access mode for the ${executor} executor.
- Native Gemini CLI tools are not available in this turn.
- Request gateway tools only with fenced \`tool_call\` blocks.
- Do not use Gemini CLI native tools or shell/file modification actions in this mode.
- If native Gemini CLI tools are needed, ask the user to switch to Full Access mode.`;
  }

  return `[[SPACESKIT_EXECUTOR_ACCESS_MODE_V1]]
This turn is running in DEFAULT access mode for the ${executor} executor.
- Safe read-only tools are available (Read, Glob, Grep, WebSearch, WebFetch).
- Do not use tools that modify files or run shell commands in this mode.
- If modifications are needed, ask the user to switch to Full Access mode.`;
}
