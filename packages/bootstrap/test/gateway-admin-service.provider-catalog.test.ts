import { describe, expect, test } from "bun:test";
import { createContext } from "./gateway-admin-service-test-helpers.js";

describe("DefaultGatewayAdminService provider catalog detection", () => {
  test("lists available models from OpenAI-compatible endpoint", async () => {
    const ctx = createContext();
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "qwen2.5-coder", context_length: 32768 },
              { id: "deepseek-r1" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as typeof fetch;

      ctx.admin.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1",
        baseURL: "http://127.0.0.1:1234/v1",
      });

      const catalogs = await ctx.admin.listAvailableModels({ providerId: "openai" });
      expect(catalogs.length).toBe(1);
      expect(catalogs[0].providerId).toBe("openai");
      expect(catalogs[0].detectionStatus).toBe("available");
      expect(catalogs[0].models.map((entry) => entry.id)).toContain("openai/qwen2.5-coder");
      expect(catalogs[0].models.map((entry) => entry.id)).toContain("openai/deepseek-r1");
      const qwen = catalogs[0].models.find((entry) => entry.id === "openai/qwen2.5-coder");
      const deepseek = catalogs[0].models.find((entry) => entry.id === "openai/deepseek-r1");
      expect(qwen?.contextWindow).toBe(32768);
      expect(deepseek?.contextWindow).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("reuses short-lived model detection cache for repeated catalog reads", async () => {
    const ctx = createContext();
    const originalFetch = globalThis.fetch;
    try {
      let fetchCalls = 0;
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        return new Response(
          JSON.stringify({
            data: [{ id: "google/gemma-3-4b" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch;

      (ctx.admin as any).discoverLocalAgents = async () => [];

      ctx.admin.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1",
        baseURL: "http://127.0.0.1:1234/v1",
      });

      const first = await ctx.admin.listProviderCatalogs({ providerId: "openai" });
      const second = await ctx.admin.listProviderCatalogs({ providerId: "openai" });

      expect(first.length).toBe(1);
      expect(second.length).toBe(1);
      expect(fetchCalls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("preserves local runtime IDs for codex runtime configuration", async () => {
    const ctx = createContext();
    try {
      const configured = ctx.admin.setProviderConfig({
        providerId: "codex",
        model: "gpt-4.1",
      });

      expect(configured.providerId).toBe("codex");
      expect(configured.model).toBe("codex/gpt-4.1");

      const resolved = await ctx.admin.resolveProviderForProfile("codex", "gpt-4.1");
      expect(resolved.providerId).toBe("codex");
      expect(resolved.model).toBe("codex/gpt-4.1");
      expect(resolved.isLocal).toBe(true);
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("applies context-window hints for claude catalog models when runtime metadata is missing", async () => {
    const ctx = createContext();
    try {
      ctx.admin.setProviderConfig({
        providerId: "claude",
        model: "claude/opus-main-a",
      });
      const catalogs = await ctx.admin.listProviderCatalogs({ providerId: "claude" });
      expect(catalogs.length).toBe(1);
      const claude = catalogs[0];
      expect(claude.providerId).toBe("claude");
      const sonnet = claude.models.find((entry) => entry.id === "claude/sonnet");
      const opus = claude.models.find((entry) => entry.id === "claude/opus");
      const configured = claude.models.find((entry) => entry.id === "claude/opus-main-a");
      expect(sonnet?.contextWindow).toBe(200000);
      expect(opus?.contextWindow).toBe(200000);
      expect(configured?.contextWindow).toBe(200000);
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });
});
