import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { USER_ESCALATION_SKILL_ID } from "@spaceskit/core";
import { startGateway } from "../src/index.js";
import { MAIN_SPACE_SYSTEM_SKILL_IDS } from "../src/seed/main-space-system-skills.js";
import {
  INTEGRATION_TIMEOUT,
  randomPort,
  removeDbArtifacts,
} from "./main-defaults-test-helpers.js";

describe("bootstrap main defaults", () => {
  test("defaults main space and profile names by gateway profile", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const embeddedDbPath = join(tmpdir(), `spaceskit-main-defaults-embedded-${crypto.randomUUID()}.db`);
    const externalDbPath = join(tmpdir(), `spaceskit-main-defaults-external-${crypto.randomUUID()}.db`);

    let embedded: Awaited<ReturnType<typeof startGateway>> | null = null;
    let external: Awaited<ReturnType<typeof startGateway>> | null = null;
    const embeddedMainSpaceId = "embedded-profile-main-space-test";
    const externalMainSpaceId = "external-profile-main-space-test";
    const embeddedMainProfileId = "embedded-profile-main-agent-test";
    const externalMainProfileId = "external-profile-main-agent-test";
    const previousGatewayProfile = Bun.env.SPACESKIT_GATEWAY_PROFILE;
    const previousMainSpaceName = Bun.env.SPACESKIT_MAIN_SPACE_NAME;
    const previousMasterKey = Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY;
    const previousHttpPrincipalSecret = Bun.env.SPACESKIT_HTTP_PRINCIPAL_AUTH_HS256_SECRET;

    try {
      delete Bun.env.SPACESKIT_MAIN_SPACE_NAME;
      Bun.env.SPACESKIT_GATEWAY_PROFILE = "embedded";
      embedded = await startGateway({
        port: randomPort(),
        host: "127.0.0.1",
        dbPath: embeddedDbPath,
        logLevel: "error",
        runtimeGeneration: "test_main_defaults_embedded_profile_name",
        mainSpaceId: embeddedMainSpaceId,
        mainProfileId: embeddedMainProfileId,
        mainAgentId: "embedded-profile-main-agent-id-test",
      });

      const embeddedSpace = await embedded.spaceAdminService.getSpace(embeddedMainSpaceId);
      expect(embeddedSpace).not.toBeNull();
      expect(embeddedSpace?.name).toBe("Embedded Main Space");

      const embeddedProfile = embedded.db?.db.query(
        "SELECT name FROM agent_profiles WHERE profile_id = ?",
      ).get(embeddedMainProfileId) as { name: string } | undefined;
      expect(embeddedProfile?.name).toBe("Embedded Main Agent");
      const embeddedMainRevision = embedded.db?.db.query(
        "SELECT default_skill_set_ids_json FROM agent_profile_revisions WHERE profile_id = ? AND revision = 1",
      ).get(embeddedMainProfileId) as { default_skill_set_ids_json: string } | undefined;
      expect(JSON.parse(embeddedMainRevision?.default_skill_set_ids_json ?? "[]")).toContain(USER_ESCALATION_SKILL_ID);
      const embeddedConciergeRevision = embedded.db?.db.query(
        "SELECT default_skill_set_ids_json FROM agent_profile_revisions WHERE profile_id = ? AND revision = 1",
      ).get("concierge-profile") as { default_skill_set_ids_json: string } | undefined;
      expect(JSON.parse(embeddedConciergeRevision?.default_skill_set_ids_json ?? "[]")).toContain(USER_ESCALATION_SKILL_ID);

      const embeddedSkillRows = embedded.db?.db.query(
        `SELECT skill_id, status
         FROM gateway_skill_catalog
         WHERE skill_id = ? OR skill_id = ? OR skill_id = ?
         ORDER BY skill_id ASC`,
      ).all(...MAIN_SPACE_SYSTEM_SKILL_IDS) as Array<{ skill_id: string; status: string }>;
      expect(embeddedSkillRows.map((row) => row.skill_id)).toEqual([...MAIN_SPACE_SYSTEM_SKILL_IDS].sort());
      expect(embeddedSkillRows.every((row) => row.status === "active")).toBe(true);

      const embeddedAssignments = embedded.db?.db.query(
        `SELECT skill_id
         FROM space_skills
         WHERE space_id = ?
         ORDER BY skill_id ASC`,
      ).all(embeddedMainSpaceId) as Array<{ skill_id: string }>;
      expect(embeddedAssignments.map((row) => row.skill_id)).toEqual([...MAIN_SPACE_SYSTEM_SKILL_IDS].sort());

      Bun.env.SPACESKIT_GATEWAY_PROFILE = "external";
      Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY = "test-master-key-for-external-profile";
      Bun.env.SPACESKIT_HTTP_PRINCIPAL_AUTH_HS256_SECRET = "test-http-principal-secret";
      external = await startGateway({
        port: randomPort(),
        host: "127.0.0.1",
        dbPath: externalDbPath,
        logLevel: "error",
        archFreezeEnforced: false,
        runtimeGeneration: "test_main_defaults_external_profile_name",
        mainSpaceId: externalMainSpaceId,
        mainProfileId: externalMainProfileId,
        mainAgentId: "external-profile-main-agent-id-test",
      });

      const externalSpace = await external.spaceAdminService.getSpace(externalMainSpaceId);
      expect(externalSpace).not.toBeNull();
      expect(externalSpace?.name).toBe("External Main Space");

      const externalProfile = external.db?.db.query(
        "SELECT name FROM agent_profiles WHERE profile_id = ?",
      ).get(externalMainProfileId) as { name: string } | undefined;
      expect(externalProfile?.name).toBe("External Main Agent");
      const externalMainRevision = external.db?.db.query(
        "SELECT default_skill_set_ids_json FROM agent_profile_revisions WHERE profile_id = ? AND revision = 1",
      ).get(externalMainProfileId) as { default_skill_set_ids_json: string } | undefined;
      expect(JSON.parse(externalMainRevision?.default_skill_set_ids_json ?? "[]")).toContain(USER_ESCALATION_SKILL_ID);

      const externalSkillRows = external.db?.db.query(
        `SELECT skill_id, status
         FROM gateway_skill_catalog
         WHERE skill_id = ? OR skill_id = ? OR skill_id = ?
         ORDER BY skill_id ASC`,
      ).all(...MAIN_SPACE_SYSTEM_SKILL_IDS) as Array<{ skill_id: string; status: string }>;
      expect(externalSkillRows.map((row) => row.skill_id)).toEqual([...MAIN_SPACE_SYSTEM_SKILL_IDS].sort());
      expect(externalSkillRows.every((row) => row.status === "active")).toBe(true);

      const externalAssignments = external.db?.db.query(
        `SELECT skill_id
         FROM space_skills
         WHERE space_id = ?
         ORDER BY skill_id ASC`,
      ).all(externalMainSpaceId) as Array<{ skill_id: string }>;
      expect(externalAssignments.map((row) => row.skill_id)).toEqual([...MAIN_SPACE_SYSTEM_SKILL_IDS].sort());
    } finally {
      try {
        await embedded?.shutdown();
      } catch {}
      try {
        await external?.shutdown();
      } catch {}
      removeDbArtifacts(embeddedDbPath);
      removeDbArtifacts(externalDbPath);
      if (previousGatewayProfile === undefined) {
        delete Bun.env.SPACESKIT_GATEWAY_PROFILE;
      } else {
        Bun.env.SPACESKIT_GATEWAY_PROFILE = previousGatewayProfile;
      }
      if (previousMainSpaceName === undefined) {
        delete Bun.env.SPACESKIT_MAIN_SPACE_NAME;
      } else {
        Bun.env.SPACESKIT_MAIN_SPACE_NAME = previousMainSpaceName;
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

  test("ensures main profile/space/assignment and remains idempotent across restart", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const dbPath = join(tmpdir(), `spaceskit-main-defaults-${crypto.randomUUID()}.db`);
    const previousGatewayProfile = Bun.env.SPACESKIT_GATEWAY_PROFILE;

    const config = {
      port: randomPort(),
      host: "127.0.0.1",
      dbPath,
      logLevel: "error" as const,
      runtimeGeneration: "test_main_defaults_generation",
      mainSpaceId: "main-space-test",
      mainSpaceName: "Main Space Test",
      mainSpaceResourceId: "resource:main:test",
      mainSpaceGoal: "Test bootstrap defaults",
      mainProfileId: "main-profile-test",
      mainAgentId: "main-agent-test",
    };

    let first: Awaited<ReturnType<typeof startGateway>> | null = null;
    let second: Awaited<ReturnType<typeof startGateway>> | null = null;

    try {
      Bun.env.SPACESKIT_GATEWAY_PROFILE = "embedded";
      first = await startGateway(config);

      const firstSpace = await first.spaceAdminService.getSpace(config.mainSpaceId);
      expect(firstSpace).not.toBeNull();
      expect(firstSpace?.name).toBe(config.mainSpaceName);
      expect(firstSpace?.resourceId).toBe(config.mainSpaceResourceId);

      const firstAssignment = firstSpace?.agents.find(
        (assignment) => assignment.agentId === config.mainAgentId,
      );
      expect(firstAssignment).toBeDefined();
      expect(firstAssignment?.profileId).toBe(config.mainProfileId);
      expect(firstAssignment?.role).toBe("global_coordinator");
      expect(firstAssignment?.isPrimary).toBe(true);

      const firstDb = first.db?.db;
      expect(firstDb).toBeDefined();
      const firstProfileCount = firstDb!.query(
        "SELECT COUNT(*) AS count FROM agent_profiles WHERE profile_id = ?",
      ).get(config.mainProfileId) as { count: number };
      expect(firstProfileCount.count).toBe(1);

      await first.shutdown();
      first = null;

      second = await startGateway({
        ...config,
        port: randomPort(),
        mainAgentAutoRepairEnabled: false,
      });

      const secondSpace = await second.spaceAdminService.getSpace(config.mainSpaceId);
      expect(secondSpace).not.toBeNull();

      const secondDb = second.db?.db;
      expect(secondDb).toBeDefined();

      const profileCount = secondDb!.query(
        "SELECT COUNT(*) AS count FROM agent_profiles WHERE profile_id = ?",
      ).get(config.mainProfileId) as { count: number };
      expect(profileCount.count).toBe(1);

      const spaceCount = secondDb!.query(
        "SELECT COUNT(*) AS count FROM spaces WHERE space_id = ?",
      ).get(config.mainSpaceId) as { count: number };
      expect(spaceCount.count).toBe(1);

      const assignmentCount = secondDb!.query(
        "SELECT COUNT(*) AS count FROM space_agent_assignments WHERE space_id = ? AND agent_id = ?",
      ).get(config.mainSpaceId, config.mainAgentId) as { count: number };
      expect(assignmentCount.count).toBe(1);

      const assignmentRow = secondDb!.query(
        "SELECT profile_id, role, turn_order, is_primary FROM space_agent_assignments WHERE space_id = ? AND agent_id = ?",
      ).get(config.mainSpaceId, config.mainAgentId) as {
        profile_id: string;
        role: string;
        turn_order: number;
        is_primary: number;
      };
      expect(assignmentRow.profile_id).toBe(config.mainProfileId);
      expect(assignmentRow.role).toBe("global_coordinator");
      expect(assignmentRow.turn_order).toBe(0);
      expect(assignmentRow.is_primary).toBe(1);
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

  test("selects first available runtime/model for main profile when defaults are unset", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const dbPath = join(tmpdir(), `spaceskit-main-provider-selection-${crypto.randomUUID()}.db`);
    const previousModelProvider = Bun.env.SPACESKIT_MODEL_PROVIDER;
    const previousModel = Bun.env.SPACESKIT_MODEL;
    const previousOpenRouterKey = Bun.env.OPENROUTER_API_KEY;
    const previousGatewayProfile = Bun.env.SPACESKIT_GATEWAY_PROFILE;

    let instance: Awaited<ReturnType<typeof startGateway>> | null = null;
    try {
      delete Bun.env.SPACESKIT_MODEL_PROVIDER;
      delete Bun.env.SPACESKIT_MODEL;
      Bun.env.SPACESKIT_GATEWAY_PROFILE = "embedded";
      Bun.env.OPENROUTER_API_KEY = "test-openrouter-key";

      const mainProfileId = "main-profile-provider-selection-test";
      instance = await startGateway({
        port: randomPort(),
        host: "127.0.0.1",
        dbPath,
        logLevel: "error",
        runtimeGeneration: "test_main_provider_selection",
        mainSpaceId: "main-space-provider-selection-test",
        mainProfileId,
        mainAgentId: "main-agent-provider-selection-test",
      });

      const row = instance.db?.db.query(
        `SELECT provider_hint, model_hint
         FROM agent_profile_revisions
         WHERE profile_id = ?
         ORDER BY revision DESC
         LIMIT 1`,
      ).get(mainProfileId) as { provider_hint: string; model_hint: string } | undefined;

      expect(row).toBeDefined();
      // CLI/app-server providers are auto-seeded when detected on PATH
      // and take priority over API-key providers. Codex app server is preferred
      // when available; otherwise the resolver falls through to the next
      // detected CLI or configured API-key provider.
      const validProviders = ["codex-app-server", "claude", "codex", "gemini", "openrouter"];
      expect(validProviders).toContain(row?.provider_hint);
      expect(row!.model_hint).toStartWith(`${row!.provider_hint}/`);
    } finally {
      try {
        await instance?.shutdown();
      } catch {}
      removeDbArtifacts(dbPath);
      if (previousModelProvider === undefined) {
        delete Bun.env.SPACESKIT_MODEL_PROVIDER;
      } else {
        Bun.env.SPACESKIT_MODEL_PROVIDER = previousModelProvider;
      }
      if (previousModel === undefined) {
        delete Bun.env.SPACESKIT_MODEL;
      } else {
        Bun.env.SPACESKIT_MODEL = previousModel;
      }
      if (previousOpenRouterKey === undefined) {
        delete Bun.env.OPENROUTER_API_KEY;
      } else {
        Bun.env.OPENROUTER_API_KEY = previousOpenRouterKey;
      }
      if (previousGatewayProfile === undefined) {
        delete Bun.env.SPACESKIT_GATEWAY_PROFILE;
      } else {
        Bun.env.SPACESKIT_GATEWAY_PROFILE = previousGatewayProfile;
      }
    }
  });
});
