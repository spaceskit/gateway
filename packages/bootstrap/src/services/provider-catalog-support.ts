import type {
  GatewayProviderAuthModePayload as GatewayProviderAuthMode,
  GatewayProviderAuthStatusPayload as GatewayProviderAuthStatus,
} from "@spaceskit/server";

export const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  apple: "apple/apple-on-device",
  anthropic: "anthropic/claude-sonnet-4-5",
  "claude-agent-sdk": "claude-agent-sdk/claude-sonnet-4-5",
  claude: "claude/sonnet",
  "codex-app-server": "codex-app-server/gpt-5.4",
  codex: "codex/gpt-5.1-codex",
  gemini: "gemini/gemini-2.5-flash",
  lmstudio: "lmstudio/qwen2.5-coder",
  ollama: "ollama/qwen2.5-coder",
  openrouter: "openrouter/openai/gpt-4.1-mini",
  groq: "groq/llama-3.3-70b-versatile",
  together: "together/meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
  mistral: "mistral/mistral-large-latest",
  openai: "openai/gpt-4.1",
};

export const LOCAL_PROVIDER_MODEL_MANIFEST: Record<string, string[]> = {
  apple: [
    "apple/apple-on-device",
  ],
  anthropic: [
    "anthropic/claude-sonnet-4-5",
    "anthropic/claude-opus-4-5",
    "anthropic/claude-haiku-4-5",
  ],
  "claude-agent-sdk": [
    "claude-agent-sdk/claude-sonnet-4-6",
    "claude-agent-sdk/claude-opus-4-6",
    "claude-agent-sdk/claude-haiku-4-5",
    "claude-agent-sdk/claude-sonnet-4-5",
  ],
  "codex-app-server": [
    "codex-app-server/gpt-5.4",
    "codex-app-server/gpt-5.4-mini",
    "codex-app-server/gpt-5.3-codex",
    "codex-app-server/gpt-5.3-codex-spark",
    "codex-app-server/gpt-5.2",
  ],
  claude: [
    "claude/sonnet",
    "claude/opus",
    "claude/haiku",
  ],
  codex: [
    "codex/gpt-5.2-codex",
    "codex/gpt-5.2-codex-max",
    "codex/gpt-5.2-codex-mini",
    "codex/gpt-5.1-codex",
    "codex/gpt-5.1-codex-max",
    "codex/gpt-5.1-codex-mini",
    "codex/gpt-5.2",
    "codex/gpt-5.1",
    "codex/gpt-5-codex",
    "codex/gpt-5",
  ],
  gemini: [
    "gemini/gemini-3-pro-preview",
    "gemini/gemini-3-flash-preview",
    "gemini/gemini-2.5-pro",
    "gemini/gemini-2.5-flash",
  ],
  lmstudio: [],
  ollama: [],
};

export const API_KEY_ENV_BY_PROVIDER: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  "claude-agent-sdk": "ANTHROPIC_API_KEY",
  "codex-app-server": "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
  together: "TOGETHER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  openai: "OPENAI_API_KEY",
};

export const OPENAI_BASE_URL_ENV = "OPENAI_BASE_URL";
export const LMSTUDIO_BASE_URL_ENV = "LMSTUDIO_BASE_URL";
export const OLLAMA_BASE_URL_ENV = "OLLAMA_BASE_URL";

export const LOCAL_PROVIDER_IDS = new Set(["apple", "claude", "codex", "gemini", "lmstudio", "ollama"]);
const OPENAI_COMPATIBLE_PROVIDER_IDS = new Set([
  "openai",
  "lmstudio",
  "ollama",
  "openrouter",
  "groq",
  "together",
  "mistral",
]);

const PROVIDER_AUTH_MODES: Partial<Record<string, GatewayProviderAuthMode[]>> = {
  anthropic: ["api_key"],
  "claude-agent-sdk": ["api_key", "host_login"],
  "codex-app-server": ["host_login", "api_key"],
  openai: ["api_key"],
  openrouter: ["api_key"],
  groq: ["api_key"],
  together: ["api_key"],
  mistral: ["api_key"],
};

export function providerDisplayName(providerId: string): string {
  switch (providerId) {
    case "apple":
      return "Apple Foundation";
    case "anthropic":
      return "Anthropic";
    case "claude-agent-sdk":
      return "Claude Agent SDK";
    case "codex-app-server":
      return "Codex App Server";
    case "openai":
      return "OpenAI";
    case "openrouter":
      return "OpenRouter";
    case "groq":
      return "Groq";
    case "together":
      return "Together";
    case "mistral":
      return "Mistral";
    case "claude":
      return "Claude Code";
    case "codex":
      return "Codex CLI";
    case "gemini":
      return "Gemini CLI";
    case "lmstudio":
      return "LM Studio";
    case "ollama":
      return "Ollama";
    default:
      return providerId;
  }
}

