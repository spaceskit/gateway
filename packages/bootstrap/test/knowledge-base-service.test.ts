import { afterEach, describe, expect, test } from "bun:test";
import { initDatabase, KnowledgeBaseEntryRepository } from "@spaceskit/persistence";
import { KnowledgeBaseService, KnowledgeBaseServiceError } from "../src/services/knowledge-base-service.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
});

function createService() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-kb-service-${crypto.randomUUID()}`,
  });
  dbManagers.push(db);

  return new KnowledgeBaseService({
    repository: new KnowledgeBaseEntryRepository(db.db),
  });
}

describe("KnowledgeBaseService", () => {
  test("upserts valid web and local entries", () => {
    const service = createService();

    const web = service.upsertEntry({
      name: "API Docs",
      kind: "web",
      uri: "https://platform.openai.com/docs",
      tags: ["docs", "api"],
      scopeType: "global",
    });
    expect(web.kind).toBe("web");
    expect(web.uri.startsWith("https://")).toBe(true);
    expect(web.tags).toEqual(["docs", "api"]);

    const local = service.upsertEntry({
      name: "Local Runbook",
      kind: "file",
      uri: "/tmp/runbook.md",
      tags: ["Runbook"],
      scopeType: "space",
      spaceId: "space-a",
    });
    expect(local.kind).toBe("file");
    expect(local.uri.startsWith("file://")).toBe(true);
    expect(local.scopeType).toBe("space");
    expect(local.spaceId).toBe("space-a");
    expect(local.tags).toEqual(["runbook"]);
  });

  test("lists global + matching space entries for space queries", () => {
    const service = createService();

    service.upsertEntry({
      name: "Global Docs",
      kind: "web",
      uri: "https://example.com/global",
      tags: ["docs"],
      scopeType: "global",
    });

    service.upsertEntry({
      name: "Space A Notes",
      kind: "folder",
      uri: "file:///tmp/space-a",
      tags: ["local"],
      scopeType: "space",
      spaceId: "space-a",
    });

    service.upsertEntry({
      name: "Space B Notes",
      kind: "folder",
      uri: "file:///tmp/space-b",
      tags: ["local"],
      scopeType: "space",
      spaceId: "space-b",
    });

    const entries = service.listEntries({ spaceId: "space-a" });
    const ids = entries.map((entry) => entry.name).sort();
    expect(ids).toEqual(["Global Docs", "Space A Notes"]);
  });

  test("rejects invalid URI payloads", () => {
    const service = createService();

    expect(() => service.upsertEntry({
      name: "Bad Web",
      kind: "web",
      uri: "ftp://example.com",
      scopeType: "global",
    })).toThrow(KnowledgeBaseServiceError);

    expect(() => service.upsertEntry({
      name: "Bad Local",
      kind: "file",
      uri: "relative/path.md",
      scopeType: "global",
    })).toThrow(KnowledgeBaseServiceError);
  });
});
