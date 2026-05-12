import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initDatabase, ProfileRepository } from "@spaceskit/persistence";
import { startGateway } from "../src/index.js";
import {
  INTEGRATION_TIMEOUT,
  gatewayErrorCode,
  randomPort,
  removeDbArtifacts,
} from "./main-defaults-test-helpers.js";

describe("bootstrap main defaults", () => {
  test("repairs LM Studio pinned model when runtime discovery no longer includes it", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const dbPath = join(tmpdir(), `spaceskit-main-agent-lmstudio-fallback-${crypto.randomUUID()}.db`);
    const previousGatewayProfile = Bun.env.SPACESKIT_GATEWAY_PROFILE;
    const previousMasterKey = Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY;
    const previousHttpPrincipalSecret = Bun.env.SPACESKIT_HTTP_PRINCIPAL_AUTH_HS256_SECRET;
    const originalFetch = globalThis.fetch;
    const config = {
      port: randomPort(),
      host: "127.0.0.1",
      dbPath,
      logLevel: "error" as const,
      runtimeGeneration: "test_main_agent_lmstudio_runtime_fallback_generation",
      mainSpaceId: "main-space-lmstudio-fallback-test",
      mainProfileId: "main-profile-lmstudio-fallback-test",
      mainAgentId: "main-agent-lmstudio-fallback-test",
    };

    let detectedModels = ["qwen2.5-coder"];
    let instance: Awaited<ReturnType<typeof startGateway>> | null = null;
    try {
      Bun.env.SPACESKIT_GATEWAY_PROFILE = "external";
      Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY = "test-main-agent-lmstudio-fallback-master-key";
      Bun.env.SPACESKIT_HTTP_PRINCIPAL_AUTH_HS256_SECRET = "test-http-principal-secret";
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            data: detectedModels.map((id) => ({ id })),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as typeof fetch;

      instance = await startGateway({
        ...config,
        archFreezeEnforced: false,
      });
      instance.gatewayAdminService.setProviderConfig({
        providerId: "lmstudio",
        model: "lmstudio/qwen2.5-coder",
        baseURL: "http://127.0.0.1:1234/v1",
        allowCustomModel: true,
      });
      await instance.gatewayAdminService.setMainAgent({
        spaceId: config.mainSpaceId,
        selectionMode: "provider_model",
        providerId: "lmstudio",
        modelId: "lmstudio/qwen2.5-coder",
      });

      detectedModels = ["google/gemma-3-4b"];

      const state = await instance.gatewayAdminService.getMainAgent({
        spaceId: config.mainSpaceId,
        repairIfMissing: true,
      });
      expect(state.status).toBe("fallback");
      expect(state.fallbackApplied).toBe(true);
      expect(state.modelHint).toBe("lmstudio/google/gemma-3-4b");
      expect(state.fallbackReason).toContain("not loaded in LM Studio runtime");
    } finally {
      globalThis.fetch = originalFetch;
      try {
        await instance?.shutdown();
      } catch {}
      removeDbArtifacts(dbPath);
      if (previousGatewayProfile === undefined) {
        delete Bun.env.SPACESKIT_GATEWAY_PROFILE;
      } else {
        Bun.env.SPACESKIT_GATEWAY_PROFILE = previousGatewayProfile;
      }
      if (previousMasterKey === undefined) {
        delete Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY;
      } else {
        Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY = previousMasterKey;
      }
      if (previousHttpPrincipalSecret === undefined) {
        delete Bun.env.SPACESKIT_HTTP_PRINCIPAL_AUTH_HS256_SECRET;
      } else {
        Bun.env.SPACESKIT_HTTP_PRINCIPAL_AUTH_HS256_SECRET = previousHttpPrincipalSecret;
      }
    }
  });

  test("returns fallback status when pinned runtime/model becomes unavailable after restart", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const dbPath = join(tmpdir(), `spaceskit-main-agent-fallback-${crypto.randomUUID()}.db`);
    const missingProviderId = `missing-provider-${crypto.randomUUID().slice(0, 8)}`;
    const previousGatewayProfile = Bun.env.SPACESKIT_GATEWAY_PROFILE;
    const config = {
      port: randomPort(),
      host: "127.0.0.1",
      dbPath,
      logLevel: "error" as const,
      runtimeGeneration: "test_main_agent_fallback_generation",
      mainSpaceId: "main-space-fallback-test",
      mainProfileId: "main-profile-fallback-test",
      mainAgentId: "main-agent-fallback-test",
    };

    let first: Awaited<ReturnType<typeof startGateway>> | null = null;
    let second: Awaited<ReturnType<typeof startGateway>> | null = null;

    try {
      Bun.env.SPACESKIT_GATEWAY_PROFILE = "embedded";
      first = await startGateway(config);
      first.gatewayAdminService.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1",
        apiKey: "test-openai-key",
      });
      await first.gatewayAdminService.setMainAgent({
        spaceId: config.mainSpaceId,
        selectionMode: "provider_model",
        providerId: "openai",
        modelId: "gpt-4.1",
      });
      await first.shutdown();
      first = null;

      const seeded = initDatabase({
        path: dbPath,
        runtimeGeneration: config.runtimeGeneration,
      });
      try {
        const profiles = new ProfileRepository(seeded.db);
        profiles.update({
          profileId: config.mainProfileId,
          providerHint: missingProviderId,
          modelHint: `${missingProviderId}/missing-model`,
          modelConfig: {
            preferredModels: [`${missingProviderId}/missing-model`],
            fallbackModels: [],
          },
          source: "test-invalid-provider",
        });
      } finally {
        seeded.close();
      }

      second = await startGateway({
        ...config,
        port: randomPort(),
        mainAgentAutoRepairEnabled: false,
      });

      const state = await second.gatewayAdminService.getMainAgent({
        spaceId: config.mainSpaceId,
        repairIfMissing: true,
      });
      expect(state.status).toBe("fallback");
      expect(state.fallbackApplied).toBe(true);
      expect(state.fallbackReason?.length ?? 0).toBeGreaterThan(0);
    } finally {
      try {
        await first?.shutdown();
      } catch {}
      try {
        await second?.shutdown();
      } catch {}
      removeDbArtifacts(dbPath);
      if (previousGatewayProfile === undefined) {
        delete Bun.env.SPACESKIT_GATEWAY_PROFILE;
      } else {
        Bun.env.SPACESKIT_GATEWAY_PROFILE = previousGatewayProfile;
      }
    }
  });

  test("does not auto-repair archived main profile on startup when mainAgentAutoRepairEnabled is false", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const dbPath = join(tmpdir(), `spaceskit-main-agent-no-autorepair-${crypto.randomUUID()}.db`);
    const previousGatewayProfile = Bun.env.SPACESKIT_GATEWAY_PROFILE;
    const config = {
      port: randomPort(),
      host: "127.0.0.1",
      dbPath,
      logLevel: "error" as const,
      runtimeGeneration: "test_main_agent_no_autorepair_generation",
      mainSpaceId: "main-space-no-autorepair-test",
      mainProfileId: "main-profile-no-autorepair-test",
      mainAgentId: "main-agent-no-autorepair-test",
    };

    let first: Awaited<ReturnType<typeof startGateway>> | null = null;
    let second: Awaited<ReturnType<typeof startGateway>> | null = null;

    try {
      Bun.env.SPACESKIT_GATEWAY_PROFILE = "embedded";
      first = await startGateway(config);
      await first.shutdown();
      first = null;

      const seeded = initDatabase({
        path: dbPath,
        runtimeGeneration: config.runtimeGeneration,
      });
      try {
        const profiles = new ProfileRepository(seeded.db);
        profiles.archive(config.mainProfileId);
      } finally {
        seeded.close();
      }

      second = await startGateway({
        ...config,
        port: randomPort(),
        mainAgentAutoRepairEnabled: false,
      });

      const profileRow = second.db?.db.query(
        "SELECT archived FROM agent_profiles WHERE profile_id = ?",
      ).get(config.mainProfileId) as { archived: number } | undefined;
      expect(profileRow?.archived).toBe(1);

      let caught: unknown;
      try {
        await second.gatewayAdminService.getMainAgent({
          spaceId: config.mainSpaceId,
          repairIfMissing: false,
        });
      } catch (error) {
        caught = error;
      }
      expect(gatewayErrorCode(caught)).toBe("FAILED_PRECONDITION");
    } finally {
      try {
        await first?.shutdown();
      } catch {}
      try {
        await second?.shutdown();
      } catch {}
      removeDbArtifacts(dbPath);
      if (previousGatewayProfile === undefined) {
        delete Bun.env.SPACESKIT_GATEWAY_PROFILE;
      } else {
        Bun.env.SPACESKIT_GATEWAY_PROFILE = previousGatewayProfile;
      }
    }
  });

  test("agent_definition swap derives provider from model when source provider hint is missing", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const dbPath = join(tmpdir(), `spaceskit-main-agent-template-provider-${crypto.randomUUID()}.db`);
    const previousGatewayProfile = Bun.env.SPACESKIT_GATEWAY_PROFILE;
    const config = {
      port: randomPort(),
      host: "127.0.0.1",
      dbPath,
      logLevel: "error" as const,
      runtimeGeneration: "test_main_agent_template_provider_derivation_generation",
      mainSpaceId: "main-space-template-provider-test",
      mainProfileId: "main-profile-template-provider-test",
      mainAgentId: "main-agent-template-provider-test",
    };

    let instance: Awaited<ReturnType<typeof startGateway>> | null = null;
    try {
      Bun.env.SPACESKIT_GATEWAY_PROFILE = "embedded";
      instance = await startGateway(config);
      instance.gatewayAdminService.setProviderConfig({
        providerId: "openai",
        model: "openai/gpt-4.1",
        apiKey: "test-openai-key",
      });

      const db = instance.db?.db;
      expect(db).toBeDefined();
      const profileRepo = new ProfileRepository(db!);
      profileRepo.create({
        profileId: "source-template-without-provider",
        name: "Source Template",
        personalityPrompt: "Template personality",
        modelHint: "openai/gpt-4.1",
        source: "test-profile-template",
      });

      const state = await instance.gatewayAdminService.setMainAgent({
        spaceId: config.mainSpaceId,
        selectionMode: "agent_definition",
        sourceAgentDefinitionId: "source-template-without-provider",
      });

      expect(state.providerHint).toBe("openai");
      expect(state.modelHint).toBe("openai/gpt-4.1");
      expect(state.status === "healthy" || state.status === "repaired").toBe(true);
      expect(state.fallbackApplied).toBe(false);
    } finally {
      try {
        await instance?.shutdown();
      } catch {}
      removeDbArtifacts(dbPath);
      if (previousGatewayProfile === undefined) {
        delete Bun.env.SPACESKIT_GATEWAY_PROFILE;
      } else {
        Bun.env.SPACESKIT_GATEWAY_PROFILE = previousGatewayProfile;
      }
    }
  });
});