export function providerRequiresApiKey(
  providerId: string,
  baseURL?: string,
  authMode?: GatewayProviderAuthMode,
): boolean {
  if (isLocalProvider(providerId)) {
    return false;
  }
  if (providerId === "claude-agent-sdk") {
    return authMode !== "host_login";
  }
  if (providerId === "codex-app-server") {
    return authMode === "api_key";
  }
  if (providerId === "openai") {
    return !isLikelyLocalBaseURL(baseURL);
  }
  return true;
}

export function providerInstallHint(providerId: string): string | undefined {
  switch (providerId) {
    case "apple":
      return "Runs on-device on Apple Silicon Macs with Apple Intelligence enabled.";
    case "anthropic":
      return "Add ANTHROPIC_API_KEY or configure a runtime key for direct Anthropic API access.";
    case "claude-agent-sdk":
      return "Use ANTHROPIC_API_KEY for direct SDK API access, or sign in with Claude on this gateway host to use a local subscription session.";
    case "codex-app-server":
      return "Install Codex CLI, then either sign in with ChatGPT on this gateway host or provide OPENAI_API_KEY for App Server sessions.";
    case "claude":
      return "Install Claude Code and sign in locally.";
    case "codex":
      return "Install Codex CLI and sign in locally.";
    case "gemini":
      return "Install Gemini CLI and sign in locally.";
    case "lmstudio":
      return "Install LM Studio, start the local server, and load at least one model.";
    case "ollama":
      return "Install Ollama, start the daemon, and pull at least one model.";
    case "openrouter":
      return "Add OPENROUTER_API_KEY or configure a runtime key.";
    case "groq":
      return "Add GROQ_API_KEY or configure a runtime key.";
    case "together":
      return "Add TOGETHER_API_KEY or configure a runtime key.";
    case "mistral":
      return "Add MISTRAL_API_KEY or configure a runtime key.";
    case "openai":
      return "Add OPENAI_API_KEY or configure a runtime key.";
    default:
      return undefined;
  }
}

export function providerSupportedAuthModes(providerId: string): GatewayProviderAuthMode[] {
  return [...(PROVIDER_AUTH_MODES[providerId] ?? [])];
}

export function resolveProviderAuthMode(
  providerId: string,
  preferred?: GatewayProviderAuthMode,
): GatewayProviderAuthMode | undefined {
  const supported = providerSupportedAuthModes(providerId);
  if (supported.length === 0) {
    return undefined;
  }
  if (preferred && supported.includes(preferred)) {
    return preferred;
  }
  return supported[0];
}

export function resolveRequestedProviderAuthMode(
  providerId: string,
  requested?: GatewayProviderAuthMode,
  existing?: GatewayProviderAuthMode,
): GatewayProviderAuthMode | undefined {
  const supported = providerSupportedAuthModes(providerId);
  if (supported.length === 0) {
    if (requested) {
      throw new Error(`Provider ${providerId} does not support configurable authentication modes.`);
    }
    return undefined;
  }
  if (!requested) {
    return resolveProviderAuthMode(providerId, existing);
  }
  if (!supported.includes(requested)) {
    throw new Error(`Provider ${providerId} does not support auth mode ${requested}.`);
  }
  return requested;
}

export function normalizeProviderAuthMode(value?: string | null): GatewayProviderAuthMode | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "api_key" || normalized === "host_login") {
    return normalized;
  }
  return undefined;
}

export function inferDefaultProviderAuthStatus(
  providerId: string,
  authMode: GatewayProviderAuthMode | undefined,
  hasApiKey: boolean,
): GatewayProviderAuthStatus | undefined {
  if (authMode === "host_login" && (providerId === "claude-agent-sdk" || providerId === "codex-app-server")) {
    return "needs_auth";
  }
  if (authMode === "api_key") {
    return hasApiKey ? "authenticated" : "needs_key";
  }
  return undefined;
}

export function providerRecommended(providerId: string): boolean {
  if (providerId === "apple" || providerId === "codex-app-server") {
    return true;
  }
  return providerId === "openrouter"
    || providerId === "codex"
    || providerId === "lmstudio";
}

export function isCliExecutorProvider(providerId: string): boolean {
  return providerId === "claude" || providerId === "codex" || providerId === "gemini";
}

export function isLocalProvider(providerId: string): boolean {
  return LOCAL_PROVIDER_IDS.has(providerId);
}

export function isOpenAICompatibleProvider(providerId: string): boolean {
  return OPENAI_COMPATIBLE_PROVIDER_IDS.has(providerId);
}

export function isLikelyLocalBaseURL(baseURL?: string): boolean {
  if (!baseURL) return false;
  try {
    const url = new URL(baseURL);
    const host = url.hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

export function keyFromEnvironment(providerId: string): string | undefined {
  const envName = API_KEY_ENV_BY_PROVIDER[providerId];
  if (!envName) return undefined;
  const value = process.env[envName]?.trim();
  return value || undefined;
}
