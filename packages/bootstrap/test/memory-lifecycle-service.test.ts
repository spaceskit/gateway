import { afterEach, describe, expect, test } from "bun:test";
import {
  initDatabase,
  PersonalityInsightRepository,
  ProfileRepository,
  SpaceRepository,
} from "@spaceskit/persistence";
import { MemoryLifecycleService } from "../src/services/memory-lifecycle-service.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
});

function createService() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-memory-lifecycle-${crypto.randomUUID()}`,
  });
  dbManagers.push(db);

  const spaces = new SpaceRepository(db.db);
  spaces.create({
    spaceId: "space-1",
    resourceId: "resource:space-1",
    spaceType: "space",
    name: "Test Space",
    goal: "",
    turnModel: "sequential_all",
  });

  const profiles = new ProfileRepository(db.db);
  profiles.create({
    profileId: "profile-1",
    name: "Test Profile",
    personalityPrompt: "You are helpful.",
  });

  const insights = new PersonalityInsightRepository(db.db);
  insights.create({
    insightId: "insight-1",
    spaceId: "space-1",
    profileId: "profile-1",
    baseRevision: 1,
    proposedPromptDelta: "Be more concise in code reviews.",
    rationale: "The user asked for terser review notes.",
    confidence: 0.9,
  });

  const service = new MemoryLifecycleService({
    insights,
    profiles,
  });

  return { insights, profiles, service };
}

describe("MemoryLifecycleService", () => {
  test("acceptInsight creates a new profile revision and records approved revision", () => {
    const { insights, profiles, service } = createService();

    const accepted = service.acceptInsight("insight-1");

    expect(accepted).toBeDefined();
    expect(accepted?.status).toBe("accepted");
    expect(accepted?.approvedRevision).toBe(2);

    const updatedInsight = insights.getById("insight-1");
    expect(updatedInsight?.approved_revision).toBe(2);

    const activeRevision = profiles.getActiveRevision("profile-1");
    expect(activeRevision?.revision).toBe(2);
    expect(activeRevision?.personality_prompt).toContain("You are helpful.");
    expect(activeRevision?.personality_prompt).toContain("Be more concise in code reviews.");
  });
});
