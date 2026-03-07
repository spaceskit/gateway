import { afterEach, describe, expect, test } from "bun:test";
import { initDatabase } from "../src/database.js";
import { KnowledgeBaseEntryRepository } from "../src/repositories/knowledge-base.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
});

function createRepository() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-kb-repo-${crypto.randomUUID()}`,
  });
  dbManagers.push(db);
  return new KnowledgeBaseEntryRepository(db.db);
}

describe("KnowledgeBaseEntryRepository", () => {
  test("upserts and preserves created_at while updating updated_at", () => {
    const repo = createRepository();

    const created = repo.upsert({
      entryId: "kb-1",
      name: "Codex Docs",
      kind: "web",
      uri: "https://platform.openai.com/docs",
      tags: ["docs", "api"],
      scopeType: "global",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const updated = repo.upsert({
      entryId: "kb-1",
      name: "Codex API Docs",
      kind: "web",
      uri: "https://platform.openai.com/docs/api-reference",
      description: "Main API reference",
      tags: ["docs", "reference"],
      scopeType: "global",
    });

    expect(created.created_at).toBe("2026-01-01T00:00:00.000Z");
    expect(updated.created_at).toBe("2026-01-01T00:00:00.000Z");
    expect(Date.parse(updated.updated_at)).toBeGreaterThanOrEqual(Date.parse(created.updated_at));
    expect(updated.name).toBe("Codex API Docs");
    expect(updated.description).toBe("Main API reference");
  });

  test("lists global + matching space entries and filters by tags/query", () => {
    const repo = createRepository();

    repo.upsert({
      entryId: "kb-global",
      name: "Global Runbook",
      kind: "web",
      uri: "https://example.com/runbook",
      tags: ["docs", "runbook"],
      scopeType: "global",
    });

    repo.upsert({
      entryId: "kb-space-a",
      name: "Space A Local Docs",
      kind: "folder",
      uri: "file:///Users/demo/docs/space-a",
      tags: ["local", "docs"],
      scopeType: "space",
      spaceId: "space-a",
    });

    repo.upsert({
      entryId: "kb-space-b",
      name: "Space B Reference",
      kind: "file",
      uri: "file:///Users/demo/docs/space-b.md",
      tags: ["local", "reference"],
      scopeType: "space",
      spaceId: "space-b",
    });

    const scoped = repo.list({ spaceId: "space-a" });
    expect(scoped.map((row) => row.entry_id).sort()).toEqual(["kb-global", "kb-space-a"]);

    const filteredByTag = repo.list({ spaceId: "space-a", tags: ["runbook"] });
    expect(filteredByTag.map((row) => row.entry_id)).toEqual(["kb-global"]);

    const filteredByQuery = repo.list({ query: "space b" });
    expect(filteredByQuery.map((row) => row.entry_id)).toEqual(["kb-space-b"]);
  });

  test("deletes entries by entry_id", () => {
    const repo = createRepository();

    repo.upsert({
      entryId: "kb-delete",
      name: "Delete Me",
      kind: "web",
      uri: "https://example.com/delete",
      tags: [],
      scopeType: "global",
    });

    expect(repo.delete("kb-delete")).toBe(true);
    expect(repo.delete("kb-delete")).toBe(false);
    expect(repo.get("kb-delete")).toBeNull();
  });
});
