import { describe, expect, test } from "bun:test";
import { createContext } from "./gateway-admin-service-test-helpers.js";
import { LocalExecutableResolver } from "../src/execution/local-executable-resolver.js";

// listProviderConfigSummaries() exists so hot paths like /health can read provider id + model
// without triggering the local-CLI model detection that listProviderConfigs() performs. That
// detection (e.g. spawning `opencode models`) makes a single /health call cost ~1s, which is
// longer than the app's gateway-reachability probe timeout — so a running gateway looks down.

function createSpyResolver(): { resolver: LocalExecutableResolver; calls: unknown[] } {
  const calls: unknown[] = [];
  const resolver = {
    resolve: (input: unknown) => {
      calls.push(input);
      return { path: undefined, resolutionSource: "not_found" as const, manualPathConfigured: false };
    },
  } as unknown as LocalExecutableResolver;
  return { resolver, calls };
}

describe("DefaultGatewayAdminService.listProviderConfigSummaries", () => {
  test("returns the same provider id + model as listProviderConfigs", () => {
    const ctx = createContext();
    try {
      ctx.admin.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1-mini",
        apiKey: "sk-test",
      });

      const full = ctx.admin.listProviderConfigs();
      const summaries = ctx.admin.listProviderConfigSummaries();

      expect(summaries.map((s) => `${s.providerId}/${s.model}`))
        .toEqual(full.map((c) => `${c.providerId}/${c.model}`));
    } finally {
      ctx.restoreEnv();
    }
  });

  test("does NOT invoke the executable resolver (no local CLI model detection)", () => {
    const { resolver, calls } = createSpyResolver();
    const ctx = createContext({ gatewayProfile: "embedded", hostPlatform: "darwin", hostArch: "arm64", executableResolver: resolver });
    try {
      // opencode triggers CLI model detection inside listProviderConfigs() via mergeAllowedModels.
      ctx.admin.setProviderConfig({
        providerId: "opencode",
        model: "opencode/some-model",
      });

      calls.length = 0;
      ctx.admin.listProviderConfigSummaries();
      // Summaries must not have probed for any local executable.
      expect(calls).toEqual([]);
    } finally {
      ctx.restoreEnv();
    }
  });
});
