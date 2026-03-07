import { describe, expect, test } from "bun:test";
import { Logger } from "@spaceskit/observability";
import { initDatabase, ProviderSecretRefRepository } from "@spaceskit/persistence";
import {
  DefaultGatewayAdminService,
  type AppleFoundationAvailabilitySnapshot,
} from "../src/gateway-admin-service.js";
import { ProviderSecretRefService } from "../src/services/provider-secret-ref-service.js";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENAI_BASE_URL",
] as const;

function createContext(options?: {
  gatewayProfile?: "embedded" | "external";
  enableAppleFoundationProvider?: boolean;
  appleFoundationAvailability?: AppleFoundationAvailabilitySnapshot;
  hostPlatform?: string;
  hostArch?: string;
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
  const providerSecretRefService = new ProviderSecretRefService({
    repository,
    logger: new Logger({ minLevel: "error", module: "gateway-admin-test.secret-ref" }),
    masterKey: "test-gateway-admin-master-key",
  });
  const admin = new DefaultGatewayAdminService({
    logger: new Logger({ minLevel: "error", module: "gateway-admin-test" }),
    profileRepo: null,
    spaceAdminService: {
      getSpace: async () => null,
      addAgent: async () => ({ assignment: null }),
      updateAgentAssignment: async () => ({ assignment: null }),
    } as any,
    providerSecretRefService,
    gatewayProfile: options?.gatewayProfile ?? "external",
    enableAppleFoundationProvider: options?.enableAppleFoundationProvider ?? false,
    appleFoundationAvailability: options?.appleFoundationAvailability,
    hostPlatform: options?.hostPlatform,
    hostArch: options?.hostArch,
  });

  return {
    db,
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
  test("resolves runtime API key via secret reference at runtime", () => {
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

      const resolved = ctx.admin.resolveProviderForProfile(
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

  test("preserves local runtime IDs for codex runtime configuration", () => {
    const ctx = createContext();
    try {
      const configured = ctx.admin.setProviderConfig({
        providerId: "codex",
        model: "gpt-4.1",
      });

      expect(configured.providerId).toBe("codex");
      expect(configured.model).toBe("codex/gpt-4.1");

      const resolved = ctx.admin.resolveProviderForProfile("codex", "gpt-4.1");
      expect(resolved.providerId).toBe("codex");
      expect(resolved.model).toBe("codex/gpt-4.1");
      expect(resolved.isLocal).toBe(true);
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("prefers model-hint provider when providerHint and modelHint conflict", () => {
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

      const resolved = ctx.admin.resolveProviderForProfile("anthropic", "openai/gpt-4.1");
      expect(resolved.providerId).toBe("openai");
      expect(resolved.model).toBe("openai/gpt-4.1");
    } finally {
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

  test("allows apple provider config but blocks resolve when availability is false", () => {
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

      let resolveErr: unknown;
      try {
        ctx.admin.resolveProviderForProfile("apple", "apple/apple-on-device");
      } catch (err) {
        resolveErr = err;
      }
      expect(resolveErr).toMatchObject({ code: "FAILED_PRECONDITION" });
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

  test("blocks apple resolve on unsupported hosts even when opt-in is enabled", () => {
    const ctx = createContext({
      enableAppleFoundationProvider: true,
      appleFoundationAvailability: { available: true, reason: "Apple Intelligence available." },
      hostPlatform: "linux",
      hostArch: "x64",
    });
    try {
      let resolveErr: unknown;
      try {
        ctx.admin.resolveProviderForProfile("apple", "apple/apple-on-device");
      } catch (err) {
        resolveErr = err;
      }
      expect(resolveErr).toMatchObject({ code: "FAILED_PRECONDITION" });
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

  test("persists native CLI tools setting in provider settings", () => {
    const ctx = createContext();
    try {
      const configured = ctx.admin.setProviderConfig({
        providerId: "claude",
        model: "claude/sonnet",
        nativeCliToolsEnabled: true,
      });

      expect(configured.nativeCliToolsEnabled).toBe(true);
      expect(ctx.admin.getProviderSettings("claude").nativeCliToolsEnabled).toBe(true);
      expect(ctx.admin.resolveProviderForProfile("claude", "claude/sonnet").nativeCliToolsEnabled).toBe(true);
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });
});
