import { afterEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { initDatabase } from "../src/database.js";
import { GatewaySkillCatalogRepository } from "../src/repositories/gateway-skill-catalog.js";
import { AgentPresetRepository } from "../src/repositories/agent-presets.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];
const tempDbPaths = new Set<string>();

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
  for (const path of tempDbPaths) {
    try {
      unlinkSync(path);
    } catch {
      // best-effort cleanup
    }
  }
  tempDbPaths.clear();
});

function createInMemory() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-skill-agent-preset-${crypto.randomUUID()}`,
  });
  dbManagers.push(db);
  return db;
}

describe("GatewaySkillCatalogRepository", () => {
  test("supports CRUD and tag/status filtering", () => {
    const db = createInMemory();
    const repo = new GatewaySkillCatalogRepository(db.db);

    const created = repo.upsert({
      skillId: "custom/test-skill",
      name: "Test Skill",
      description: "for repository CRUD",
      contentMarkdown: "### Skill body",
      sourceRef: "https://example.com/skill",
      tags: ["test", "custom"],
      status: "active",
    });

    expect(created.skill_id).toBe("custom/test-skill");
    expect(created.status).toBe("active");

    const byId = repo.get("custom/test-skill");
    expect(byId?.name).toBe("Test Skill");

    const tagged = repo.list({ status: "all", tags: ["custom"] });
    expect(tagged.some((entry) => entry.skill_id == "custom/test-skill")).toBe(true);

    const archived = repo.upsert({
      skillId: "custom/test-skill",
      name: "Test Skill Updated",
      contentMarkdown: "### Updated",
      tags: ["test"],
      status: "archived",
    });
    expect(archived.status).toBe("archived");

    const activeList = repo.list({ status: "active" });
    expect(activeList.some((entry) => entry.skill_id == "custom/test-skill")).toBe(false);

    expect(repo.delete("custom/test-skill")).toBe(true);
    expect(repo.delete("custom/test-skill")).toBe(false);
  });

  test("seeded skills remain idempotent across restart", () => {
    const path = `/tmp/spaces-gateway-skill-seed-${crypto.randomUUID()}.db`;
    tempDbPaths.add(path);
    const generation = `seed-idempotency-${crypto.randomUUID()}`;

    const first = initDatabase({
      path,
      runtimeGeneration: generation,
    });
    const firstRepo = new GatewaySkillCatalogRepository(first.db);
    const firstSeedIds = firstRepo.list({ status: "all" }).map((entry) => entry.skill_id);
    expect(firstSeedIds.filter((value) => value === "anthropic/pdf").length).toBe(1);
    expect(firstSeedIds.filter((value) => value === "openai/gh-address-comments").length).toBe(1);
    first.close();

    const second = initDatabase({
      path,
      runtimeGeneration: generation,
    });
    dbManagers.push(second);
    const secondRepo = new GatewaySkillCatalogRepository(second.db);
    const secondSeedIds = secondRepo.list({ status: "all" }).map((entry) => entry.skill_id);
    expect(secondSeedIds.filter((value) => value === "anthropic/pdf").length).toBe(1);
    expect(secondSeedIds.filter((value) => value === "openai/gh-address-comments").length).toBe(1);
  });
});

describe("AgentPresetRepository", () => {
  test("upsert creates revisions and archive hides from active list", () => {
    const db = createInMemory();
    const repo = new AgentPresetRepository(db.db);

    const created = repo.upsertWithNewRevision({
      presetId: "agent-preset-test",
      ownerPrincipalId: "principal-1",
      name: "Research Team",
      description: "agent preset",
      presetConfigJson: JSON.stringify({
        schemaVersion: 1,
        defaultAgents: [{ agentId: "agent-a", profileId: "profile-a", role: "participant", turnOrder: 0 }],
        tags: ["research"],
        metadata: { createdBy: "principal-1", source: "user" },
      }),
    });

    expect(created.created).toBe(true);
    expect(created.revision.revision).toBe(1);

    const updated = repo.upsertWithNewRevision({
      presetId: "agent-preset-test",
      ownerPrincipalId: "principal-1",
      name: "Research Team v2",
      description: "updated",
      presetConfigJson: JSON.stringify({
        schemaVersion: 1,
        defaultAgents: [{ agentId: "agent-b", profileId: "profile-b", role: "global_coordinator", turnOrder: 0 }],
        tags: ["research", "lead"],
        metadata: { createdBy: "principal-1", source: "user" },
      }),
    });

    expect(updated.created).toBe(false);
    expect(updated.revision.revision).toBe(2);
    expect(repo.listRevisions("agent-preset-test").map((row) => row.revision)).toEqual([2, 1]);
    expect(repo.getById("agent-preset-test")?.active_revision).toBe(2);

    const activeBeforeArchive = repo.list({ ownerPrincipalId: "principal-1" });
    expect(activeBeforeArchive.some((row) => row.preset_id === "agent-preset-test")).toBe(true);

    expect(repo.archive("agent-preset-test")).toBe(true);
    expect(repo.archive("agent-preset-test")).toBe(false);

    const activeAfterArchive = repo.list({ ownerPrincipalId: "principal-1" });
    expect(activeAfterArchive.some((row) => row.preset_id === "agent-preset-test")).toBe(false);
  });
});
