import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Logger } from "@spaceskit/observability";
import {
  initDatabase,
  ProfileRepository,
  ProviderSecretRefRepository,
} from "@spaceskit/persistence";
import {
  DefaultGatewayAdminService,
  type AppleFoundationAvailabilitySnapshot,
} from "../src/gateway-admin-service.js";
import { LocalExecutableResolver } from "../src/execution/local-executable-resolver.js";
import { ProviderSecretRefService } from "../src/services/provider-secret-ref-service.js";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENAI_BASE_URL",
] as const;

// No-op resolver that never finds executables — isolates tests from host CLIs.
const NO_OP_EXECUTABLE_RESOLVER = {
  resolve: () => ({ path: undefined, resolutionSource: "not_found" as const, manualPathConfigured: false }),
} as unknown as LocalExecutableResolver;

function createSpaceAdminStub() {
  const spaces = new Map<string, any>();

  return {
    getSpace: async (spaceId: string) => spaces.get(spaceId) ?? null,
    createSpace: async (input: any) => {
      spaces.set(input.spaceId, {
        spaceId: input.spaceId,
        spaceUid: `uid-${input.spaceId}`,
        orchestratorProfileId: input.initialAgents?.[0]?.profileId ?? null,
        agents: [...(input.initialAgents ?? [])],
      });
      return spaces.get(input.spaceId);
    },
    addAgent: async (input: any) => {
      const current = spaces.get(input.spaceId);
      if (!current) {
        throw new Error(`Missing space for addAgent: ${input.spaceId}`);
      }
      current.agents.push({
        agentId: input.agentId,
        profileId: input.profileId,
        role: input.role,
        turnOrder: input.turnOrder,
        isPrimary: input.isPrimary,
      });
      return { assignment: current.agents[current.agents.length - 1] };
    },
    updateAgentAssignment: async (input: any) => {
      const current = spaces.get(input.spaceId);
      if (!current) {
        throw new Error(`Missing space for updateAgentAssignment: ${input.spaceId}`);
      }
      const index = current.agents.findIndex((agent: any) => agent.agentId === input.agentId);
      if (index >= 0) {
        current.agents[index] = {
          agentId: input.agentId,
          profileId: input.profileId,
          role: input.role,
          turnOrder: input.turnOrder,
          isPrimary: input.isPrimary,
        };
      }
      return { assignment: current.agents[index] ?? null };
    },
    setSpaceOrchestrator: async (input: any) => {
      const current = spaces.get(input.spaceId);
      if (!current) {
        throw new Error(`Missing space for setSpaceOrchestrator: ${input.spaceId}`);
      }
      current.orchestratorProfileId = input.profileId;
      return current;
    },
  };
}

