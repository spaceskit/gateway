/**
 * Model Capability Registry — resolves runtime capabilities for a given
 * provider/model combination so prompt composition, context-window middleware,
 * and execution adapters can adapt their behavior.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PromptBudgetClass = "full" | "compact" | "minimal";
export type RuntimeExecutionClass = "cloud" | "executor" | "local_runtime";
export type RuntimeAccessModeStrategy = "gateway_owned" | "executor_cli";

export interface ModelCapabilities {
  /** Estimated context window in tokens. */
  contextWindow: number;
  /** How tools are invoked: native function-calling, gateway-mediated, or none. */
  toolSupportMode: "native" | "mediated" | "none";
  /** Whether the provider supports streaming token output. */
  supportsStreaming: boolean;
  /** Whether the provider can surface observable activity/progress beyond plain text. */
  supportsActivityStreaming: boolean;
  /** Whether the provider exposes public reasoning summaries/deltas. */
  supportsPublicReasoning: boolean;
  /** Whether the provider supports native extended thinking (Anthropic thinking, Gemini thinking_config). */
  supportsThinking: boolean;
  /** Whether the provider supports reasoning effort control (OpenAI o-series reasoning_effort). */
  supportsReasoningEffort: boolean;
  /** Gateway runtime class for capability/access behavior. */
  executionClass: RuntimeExecutionClass;
  /** Whether access-mode mapping is gateway-owned or mapped onto a native executor CLI. */
  accessModeStrategy: RuntimeAccessModeStrategy;
  /** Determines how much prompt content to include. */
  promptBudgetClass: PromptBudgetClass;
  /** True for CLI-based execution providers (claude, codex, gemini). */
  isCliExecutor: boolean;
}

// ---------------------------------------------------------------------------
// Provider defaults
// ---------------------------------------------------------------------------

const CLI_EXECUTOR_PROVIDERS = new Set(["claude", "codex", "gemini"]);

interface ProviderDefaults {
  contextWindow: number;
  toolSupportMode: "native" | "mediated" | "none";
  supportsStreaming: boolean;
  supportsActivityStreaming: boolean;
  supportsPublicReasoning: boolean;
  supportsThinking: boolean;
  supportsReasoningEffort: boolean;
  executionClass: RuntimeExecutionClass;
  accessModeStrategy: RuntimeAccessModeStrategy;
  isCliExecutor: boolean;
}

