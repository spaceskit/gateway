import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProfileRepository } from "@spaceskit/persistence";
import { startGateway } from "../src/index.js";
import {
  INTEGRATION_TIMEOUT,
  gatewayErrorCode,
  gatewayErrorMessage,
  randomPort,
  removeDbArtifacts,
} from "./main-defaults-test-helpers.js";

describe("bootstrap main defaults", () => {
  test("repairs stale conflicting main-assignment policy before applying main-agent swap", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const dbPath = join(tmpdir(), `spaceskit-main-agent-conflict-repair-${crypto.randomUUID()}.db`);
    const previousGatewayProfile = Bun.env.SPACESKIT_GATEWAY_PROFILE;
    const config = {
      port: randomPort(),
      host: "127.0.0.1",
      dbPath,
      logLevel: "error" as const,
      runtimeGeneration: "test_main_agent_conflict_repair_generation",
      mainSpaceId: "main-space-conflict-repair-test",
      mainProfileId: "main-profile-conflict-repair-test",
      mainAgentId: "main-agent-conflict-repair-test",
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
        allowCustomModel: true,
      });
      await first.gatewayAdminService.setMainAgent({
        spaceId: config.mainSpaceId,
        selectionMode: "provider_model",
        providerId: "openai",
        modelId: "gpt-4.1",
      });

      const nowIso = new Date().toISOString();
      const firstProfileRepo = new ProfileRepository(first.db!.db);
      firstProfileRepo.create({
        profileId: "stale-main-conflict-profile",
        name: "Stale Main Conflict Profile",
        personalityPrompt: "Stale conflicting profile.",
      });
      // Simulate stale existing-space data via direct DB mutation: add a second
      // primary/coordinator assignment while keeping canonical assignment intact.
      first.db?.db.query(
        `INSERT INTO space_agent_assignments (
          space_id,
          agent_id,
          profile_id,
          security_scope_json,
          spawn_context,
          context_overrides_json,
          role,
          turn_order,
          is_primary,
          assigned_at,
          updated_at
        ) VALUES (?, ?, ?, NULL, NULL, NULL, 'global_coordinator', 1, 1, ?, ?)`,
      ).run(
        config.mainSpaceId,
        "stale-main-conflict-agent",
        "stale-main-conflict-profile",
        nowIso,
        nowIso,
      );

      await first.shutdown();
      first = null;

      second = await startGateway({
        ...config,
        port: randomPort(),
        mainAgentAutoRepairEnabled: false,
      });

      const preSwapRows = second.db?.db.query(
        `SELECT agent_id, role, is_primary
         FROM space_agent_assignments
         WHERE space_id = ?
         ORDER BY agent_id ASC`,
      ).all(config.mainSpaceId) as Array<{
        agent_id: string;
        role: string;
        is_primary: number;
      }>;
      const preSwapMainCandidates = preSwapRows.filter((row) =>
        row.is_primary === 1 || row.role === "global_coordinator");
      expect(preSwapMainCandidates.length).toBe(2);

      let strictError: unknown;
      try {
        await second.gatewayAdminService.getMainAgent({
          spaceId: config.mainSpaceId,
          repairIfMissing: false,
        });
      } catch (error) {
        strictError = error;
      }
      expect(gatewayErrorCode(strictError)).toBe("FAILED_PRECONDITION");

      const swapped = await second.gatewayAdminService.setMainAgent({
        spaceId: config.mainSpaceId,
        selectionMode: "provider_model",
        providerId: "openai",
        modelId: "gpt-4.1-mini",
      });
      expect(swapped.providerHint).toBe("openai");
      expect(swapped.modelConfig.preferredModels[0]).toBe("openai/gpt-4.1-mini");

      const assignmentRows = second.db?.db.query(
        `SELECT agent_id, role, is_primary
         FROM space_agent_assignments
         WHERE space_id = ?
         ORDER BY agent_id ASC`,
      ).all(config.mainSpaceId) as Array<{
        agent_id: string;
        role: string;
        is_primary: number;
      }>;
      const activeMainCandidates = assignmentRows.filter((row) =>
        row.is_primary === 1 || row.role === "global_coordinator");
      expect(activeMainCandidates.length).toBe(1);
      expect(activeMainCandidates[0]?.agent_id).toBe(config.mainAgentId);
      expect(activeMainCandidates[0]?.role).toBe("global_coordinator");
      expect(activeMainCandidates[0]?.is_primary).toBe(1);
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

  test("persists runtime/model main-agent selection across restart", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const dbPath = join(tmpdir(), `spaceskit-main-agent-selection-${crypto.randomUUID()}.db`);
    const previousGatewayProfile = Bun.env.SPACESKIT_GATEWAY_PROFILE;
    const config = {
      port: randomPort(),
      host: "127.0.0.1",
      dbPath,
      logLevel: "error" as const,
      runtimeGeneration: "test_main_agent_selection_persistence_generation",
      mainSpaceId: "main-space-selection-persist-test",
      mainProfileId: "main-profile-selection-persist-test",
      mainAgentId: "main-agent-selection-persist-test",
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

      second = await startGateway({
        ...config,
        port: randomPort(),
      });

      const state = await second.gatewayAdminService.getMainAgent({
        spaceId: config.mainSpaceId,
        repairIfMissing: true,
      });
      expect(state.providerHint).toBe("openai");
      expect(state.modelConfig.preferredModels[0]).toBe("openai/gpt-4.1");
      expect(state.status === "healthy" || state.status === "repaired").toBe(true);
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

  test("rejects provider_model main-agent swap when model prefix mismatches provider", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const dbPath = join(tmpdir(), `spaceskit-main-agent-provider-prefix-${crypto.randomUUID()}.db`);
    const previousGatewayProfile = Bun.env.SPACESKIT_GATEWAY_PROFILE;
    const config = {
      port: randomPort(),
      host: "127.0.0.1",
      dbPath,
      logLevel: "error" as const,
      runtimeGeneration: "test_main_agent_provider_prefix_validation_generation",
      mainSpaceId: "main-space-provider-prefix-test",
      mainProfileId: "main-profile-provider-prefix-test",
      mainAgentId: "main-agent-provider-prefix-test",
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

      let caught: unknown;
      try {
        await instance.gatewayAdminService.setMainAgent({
          spaceId: config.mainSpaceId,
          selectionMode: "provider_model",
          providerId: "openai",
          modelId: "anthropic/claude-sonnet-4-5",
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeDefined();
      expect(gatewayErrorCode(caught)).toBe("INVALID_ARGUMENT");
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

  test("rejects LM Studio main-agent swap when selected model is not loaded in runtime", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const dbPath = join(tmpdir(), `spaceskit-main-agent-lmstudio-validation-${crypto.randomUUID()}.db`);
    const previousGatewayProfile = Bun.env.SPACESKIT_GATEWAY_PROFILE;
    const previousMasterKey = Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY;
    const previousHttpPrincipalSecret = Bun.env.SPACESKIT_HTTP_PRINCIPAL_AUTH_HS256_SECRET;
    const originalFetch = globalThis.fetch;
    const config = {
      port: randomPort(),
      host: "127.0.0.1",
      dbPath,
      logLevel: "error" as const,
      runtimeGeneration: "test_main_agent_lmstudio_runtime_validation_generation",
      mainSpaceId: "main-space-lmstudio-validation-test",
      mainProfileId: "main-profile-lmstudio-validation-test",
      mainAgentId: "main-agent-lmstudio-validation-test",
    };

    let instance: Awaited<ReturnType<typeof startGateway>> | null = null;
    try {
      Bun.env.SPACESKIT_GATEWAY_PROFILE = "external";
      Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY = "test-main-agent-lmstudio-validation-master-key";
      Bun.env.SPACESKIT_HTTP_PRINCIPAL_AUTH_HS256_SECRET = "test-http-principal-secret";
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

      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            data: [{ id: "google/gemma-3-4b" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as typeof fetch;

      let caught: unknown;
      try {
        await instance.gatewayAdminService.setMainAgent({
          spaceId: config.mainSpaceId,
          selectionMode: "provider_model",
          providerId: "lmstudio",
          modelId: "lmstudio/qwen2.5-coder",
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeDefined();
      expect(gatewayErrorCode(caught)).toBe("FAILED_PRECONDITION");
      expect(gatewayErrorMessage(caught)).toContain("not loaded in LM Studio runtime");
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
});
