import { describe, expect, test } from "bun:test";
import { createContext } from "./gateway-admin-service-test-helpers.js";

describe("DefaultGatewayAdminService profile resolution", () => {
  test("prefers model-hint provider when providerHint and modelHint conflict", async () => {
    const ctx = createContext();
    try {
      ctx.admin.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1",
      });
      ctx.admin.setProviderConfig({
        providerId: "anthropic",
        model: "anthropic/claude-sonnet-4-5",
      });

      const resolved = await ctx.admin.resolveProviderForProfile("anthropic", "openai/gpt-4.1");
      expect(resolved.providerId).toBe("openai");
      expect(resolved.model).toBe("openai/gpt-4.1");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("falls back to a configured runtime when the requested provider is unavailable", async () => {
    const ctx = createContext();
    try {
      ctx.admin.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1",
        apiKey: "sk-openai-test",
      });

      const resolved = await ctx.admin.resolveProviderForProfile(
        "missing-provider",
        "missing-provider/missing-model",
      );
      expect(resolved.providerId).toBe("openai");
      expect(resolved.model).toBe("openai/gpt-4.1");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("rejects LM Studio fallback when the runtime remains unreachable", async () => {
    const ctx = createContext();
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:1234");
      }) as typeof fetch;

      ctx.admin.setProviderConfig({
        providerId: "lmstudio",
        model: "lmstudio/qwen2.5-coder",
        baseURL: "http://127.0.0.1:1234/v1",
      });

      await expect(
        ctx.admin.resolveProviderForProfile("lmstudio", "lmstudio/not-loaded-model"),
      ).rejects.toMatchObject({
        code: "FAILED_PRECONDITION",
        message: expect.stringContaining("ECONNREFUSED"),
      });
    } finally {
      globalThis.fetch = originalFetch;
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("rejects conflicting providerHint and modelHint in profile selection validation", () => {
    const ctx = createContext();
    try {
      let error: unknown;
      try {
        ctx.admin.validateProfileModelSelection({
          providerHint: "anthropic",
          modelHint: "openai/gpt-4.1",
        });
      } catch (err) {
        error = err;
      }
      expect(error).toMatchObject({ code: "INVALID_ARGUMENT" });
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("retains discovered model options when saving local runtime settings", () => {
    const ctx = createContext();
    try {
      const configured = ctx.admin.setProviderConfig({
        providerId: "codex",
        model: "codex/gpt-5.1-codex",
        allowedModels: ["codex/gpt-5.1-codex"],
      });
      expect(configured.allowedModels).toContain("codex/gpt-5.2-codex");

      const fromSettings = ctx.admin.getProviderSettings("codex");
      expect(fromSettings.allowedModels).toContain("codex/gpt-5.2-codex");

      const fromList = ctx.admin.listProviderConfigs().find((entry) => entry.providerId === "codex");
      expect(fromList?.allowedModels).toContain("codex/gpt-5.2-codex");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });
});