const PROVIDER_DEFAULTS: Record<string, ProviderDefaults> = {
  anthropic: { contextWindow: 200_000, toolSupportMode: "native", supportsStreaming: true, supportsActivityStreaming: false, supportsPublicReasoning: false, supportsThinking: true, supportsReasoningEffort: false, executionClass: "cloud", accessModeStrategy: "gateway_owned", isCliExecutor: false },
  openai: { contextWindow: 128_000, toolSupportMode: "native", supportsStreaming: true, supportsActivityStreaming: false, supportsPublicReasoning: false, supportsThinking: false, supportsReasoningEffort: true, executionClass: "cloud", accessModeStrategy: "gateway_owned", isCliExecutor: false },
  openrouter: { contextWindow: 128_000, toolSupportMode: "native", supportsStreaming: true, supportsActivityStreaming: false, supportsPublicReasoning: false, supportsThinking: false, supportsReasoningEffort: false, executionClass: "cloud", accessModeStrategy: "gateway_owned", isCliExecutor: false },
  groq: { contextWindow: 128_000, toolSupportMode: "native", supportsStreaming: true, supportsActivityStreaming: false, supportsPublicReasoning: false, supportsThinking: false, supportsReasoningEffort: false, executionClass: "cloud", accessModeStrategy: "gateway_owned", isCliExecutor: false },
  together: { contextWindow: 128_000, toolSupportMode: "native", supportsStreaming: true, supportsActivityStreaming: false, supportsPublicReasoning: false, supportsThinking: false, supportsReasoningEffort: false, executionClass: "cloud", accessModeStrategy: "gateway_owned", isCliExecutor: false },
  mistral: { contextWindow: 128_000, toolSupportMode: "native", supportsStreaming: true, supportsActivityStreaming: false, supportsPublicReasoning: false, supportsThinking: false, supportsReasoningEffort: false, executionClass: "cloud", accessModeStrategy: "gateway_owned", isCliExecutor: false },
  ollama: { contextWindow: 8_192, toolSupportMode: "native", supportsStreaming: true, supportsActivityStreaming: false, supportsPublicReasoning: false, supportsThinking: false, supportsReasoningEffort: false, executionClass: "local_runtime", accessModeStrategy: "gateway_owned", isCliExecutor: false },
  lmstudio: { contextWindow: 32_768, toolSupportMode: "native", supportsStreaming: true, supportsActivityStreaming: false, supportsPublicReasoning: false, supportsThinking: false, supportsReasoningEffort: false, executionClass: "local_runtime", accessModeStrategy: "gateway_owned", isCliExecutor: false },
  apple: { contextWindow: 4_096, toolSupportMode: "native", supportsStreaming: true, supportsActivityStreaming: false, supportsPublicReasoning: false, supportsThinking: false, supportsReasoningEffort: false, executionClass: "local_runtime", accessModeStrategy: "gateway_owned", isCliExecutor: false },
  "claude-agent-sdk": { contextWindow: 200_000, toolSupportMode: "mediated", supportsStreaming: true, supportsActivityStreaming: true, supportsPublicReasoning: true, supportsThinking: true, supportsReasoningEffort: false, executionClass: "executor", accessModeStrategy: "executor_cli", isCliExecutor: false },
  "codex-app-server": { contextWindow: 200_000, toolSupportMode: "mediated", supportsStreaming: true, supportsActivityStreaming: true, supportsPublicReasoning: true, supportsThinking: false, supportsReasoningEffort: true, executionClass: "executor", accessModeStrategy: "executor_cli", isCliExecutor: false },
  claude: { contextWindow: 200_000, toolSupportMode: "mediated", supportsStreaming: true, supportsActivityStreaming: true, supportsPublicReasoning: true, supportsThinking: true, supportsReasoningEffort: false, executionClass: "executor", accessModeStrategy: "executor_cli", isCliExecutor: true },
  codex: { contextWindow: 200_000, toolSupportMode: "mediated", supportsStreaming: true, supportsActivityStreaming: true, supportsPublicReasoning: true, supportsThinking: false, supportsReasoningEffort: true, executionClass: "executor", accessModeStrategy: "executor_cli", isCliExecutor: true },
  gemini: { contextWindow: 200_000, toolSupportMode: "mediated", supportsStreaming: true, supportsActivityStreaming: true, supportsPublicReasoning: false, supportsThinking: true, supportsReasoningEffort: false, executionClass: "executor", accessModeStrategy: "executor_cli", isCliExecutor: true },
};

// ---------------------------------------------------------------------------
// Per-model context window overrides
// ---------------------------------------------------------------------------

// -- Managed by dev-services/scripts/refresh-model-context-windows.ts --
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic — 1M-capable models
  "claude-sonnet-4-20250514": 1_000_000,
  "claude-sonnet-4": 1_000_000,
  "claude-opus-4-20250514": 1_000_000,
  "claude-opus-4": 1_000_000,
  "claude-opus-4-6": 1_000_000,
  "claude-4-5-sonnet": 1_000_000,
  // Anthropic — 200k models
  "claude-3-5-sonnet-20241022": 200_000,
  "claude-3-5-haiku-20241022": 200_000,
  "claude-3-opus-20240229": 200_000,
  "claude-3-haiku-20240307": 200_000,
  // OpenAI / Codex — GPT-5 family (1M context)
  "gpt-5.2-codex": 1_048_576,
  "gpt-5.2-codex-max": 1_048_576,
  "gpt-5.2-codex-mini": 1_048_576,
  "gpt-5.1-codex": 1_048_576,
  "gpt-5.1-codex-max": 1_048_576,
  "gpt-5.1-codex-mini": 1_048_576,
  "gpt-5.2": 1_048_576,
  "gpt-5.1": 1_048_576,
  "gpt-5-codex": 1_048_576,
  "gpt-5": 1_048_576,
  // Gemini — 1M context models
  "gemini-3-pro-preview": 1_000_000,
  "gemini-3-flash-preview": 1_000_000,
  "gemini-2.5-pro": 1_000_000,
  "gemini-2.5-flash": 1_000_000,
};

