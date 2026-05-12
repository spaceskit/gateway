import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initDatabase, PersonaRepository, ProfileRepository } from "@spaceskit/persistence";
import { startGateway } from "../src/index.js";
import { DEFAULT_PERSONA_ID, GatewayIdentityService } from "../src/services/gateway-identity-service.js";
import {
  INTEGRATION_TIMEOUT,
  randomPort,
  removeDbArtifacts,
} from "./main-defaults-test-helpers.js";

describe("bootstrap main defaults", () => {
  test("upgrades pre-persona databases and repairs persona assignments", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const dbPath = join(tmpdir(), `spaceskit-persona-upgrade-${crypto.randomUUID()}.db`);
    const legacyProfileId = "legacy-profile-persona-upgrade-test";
    const previousGatewayProfile = Bun.env.SPACESKIT_GATEWAY_PROFILE;

    let gateway: Awaited<ReturnType<typeof startGateway>> | null = null;

    try {
      const seeded = initDatabase({
        path: dbPath,
        runtimeGeneration: "test_pre_persona_seed",
      });
      try {
        const profiles = new ProfileRepository(seeded.db);
        profiles.create({
          profileId: legacyProfileId,
          personaId: "stale-persona",
          name: "Legacy Persona Profile",
          description: "Legacy test profile",
          personalityPrompt: "Stay concise.",
          providerHint: "openai",
          modelHint: "openai/gpt-4.1",
        });

        seeded.db.exec("DROP TABLE IF EXISTS persona_revisions");
        seeded.db.exec("DROP TABLE IF EXISTS personas");
        seeded.db.query("DELETE FROM schema_version WHERE version = ?").run("v3_identity_personas");
      } finally {
        seeded.close();
      }

      Bun.env.SPACESKIT_GATEWAY_PROFILE = "embedded";
      gateway = await startGateway({
        port: randomPort(),
        host: "127.0.0.1",
        dbPath,
        logLevel: "error",
        runtimeGeneration: "test_pre_persona_upgrade",
        mainSpaceId: "persona-upgrade-main-space",
        mainProfileId: "persona-upgrade-main-profile",
        mainAgentId: "persona-upgrade-main-agent",
      });

      const tables = gateway.db?.db.query(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name IN ('personas', 'persona_revisions')
         ORDER BY name`,
      ).all() as Array<{ name: string }>;
      expect(tables.map((row) => row.name)).toEqual(["persona_revisions", "personas"]);

      const defaultPersona = gateway.db?.db.query(
        "SELECT persona_id, archived, is_default FROM personas WHERE persona_id = ?",
      ).get(DEFAULT_PERSONA_ID) as {
        persona_id: string;
        archived: number;
        is_default: number;
      } | null;
      expect(defaultPersona?.persona_id).toBe(DEFAULT_PERSONA_ID);
      expect(defaultPersona?.archived).toBe(0);
      expect(defaultPersona?.is_default).toBe(1);

      const repairedProfile = gateway.db?.db.query(
        "SELECT persona_id FROM agent_profiles WHERE profile_id = ?",
      ).get(legacyProfileId) as { persona_id: string } | null;
      expect(repairedProfile?.persona_id).toBe(DEFAULT_PERSONA_ID);

      const identity = new GatewayIdentityService({
        profiles: new ProfileRepository(gateway.db!.db),
        personas: new PersonaRepository(gateway.db!.db),
        defaultPersonaId: DEFAULT_PERSONA_ID,
      });

      expect(identity.listPersonas(false).map((entry) => entry.personaId)).toContain(DEFAULT_PERSONA_ID);
      expect(identity.listAgentDefinitions(true).map((entry) => entry.agentDefinitionId)).toContain(legacyProfileId);

      const updated = identity.updateAgentDefinition({
        agentDefinitionId: legacyProfileId,
        modelHint: "openai/gpt-4.1-mini",
        modelConfig: {
          preferredModels: ["openai/gpt-4.1-mini"],
        },
      });
      expect(updated.agentDefinition.personaId).toBe(DEFAULT_PERSONA_ID);
      expect(updated.agentDefinition.modelHint).toBe("openai/gpt-4.1-mini");
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
});
