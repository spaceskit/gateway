import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { ExperienceMemoryProvider } from "../../src/memory/experience-memory-provider.js";

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

});
