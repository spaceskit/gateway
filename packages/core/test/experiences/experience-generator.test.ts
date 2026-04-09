import { describe, expect, test } from "bun:test";
import { ExperienceGenerator } from "../../src/experiences/experience-generator.js";
import { EventBus } from "../../src/events/event-bus.js";
import type { Experience } from "../../src/experiences/types.js";
import type { MemoryDocument, MemorySaveInput } from "../../src/memory/types.js";

function buildGenerator(overrides: {
  saveExperience?: (experience: Experience) => Promise<void>;
  saveMemory?: (input: MemorySaveInput) => Promise<void>;
} = {}) {
  const eventBus = new EventBus();
  const savedExperiences: Experience[] = [];
  const savedMemories: MemorySaveInput[] = [];
  const generator = new ExperienceGenerator({
    eventBus,
    loadSpaceConfig: async (spaceId) => ({
      spaceId,
      resourceId: "resource-1",
      name: "Research Space",
      goal: "Investigate gateway reliability",
      turnModel: "broadcast_team",
      agents: [{ agentId: "agent-1", isPrimary: true }],
    }),
    loadHistory: async () => ([
      {
        turnId: "turn-1",
        agentId: "agent-1",
        input: "Investigate gateway reliability",
        output: "Identified the root cause and a mitigation path.",
        promptTokens: 120,
        completionTokens: 60,
        status: "completed",
      },
    ]),
    saveExperience: async (experience) => {
      savedExperiences.push(experience);
      await overrides.saveExperience?.(experience);
    },
    memoryProvider: {
      id: "memory-stub",
      name: "Memory Stub",
      available: true,
      async save(input) {
        savedMemories.push(input);
        await overrides.saveMemory?.(input);
        return {
          id: "memory-1",
          content: input.content,
          type: input.type,
          scope: input.scope,
          metadata: input.metadata ?? {},
          tags: input.tags ?? [],
          importance: input.importance ?? 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        } satisfies MemoryDocument;
      },
      async search() {
        return { results: [], totalCount: 0, queryTimeMs: 0 };
      },
      async get() {
        return null;
      },
      async update() {
        throw new Error("not implemented");
      },
      async delete() {},
      async list() {
        return [];
      },
      async assembleContext() {
        return { memories: [], tokenEstimate: 0 };
      },
      async checkHealth() {
        return true;
      },
    },
  });

  return {
    eventBus,
    generator,
    savedExperiences,
    savedMemories,
  };
}

describe("ExperienceGenerator", () => {
  test("stores generated experiences as accepted user-scoped knowledge when the requesting principal is known", async () => {
    const { eventBus, generator, savedExperiences, savedMemories } = buildGenerator();

    eventBus.emit({
      type: "space.turn_started",
      spaceId: "space-1",
      turnId: "turn-1",
      requestedByPrincipalId: "user-1",
      timestamp: new Date(),
    });

    const experience = await generator.generate("space-1");

    expect(experience?.status).toBe("accepted");
    expect(savedExperiences).toHaveLength(1);
    expect(savedExperiences[0]?.status).toBe("accepted");
    expect(savedMemories).toHaveLength(1);
    expect(savedMemories[0]?.scope).toEqual({ spaceId: "space-1", userId: "user-1" });
    expect(savedMemories[0]?.metadata?.sourceType).toBe("experience");
    expect(savedMemories[0]?.metadata?.sourceId).toBe(savedExperiences[0]?.experienceId);
    expect(savedMemories[0]?.metadata?.sourceStatus).toBe("accepted");

    generator.destroy();
  });

  test("clears principal scope after generation so later runs do not reuse stale ownership", async () => {
    const { eventBus, generator, savedMemories } = buildGenerator();

    eventBus.emit({
      type: "space.turn_started",
      spaceId: "space-1",
      turnId: "turn-1",
      requestedByPrincipalId: "user-1",
      timestamp: new Date(),
    });

    await generator.generate("space-1");
    await generator.generate("space-1");

    expect(savedMemories).toHaveLength(2);
    expect(savedMemories[0]?.scope).toEqual({ spaceId: "space-1", userId: "user-1" });
    expect(savedMemories[1]?.scope).toEqual({ spaceId: "space-1" });

    generator.destroy();
  });

  test("responds to space.self_check events", async () => {
    const { eventBus, generator, savedExperiences } = buildGenerator();

    eventBus.emit({
      type: "space.self_check",
      spaceId: "space-2",
      turnId: "turn-2",
      timestamp: new Date(),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(savedExperiences).toHaveLength(1);
    expect(savedExperiences[0]?.spaceId).toBe("space-2");

    generator.destroy();
  });
});
