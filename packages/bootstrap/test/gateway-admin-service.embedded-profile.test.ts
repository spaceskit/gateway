import { describe, expect, test } from "bun:test";
import { createContext } from "./gateway-admin-service-test-helpers.js";

describe("DefaultGatewayAdminService embedded profile constraints", () => {
  test("embedded profile rejects localhost baseURL for known providers", () => {
    const ctx = createContext({ gatewayProfile: "embedded" });
    try {
      expect(() => ctx.admin.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1",
        baseURL: "http://127.0.0.1:1234/v1",
      })).toThrow();
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("embedded profile rejects remote baseURL", () => {
    const ctx = createContext({ gatewayProfile: "embedded" });
    try {
      expect(() => ctx.admin.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1",
        baseURL: "https://api.custom-proxy.com/v1",
      })).toThrow();
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("embedded non-mac profile rejects local profile provisioning with known template", async () => {
    const ctx = createContext({ gatewayProfile: "embedded", hostPlatform: "linux", hostArch: "x64" });
    try {
      const err = await ctx.admin.provisionLocalProfile({ localClientId: "lmstudio" }).catch((e: any) => e);
      expect(err).toBeDefined();
      expect(err.code).toBe("FAILED_PRECONDITION");
      expect(err.message).toContain("embedded macOS");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("embedded profile rejects local profile provisioning with unknown template", async () => {
    const ctx = createContext({ gatewayProfile: "embedded", hostPlatform: "linux", hostArch: "x64" });
    try {
      await expect(ctx.admin.provisionLocalProfile({ localClientId: "unknown-client" })).rejects.toMatchObject({
        code: "FAILED_PRECONDITION",
      });
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("embedded non-mac profile rejects executor/local runtimes", () => {
    const ctx = createContext({ gatewayProfile: "embedded", hostPlatform: "linux", hostArch: "x64" });
    try {
      for (const providerId of ["claude", "codex", "gemini", "lmstudio"]) {
        expect(() => ctx.admin.setProviderConfig({
          providerId,
          model: `${providerId}/test-model`,
        })).toThrow();
      }
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("embedded macOS allows executor and local runtime configuration", () => {
    const ctx = createContext({
      gatewayProfile: "embedded",
      enableAppleFoundationProvider: true,
      appleFoundationAvailability: { available: true, reason: "Apple Intelligence available." },
      hostPlatform: "darwin",
      hostArch: "arm64",
    });
    try {
      expect(() => ctx.admin.setProviderConfig({
        providerId: "claude",
        model: "claude/sonnet",
        nativeCliToolsEnabled: true,
      })).not.toThrow();
      expect(() => ctx.admin.setProviderConfig({
        providerId: "lmstudio",
        model: "lmstudio/qwen2.5-coder",
      })).not.toThrow();
      expect(() => ctx.admin.setProviderConfig({
        providerId: "apple",
        model: "apple/apple-on-device",
      })).not.toThrow();
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("embedded profile rejects unknown custom providers", () => {
    const ctx = createContext({ gatewayProfile: "embedded" });
    try {
      expect(() => ctx.admin.setProviderConfig({
        providerId: "togetherai",
        model: "togetherai/llama-3",
      })).toThrow();
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("embedded profile rejects localhost baseURL for lmstudio", () => {
    const ctx = createContext({ gatewayProfile: "embedded", hostPlatform: "linux", hostArch: "x64" });
    try {
      expect(() => ctx.admin.setProviderConfig({
        providerId: "lmstudio",
        model: "lmstudio/qwen2.5-coder",
        baseURL: "http://127.0.0.1:1234/v1",
      })).toThrow();
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("listProviderCatalogs includes configAllowed field for embedded non-mac hosts", async () => {
    const ctx = createContext({ gatewayProfile: "embedded", hostPlatform: "linux", hostArch: "x64" });
    try {
      const catalogs = await ctx.admin.listProviderCatalogs();
      expect(catalogs.length).toBeGreaterThan(0);
      for (const catalog of catalogs) {
        expect(catalog.configAllowed).toBeDefined();
        expect(typeof catalog.configAllowed).toBe("boolean");
      }
      const enabledProviders = ["openrouter", "openai", "groq", "together", "mistral"];
      const disabledProviders = ["apple", "claude", "codex", "gemini", "lmstudio"];
      for (const catalog of catalogs) {
        if (enabledProviders.includes(catalog.providerId)) {
          expect(catalog.configAllowed).toBe(true);
        }
        if (disabledProviders.includes(catalog.providerId)) {
          expect(catalog.configAllowed).toBe(false);
        }
      }
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("persists native CLI tools setting in provider settings", async () => {
    const ctx = createContext();
    try {
      const configured = ctx.admin.setProviderConfig({
        providerId: "claude",
        model: "claude/sonnet",
        nativeCliToolsEnabled: true,
      });

      expect(configured.nativeCliToolsEnabled).toBe(true);
      expect(ctx.admin.getProviderSettings("claude").nativeCliToolsEnabled).toBe(true);
      expect((await ctx.admin.resolveProviderForProfile("claude", "claude/sonnet")).nativeCliToolsEnabled).toBe(true);
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });
});
