import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initDatabase, ProfileRepository } from "@spaceskit/persistence";
import { startGateway } from "../src/index.js";
import {
  INTEGRATION_TIMEOUT,
  randomPort,
  removeDbArtifacts,
} from "./main-defaults-test-helpers.js";

describe("bootstrap main defaults", () => {
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
});
