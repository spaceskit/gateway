import { describe, expect, test } from "bun:test";
import { Logger } from "@spaceskit/observability";
import { initDatabase, ProviderConfigRepository } from "@spaceskit/persistence";
import { DefaultGatewayAdminService } from "../src/gateway-admin-service.js";

const ENV_KEYS = [
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
] as const;

function createContext(options?: { gatewayProfile?: "embedded" | "external" }) {
  const previousEnv = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    previousEnv.set(key, process.env[key]);
    delete process.env[key];
  }

  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-provider-config-persist-${crypto.randomUUID()}`,
  });
  const providerConfigRepo = new ProviderConfigRepository(db.db);
  const admin = new DefaultGatewayAdminService({
    logger: new Logger({ minLevel: "error", module: "provider-config-persist-test" }),
    profileRepo: null,
    spaceAdminService: {
      getSpace: async () => null,
      addAgent: async () => ({ assignment: null }),
      updateAgentAssignment: async () => ({ assignment: null }),
    } as any,
    providerConfigRepo,
    gatewayProfile: options?.gatewayProfile ?? "external",
  });

  return {
    db,
    providerConfigRepo,
    admin,
    restoreEnv() {
      for (const key of ENV_KEYS) {
        const value = previousEnv.get(key);
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    },
  };
}

function createAdminWithRepo(
  db: ReturnType<typeof initDatabase>,
  providerConfigRepo: ProviderConfigRepository,
  gatewayProfile: "embedded" | "external" = "external",
) {
  return new DefaultGatewayAdminService({
    logger: new Logger({ minLevel: "error", module: "provider-config-persist-test" }),
    profileRepo: null,
    spaceAdminService: {
      getSpace: async () => null,
      addAgent: async () => ({ assignment: null }),
      updateAgentAssignment: async () => ({ assignment: null }),
    } as any,
    providerConfigRepo,
    gatewayProfile,
  });
}

describe("Provider config persistence", () => {
  test("set config persists to repo", () => {
    const ctx = createContext();
    try {
      ctx.admin.setProviderConfig({
        providerId: "anthropic",
        model: "anthropic/claude-sonnet-4-5",
        apiKey: "sk-test",
      });

      const row = ctx.providerConfigRepo.getById("anthropic");
      expect(row).not.toBeNull();
      expect(row!.provider_id).toBe("anthropic");
      expect(row!.model).toBe("anthropic/claude-sonnet-4-5");
      expect(row!.auth_mode).toBe("api_key");
      expect(row!.source).toBe("runtime");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("host login auth mode persists and reloads for claude-agent-sdk", () => {
    const ctx = createContext();
    try {
      const config = ctx.admin.setProviderConfig({
        providerId: "claude-agent-sdk",
        model: "claude-agent-sdk/claude-sonnet-4-5",
        authMode: "host_login",
      });

      expect(config.authMode).toBe("host_login");
      expect(config.hasApiKey).toBe(false);

      const row = ctx.providerConfigRepo.getById("claude-agent-sdk");
      expect(row).not.toBeNull();
      expect(row!.auth_mode).toBe("host_login");

      const admin2 = createAdminWithRepo(ctx.db, ctx.providerConfigRepo);
      const reloaded = admin2.getProviderSettings("claude-agent-sdk");
      expect(reloaded.authMode).toBe("host_login");
      expect(reloaded.hasApiKey).toBe(false);
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("remove config removes from repo", () => {
    const ctx = createContext();
    try {
      ctx.admin.setProviderConfig({
        providerId: "anthropic",
        model: "anthropic/claude-sonnet-4-5",
        apiKey: "sk-test",
      });
      expect(ctx.providerConfigRepo.getById("anthropic")).not.toBeNull();

      ctx.admin.removeProviderConfig("anthropic");
      expect(ctx.providerConfigRepo.getById("anthropic")).toBeNull();
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("seed loads persisted configs", () => {
    const ctx = createContext();
    try {
      // Persist a config directly in the repo
      ctx.providerConfigRepo.upsert({
        providerId: "openai",
        model: "openai/gpt-4.1",
        allowedModelsJson: '["openai/gpt-4.1"]',
        allowCustomModel: false,
        source: "runtime",
      });

      // Create a new admin service instance (simulating restart)
      const admin2 = createAdminWithRepo(ctx.db, ctx.providerConfigRepo);
      const configs = admin2.listProviderConfigs();
      const openaiConfig = configs.find((c) => c.providerId === "openai");

      expect(openaiConfig).toBeDefined();
      expect(openaiConfig!.model).toBe("openai/gpt-4.1");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("env config overrides persisted", () => {
    const ctx = createContext();
    try {
      // Persist a config
      ctx.providerConfigRepo.upsert({
        providerId: "openrouter",
        model: "openrouter/openai/gpt-4.1-mini",
        allowedModelsJson: '["openrouter/openai/gpt-4.1-mini"]',
        allowCustomModel: false,
        source: "runtime",
      });

      // Set env key — env should override persisted
      process.env.OPENROUTER_API_KEY = "sk-or-from-env";
      const admin2 = createAdminWithRepo(ctx.db, ctx.providerConfigRepo);
      const configs = admin2.listProviderConfigs();
      const openRouterConfig = configs.find((c) => c.providerId === "openrouter");

      expect(openRouterConfig).toBeDefined();
      // env seed overwrites persisted model with its own default
      expect(openRouterConfig!.source).toBe("env");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("persisted config survives restart with same repo", () => {
    const ctx = createContext();
    try {
      ctx.admin.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1",
        apiKey: "sk-test-openai",
      });

      // Simulate restart — new service instance, same repo
      const admin2 = createAdminWithRepo(ctx.db, ctx.providerConfigRepo);
      const configs = admin2.listProviderConfigs();
      const openaiConfig = configs.find((c) => c.providerId === "openai");

      expect(openaiConfig).toBeDefined();
      expect(openaiConfig!.model).toBe("openai/gpt-4.1");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("factory reset clears persisted configs via removeProviderConfig calls", () => {
    const ctx = createContext();
    try {
      ctx.admin.setProviderConfig({
        providerId: "openrouter",
        model: "openrouter/openai/gpt-4.1-mini",
        apiKey: "sk-or-test",
      });
      ctx.admin.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1",
        apiKey: "sk-test-openai",
      });

      expect(ctx.providerConfigRepo.list().length).toBe(2);

      // Simulate what factory reset does: call removeProviderConfig for each
      const configs = ctx.admin.listProviderConfigs();
      for (const config of configs) {
        ctx.admin.removeProviderConfig(config.providerId);
      }

      expect(ctx.providerConfigRepo.list()).toEqual([]);
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("runtime set after seed overrides all", () => {
    const ctx = createContext();
    try {
      // Persist a config
      ctx.providerConfigRepo.upsert({
        providerId: "openai",
        model: "openai/gpt-4.1-mini",
        allowedModelsJson: '["openai/gpt-4.1-mini"]',
        allowCustomModel: false,
        source: "env",
      });

      // Create a new admin instance (loads persisted)
      const admin2 = createAdminWithRepo(ctx.db, ctx.providerConfigRepo);

      // Runtime set should override
      const result = admin2.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1",
        apiKey: "sk-runtime",
      });

      expect(result.model).toBe("openai/gpt-4.1");
      expect(result.source).toBe("runtime");

      // Verify persisted row is also updated
      const row = ctx.providerConfigRepo.getById("openai");
      expect(row).not.toBeNull();
      expect(row!.model).toBe("openai/gpt-4.1");
      expect(row!.source).toBe("runtime");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });
});
