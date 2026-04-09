import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  ExperienceMemoryProvider,
  backfillLegacyExperienceKnowledge,
} from "../../src/memory/experience-memory-provider.js";

const databases: Database[] = [];

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
});

function createProvider(): ExperienceMemoryProvider {
  const db = new Database(":memory:");
  databases.push(db);
  return new ExperienceMemoryProvider({ db });
}

async function seedDocuments(provider: ExperienceMemoryProvider) {
  await provider.save({
    content: "Learned about TypeScript generics patterns",
    type: "semantic",
    scope: { spaceId: "space-1" },
    metadata: { sourceStatus: "accepted" },
    tags: ["typescript"],
    importance: 0.8,
  });
  await provider.save({
    content: "Draft notes on error handling strategies",
    type: "semantic",
    scope: { spaceId: "space-1" },
    metadata: { sourceStatus: "draft" },
    tags: ["errors"],
    importance: 0.8,
  });
  await provider.save({
    content: "Rejected approach to global state management",
    type: "semantic",
    scope: { spaceId: "space-1" },
    metadata: { sourceStatus: "rejected" },
    tags: ["state"],
    importance: 0.8,
  });
  await provider.save({
    content: "Memory without status field for testing",
    type: "semantic",
    scope: { spaceId: "space-1" },
    metadata: {},
    tags: ["misc"],
    importance: 0.8,
  });
}

