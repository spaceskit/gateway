import { describe, expect, test } from "bun:test";
import { createContext } from "./gateway-admin-service-test-helpers.js";
import { LocalExecutableResolver } from "../src/execution/local-executable-resolver.js";

describe("DefaultGatewayAdminService local runtime detection", () => {
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
});
