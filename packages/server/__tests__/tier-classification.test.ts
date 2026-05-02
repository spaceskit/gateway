import { describe, expect, test } from "bun:test";
import {
  classifyTier,
  type ModelTier,
} from "../src/admin/provider-catalog/tier-classification.js";

describe("classifyTier", () => {
  describe("known anthropic models", () => {
    test("claude-haiku-4-5 → fast", () => {
      expect(classifyTier("anthropic", "anthropic/claude-haiku-4-5")).toBe("fast");
    });

    test("claude-sonnet-4-5 → balanced (no fast or smartest keyword)", () => {
      expect(classifyTier("anthropic", "anthropic/claude-sonnet-4-5")).toBe("balanced");
    });

    test("claude-opus-4-5 → smartest", () => {
      expect(classifyTier("anthropic", "anthropic/claude-opus-4-5")).toBe("smartest");
    });

    test("works without provider prefix", () => {
      expect(classifyTier("anthropic", "claude-haiku-4-5")).toBe("fast");
      expect(classifyTier("anthropic", "claude-opus-4-5")).toBe("smartest");
      expect(classifyTier("anthropic", "claude-sonnet-4-5")).toBe("balanced");
    });
  });

  describe("OpenAI / codex models", () => {
    test("gpt-4.1-mini → fast", () => {
      expect(classifyTier("openai", "openai/gpt-4.1-mini")).toBe("fast");
    });

    test("gpt-4.1 → balanced", () => {
      expect(classifyTier("openai", "openai/gpt-4.1")).toBe("balanced");
    });

    test("gpt-5.4-mini → fast (codex-app-server)", () => {
      expect(classifyTier("codex-app-server", "codex-app-server/gpt-5.4-mini")).toBe("fast");
    });

    test("gpt-5.2-codex-max → local (codex CLI is local-runtime)", () => {
      // codex CLI runs on the host -> local tier per spec
      expect(classifyTier("codex", "codex/gpt-5.2-codex-max")).toBe("local");
    });

    test("codex-app-server gpt-5.4 → balanced", () => {
      expect(classifyTier("codex-app-server", "codex-app-server/gpt-5.4")).toBe("balanced");
    });
  });

  describe("Gemini models", () => {
    test("gemini-3-flash-preview → local (gemini CLI provider)", () => {
      // gemini CLI is local-runtime
      expect(classifyTier("gemini", "gemini/gemini-3-flash-preview")).toBe("local");
    });

    test("openrouter google/gemini-3-flash → fast (cloud routing)", () => {
      expect(classifyTier("openrouter", "openrouter/google/gemini-3-flash")).toBe("fast");
    });

    test("openrouter google/gemini-3-pro → smartest", () => {
      expect(classifyTier("openrouter", "openrouter/google/gemini-3-pro")).toBe("smartest");
    });
  });

  describe("Claude Agent SDK", () => {
    test("claude-sonnet-4-6 → balanced", () => {
      expect(classifyTier("claude-agent-sdk", "claude-agent-sdk/claude-sonnet-4-6")).toBe("balanced");
    });

    test("claude-opus-4-6 → smartest", () => {
      expect(classifyTier("claude-agent-sdk", "claude-agent-sdk/claude-opus-4-6")).toBe("smartest");
    });

    test("claude-haiku-4-5 → fast", () => {
      expect(classifyTier("claude-agent-sdk", "claude-agent-sdk/claude-haiku-4-5")).toBe("fast");
    });
  });

  describe("local runtimes", () => {
    test("apple/apple-on-device → local", () => {
      expect(classifyTier("apple", "apple/apple-on-device")).toBe("local");
    });

    test("lmstudio/qwen2.5-coder → local (provider override)", () => {
      // LM Studio is a local runtime; even mini-flavored models are tier=local.
      expect(classifyTier("lmstudio", "lmstudio/qwen2.5-coder")).toBe("local");
    });

    test("ollama/llama3 → local", () => {
      expect(classifyTier("ollama", "ollama/llama3")).toBe("local");
    });

    test("claude (CLI) → local even for opus model name", () => {
      expect(classifyTier("claude", "claude/opus")).toBe("local");
    });

    test("codex (CLI) → local even for mini model name", () => {
      expect(classifyTier("codex", "codex/gpt-5.1-codex-mini")).toBe("local");
    });
  });

  describe("unknown providers fall back to balanced", () => {
    test("unknown provider, no keywords → balanced", () => {
      expect(classifyTier("acme", "acme/some-model-v1")).toBe("balanced");
    });

    test("unknown provider, fast keyword → fast", () => {
      expect(classifyTier("acme", "acme/turbo-mini")).toBe("fast");
    });

    test("unknown provider, smartest keyword → smartest", () => {
      expect(classifyTier("acme", "acme/super-pro")).toBe("smartest");
    });

    test("empty model id → balanced", () => {
      expect(classifyTier("acme", "")).toBe("balanced");
    });

    test("model id with no slash, fast keyword", () => {
      expect(classifyTier("acme", "haiku-style-model")).toBe("fast");
    });
  });

  describe("contextWindow influence (currently a no-op)", () => {
    test("contextWindow does not change classification for balanced model", () => {
      const tierWithoutCw = classifyTier("openai", "openai/gpt-4.1");
      const tierWithSmallCw = classifyTier("openai", "openai/gpt-4.1", 16_000);
      const tierWithLargeCw = classifyTier("openai", "openai/gpt-4.1", 1_000_000);
      expect(tierWithoutCw).toBe("balanced");
      expect(tierWithSmallCw).toBe("balanced");
      expect(tierWithLargeCw).toBe("balanced");
    });

    test("contextWindow does not override fast keyword", () => {
      expect(classifyTier("openai", "openai/gpt-4.1-mini", 1_000_000)).toBe("fast");
    });

    test("contextWindow does not override local provider", () => {
      expect(classifyTier("apple", "apple/apple-on-device", 16_000)).toBe("local");
    });
  });

  describe("type contract", () => {
    test("returns one of the four tier literals", () => {
      const valid: ReadonlyArray<ModelTier> = ["fast", "balanced", "smartest", "local"];
      const samples: Array<[string, string]> = [
        ["anthropic", "anthropic/claude-haiku-4-5"],
        ["anthropic", "anthropic/claude-sonnet-4-5"],
        ["anthropic", "anthropic/claude-opus-4-5"],
        ["apple", "apple/apple-on-device"],
        ["acme", "acme/whatever"],
      ];
      for (const [provider, model] of samples) {
        const tier = classifyTier(provider, model);
        expect(valid).toContain(tier);
      }
    });
  });

  describe("edge cases", () => {
    test("uppercase / mixed-case model id is handled", () => {
      expect(classifyTier("anthropic", "ANTHROPIC/Claude-Haiku-4-5")).toBe("fast");
      expect(classifyTier("OpenAI", "OpenAI/GPT-4.1-Mini")).toBe("fast");
    });

    test("provider id casing does not break local-runtime detection", () => {
      expect(classifyTier("APPLE", "apple/apple-on-device")).toBe("local");
    });

    test("openrouter nested prefix is stripped only once", () => {
      // stripProviderPrefix removes only the first segment; `openai/gpt-4.1-mini`
      // remains in the string so `mini` still matches.
      expect(classifyTier("openrouter", "openrouter/openai/gpt-4.1-mini")).toBe("fast");
      expect(classifyTier("openrouter", "openrouter/anthropic/claude-opus-4-5")).toBe("smartest");
    });
  });
});
