import { describe, expect, test } from "bun:test";
import { createContext } from "./gateway-admin-service-test-helpers.js";

describe("DefaultGatewayAdminService Claude Agent SDK integration", () => {
  test("surfaces Claude Agent SDK in api_key mode with provider auth metadata", async () => {
    const ctx = createContext({
      claudeAgentSdkMetadataProbe: async () => ({
        authStatus: "authenticated",
      }),
    });
    try {
      const configured = ctx.admin.setProviderConfig({
        providerId: "claude-agent-sdk",
        model: "claude-sonnet-4-5",
        apiKey: "sk-ant-runtime",
        authMode: "api_key",
      });

      expect(configured.providerId).toBe("claude-agent-sdk");
      expect(configured.model).toBe("claude-agent-sdk/claude-sonnet-4-5");
      expect(configured.hasApiKey).toBe(true);
      expect(configured.authMode).toBe("api_key");

      const settings = ctx.admin.getProviderSettings("claude-agent-sdk");
      expect(settings.providerId).toBe("claude-agent-sdk");
      expect(settings.model).toBe("claude-agent-sdk/claude-sonnet-4-5");
      expect(settings.hasApiKey).toBe(true);
      expect(settings.authMode).toBe("api_key");

      const catalogs = await ctx.admin.listProviderCatalogs({ providerId: "claude-agent-sdk" });
      expect(catalogs).toHaveLength(1);
      expect(catalogs[0]).toMatchObject({
        providerId: "claude-agent-sdk",
        displayName: "Claude Agent SDK",
        group: "executor",
        integrationClass: "executor",
        requiresApiKey: true,
        hasApiKey: true,
        supportedAuthModes: ["api_key", "host_login"],
        authMode: "api_key",
        authStatus: "authenticated",
      });
      expect(catalogs[0]?.installHint).toContain("ANTHROPIC_API_KEY");

      const resolved = await ctx.admin.resolveProviderForProfile(
        "claude-agent-sdk",
        "claude-agent-sdk/claude-sonnet-4-5",
      );
      expect(resolved.providerId).toBe("claude-agent-sdk");
      expect(resolved.model).toBe("claude-agent-sdk/claude-sonnet-4-5");
      expect(resolved.apiKey).toBe("sk-ant-runtime");
      expect(resolved.authMode).toBe("api_key");
      expect(resolved.isLocal).toBe(false);
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("surfaces Claude Agent SDK host login metadata and discovered models", async () => {
    const ctx = createContext({
      claudeAgentSdkMetadataProbe: async () => ({
        authStatus: "authenticated",
        authAccount: {
          email: "agent@example.com",
          organization: "Acme",
          subscriptionType: "max",
          tokenSource: "oauth",
          apiProvider: "firstParty",
        },
        models: [
          {
            id: "claude-agent-sdk/claude-sonnet-4-6",
            displayName: "Claude Sonnet 4.6",
            source: "detected",
            available: true,
            contextWindow: 200_000,
          },
          {
            id: "claude-agent-sdk/claude-opus-4-6",
            displayName: "Claude Opus 4.6",
            source: "detected",
            available: true,
            contextWindow: 200_000,
          },
        ],
      }),
    });

    try {
      const configured = ctx.admin.setProviderConfig({
        providerId: "claude-agent-sdk",
        model: "claude-sonnet-4-5",
        authMode: "host_login",
      });

      expect(configured.authMode).toBe("host_login");
      expect(configured.hasApiKey).toBe(false);

      const settings = ctx.admin.getProviderSettings("claude-agent-sdk");
      expect(settings.authMode).toBe("host_login");

      const catalogs = await ctx.admin.listProviderCatalogs({ providerId: "claude-agent-sdk" });
      expect(catalogs).toHaveLength(1);
      expect(catalogs[0]).toMatchObject({
        providerId: "claude-agent-sdk",
        supportedAuthModes: ["api_key", "host_login"],
        authMode: "host_login",
        authStatus: "authenticated",
        requiresApiKey: false,
        hasApiKey: false,
        authAccount: {
          email: "agent@example.com",
          organization: "Acme",
          subscriptionType: "max",
          tokenSource: "oauth",
          apiProvider: "firstParty",
        },
      });
      const detectedModelIds = catalogs[0]?.models
        .filter((entry) => entry.source === "detected")
        .map((entry) => entry.id)
        .sort();
      expect(detectedModelIds).toEqual([
        "claude-agent-sdk/claude-opus-4-6",
        "claude-agent-sdk/claude-sonnet-4-6",
      ]);
      expect(catalogs[0]?.models.map((entry) => entry.id)).toContain(
        "claude-agent-sdk/claude-sonnet-4-5",
      );

      const resolved = await ctx.admin.resolveProviderForProfile(
        "claude-agent-sdk",
        "claude-agent-sdk/claude-sonnet-4-5",
      );
      expect(resolved.authMode).toBe("host_login");
      expect(resolved.apiKey).toBeUndefined();
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("keeps fallback Claude Agent SDK models visible when host login needs authentication", async () => {
    const ctx = createContext({
      claudeAgentSdkMetadataProbe: async () => ({
        authStatus: "needs_auth",
      }),
    });

    try {
      ctx.admin.setProviderConfig({
        providerId: "claude-agent-sdk",
        model: "claude-agent-sdk/claude-sonnet-4-5",
        authMode: "host_login",
      });

      const catalogs = await ctx.admin.listProviderCatalogs({ providerId: "claude-agent-sdk" });
      expect(catalogs[0]?.status).toBe("needs_auth");
      expect(catalogs[0]?.authStatus).toBe("needs_auth");
      expect(catalogs[0]?.models.map((entry) => entry.id)).toContain("claude-agent-sdk/claude-sonnet-4-5");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });
});
