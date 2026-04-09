import { afterEach, describe, expect, test } from "bun:test";
import { initDatabase } from "../src/database.js";
import { PersonalityInsightRepository } from "../src/repositories/personality-insights.js";
import { SpaceRepository } from "../src/repositories/spaces.js";
import { ProfileRepository } from "../src/repositories/profiles.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
});

function createRepository() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-insights-${crypto.randomUUID()}`,
  });
  dbManagers.push(db);

  // Seed required FK parents
  const spaces = new SpaceRepository(db.db);
  spaces.create({
    spaceId: "space-1",
    resourceId: "resource-1",
    spaceType: "space",
    name: "Test Space",
    goal: "",
    turnModel: "sequential_all",
  });

  const profiles = new ProfileRepository(db.db);
  profiles.create({
    profileId: "profile-1",
    name: "Test Profile 1",
    personalityPrompt: "You are helpful.",
  });
  profiles.create({
    profileId: "profile-2",
    name: "Test Profile 2",
    personalityPrompt: "You are concise.",
  });

  return new PersonalityInsightRepository(db.db);
}

function seedInsight(
  repo: PersonalityInsightRepository,
  overrides: Partial<{
    insightId: string;
    profileId: string;
    status: "proposed" | "accepted" | "rejected" | "superseded";
  }> = {},
) {
  return repo.create({
    insightId: overrides.insightId ?? crypto.randomUUID(),
    spaceId: "space-1",
    profileId: overrides.profileId ?? "profile-1",
    baseRevision: 1,
    proposedPromptDelta: "Be more concise in responses.",
    rationale: "User prefers shorter answers.",
    confidence: 0.85,
    status: overrides.status ?? "proposed",
    createdBy: "experience-generator",
  });
}

describe("PersonalityInsightRepository lifecycle", () => {
  test("listProposed returns only proposed insights", () => {
    const repo = createRepository();

    seedInsight(repo, { insightId: "ins-proposed-1", profileId: "profile-1" });
    seedInsight(repo, { insightId: "ins-proposed-2", profileId: "profile-1" });
    seedInsight(repo, { insightId: "ins-accepted", profileId: "profile-1", status: "accepted" });
    seedInsight(repo, { insightId: "ins-rejected", profileId: "profile-1", status: "rejected" });
    seedInsight(repo, { insightId: "ins-other-profile", profileId: "profile-2" });

    const proposed = repo.listProposed("profile-1");
    expect(proposed.length).toBe(2);
    expect(proposed.every((i) => i.status === "proposed")).toBe(true);
    expect(proposed.every((i) => i.profile_id === "profile-1")).toBe(true);
  });

  test("accept changes status to accepted and records approved revision", () => {
    const repo = createRepository();
    const insight = seedInsight(repo, { insightId: "ins-to-accept" });
    expect(insight.status).toBe("proposed");

    repo.accept("ins-to-accept", 3);

    const updated = repo.getById("ins-to-accept");
    expect(updated).toBeDefined();
    expect(updated!.status).toBe("accepted");
    expect(updated!.approved_revision).toBe(3);
  });

  test("reject changes status to rejected", () => {
    const repo = createRepository();
    const insight = seedInsight(repo, { insightId: "ins-to-reject" });
    expect(insight.status).toBe("proposed");

    repo.reject("ins-to-reject");

    const updated = repo.getById("ins-to-reject");
    expect(updated).toBeDefined();
    expect(updated!.status).toBe("rejected");
  });

  test("updated_at is set on accept/reject", () => {
    const repo = createRepository();
    const insight = seedInsight(repo, { insightId: "ins-timestamps" });
    const originalUpdatedAt = insight.updated_at;

    repo.accept("ins-timestamps");
    const afterAccept = repo.getById("ins-timestamps")!;
    expect(Date.parse(afterAccept.updated_at)).toBeGreaterThanOrEqual(Date.parse(originalUpdatedAt));

    // Create another to test reject timestamp
    const insight2 = seedInsight(repo, { insightId: "ins-timestamps-2" });
    const originalUpdatedAt2 = insight2.updated_at;

    repo.reject("ins-timestamps-2");
    const afterReject = repo.getById("ins-timestamps-2")!;
    expect(Date.parse(afterReject.updated_at)).toBeGreaterThanOrEqual(Date.parse(originalUpdatedAt2));
  });
});
