import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initDatabase } from "@spaceskit/persistence";
import { startGateway } from "../src/index.js";
import {
  INTEGRATION_TIMEOUT,
  gatewayErrorCode,
  gatewayErrorMessage,
  randomPort,
  removeDbArtifacts,
} from "./main-defaults-test-helpers.js";

describe("bootstrap main defaults", () => {
  test("bootstraps concierge defaults alongside main defaults", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const dbPath = join(tmpdir(), `spaceskit-concierge-defaults-${crypto.randomUUID()}.db`);
    const previousGatewayProfile = Bun.env.SPACESKIT_GATEWAY_PROFILE;

    let gateway: Awaited<ReturnType<typeof startGateway>> | null = null;

    try {
      Bun.env.SPACESKIT_GATEWAY_PROFILE = "embedded";
      gateway = await startGateway({
        port: randomPort(),
        host: "127.0.0.1",
        dbPath,
        logLevel: "error",
        runtimeGeneration: "test_concierge_defaults_embedded",
        mainSpaceId: "main-space-test",
        mainProfileId: "main-profile-test",
        mainAgentId: "main-agent-test",
        conciergeSpaceId: "concierge-space-test",
        conciergeProfileId: "concierge-profile-test",
        conciergeAgentId: "concierge-agent-test",
      });

      const conciergeSpace = await gateway.spaceAdminService.getSpace("concierge-space-test");
      expect(conciergeSpace).not.toBeNull();
      expect(conciergeSpace?.name).toBe("Embedded Concierge");
      expect(conciergeSpace?.resourceId).toBe("system.concierge.backing-space.concierge-space-test");
      expect(conciergeSpace?.visibility).toBe("private");
      expect(conciergeSpace?.agents.map((assignment) => assignment.agentId)).toContain("concierge-agent-test");

      const conciergeProfile = gateway.db?.db.query(
        "SELECT profile_id, name FROM agent_profiles WHERE profile_id = ?",
      ).get("concierge-profile-test") as {
        profile_id: string;
        name: string;
      } | null;
      expect(conciergeProfile?.profile_id).toBe("concierge-profile-test");
      expect(conciergeProfile?.name).toBe("Embedded Concierge");

      const conciergeRevision = gateway.db?.db.query(
        `SELECT model_hint
         FROM agent_profile_revisions
         WHERE profile_id = ?
         ORDER BY revision DESC
         LIMIT 1`,
      ).get("concierge-profile-test") as { model_hint?: string } | null;
      expect(typeof conciergeRevision?.model_hint).toBe("string");
    } finally {
      try {
        await gateway?.shutdown();
      } catch {}
      removeDbArtifacts(dbPath);
      if (previousGatewayProfile === undefined) {
        delete Bun.env.SPACESKIT_GATEWAY_PROFILE;
      } else {
        Bun.env.SPACESKIT_GATEWAY_PROFILE = previousGatewayProfile;
      }
    }
  });

  test("repairs legacy concierge backing-space metadata on startup without changing pinned runtime", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const dbPath = join(tmpdir(), `spaceskit-concierge-repair-${crypto.randomUUID()}.db`);
    const previousGatewayProfile = Bun.env.SPACESKIT_GATEWAY_PROFILE;
    const config = {
      port: randomPort(),
      host: "127.0.0.1",
      dbPath,
      logLevel: "error" as const,
      runtimeGeneration: "test_concierge_space_repair_generation",
      mainSpaceId: "main-space-concierge-repair-test",
      mainProfileId: "main-profile-concierge-repair-test",
      mainAgentId: "main-agent-concierge-repair-test",
      conciergeSpaceId: "concierge-space-concierge-repair-test",
      conciergeProfileId: "concierge-profile-concierge-repair-test",
      conciergeAgentId: "concierge-agent-concierge-repair-test",
      conciergeSpaceGoal: "Dedicated concierge backing space for app navigation, routing, and call continuity.",
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
      await first.gatewayAdminService.setConciergeAgent({
        spaceId: config.conciergeSpaceId,
        selectionMode: "provider_model",
        providerId: "openai",
        modelId: "openai/gpt-4.1",
      });
      await first.shutdown();
      first = null;

      const seeded = initDatabase({
        path: dbPath,
        runtimeGeneration: config.runtimeGeneration,
      });
      try {
        seeded.db.query(
          `UPDATE spaces
           SET resource_id = ?,
               space_type = ?,
               name = ?,
               goal = ?,
               space_config_json = ?,
               updated_at = ?
           WHERE space_id = ?`,
        ).run(
          "resource:concierge",
          "main",
          "Embedded Concierge Leak",
          "Wrong goal",
          JSON.stringify({
            visibility: "shared",
            orchestratorProfileId: "legacy-concierge-profile",
            spaceUid: "legacy-concierge-space-uid",
          }),
          new Date().toISOString(),
          config.conciergeSpaceId,
        );
        seeded.db.query(
          `UPDATE space_agent_assignments
           SET profile_id = ?,
               role = ?,
               turn_order = ?,
               is_primary = ?,
               updated_at = ?
           WHERE space_id = ?
             AND agent_id = ?`,
        ).run(
          "legacy-concierge-profile",
          "participant",
          9,
          0,
          new Date().toISOString(),
          config.conciergeSpaceId,
          config.conciergeAgentId,
        );
      } finally {
        seeded.close();
      }

      second = await startGateway({
        ...config,
        port: randomPort(),
      });

      const repairedRow = second.db?.db.query(
        `SELECT resource_id, space_type, name, goal, space_config_json
         FROM spaces
         WHERE space_id = ?`,
      ).get(config.conciergeSpaceId) as {
        resource_id: string;
        space_type: string;
        name: string;
        goal: string;
        space_config_json: string | null;
      } | null;
      expect(repairedRow?.resource_id).toBe(`system.concierge.backing-space.${config.conciergeSpaceId}`);
      expect(repairedRow?.space_type).toBe("concierge");
      expect(repairedRow?.name).toBe("Embedded Concierge");
      expect(repairedRow?.goal).toBe(config.conciergeSpaceGoal);
      expect(JSON.parse(repairedRow?.space_config_json ?? "{}").visibility).toBe("private");
      expect(JSON.parse(repairedRow?.space_config_json ?? "{}").orchestratorProfileId).toBe(config.conciergeProfileId);

      const repairedSpace = await second.spaceAdminService.getSpace(config.conciergeSpaceId);
      expect(repairedSpace?.visibility).toBe("private");
      expect(repairedSpace?.orchestratorProfileId).toBe(config.conciergeProfileId);
      expect(repairedSpace?.agents[0]?.profileId).toBe(config.conciergeProfileId);
      expect(repairedSpace?.agents[0]?.role).toBe("global_coordinator");
      expect(repairedSpace?.agents[0]?.turnOrder).toBe(0);
      expect(repairedSpace?.agents[0]?.isPrimary).toBe(true);

      const state = await second.gatewayAdminService.getConciergeAgent({
        spaceId: config.conciergeSpaceId,
        repairIfMissing: true,
      });
      expect(state.providerHint).toBe("openai");
      expect(state.modelHint).toBe("openai/gpt-4.1");
      expect(state.fallbackApplied).toBe(false);
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

  test("does not silently fall back pinned concierge runtime when LM Studio model disappears", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const dbPath = join(tmpdir(), `spaceskit-concierge-lmstudio-pinned-${crypto.randomUUID()}.db`);
    const previousGatewayProfile = Bun.env.SPACESKIT_GATEWAY_PROFILE;
    const previousMasterKey = Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY;
    const previousHttpPrincipalSecret = Bun.env.SPACESKIT_HTTP_PRINCIPAL_AUTH_HS256_SECRET;
    const originalFetch = globalThis.fetch;
    const config = {
      port: randomPort(),
      host: "127.0.0.1",
      dbPath,
      logLevel: "error" as const,
      runtimeGeneration: "test_concierge_lmstudio_pinned_generation",
      mainSpaceId: "main-space-concierge-lmstudio-test",
      mainProfileId: "main-profile-concierge-lmstudio-test",
      mainAgentId: "main-agent-concierge-lmstudio-test",
      conciergeSpaceId: "concierge-space-concierge-lmstudio-test",
      conciergeProfileId: "concierge-profile-concierge-lmstudio-test",
      conciergeAgentId: "concierge-agent-concierge-lmstudio-test",
    };

    let detectedModels = ["qwen2.5-coder"];
    let instance: Awaited<ReturnType<typeof startGateway>> | null = null;

    try {
      Bun.env.SPACESKIT_GATEWAY_PROFILE = "external";
      Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY = "test-concierge-lmstudio-master-key";
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
      await instance.gatewayAdminService.setConciergeAgent({
        spaceId: config.conciergeSpaceId,
        selectionMode: "provider_model",
        providerId: "lmstudio",
        modelId: "lmstudio/qwen2.5-coder",
      });

      detectedModels = ["google/gemma-3-4b"];

      let caught: unknown;
      try {
        await instance.gatewayAdminService.getConciergeAgent({
          spaceId: config.conciergeSpaceId,
          repairIfMissing: true,
        });
      } catch (error) {
        caught = error;
      }

      expect(gatewayErrorCode(caught)).toBe("FAILED_PRECONDITION");
      expect(gatewayErrorMessage(caught)).toContain("not loaded in LM Studio runtime");

      const revision = instance.db?.db.query(
        `SELECT model_hint
         FROM agent_profile_revisions
         WHERE profile_id = ?
         ORDER BY revision DESC
         LIMIT 1`,
      ).get(config.conciergeProfileId) as { model_hint?: string } | null;
      expect(revision?.model_hint).toBe("lmstudio/qwen2.5-coder");
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
