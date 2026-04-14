import { describe, expect, test } from "bun:test";
import { resolveModelCapabilities } from "../../src/agents/model-capability-registry.js";
import { inferContextWindow } from "../../src/agents/model-capability-registry.js";

describe("resolveModelCapabilities", () => {
  test("reports executor runtime classes with activity streaming and CLI access mapping", () => {
    expect(resolveModelCapabilities("claude")).toMatchObject({
      executionClass: "executor",
      supportsStreaming: true,
      supportsActivityStreaming: true,
      supportsPublicReasoning: true,
      accessModeStrategy: "executor_cli",
    });
    expect(resolveModelCapabilities("claude-agent-sdk")).toMatchObject({
      executionClass: "executor",
      toolSupportMode: "mediated",
      supportsStreaming: true,
      supportsActivityStreaming: true,
      supportsPublicReasoning: true,
      accessModeStrategy: "executor_cli",
    });
    expect(resolveModelCapabilities("codex-app-server")).toMatchObject({
      executionClass: "executor",
      toolSupportMode: "mediated",
      supportsStreaming: true,
      supportsActivityStreaming: true,
      supportsPublicReasoning: true,
      supportsReasoningEffort: true,
      isCliExecutor: false,
      accessModeStrategy: "executor_cli",
    });
    expect(resolveModelCapabilities("gemini")).toMatchObject({
      executionClass: "executor",
      supportsActivityStreaming: true,
      supportsPublicReasoning: false,
      accessModeStrategy: "executor_cli",
    });
  });

  test("reports thinking and reasoning capability flags per provider", () => {
    // Anthropic SDK supports extended thinking
    expect(resolveModelCapabilities("anthropic")).toMatchObject({
      supportsThinking: true,
      supportsReasoningEffort: false,
    });
    // OpenAI supports reasoning_effort (o-series)
    expect(resolveModelCapabilities("openai")).toMatchObject({
      supportsThinking: false,
      supportsReasoningEffort: true,
    });
    // Claude CLI supports thinking (via --effort)
    expect(resolveModelCapabilities("claude")).toMatchObject({
      supportsThinking: true,
      supportsReasoningEffort: false,
    });
    // Claude Agent SDK supports Anthropic thinking controls
    expect(resolveModelCapabilities("claude-agent-sdk")).toMatchObject({
      supportsThinking: true,
      supportsReasoningEffort: false,
    });
    // Codex App Server supports reasoning_effort, but not Anthropic-style thinking.
    expect(resolveModelCapabilities("codex-app-server")).toMatchObject({
      supportsThinking: false,
      supportsReasoningEffort: true,
    });
    // Gemini CLI supports thinking (via --thinking-level)
    expect(resolveModelCapabilities("gemini")).toMatchObject({
      supportsThinking: true,
      supportsReasoningEffort: false,
    });
    // Codex CLI supports reasoning_effort
    expect(resolveModelCapabilities("codex")).toMatchObject({
      supportsThinking: false,
      supportsReasoningEffort: true,
    });
    // Local runtimes don't support either
    expect(resolveModelCapabilities("ollama")).toMatchObject({
      supportsThinking: false,
      supportsReasoningEffort: false,
    });
    expect(resolveModelCapabilities("apple")).toMatchObject({
      supportsThinking: false,
      supportsReasoningEffort: false,
    });
  });

  test("reports cloud and local runtimes as gateway-owned access paths", () => {
    expect(resolveModelCapabilities("openai")).toMatchObject({
      executionClass: "cloud",
      supportsStreaming: true,
      supportsActivityStreaming: false,
      supportsPublicReasoning: false,
      accessModeStrategy: "gateway_owned",
    });
    expect(resolveModelCapabilities("apple")).toMatchObject({
      executionClass: "local_runtime",
      supportsStreaming: true,
      supportsActivityStreaming: false,
      supportsPublicReasoning: false,
      accessModeStrategy: "gateway_owned",
    });
    expect(resolveModelCapabilities("lmstudio")).toMatchObject({
      executionClass: "local_runtime",
      supportsStreaming: true,
      supportsActivityStreaming: false,
      supportsPublicReasoning: false,
      accessModeStrategy: "gateway_owned",
    });
  });
});

describe("inferContextWindow", () => {
  test("returns provider-level defaults for static providers", () => {
    expect(inferContextWindow("claude")).toBe(200_000);
    expect(inferContextWindow("claude-agent-sdk")).toBe(200_000);
    expect(inferContextWindow("codex-app-server")).toBe(200_000);
    expect(inferContextWindow("codex")).toBe(200_000);
    expect(inferContextWindow("gemini")).toBe(200_000);
    expect(inferContextWindow("apple")).toBe(4_096);
  });

  test("returns per-model context window for bare model IDs", () => {
    expect(inferContextWindow("codex", "gpt-5.1-codex")).toBe(1_048_576);
    expect(inferContextWindow("codex", "gpt-5.2-codex-mini")).toBe(1_048_576);
    expect(inferContextWindow("gemini", "gemini-2.5-flash")).toBe(1_000_000);
    expect(inferContextWindow("gemini", "gemini-3-pro-preview")).toBe(1_000_000);
    expect(inferContextWindow("claude", "claude-sonnet-4")).toBe(1_000_000);
  });

  test("strips provider prefix from model IDs", () => {
    expect(inferContextWindow("codex", "codex/gpt-5.1-codex")).toBe(1_048_576);
    expect(inferContextWindow("gemini", "gemini/gemini-2.5-pro")).toBe(1_000_000);
    expect(inferContextWindow("claude", "claude/claude-opus-4")).toBe(1_000_000);
  });

  test("falls back to provider default for unknown model IDs", () => {
    expect(inferContextWindow("codex", "codex/some-future-model")).toBe(200_000);
    expect(inferContextWindow("gemini", "gemini/unknown-model")).toBe(200_000);
  });

  test("returns undefined for providers without static defaults", () => {
    expect(inferContextWindow("openai")).toBeUndefined();
    expect(inferContextWindow("openrouter")).toBeUndefined();
    expect(inferContextWindow("lmstudio")).toBeUndefined();
  });

  test("returns undefined for empty provider", () => {
    expect(inferContextWindow("")).toBeUndefined();
    expect(inferContextWindow("  ")).toBeUndefined();
  });
});