function createContext(options?: {
  gatewayProfile?: "embedded" | "external";
  enableAppleFoundationProvider?: boolean;
  appleFoundationAvailability?: AppleFoundationAvailabilitySnapshot;
  hostPlatform?: string;
  hostArch?: string;
  executableResolver?: LocalExecutableResolver;
  interconnectorCatalogService?: {
    listBundles: () => unknown[];
    rescan: () => Promise<{ interconnectors: unknown[] }>;
  };
  claudeAgentSdkMetadataProbe?: () => Promise<any>;
  codexAppServerMetadataProbe?: () => Promise<any>;
  withProfiles?: boolean;
}) {
  const previousEnv = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    previousEnv.set(key, process.env[key]);
    delete process.env[key];
  }

  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-gateway-admin-${crypto.randomUUID()}`,
  });
  const repository = new ProviderSecretRefRepository(db.db);
  const profileRepo = options?.withProfiles ? new ProfileRepository(db.db) : null;
  const providerSecretRefService = new ProviderSecretRefService({
    repository,
    logger: new Logger({ minLevel: "error", module: "gateway-admin-test.secret-ref" }),
    masterKey: "test-gateway-admin-master-key",
  });
  const admin = new DefaultGatewayAdminService({
    logger: new Logger({ minLevel: "error", module: "gateway-admin-test" }),
    profileRepo,
    spaceAdminService: createSpaceAdminStub() as any,
    providerSecretRefService,
    gatewayProfile: options?.gatewayProfile ?? "external",
    enableAppleFoundationProvider: options?.enableAppleFoundationProvider ?? false,
    appleFoundationAvailability: options?.appleFoundationAvailability,
    hostPlatform: options?.hostPlatform,
    hostArch: options?.hostArch,
    executableResolver: options?.executableResolver ?? NO_OP_EXECUTABLE_RESOLVER,
    interconnectorCatalogService: options?.interconnectorCatalogService as any,
    claudeAgentSdkMetadataProbe: options?.claudeAgentSdkMetadataProbe,
    codexAppServerMetadataProbe: options?.codexAppServerMetadataProbe,
  });

  return {
    db,
    profileRepo,
    providerSecretRefService,
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
      expect(mainRevision?.model_hint).toBe("codex-app-server/gpt-5.4");
      expect(conciergeRevision?.provider_hint).toBe("openai");
      expect(conciergeRevision?.model_hint).toBe("openai/gpt-4.1");

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

  test("rejects host login auth mode for direct Anthropic API provider", () => {
    const ctx = createContext();
    try {
      expect(() => ctx.admin.setProviderConfig({
        providerId: "anthropic",
        model: "claude-sonnet-4-5",
        authMode: "host_login",
      })).toThrow();
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("surfaces Anthropic as a hosted provider with seeded Claude model options", async () => {
    const ctx = createContext();
    try {
      const configured = ctx.admin.setProviderConfig({
        providerId: "anthropic",
        model: "claude-sonnet-4-5",
        apiKey: "sk-ant-runtime",
      });

      expect(configured.providerId).toBe("anthropic");
      expect(configured.model).toBe("anthropic/claude-sonnet-4-5");
      expect(configured.hasApiKey).toBe(true);

      const catalogs = await ctx.admin.listProviderCatalogs({ providerId: "anthropic" });
      expect(catalogs).toHaveLength(1);
      expect(catalogs[0]).toMatchObject({
        providerId: "anthropic",
        displayName: "Anthropic",
        group: "cloud",
        integrationClass: "cloud",
        requiresApiKey: true,
        hasApiKey: true,
      });
      expect(catalogs[0]?.installHint).toContain("ANTHROPIC_API_KEY");
      expect(catalogs[0]?.models.map((entry) => entry.id)).toEqual([
        "anthropic/claude-sonnet-4-5",
        "anthropic/claude-opus-4-5",
        "anthropic/claude-haiku-4-5",
      ]);
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("lists and rescans supported interconnectors through the catalog service", async () => {
    const bundles = [
      {
        bundleId: "jira-cli",
        bundleDisplayName: "Jira CLI",
        bundleDescription: "Gateway-managed Jira CLI bundle.",
        availabilityStatus: "inactive",
        detected: false,
        executablePath: null,
        installHint: "Install `jira` and rescan CLI Tools.",
        toolIds: ["jira.issue.view", "jira.issue.create"],
        toolCount: 2,
        managedEnabled: true,
        healthStatus: "unknown",
        healthMessage: "Jira CLI is not detected on this gateway.",
        updatedAt: "2026-03-09T10:00:00Z",
      },
    ];

    let rescanCalls = 0;
    const ctx = createContext({
      interconnectorCatalogService: {
        listBundles: () => bundles,
        rescan: async () => {
          rescanCalls += 1;
          return { interconnectors: bundles };
        },
      },
    });

    try {
      expect(ctx.admin.listInterconnectors()).toEqual(bundles);
      await expect(ctx.admin.rescanInterconnectors()).resolves.toEqual(bundles);
      expect(rescanCalls).toBe(1);
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

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

  test("lists available models for lmstudio with lmstudio prefixes", async () => {
    const ctx = createContext();
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "qwen2.5-coder", context_window: 65536 },
              { id: "google/gemma-3-4b", max_context_length: 131072 },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as typeof fetch;

      ctx.admin.setProviderConfig({
        providerId: "lmstudio",
        model: "lmstudio/gpt-4.1-mini",
        baseURL: "http://127.0.0.1:1234/v1",
      });

      const catalogs = await ctx.admin.listAvailableModels({ providerId: "lmstudio" });
      expect(catalogs.length).toBe(1);
      expect(catalogs[0].providerId).toBe("lmstudio");
      expect(catalogs[0].requiresApiKey).toBe(false);
      expect(catalogs[0].detectionStatus).toBe("available");
      expect(catalogs[0].models.map((entry) => entry.id)).toContain("lmstudio/qwen2.5-coder");
      expect(catalogs[0].models.map((entry) => entry.id)).toContain("lmstudio/google/gemma-3-4b");
      const qwen = catalogs[0].models.find((entry) => entry.id === "lmstudio/qwen2.5-coder");
      const gemma = catalogs[0].models.find((entry) => entry.id === "lmstudio/google/gemma-3-4b");
      expect(qwen?.contextWindow).toBe(65536);
      expect(gemma?.contextWindow).toBe(131072);
    } finally {
      globalThis.fetch = originalFetch;
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("discoverLocalAgents includes LM Studio available models when endpoint responds", async () => {
    const ctx = createContext();
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            data: [{ id: "qwen2.5-coder" }, { id: "google/gemma-3-4b" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as typeof fetch;

      const agents = await ctx.admin.discoverLocalAgents();
      const lmstudio = agents.find((agent) => agent.id === "lmstudio");
      expect(lmstudio).toBeDefined();
      expect(lmstudio?.serviceReachable).toBe(true);
      expect(lmstudio?.availableModels).toEqual([
        "lmstudio/qwen2.5-coder",
        "lmstudio/google/gemma-3-4b",
      ]);
      expect(lmstudio?.recommendedModel).toBe("lmstudio/qwen2.5-coder");
    } finally {
      globalThis.fetch = originalFetch;
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("surface actionable LM Studio connection errors when model endpoint is unreachable", async () => {
    const ctx = createContext();
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        const error = new Error("Unable to connect. Is the computer able to access the url?") as Error & {
          code?: string;
        };
        error.code = "ConnectionRefused";
        throw error;
      }) as typeof fetch;

      const agents = await ctx.admin.discoverLocalAgents();
      const lmstudio = agents.find((agent) => agent.id === "lmstudio");
      expect(lmstudio).toBeDefined();
      expect(lmstudio?.serviceReachable).toBe(false);
      expect(lmstudio?.detectionError).toContain("Connection refused at http://127.0.0.1:1234/v1/models");
      expect(lmstudio?.detectionError).toContain("lms server start --port 1234");
    } finally {
      globalThis.fetch = originalFetch;
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("lists manifest-backed model options for local CLI providers", async () => {
    const ctx = createContext();
    try {
      const catalogs = await ctx.admin.listProviderCatalogs({ providerId: "codex" });
      expect(catalogs.length).toBe(1);
      const codex = catalogs[0];
      expect(codex.providerId).toBe("codex");
      expect(codex.models.map((entry) => entry.id)).toContain("codex/gpt-5.1-codex");
      expect(codex.models.map((entry) => entry.id)).toContain("codex/gpt-5.2-codex");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("auto-seeds a separate codex-app-server provider config when codex is installed", () => {
    const executableResolver = {
      resolve: ({ cacheKey }: { cacheKey: string }) => ({
        path: cacheKey === "codex" ? "/opt/homebrew/bin/codex" : undefined,
      }),
    } as unknown as LocalExecutableResolver;
    const ctx = createContext({ executableResolver });
    try {
      const codex = ctx.admin.getProviderSettings("codex");
      const codexAppServer = ctx.admin.getProviderSettings("codex-app-server");

      expect(codex.providerId).toBe("codex");
      expect(codexAppServer.providerId).toBe("codex-app-server");
      expect(codexAppServer.model).toBe("codex-app-server/gpt-5.4");
      expect(codexAppServer.authMode).toBe("host_login");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("discoverLocalAgents uses executable resolver for embedded CLI detection", async () => {
    const executableResolver = {
      resolve: ({ cacheKey }: { cacheKey: string }) => ({
        path: cacheKey === "claude" ? "/opt/homebrew/bin/claude" : undefined,
      }),
    } as unknown as LocalExecutableResolver;
    const ctx = createContext({
      gatewayProfile: "embedded",
      hostPlatform: "darwin",
      hostArch: "arm64",
      executableResolver,
    });
    try {
      const agents = await ctx.admin.discoverLocalAgents();
      const claude = agents.find((agent) => agent.id === "claude");
      expect(claude?.detected).toBe(true);
      expect(claude?.executablePath).toBe("/opt/homebrew/bin/claude");
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

  test("returns telemetry for configured runtimes using usage snapshot fallback", async () => {
    const ctx = createContext();
    try {
      ctx.admin.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1",
        apiKey: "sk-openai-test",
      });
      ctx.admin.setUsageSnapshotService({
        getSnapshot: () => ({
          computedAt: new Date().toISOString(),
          currency: "USD",
          windows: {
            last5h: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
            last7d: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
            last30d: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
            lifetime: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
          },
          budget: {
            softCapUsd: 20,
            hardCapUsd: 50,
            warningThreshold: 0.8,
            spentUsd: 0,
            leftUsd: 50,
          },
          providerUsage: [
            {
              providerId: "openai",
              status: "available",
              inputTokens: 11,
              outputTokens: 7,
              totalTokens: 18,
              spentUsd: 0.12,
            },
          ],
        }),
      } as any);

      const telemetry = await ctx.admin.getProviderTelemetry();
      expect(telemetry.length).toBe(1);
      expect(telemetry[0].providerId).toBe("openai");
      expect(telemetry[0].source).toBe("usage_snapshot");
      expect(telemetry[0].usage?.totalTokens).toBe(18);
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("builds local usage fallback without calling provider telemetry recursively", async () => {
    const ctx = createContext();
    try {
      ctx.admin.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1",
        apiKey: "sk-openai-test",
      });
      ctx.admin.setUsageSnapshotService({
        getSnapshot: () => ({
          computedAt: new Date().toISOString(),
          currency: "USD",
          windows: {
            last5h: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
            last7d: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
            last30d: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
            lifetime: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
          },
          budget: {
            softCapUsd: 20,
            hardCapUsd: 50,
            warningThreshold: 0.8,
            spentUsd: 0,
            leftUsd: 50,
          },
          providerUsage: [
            {
              providerId: "openai",
              status: "available",
              inputTokens: 11,
              outputTokens: 7,
              totalTokens: 18,
              spentUsd: 0.12,
            },
          ],
        }),
      } as any);

      (ctx.admin as any).getProviderTelemetry = async () => {
        throw new Error("getProviderTelemetry should not be called");
      };

      const telemetry = await ctx.admin.getLocalUsageTelemetry({ providerId: "openai" });
      expect(telemetry.length).toBe(1);
      expect(telemetry[0].providerId).toBe("openai");
      expect(telemetry[0].status).toBe("available");
      expect(telemetry[0].summary.totalTokens).toBe(0);
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("passes requested providerIds batch to local provider telemetry service", async () => {
    const ctx = createContext();
    try {
      ctx.admin.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1",
        apiKey: "sk-openai-test",
      });
      ctx.admin.setProviderConfig({
        providerId: "openrouter",
        model: "openrouter/anthropic/claude-sonnet-4",
        apiKey: "sk-openrouter-test",
      });
      ctx.admin.setProviderConfig({
        providerId: "anthropic",
        model: "anthropic/claude-sonnet-4",
        apiKey: "sk-anthropic-test",
      });

      let received: any = null;
      ctx.admin.setLocalUsageTelemetryService({
        getTelemetry: async (input: any) => {
          received = input;
          return [];
        },
      } as any);

      const telemetry = await ctx.admin.getLocalUsageTelemetry({
        providerIds: ["openrouter", "openai", "openrouter"],
      });

      expect(telemetry).toEqual([]);
      expect(received.providerIds).toEqual(["openrouter", "openai"]);
      expect(received.fallbackTelemetry.map((entry: any) => entry.providerId)).toEqual(["openrouter", "openai"]);
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("returns Claude quota windows from OAuth usage probe", async () => {
    const ctx = createContext();
    try {
      ctx.admin.setProviderConfig({
        providerId: "claude",
        model: "claude/sonnet",
      });
      ctx.admin.setUsageSnapshotService({
        getSnapshot: () => ({
          computedAt: new Date().toISOString(),
          currency: "USD",
          windows: {
            last5h: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
            last7d: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
            last30d: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
            lifetime: { inputTokens: 0, outputTokens: 0, totalTokens: 0, spentUsd: 0 },
          },
          budget: {
            softCapUsd: 20,
            hardCapUsd: 50,
            warningThreshold: 0.8,
            spentUsd: 0,
            leftUsd: 50,
          },
          providerUsage: [
            {
              providerId: "claude",
              status: "available",
              inputTokens: 17,
              outputTokens: 9,
              totalTokens: 26,
              spentUsd: 0,
            },
          ],
        }),
      } as any);

      (ctx.admin as any).findExecutable = () => "/usr/local/bin/claude";
      (ctx.admin as any).readClaudeOAuthAccessToken = async () => ({
        accessToken: "oauth-token",
        source: "keychain",
      });
      (ctx.admin as any).fetchClaudeOAuthUsage = async (accessToken: string) => {
        expect(accessToken).toBe("oauth-token");
        return {
          windows: [
            {
              scopeId: "claude",
              scopeName: "Claude",
              window: "primary",
              usedPercent: 25,
              remainingPercent: 75,
              resetsAt: "2026-02-28T13:00:00.000Z",
              windowDurationMins: 300,
            },
            {
              scopeId: "claude",
              scopeName: "Claude",
              window: "secondary",
              usedPercent: 10,
              remainingPercent: 90,
              resetsAt: "2026-03-06T08:00:00.000Z",
              windowDurationMins: 10080,
            },
          ],
        };
      };

      const telemetry = await ctx.admin.getProviderTelemetry({ providerId: "claude" });
      expect(telemetry.length).toBe(1);
      expect(telemetry[0].providerId).toBe("claude");
      expect(telemetry[0].source).toBe("claude_cli");
      expect(telemetry[0].status).toBe("available");
      expect(telemetry[0].windows.map((entry) => entry.window)).toEqual(["primary", "secondary"]);
      expect(telemetry[0].windows[0].usedPercent).toBe(25);
      expect(telemetry[0].windows[1].windowDurationMins).toBe(10080);
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("does not use Anthropic API keys for Claude quota windows", async () => {
    const ctx = createContext();
    try {
      process.env.ANTHROPIC_API_KEY = "sk-ant-api-key";
      ctx.admin.setProviderConfig({
        providerId: "claude",
        model: "claude/sonnet",
      });
      (ctx.admin as any).findExecutable = () => "/usr/local/bin/claude";
      (ctx.admin as any).readClaudeOAuthAccessToken = async () => ({
        message: "No Claude OAuth token found.",
      });
      (ctx.admin as any).fetchClaudeOAuthUsage = async () => {
        throw new Error("Claude OAuth fetch should not run without an OAuth token");
      };

      const telemetry = await ctx.admin.getProviderTelemetry({ providerId: "claude" });
      expect(telemetry.length).toBe(1);
      expect(telemetry[0].providerId).toBe("claude");
      expect(telemetry[0].source).toBe("claude_cli");
      expect(telemetry[0].windows).toEqual([]);
      expect(telemetry[0].message).toContain("OAuth");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("prefers Claude OAuth Keychain credentials before legacy credentials file", async () => {
    const ctx = createContext();
    try {
      (ctx.admin as any).readClaudeOAuthAccessTokenFromKeychain = () => ({
        accessToken: "keychain-token",
        source: "keychain",
      });
      (ctx.admin as any).readClaudeOAuthAccessTokenFromCredentialsFile = () => ({
        accessToken: "file-token",
        source: "credentials_file",
      });

      const credentials = await (ctx.admin as any).readClaudeOAuthAccessToken();
      expect(credentials).toEqual({
        accessToken: "keychain-token",
        source: "keychain",
      });
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("falls back to Claude legacy credentials file when Keychain has no OAuth token", async () => {
    const ctx = createContext();
    try {
      (ctx.admin as any).readClaudeOAuthAccessTokenFromKeychain = () => ({});
      (ctx.admin as any).readClaudeOAuthAccessTokenFromCredentialsFile = () => ({
        accessToken: "file-token",
        source: "credentials_file",
      });

      const credentials = await (ctx.admin as any).readClaudeOAuthAccessToken();
      expect(credentials).toEqual({
        accessToken: "file-token",
        source: "credentials_file",
      });
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("no longer shells out to claude auth status during telemetry refresh", () => {
    const source = readFileSync(
      new URL("../src/gateway-admin-service.ts", import.meta.url),
      "utf8",
    );
    expect(source.includes("auth\", \"status\", \"--json")).toBe(false);
  });

  test("returns codex telemetry windows from app-server probe", async () => {
    const ctx = createContext();
    try {
      ctx.admin.setProviderConfig({
        providerId: "codex",
        model: "codex/gpt-5.1-codex",
      });

      (ctx.admin as any).findExecutable = () => "/usr/local/bin/codex";
      (ctx.admin as any).queryCodexAppServer = async () => ({
        account: {
          account: {
            email: "developer@example.com",
            planType: "pro",
          },
        },
        rateLimits: {
          rateLimitsByLimitId: {
            codex: {
              limitId: "codex",
              limitName: "Codex",
              primary: {
                usedPercent: 40,
                windowDurationMins: 300,
                resetsAt: 1_772_121_024,
              },
              secondary: {
                usedPercent: 20,
                windowDurationMins: 10_080,
                resetsAt: 1_772_482_026,
              },
            },
          },
        },
      });

      const telemetry = await ctx.admin.getProviderTelemetry({ providerId: "codex" });
      expect(telemetry.length).toBe(1);
      expect(telemetry[0].providerId).toBe("codex");
      expect(telemetry[0].source).toBe("codex_app_server");
      expect(telemetry[0].windows.length).toBe(2);
      expect(telemetry[0].windows[0].window).toBe("primary");
      expect(telemetry[0].windows[1].window).toBe("secondary");
      expect(telemetry[0].accountLabel).toContain("pro");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("rejects telemetry requests for unknown configured runtimes", async () => {
    const ctx = createContext();
    try {
      ctx.admin.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1",
      });
      await expect(ctx.admin.getProviderTelemetry({ providerId: "codex" })).rejects.toThrow(
        "Unknown providerId",
      );
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("hides apple foundation provider when opt-in flag is disabled", async () => {
    const ctx = createContext({
      enableAppleFoundationProvider: false,
      appleFoundationAvailability: { available: true, reason: "available" },
      hostPlatform: "darwin",
      hostArch: "arm64",
    });
    try {
      const catalogs = await ctx.admin.listProviderCatalogs();
      expect(catalogs.some((entry) => entry.providerId === "apple")).toBe(false);
      await expect(ctx.admin.listProviderCatalogs({ providerId: "apple" })).rejects.toThrow("Unknown providerId");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("keeps apple foundation provider out of catalogs even when opt-in is enabled on unsupported hosts", async () => {
    const ctx = createContext({
      enableAppleFoundationProvider: true,
      appleFoundationAvailability: { available: true, reason: "available" },
      hostPlatform: "linux",
      hostArch: "x64",
    });
    try {
      const catalogs = await ctx.admin.listProviderCatalogs();
      expect(catalogs.some((entry) => entry.providerId === "apple")).toBe(false);
      await expect(ctx.admin.listProviderCatalogs({ providerId: "apple" })).rejects.toThrow("Unknown providerId");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("shows apple foundation provider in catalogs on eligible hosts", async () => {
    const ctx = createContext({
      enableAppleFoundationProvider: true,
      appleFoundationAvailability: { available: true, reason: "Apple Intelligence available." },
      hostPlatform: "darwin",
      hostArch: "arm64",
    });
    try {
      const catalogs = await ctx.admin.listProviderCatalogs();
      const apple = catalogs.find((entry) => entry.providerId === "apple");
      expect(apple).toBeDefined();
      expect(apple?.status).toBe("reachable");
      expect(apple?.models.map((entry) => entry.id)).toContain("apple/apple-on-device");
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("allows apple provider config but blocks resolve when availability is false", async () => {
    const ctx = createContext({
      enableAppleFoundationProvider: true,
      appleFoundationAvailability: { available: false, reason: "Apple Intelligence unavailable." },
      hostPlatform: "darwin",
      hostArch: "arm64",
    });
    try {
      expect(() => ctx.admin.setProviderConfig({
        providerId: "apple",
        model: "apple/apple-on-device",
      })).not.toThrow();

      await expect(
        ctx.admin.resolveProviderForProfile("apple", "apple/apple-on-device"),
      ).rejects.toMatchObject({ code: "FAILED_PRECONDITION" });
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("blocks apple getProviderSettings and profile validation when opt-in is disabled", () => {
    const ctx = createContext({
      enableAppleFoundationProvider: false,
      appleFoundationAvailability: { available: true, reason: "Apple Intelligence available." },
      hostPlatform: "darwin",
      hostArch: "arm64",
    });
    try {
      let settingsErr: unknown;
      try {
        ctx.admin.getProviderSettings("apple");
      } catch (err) {
        settingsErr = err;
      }
      expect(settingsErr).toMatchObject({ code: "FAILED_PRECONDITION" });

      let validationErr: unknown;
      try {
        ctx.admin.validateProfileModelSelection({
          providerHint: "apple",
          modelHint: "apple/apple-on-device",
        });
      } catch (err) {
        validationErr = err;
      }
      expect(validationErr).toMatchObject({ code: "FAILED_PRECONDITION" });
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("blocks apple resolve on unsupported hosts even when opt-in is enabled", async () => {
    const ctx = createContext({
      enableAppleFoundationProvider: true,
      appleFoundationAvailability: { available: true, reason: "Apple Intelligence available." },
      hostPlatform: "linux",
      hostArch: "x64",
    });
    try {
      await expect(
        ctx.admin.resolveProviderForProfile("apple", "apple/apple-on-device"),
      ).rejects.toMatchObject({ code: "FAILED_PRECONDITION" });
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

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
