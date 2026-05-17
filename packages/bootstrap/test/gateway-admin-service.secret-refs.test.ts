import { describe, expect, test } from "bun:test";
import { createContext } from "./gateway-admin-service-test-helpers.js";

describe("DefaultGatewayAdminService secret-ref integration", () => {
  test("resolves runtime API key via secret reference at runtime", async () => {
    const ctx = createContext();
    try {
      ctx.providerSecretRefService.putSecretRef({
        providerId: "openrouter",
        secretRef: "secretref-openrouter-primary",
        label: "OpenRouter primary",
        secret: "sk-or-primary",
      });

      const configured = ctx.admin.setProviderConfig({
        providerId: "openrouter",
        model: "openrouter/openai/gpt-4.1-mini",
        apiKeySecretRef: "secretref-openrouter-primary",
      });
      expect(configured.hasApiKey).toBe(true);
      expect(configured.apiKeySecretRef).toBe("secretref-openrouter-primary");

      const resolved = await ctx.admin.resolveProviderForProfile(
        "openrouter",
        "openrouter/openai/gpt-4.1-mini",
      );
      expect(resolved.providerId).toBe("openrouter");
      expect(resolved.apiKeySecretRef).toBe("secretref-openrouter-primary");
      expect(resolved.apiKey).toBe("sk-or-primary");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("stores runtime defaults and synchronizes managed profiles", async () => {
    const ctx = createContext({ withProfiles: true });
    try {
      ctx.admin.setProviderConfig({
        providerId: "codex-app-server",
        model: "codex-app-server/gpt-5.4",
      });
      ctx.admin.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1",
        apiKey: "sk-openai-primary",
      });

      const result = await ctx.admin.setRuntimeDefaults({
        main: {
          providerId: "codex-app-server",
          modelId: "codex-app-server/gpt-5.4",
        },
        concierge: {
          providerId: "openai",
          modelId: "openai/gpt-4.1",
        },
      });

      expect(result.defaults.main.providerId).toBe("codex-app-server");
      expect(result.defaults.concierge.modelId).toBe("openai/gpt-4.1");
      expect(result.mainAgentState.providerHint).toBe("codex-app-server");
      expect(result.conciergeAgentState.providerHint).toBe("openai");

      const mainProfile = ctx.profileRepo?.getById("main-profile");
      const conciergeProfile = ctx.profileRepo?.getById("concierge-profile");
      const mainRevision = ctx.profileRepo?.getActiveRevision("main-profile");
      const conciergeRevision = ctx.profileRepo?.getActiveRevision("concierge-profile");

      expect(mainProfile?.is_default).toBe(1);
      expect(conciergeProfile?.is_default).toBe(0);
      expect(mainRevision?.provider_hint).toBe("codex-app-server");
      expect(JSON.parse(mainRevision?.model_config_json ?? "{}").preferredModels?.[0])
        .toBe("codex-app-server/gpt-5.4");
      expect(conciergeRevision?.provider_hint).toBe("openai");
      expect(JSON.parse(conciergeRevision?.model_config_json ?? "{}").preferredModels?.[0])
        .toBe("openai/gpt-4.1");

      const defaults = await ctx.admin.getRuntimeDefaults();
      expect(defaults.main.providerId).toBe("codex-app-server");
      expect(defaults.concierge.providerId).toBe("openai");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("deleting a secret reference detaches it from provider configs", () => {
    const ctx = createContext();
    try {
      ctx.providerSecretRefService.putSecretRef({
        providerId: "openai",
        secretRef: "secretref-openai-primary",
        label: "OpenAI primary",
        secret: "sk-openai-primary",
      });

      ctx.admin.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1",
        apiKeySecretRef: "secretref-openai-primary",
      });

      const deleted = ctx.admin.deleteSecretRef("secretref-openai-primary");
      expect(deleted).toBe(true);

      const config = ctx.admin.listProviderConfigs()
        .find((entry) => entry.providerId === "openai");
      expect(config).toBeDefined();
      expect(config?.hasApiKey).toBe(false);
      expect(config?.apiKeySecretRef).toBeUndefined();
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("rejects provider config when referenced secret belongs to another provider", () => {
    const ctx = createContext();
    try {
      ctx.providerSecretRefService.putSecretRef({
        providerId: "openai",
        secretRef: "secretref-openai-primary",
        secret: "sk-openai-primary",
      });

      expect(() => ctx.admin.setProviderConfig({
        providerId: "anthropic",
        model: "anthropic/claude-sonnet-4-5",
        apiKeySecretRef: "secretref-openai-primary",
      })).toThrow("Secret ref provider mismatch");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });
});
