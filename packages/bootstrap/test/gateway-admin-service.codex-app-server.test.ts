import { describe, expect, test } from "bun:test";
import { createContext } from "./gateway-admin-service-test-helpers.js";

describe("DefaultGatewayAdminService Codex App Server integration", () => {
  test("surfaces Codex App Server host login metadata and discovered models", async () => {
    const ctx = createContext({
      codexAppServerMetadataProbe: async () => ({
        authStatus: "authenticated",
        authAccount: {
          email: "developer@example.com",
          subscriptionType: "pro",
          tokenSource: "chatgpt",
          apiProvider: "openai",
        },
        models: [
          {
            id: "codex-app-server/gpt-5.4",
            displayName: "GPT-5.4",
            contextWindow: 1_048_576,
          },
          {
            id: "codex-app-server/gpt-5.4-mini",
            displayName: "GPT-5.4 Mini",
            contextWindow: 1_048_576,
          },
        ],
      }),
    });

    try {
      const configured = ctx.admin.setProviderConfig({
        providerId: "codex-app-server",
        model: "codex-app-server/gpt-5.4",
        authMode: "host_login",
      });

      expect(configured.authMode).toBe("host_login");
      expect(configured.hasApiKey).toBe(false);

      const catalogs = await ctx.admin.listProviderCatalogs({ providerId: "codex-app-server" });
      expect(catalogs).toHaveLength(1);
      expect(catalogs[0]).toMatchObject({
        providerId: "codex-app-server",
        displayName: "Codex App Server",
        group: "executor",
        integrationClass: "executor",
        supportedAuthModes: ["host_login", "api_key"],
        authMode: "host_login",
        authStatus: "authenticated",
        requiresApiKey: false,
        hasApiKey: false,
        authAccount: {
          email: "developer@example.com",
          subscriptionType: "pro",
          tokenSource: "chatgpt",
          apiProvider: "openai",
        },
      });
      expect(catalogs[0]?.models.map((entry) => entry.id)).toContain("codex-app-server/gpt-5.4");
      expect(catalogs[0]?.models.map((entry) => entry.id)).toContain("codex-app-server/gpt-5.4-mini");

      const resolved = await ctx.admin.resolveProviderForProfile(
        "codex-app-server",
        "codex-app-server/gpt-5.4",
      );
      expect(resolved.providerId).toBe("codex-app-server");
      expect(resolved.model).toBe("codex-app-server/gpt-5.4");
      expect(resolved.authMode).toBe("host_login");
      expect(resolved.apiKey).toBeUndefined();
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("keeps fallback Codex App Server models visible when host login needs authentication", async () => {
    const ctx = createContext({
      codexAppServerMetadataProbe: async () => ({
        authStatus: "needs_auth",
        models: [],
      }),
    });

    try {
      ctx.admin.setProviderConfig({
        providerId: "codex-app-server",
        model: "codex-app-server/gpt-5.4",
        authMode: "host_login",
      });

      const catalogs = await ctx.admin.listProviderCatalogs({ providerId: "codex-app-server" });
      expect(catalogs[0]?.status).toBe("needs_auth");
      expect(catalogs[0]?.authStatus).toBe("needs_auth");
      expect(catalogs[0]?.models.map((entry) => entry.id)).toContain("codex-app-server/gpt-5.4");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("resolves exact codex app server host-login runtime config without provider fallback", () => {
    const ctx = createContext();
    try {
      ctx.admin.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1",
        apiKey: "sk-openai-test",
      });
      ctx.admin.setProviderConfig({
        providerId: "codex-app-server",
        model: "codex-app-server/gpt-5.4-mini",
        authMode: "host_login",
      });

      const resolved = ctx.admin.resolveExactProviderRuntimeConfig({
        providerId: "codex-app-server",
      });
      expect(resolved.providerId).toBe("codex-app-server");
      expect(resolved.model).toBe("codex-app-server/gpt-5.4-mini");
      expect(resolved.authMode).toBe("host_login");
      expect(resolved.apiKey).toBeUndefined();
      expect(resolved.isLocal).toBe(false);
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("resolves exact codex app server api-key runtime config", () => {
    const ctx = createContext();
    try {
      ctx.admin.setProviderConfig({
        providerId: "codex-app-server",
        model: "codex-app-server/gpt-5.4",
        authMode: "api_key",
        apiKey: "sk-openai-runtime",
      });

      const resolved = ctx.admin.resolveExactProviderRuntimeConfig({
        providerId: "codex-app-server",
      });
      expect(resolved.providerId).toBe("codex-app-server");
      expect(resolved.model).toBe("codex-app-server/gpt-5.4");
      expect(resolved.authMode).toBe("api_key");
      expect(resolved.apiKey).toBe("sk-openai-runtime");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("resolves exact provider runtime config through secret references", () => {
    const ctx = createContext();
    try {
      ctx.providerSecretRefService.putSecretRef({
        providerId: "codex-app-server",
        secretRef: "secretref-codex-app-server-primary",
        label: "Codex App Server primary",
        secret: "sk-openai-secret-ref",
      });

      ctx.admin.setProviderConfig({
        providerId: "codex-app-server",
        model: "codex-app-server/gpt-5.4",
        authMode: "api_key",
        apiKeySecretRef: "secretref-codex-app-server-primary",
      });

      const resolved = ctx.admin.resolveExactProviderRuntimeConfig({
        providerId: "codex-app-server",
      });
      expect(resolved.apiKeySecretRef).toBe("secretref-codex-app-server-primary");
      expect(resolved.apiKey).toBe("sk-openai-secret-ref");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("does not apply provider fallback when resolving an exact runtime config", () => {
    const ctx = createContext();
    try {
      ctx.admin.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1",
        apiKey: "sk-openai-test",
      });

      const resolved = ctx.admin.resolveExactProviderRuntimeConfig({
        providerId: "codex-app-server",
        model: "codex-app-server/gpt-5.4",
      });
      expect(resolved.providerId).toBe("codex-app-server");
      expect(resolved.model).toBe("codex-app-server/gpt-5.4");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });
});