const FALLBACK_DEFAULTS: ProviderDefaults = {
  contextWindow: 128_000,
  toolSupportMode: "native",
  supportsStreaming: true,
  supportsActivityStreaming: false,
  supportsPublicReasoning: false,
  supportsThinking: false,
  supportsReasoningEffort: false,
  executionClass: "cloud",
  accessModeStrategy: "gateway_owned",
  isCliExecutor: false,
};

// ---------------------------------------------------------------------------
// Budget class derivation
// ---------------------------------------------------------------------------

function deriveBudgetClass(contextWindow: number, isCliExecutor: boolean): PromptBudgetClass {
  // CLI executors always get full prompts (different composition, but full budget)
  if (isCliExecutor) return "full";
  if (contextWindow >= 32_000) return "full";
  if (contextWindow >= 8_000) return "compact";
  return "minimal";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the runtime capabilities for a provider/model combination.
 *
 * @param providerId - The provider identifier (e.g. "anthropic", "ollama", "apple")
 * @param modelId - Optional model identifier (currently unused but reserved for
 *   per-model overrides when model families have different context windows)
 * @param contextWindowOverride - Explicit context window from catalog discovery
 *   or user configuration; takes precedence over provider defaults.
 */
export function resolveModelCapabilities(
  providerId: string,
  modelId?: string,
  contextWindowOverride?: number,
): ModelCapabilities {
  const normalized = providerId.trim().toLowerCase();
  const defaults = PROVIDER_DEFAULTS[normalized] ?? FALLBACK_DEFAULTS;
  const isCliExecutor = CLI_EXECUTOR_PROVIDERS.has(normalized);

  const contextWindow =
    contextWindowOverride !== undefined && Number.isFinite(contextWindowOverride) && contextWindowOverride > 0
      ? contextWindowOverride
      : (modelId ? MODEL_CONTEXT_WINDOWS[modelId.trim().toLowerCase()] : undefined)
        ?? defaults.contextWindow;

  return {
    contextWindow,
    toolSupportMode: defaults.toolSupportMode,
    supportsStreaming: defaults.supportsStreaming,
    supportsActivityStreaming: defaults.supportsActivityStreaming,
    supportsPublicReasoning: defaults.supportsPublicReasoning,
    supportsThinking: defaults.supportsThinking,
    supportsReasoningEffort: defaults.supportsReasoningEffort,
    executionClass: defaults.executionClass,
    accessModeStrategy: defaults.accessModeStrategy,
    promptBudgetClass: deriveBudgetClass(contextWindow, isCliExecutor),
    isCliExecutor,
  };
}

/**
 * Conservative context-window inference for provider catalog entries.
 *
 * Only returns a value for providers where we are confident about the
 * context window across all their models. For providers with model-level
 * discovery (openai, ollama, lmstudio, etc.) we return undefined so the
 * discovery-provided value takes precedence.
 */
const STATIC_CONTEXT_WINDOW_PROVIDERS: Record<string, number> = {
  apple: 4_096,
  "claude-agent-sdk": 200_000,
  "codex-app-server": 200_000,
  claude: 200_000,
  codex: 200_000,
  gemini: 200_000,
};

export function inferContextWindow(providerId: string, modelId?: string): number | undefined {
  const normalized = providerId.trim().toLowerCase();
  if (!normalized) return undefined;
  // Model-specific override takes precedence — strip provider prefix if present
  if (modelId) {
    const trimmed = modelId.trim().toLowerCase();
    const modelContext = MODEL_CONTEXT_WINDOWS[trimmed]
      ?? MODEL_CONTEXT_WINDOWS[trimmed.replace(/^[^/]+\//, "")];
    if (modelContext !== undefined) return modelContext;
  }
  return STATIC_CONTEXT_WINDOW_PROVIDERS[normalized];
}