describe("ExperienceMemoryProvider search filters", () => {
  test("status filter returns only matching status", async () => {
    const provider = createProvider();
    await seedDocuments(provider);

    const acceptedResults = await provider.search({
      text: "",
      scope: { spaceId: "space-1" },
      status: "accepted",
    });
    expect(acceptedResults.results.length).toBe(1);
    expect(acceptedResults.results[0]!.document.metadata.sourceStatus).toBe("accepted");

    const draftResults = await provider.search({
      text: "",
      scope: { spaceId: "space-1" },
      status: "draft",
    });
    expect(draftResults.results.length).toBe(1);
    expect(draftResults.results[0]!.document.metadata.sourceStatus).toBe("draft");

    const rejectedResults = await provider.search({
      text: "",
      scope: { spaceId: "space-1" },
      status: "rejected",
    });
    expect(rejectedResults.results.length).toBe(1);
    expect(rejectedResults.results[0]!.document.metadata.sourceStatus).toBe("rejected");
  });

  test("no status filter returns all documents", async () => {
    const provider = createProvider();
    await seedDocuments(provider);

    const allResults = await provider.search({
      text: "",
      scope: { spaceId: "space-1" },
    });
    expect(allResults.results.length).toBe(4);
  });

  test("minScore threshold filters correctly", async () => {
    const provider = createProvider();
    // Save a low-importance document that will have a low composite score
    await provider.save({
      content: "Low importance item",
      type: "semantic",
      scope: { spaceId: "space-2" },
      metadata: {},
      importance: 0.1,
    });
    // Save a high-importance document
    await provider.save({
      content: "High importance item",
      type: "semantic",
      scope: { spaceId: "space-2" },
      metadata: {},
      importance: 1.0,
    });

    const highScoreResults = await provider.search({
      text: "",
      scope: { spaceId: "space-2" },
      minScore: 0.8,
    });
    // Only the high importance item should pass the threshold
    expect(highScoreResults.results.length).toBe(1);
    expect(highScoreResults.results[0]!.document.content).toBe("High importance item");
  });

  test("score boost applied correctly per status", async () => {
    const provider = createProvider();
    // Create documents with identical importance but different statuses
    await provider.save({
      content: "Accepted knowledge",
      type: "semantic",
      scope: { spaceId: "space-3" },
      metadata: { sourceStatus: "accepted" },
      importance: 0.5,
    });
    await provider.save({
      content: "Draft knowledge",
      type: "semantic",
      scope: { spaceId: "space-3" },
      metadata: { sourceStatus: "draft" },
      importance: 0.5,
    });
    await provider.save({
      content: "Rejected knowledge",
      type: "semantic",
      scope: { spaceId: "space-3" },
      metadata: { sourceStatus: "rejected" },
      importance: 0.5,
    });
    await provider.save({
      content: "No status knowledge",
      type: "semantic",
      scope: { spaceId: "space-3" },
      metadata: {},
      importance: 0.5,
    });

    const results = await provider.search({
      text: "",
      scope: { spaceId: "space-3" },
    });

    // Find each result by content
    const accepted = results.results.find((r) => r.document.content === "Accepted knowledge")!;
    const draft = results.results.find((r) => r.document.content === "Draft knowledge")!;
    const rejected = results.results.find((r) => r.document.content === "Rejected knowledge")!;
    const noStatus = results.results.find((r) => r.document.content === "No status knowledge")!;

    expect(accepted).toBeDefined();
    expect(draft).toBeDefined();
    expect(rejected).toBeDefined();
    expect(noStatus).toBeDefined();

    // Accepted should have highest score (1.2x boost)
    expect(accepted.score).toBeGreaterThan(draft.score);
    // Draft should have lower score (0.8x boost)
    expect(draft.score).toBeLessThan(noStatus.score);
    // Rejected should have lowest score (0.3x boost)
    expect(rejected.score).toBeLessThan(draft.score);
  });

  test("backfills legacy experience status and user scope for existing generated memories", async () => {
    const db = new Database(":memory:");
    databases.push(db);
    const provider = new ExperienceMemoryProvider({ db });

    db.exec(`
      CREATE TABLE experiences (
        experience_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        tags_json TEXT DEFAULT '[]',
        lessons_json TEXT DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE runs (
        run_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        compatibility_turn_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'completed',
        trigger_source TEXT NOT NULL DEFAULT 'space_input',
        requested_by_principal_id TEXT NOT NULL DEFAULT '',
        requested_by_device_id TEXT NOT NULL DEFAULT '',
        target_agent_id TEXT NOT NULL DEFAULT '',
        requested_mode TEXT NOT NULL DEFAULT 'ask',
        requested_effort TEXT NOT NULL DEFAULT 'medium',
        input_text TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        error_code TEXT NOT NULL DEFAULT '',
        error_message TEXT NOT NULL DEFAULT ''
      );
    `);

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO experiences (experience_id, space_id, summary, tags_json, lessons_json, status, created_at, updated_at)
      VALUES (?, ?, ?, '[]', '[]', 'draft', ?, ?)
    `).run("exp-1", "space-legacy", "Legacy generated summary", now, now);
    db.prepare(`
      INSERT INTO runs (
        run_id, space_id, compatibility_turn_id, status, trigger_source,
        requested_by_principal_id, requested_by_device_id, target_agent_id,
        requested_mode, requested_effort, input_text, created_at, started_at,
        completed_at, error_code, error_message
      ) VALUES (?, ?, '', 'completed', 'space_input', ?, '', '', 'ask', 'medium', '', ?, ?, ?, '', '')
    `).run("run-1", "space-legacy", "user-legacy", now, now, now);

    await provider.save({
      content: "Legacy generated summary",
      type: "semantic",
      scope: { spaceId: "space-legacy" },
      metadata: { experienceId: "exp-1" },
      importance: 0.7,
    });

    const result = backfillLegacyExperienceKnowledge(db);
    expect(result).toEqual({
      experiencesAccepted: 1,
      memoryStatusesUpdated: 1,
      memoryUsersUpdated: 1,
    });

    const acceptedResults = await provider.search({
      text: "Legacy generated summary",
      scope: { userId: "user-legacy" },
      status: "accepted",
    });
    expect(acceptedResults.results).toHaveLength(1);
    expect(acceptedResults.results[0]!.document.metadata.sourceStatus).toBe("accepted");
    expect(acceptedResults.results[0]!.document.scope.userId).toBe("user-legacy");

    const experienceRow = db.prepare(
      "SELECT status FROM experiences WHERE experience_id = ?",
    ).get("exp-1") as { status: string } | null;
    expect(experienceRow?.status).toBe("accepted");
  });
});
