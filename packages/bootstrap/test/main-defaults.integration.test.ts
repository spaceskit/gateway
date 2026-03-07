import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initDatabase, ProfileRepository } from "@spaceskit/persistence";
import { startGateway } from "../src/index.js";
import { MAIN_SPACE_SYSTEM_SKILL_IDS } from "../src/seed/main-space-system-skills.js";

function randomPort(): number {
  return 20_000 + Math.floor(Math.random() * 20_000);
}

function removeDbArtifacts(dbPath: string): void {
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
}

function gatewayErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = (error as { code?: unknown }).code;
  return typeof candidate === "string" ? candidate : undefined;
}

function gatewayErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = (error as { message?: unknown }).message;
  return typeof candidate === "string" ? candidate : undefined;
}

describe("bootstrap main defaults", () => {
  // These tests start real gateway instances and are inherently slow
  const INTEGRATION_TIMEOUT = 30_000;

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
    const previousMasterSpaceName = Bun.env.SPACESKIT_MASTER_SPACE_NAME;
    const previousMasterKey = Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY;

    try {
      delete Bun.env.SPACESKIT_MAIN_SPACE_NAME;
      delete Bun.env.SPACESKIT_MASTER_SPACE_NAME;
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
      if (previousMasterSpaceName === undefined) {
        delete Bun.env.SPACESKIT_MASTER_SPACE_NAME;
      } else {
        Bun.env.SPACESKIT_MASTER_SPACE_NAME = previousMasterSpaceName;
      }
      if (previousMasterKey === undefined) {
        delete Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY;
      } else {
        Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY = previousMasterKey;
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
      expect(row?.provider_hint).toBe("openrouter");
      expect(row?.model_hint).toBe("openrouter/openai/gpt-4.1-mini");
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

  test("uses configured main orchestrator profile when provided", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const dbPath = join(tmpdir(), `spaceskit-main-orchestrator-${crypto.randomUUID()}.db`);
    const previousGatewayProfile = Bun.env.SPACESKIT_GATEWAY_PROFILE;
    const orchestratorProfileId = "orchestrator-profile-test";
    const config = {
      port: randomPort(),
      host: "127.0.0.1",
      dbPath,
      logLevel: "error" as const,
      runtimeGeneration: "test_main_orchestrator_generation",
      mainSpaceId: "main-space-orchestrator-test",
      mainSpaceName: "Main Space Orchestrator Test",
      mainSpaceResourceId: "resource:main:orchestrator:test",
      mainSpaceGoal: "Test orchestrator bootstrap default",
      mainProfileId: "main-profile-orchestrator-test",
      mainOrchestratorProfileId: orchestratorProfileId,
      mainAgentId: "main-agent-orchestrator-test",
    };

    const seeded = initDatabase({
      path: dbPath,
      runtimeGeneration: config.runtimeGeneration,
    });
    try {
      const profiles = new ProfileRepository(seeded.db);
      profiles.create({
        profileId: orchestratorProfileId,
        name: "Orchestrator",
        description: "Dedicated orchestrator profile",
        canModerate: true,
        personalityPrompt: "Act as orchestrator.",
      });
    } finally {
      seeded.close();
    }

    let instance: Awaited<ReturnType<typeof startGateway>> | null = null;
    try {
      Bun.env.SPACESKIT_GATEWAY_PROFILE = "embedded";
      instance = await startGateway(config);
      const space = await instance.spaceAdminService.getSpace(config.mainSpaceId);
      expect(space).not.toBeNull();
      expect(space?.orchestratorProfileId).toBe(orchestratorProfileId);
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

  test("recreates missing canonical main assignment on restart", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const dbPath = join(tmpdir(), `spaceskit-main-assignment-repair-${crypto.randomUUID()}.db`);
    const previousGatewayProfile = Bun.env.SPACESKIT_GATEWAY_PROFILE;
    const config = {
      port: randomPort(),
      host: "127.0.0.1",
      dbPath,
      logLevel: "error" as const,
      runtimeGeneration: "test_main_assignment_repair_generation",
      mainSpaceId: "main-space-assignment-repair-test",
      mainProfileId: "main-profile-assignment-repair-test",
      mainAgentId: "main-agent-assignment-repair-test",
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
        seeded.db.query(
          "DELETE FROM space_agent_assignments WHERE space_id = ? AND agent_id = ?",
        ).run(config.mainSpaceId, config.mainAgentId);
      } finally {
        seeded.close();
      }

      second = await startGateway({
        ...config,
        port: randomPort(),
        mainAgentAutoRepairEnabled: false,
      });

      const row = second.db?.db.query(
        `SELECT profile_id, role, turn_order, is_primary
         FROM space_agent_assignments
         WHERE space_id = ? AND agent_id = ?`,
      ).get(config.mainSpaceId, config.mainAgentId) as {
        profile_id: string;
        role: string;
        turn_order: number;
        is_primary: number;
      } | undefined;

      expect(row).toBeDefined();
      expect(row?.profile_id).toBe(config.mainProfileId);
      expect(row?.role).toBe("global_coordinator");
      expect(row?.turn_order).toBe(0);
      expect(row?.is_primary).toBe(1);
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

  test("restores archived canonical main profile and repairs assignment policy on restart", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const dbPath = join(tmpdir(), `spaceskit-main-profile-restore-${crypto.randomUUID()}.db`);
    const previousGatewayProfile = Bun.env.SPACESKIT_GATEWAY_PROFILE;
    const config = {
      port: randomPort(),
      host: "127.0.0.1",
      dbPath,
      logLevel: "error" as const,
      runtimeGeneration: "test_main_profile_restore_generation",
      mainSpaceId: "main-space-profile-restore-test",
      mainProfileId: "main-profile-restore-test",
      mainAgentId: "main-agent-profile-restore-test",
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
        seeded.db.query(
          "UPDATE agent_profiles SET archived = 1 WHERE profile_id = ?",
        ).run(config.mainProfileId);
        seeded.db.query(
          `UPDATE space_agent_assignments
           SET role = 'participant', turn_order = 9, is_primary = 0
           WHERE space_id = ? AND agent_id = ?`,
        ).run(config.mainSpaceId, config.mainAgentId);
      } finally {
        seeded.close();
      }

      second = await startGateway({
        ...config,
        port: randomPort(),
      });

      const profileRow = second.db?.db.query(
        "SELECT archived FROM agent_profiles WHERE profile_id = ?",
      ).get(config.mainProfileId) as { archived: number } | undefined;
      expect(profileRow?.archived).toBe(0);

      const assignmentRow = second.db?.db.query(
        `SELECT profile_id, role, turn_order, is_primary
         FROM space_agent_assignments
         WHERE space_id = ? AND agent_id = ?`,
      ).get(config.mainSpaceId, config.mainAgentId) as {
        profile_id: string;
        role: string;
        turn_order: number;
        is_primary: number;
      } | undefined;

      expect(assignmentRow).toBeDefined();
      expect(assignmentRow?.profile_id).toBe(config.mainProfileId);
      expect(assignmentRow?.role).toBe("global_coordinator");
      expect(assignmentRow?.turn_order).toBe(0);
      expect(assignmentRow?.is_primary).toBe(1);
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
        profileId: "legacy-main-conflict-profile",
        name: "Legacy Main Conflict Profile",
        personalityPrompt: "Legacy conflicting profile.",
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
        "legacy-main-conflict-agent",
        "legacy-main-conflict-profile",
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
      expect(swapped.modelHint).toBe("openai/gpt-4.1-mini");

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
      expect(state.modelHint).toBe("openai/gpt-4.1");
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
    }
  });

  test("repairs LM Studio pinned model when runtime discovery no longer includes it", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const dbPath = join(tmpdir(), `spaceskit-main-agent-lmstudio-fallback-${crypto.randomUUID()}.db`);
    const previousGatewayProfile = Bun.env.SPACESKIT_GATEWAY_PROFILE;
    const previousMasterKey = Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY;
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

  test("profile_template swap derives provider from model when source provider hint is missing", { timeout: INTEGRATION_TIMEOUT }, async () => {
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
        selectionMode: "profile_template",
        sourceProfileId: "source-template-without-provider",
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
