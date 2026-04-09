import { afterEach, describe, expect, test } from "bun:test";
import { initDatabase } from "../src/database.js";
import { GatewayLinkedSkillIndexRepository } from "../src/repositories/gateway-linked-skill-index.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
});

function createInMemory() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-linked-skill-index-${crypto.randomUUID()}`,
  });
  dbManagers.push(db);
  return db;
}

describe("GatewayLinkedSkillIndexRepository", () => {
  test("upserts linked entries by source path and preserves stable skill ids across refresh", () => {
    const db = createInMemory();
    const repo = new GatewayLinkedSkillIndexRepository(db.db);

    const created = repo.upsert({
      entryId: "linked:brainstorming",
      skillId: "linked.brainstorming.abcd12",
      sourcePath: "/Users/test/.agents/skills/brainstorming/SKILL.md",
      name: "brainstorming",
      description: "Explore user intent before implementation.",
      contentMarkdown: "# brainstorming",
      tags: ["planning", "design"],
      syncState: "ready",
      fileMtimeMs: 1000,
      fileSize: 250,
      contentHash: "hash-1",
    });

    expect(created.skill_id).toBe("linked.brainstorming.abcd12");
    expect(created.sync_state).toBe("ready");

    const refreshed = repo.upsert({
      entryId: "linked:brainstorming",
      skillId: "linked.brainstorming.abcd12",
      sourcePath: "/Users/test/.agents/skills/brainstorming/SKILL.md",
      name: "brainstorming",
      description: "Updated description",
      contentMarkdown: "# brainstorming\n\nUpdated",
      tags: ["planning"],
      syncState: "ready",
      fileMtimeMs: 2000,
      fileSize: 320,
      contentHash: "hash-2",
    });

    expect(refreshed.skill_id).toBe("linked.brainstorming.abcd12");
    expect(refreshed.description).toBe("Updated description");
    expect(refreshed.file_mtime_ms).toBe(2000);
    expect(repo.getBySourcePath("/Users/test/.agents/skills/brainstorming/SKILL.md")?.content_hash).toBe("hash-2");
    expect(repo.getBySkillId("linked.brainstorming.abcd12")?.source_path).toBe("/Users/test/.agents/skills/brainstorming/SKILL.md");
  });

  test("marks absent entries missing without deleting saved rows", () => {
    const db = createInMemory();
    const repo = new GatewayLinkedSkillIndexRepository(db.db);

    repo.upsert({
      entryId: "linked:brainstorming",
      skillId: "linked.brainstorming.abcd12",
      sourcePath: "/Users/test/.agents/skills/brainstorming/SKILL.md",
      name: "brainstorming",
      contentMarkdown: "# brainstorming",
      tags: [],
      syncState: "ready",
      fileMtimeMs: 1000,
      fileSize: 250,
      contentHash: "hash-1",
    });
    repo.upsert({
      entryId: "linked:tdd",
      skillId: "linked.tdd.efgh34",
      sourcePath: "/Users/test/.agents/skills/tdd/SKILL.md",
      name: "tdd",
      contentMarkdown: "# tdd",
      tags: [],
      syncState: "ready",
      fileMtimeMs: 1500,
      fileSize: 150,
      contentHash: "hash-2",
    });

    repo.markMissingExceptSourcePaths([
      "/Users/test/.agents/skills/brainstorming/SKILL.md",
    ]);

    expect(repo.getBySkillId("linked.brainstorming.abcd12")?.sync_state).toBe("ready");
    expect(repo.getBySkillId("linked.tdd.efgh34")?.sync_state).toBe("missing");
    expect(repo.list().length).toBe(2);
  });
});
