import type { SupportedProviderId } from "./cli-executor-command-types.js";

const PROVIDER_ALIASES: Record<string, SupportedProviderId> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
};

export const MODEL_MANIFEST: Record<SupportedProviderId, string[]> = {
  claude: ["claude/sonnet", "claude/opus", "claude/haiku"],
  codex: [
    "codex/gpt-5.2-codex",
    "codex/gpt-5.2-codex-max",
    "codex/gpt-5.2-codex-mini",
    "codex/gpt-5.1-codex",
  ],
  gemini: [
    "gemini/gemini-3-pro-preview",
    "gemini/gemini-3-flash-preview",
    "gemini/gemini-2.5-pro",
    "gemini/gemini-2.5-flash",
  ],
};

export function normalizeProviderId(value?: string): SupportedProviderId | undefined {
  if (!value) return undefined;
  return PROVIDER_ALIASES[value.trim().toLowerCase()];
}

export function executableForProvider(providerId?: SupportedProviderId): string | undefined {
  switch (providerId) {
    case "claude":
      return "claude";
    case "codex":
      return "codex";
    case "gemini":
      return "gemini";
    default:
      return undefined;
  }
}
