import { afterEach, describe, expect, test } from "bun:test";
import {
  inferDefaultProviderAuthStatus,
  isCliExecutorProvider,
  isLikelyLocalBaseURL,
  isLocalProvider,
  isOpenAICompatibleProvider,
  keyFromEnvironment,
  LMSTUDIO_BASE_URL_ENV,
  normalizeProviderAuthMode,
  OPENAI_BASE_URL_ENV,
  providerDisplayName,
  providerInstallHint,
  providerRecommended,
  providerRequiresApiKey,
  providerSupportedAuthModes,
  resolveProviderAuthMode,
  resolveRequestedProviderAuthMode,
} from "../src/services/provider-catalog-support.js";

describe("provider-catalog-support", () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  test("exposes stable provider display names and install hints", () => {
    expect(providerDisplayName("claude-agent-sdk")).toBe("Claude Agent SDK");
    expect(providerDisplayName("codex-app-server")).toBe("Codex App Server");
    expect(providerDisplayName("lmstudio")).toBe("LM Studio");
    expect(providerInstallHint("openrouter")).toContain("OPENROUTER_API_KEY");
    expect(providerInstallHint("codex-app-server")).toContain("OPENAI_API_KEY");
    expect(providerInstallHint("unknown-provider")).toBeUndefined();
  });

  test("derives auth modes and statuses for hosted providers", () => {
    expect(providerSupportedAuthModes("claude-agent-sdk")).toEqual(["api_key", "host_login"]);
    expect(providerSupportedAuthModes("codex-app-server")).toEqual(["host_login", "api_key"]);
    expect(resolveProviderAuthMode("claude-agent-sdk")).toBe("api_key");
    expect(resolveProviderAuthMode("codex-app-server")).toBe("host_login");
    expect(resolveProviderAuthMode("claude-agent-sdk", "host_login")).toBe("host_login");
    expect(resolveProviderAuthMode("codex-app-server", "api_key")).toBe("api_key");
    expect(resolveRequestedProviderAuthMode("claude-agent-sdk", undefined, "host_login")).toBe("host_login");
    expect(resolveRequestedProviderAuthMode("codex-app-server", undefined, "api_key")).toBe("api_key");
    expect(normalizeProviderAuthMode(" HOST_LOGIN ")).toBe("host_login");
    expect(inferDefaultProviderAuthStatus("claude-agent-sdk", "host_login", false)).toBe("needs_auth");
    expect(inferDefaultProviderAuthStatus("codex-app-server", "host_login", false)).toBe("needs_auth");
    expect(inferDefaultProviderAuthStatus("openai", "api_key", false)).toBe("needs_key");
    expect(inferDefaultProviderAuthStatus("openai", "api_key", true)).toBe("authenticated");
  });

  test("distinguishes local, executor, and openai-compatible providers", () => {
    expect(isLocalProvider("lmstudio")).toBe(true);
    expect(isLocalProvider("openai")).toBe(false);
    expect(isCliExecutorProvider("codex")).toBe(true);
    expect(isCliExecutorProvider("openai")).toBe(false);
    expect(isOpenAICompatibleProvider("openrouter")).toBe(true);
    expect(isOpenAICompatibleProvider("claude")).toBe(false);
    expect(providerRecommended("apple")).toBe(true);
    expect(providerRecommended("anthropic")).toBe(false);
  });

  test("uses local base URLs to suppress OpenAI API-key requirements", () => {
    expect(isLikelyLocalBaseURL("http://127.0.0.1:1234/v1")).toBe(true);
    expect(isLikelyLocalBaseURL("https://api.openai.com/v1")).toBe(false);
    expect(providerRequiresApiKey("openai", "http://localhost:1234/v1")).toBe(false);
    expect(providerRequiresApiKey("openai", "https://api.openai.com/v1")).toBe(true);
    expect(providerRequiresApiKey("claude-agent-sdk", undefined, "host_login")).toBe(false);
    expect(providerRequiresApiKey("codex-app-server", undefined, "host_login")).toBe(false);
    expect(providerRequiresApiKey("codex-app-server", undefined, "api_key")).toBe(true);
  });

  test("reads API keys from the expected environment variables", () => {
    process.env.OPENAI_API_KEY = "  test-key  ";

    expect(keyFromEnvironment("openai")).toBe("test-key");
    expect(keyFromEnvironment("claude")).toBeUndefined();
    expect(OPENAI_BASE_URL_ENV).toBe("OPENAI_BASE_URL");
    expect(LMSTUDIO_BASE_URL_ENV).toBe("LMSTUDIO_BASE_URL");
  });
});
