import { afterEach, describe, expect, test } from "bun:test";
import { initDatabase, OrchestratorCommandRepository, SpaceRepository } from "@spaceskit/persistence";
import { OrchestratorCommandService } from "../src/services/orchestrator-command-service.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
});

function createService() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-orchestrator-command-${crypto.randomUUID()}`,
  });
  dbManagers.push(db);

  const spaces = new SpaceRepository(db.db);
  spaces.create({
    spaceId: "space-main",
    resourceId: "resource:main",
    name: "Main Space",
    spaceType: "space",
    goal: "",
    turnModel: "sequential_all",
  });

  const executeTurnCalls: Array<{
    spaceId: string;
    input: string;
    targetAgentId?: string;
  }> = [];

  const service = new OrchestratorCommandService({
    repository: new OrchestratorCommandRepository(db.db),
    spaceAdminService: {} as any,
    spaceContextService: {} as any,
    spaceManager: {
      executeTurn: async (spaceId: string, input: string, targetAgentId?: string) => {
        executeTurnCalls.push({ spaceId, input, targetAgentId });
        return { turnId: "turn-scheduler-1" } as any;
      },
    },
    defaultTargetSpaceId: "space-main",
  });

  return { service, executeTurnCalls };
}

describe("OrchestratorCommandService run_space_prompt", () => {
  test("executes run_space_prompt and returns scheduler turn context", async () => {
    const { service, executeTurnCalls } = createService();

    const result = await service.submitCommand({
      commandType: "run_space_prompt",
      targetSpaceId: "space-main",
      payload: {
        promptText: "Generate a scheduler summary.",
        targetAgentId: "agent-writer",
        metadata: {
          jobId: "job-1",
          runId: "run-1",
        },
      },
    });

    expect(result.status).toBe("completed");
    expect(result.error).toBeUndefined();
    expect(result.result?.turnId).toBe("turn-scheduler-1");
    expect(result.result?.targetSpaceId).toBe("space-main");
    expect(result.result?.targetAgentId).toBe("agent-writer");
    expect(result.result?.source).toBe("scheduler");
    expect((result.result?.metadata as { jobId?: string } | undefined)?.jobId).toBe("job-1");
    expect(executeTurnCalls).toEqual([
      {
        spaceId: "space-main",
        input: "Generate a scheduler summary.",
        targetAgentId: "agent-writer",
      },
    ]);
  });

  test("fails run_space_prompt when promptText is missing", async () => {
    const { service, executeTurnCalls } = createService();

    const result = await service.submitCommand({
      commandType: "run_space_prompt",
      targetSpaceId: "space-main",
      payload: {},
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INVALID_ARGUMENT");
    expect(result.error?.message).toContain("payload.promptText");
    expect(executeTurnCalls).toHaveLength(0);
  });

  test("requires explicit targetSpaceId for external-style calls", async () => {
    const { service } = createService();

    await expect(service.submitCommand({
      commandType: "run_space_prompt",
      payload: {
        promptText: "Should fail before execution",
      },
    })).rejects.toThrow("targetSpaceId is required");
  });

  test("requires caller principal when requireCallerPrincipal is enabled", async () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-orchestrator-command-${crypto.randomUUID()}`,
    });
    dbManagers.push(db);

    const service = new OrchestratorCommandService({
      repository: new OrchestratorCommandRepository(db.db),
      spaceAdminService: {} as any,
      spaceContextService: {} as any,
      spaceManager: { executeTurn: async () => ({ turnId: "unused" }) } as any,
      defaultTargetSpaceId: "space-main",
      requireCallerPrincipal: true,
    });

    await expect(service.submitCommand({
      commandType: "run_space_prompt",
      targetSpaceId: "space-main",
      payload: {
        promptText: "should fail",
      },
    })).rejects.toThrow("Authenticated principal identity is required");
  });

  test("enforces authorizeCommand hook for non-trusted callers", async () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-orchestrator-command-${crypto.randomUUID()}`,
    });
    dbManagers.push(db);

    const service = new OrchestratorCommandService({
      repository: new OrchestratorCommandRepository(db.db),
      spaceAdminService: {} as any,
      spaceContextService: {} as any,
      spaceManager: { executeTurn: async () => ({ turnId: "unused" }) } as any,
      defaultTargetSpaceId: "space-main",
      requireCallerPrincipal: true,
      authorizeCommand: () => ({
        allowed: false,
        reason: "Principal cannot write to this space",
      }),
    });

    await expect(service.submitCommand({
      commandType: "run_space_prompt",
      targetSpaceId: "space-main",
      principalId: "principal-denied",
      payload: {
        promptText: "should fail",
      },
    })).rejects.toThrow("Principal cannot write to this space");
  });

  test("allows default target for trusted internal calls", async () => {
    const { service, executeTurnCalls } = createService();

    const result = await service.submitCommand({
      commandType: "run_space_prompt",
      trustedInternal: true,
      payload: {
        promptText: "Internal scheduler call",
      },
    });

    expect(result.status).toBe("completed");
    expect(result.result?.targetSpaceId).toBe("space-main");
    expect(executeTurnCalls).toEqual([
      {
        spaceId: "space-main",
        input: "Internal scheduler call",
        targetAgentId: undefined,
      },
    ]);
  });
});

describe("OrchestratorCommandService control-plane commands", () => {
  test("lists spaces through list_spaces", async () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-orchestrator-command-${crypto.randomUUID()}`,
    });
    dbManagers.push(db);
    const spaces = new SpaceRepository(db.db);
    spaces.create({
      spaceId: "space-main",
      resourceId: "resource:main",
      name: "Main Space",
      spaceType: "space",
      goal: "",
      turnModel: "sequential_all",
    });

    const service = new OrchestratorCommandService({
      repository: new OrchestratorCommandRepository(db.db),
      spaceAdminService: {
        listSpaces: async () => ([
          { id: "space-a", name: "Space A" },
          { id: "space-b", name: "Space B" },
        ]),
      } as any,
      spaceContextService: {} as any,
      spaceManager: { executeTurn: async () => ({ turnId: "unused" }) } as any,
      defaultTargetSpaceId: "space-main",
    });

    const result = await service.submitCommand({
      commandType: "list_spaces",
      targetSpaceId: "space-main",
    });

    expect(result.status).toBe("completed");
    expect((result.result?.spaces as Array<Record<string, unknown>>).length).toBe(2);
  });

  test("returns a digest through get_space_digest", async () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-orchestrator-command-${crypto.randomUUID()}`,
    });
    dbManagers.push(db);
    const spaces = new SpaceRepository(db.db);
    spaces.create({
      spaceId: "space-main",
      resourceId: "resource:main",
      name: "Main Space",
      spaceType: "space",
      goal: "",
      turnModel: "sequential_all",
    });

    const service = new OrchestratorCommandService({
      repository: new OrchestratorCommandRepository(db.db),
      spaceAdminService: {
        getSpace: async (spaceId: string) => ({
          id: spaceId,
          name: "Runtime Space",
          goal: "Track runtime incidents",
          agents: [{ agentId: "agent-main" }, { agentId: "agent-helper" }],
        }),
      } as any,
      spaceContextService: {} as any,
      spaceManager: { executeTurn: async () => ({ turnId: "unused" }) } as any,
      defaultTargetSpaceId: "space-main",
      turnRepo: {
        listBySpace: () => ([
          {
            actor_id: "agent-main",
            status: "completed",
            output_json: JSON.stringify({
              text: "Reconnect spike traced to the sync backlog and the runtime queue.",
            }),
            created_at: "2026-04-08T08:00:00.000Z",
          },
        ]),
      } as any,
      reflectionService: {
        runSummaryJob: async () => ({
          summaryText: "Runtime Space is active. Reconnect spike traced to sync backlog.",
          fallbackMode: "heuristic",
          trace: {
            jobType: "summary",
            kind: "space_digest",
            source: "orchestrator-command-service",
            fallbackMode: "heuristic",
            generatedAt: "2026-04-08T08:00:05.000Z",
          },
        }),
      } as any,
    });

    const result = await service.submitCommand({
      commandType: "get_space_digest",
      targetSpaceId: "space-main",
      payload: {
        spaceId: "space-runtime",
      },
    });

    expect(result.status).toBe("completed");
    expect(result.result?.spaceId).toBe("space-runtime");
    expect(result.result?.name).toBe("Runtime Space");
    expect(result.result?.summary).toBe(
      "Runtime Space is active. Reconnect spike traced to sync backlog.",
    );
    expect(result.result?.activeAgents).toBe(2);
    expect(result.result?.lastTurnAt).toBe("2026-04-08T08:00:00.000Z");
  });

  test("creates and lists skills via create_skill/list_skills", async () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-orchestrator-command-${crypto.randomUUID()}`,
    });
    dbManagers.push(db);
    const spaces = new SpaceRepository(db.db);
    spaces.create({
      spaceId: "space-main",
      resourceId: "resource:main",
      name: "Main Space",
      spaceType: "space",
      goal: "",
      turnModel: "sequential_all",
    });

    const skills: Array<Record<string, unknown>> = [];
    const service = new OrchestratorCommandService({
      repository: new OrchestratorCommandRepository(db.db),
      spaceAdminService: {} as any,
      spaceContextService: {} as any,
      spaceManager: { executeTurn: async () => ({ turnId: "unused" }) } as any,
      defaultTargetSpaceId: "space-main",
      gatewaySkillCatalogService: {
        listSkills: () => skills,
        upsertSkill: (input) => {
          const entry = { skillId: input.skillId ?? "skill-1", name: input.name };
          skills.push(entry);
          return { skill: entry, created: true };
        },
      },
    });

    const created = await service.submitCommand({
      commandType: "create_skill",
      targetSpaceId: "space-main",
      payload: {
        name: "Space Handoff",
        contentMarkdown: "## skill",
      },
    });

    const listed = await service.submitCommand({
      commandType: "list_skills",
      targetSpaceId: "space-main",
    });

    expect(created.status).toBe("completed");
    expect(created.result?.created).toBe(true);
    expect(listed.status).toBe("completed");
    expect((listed.result?.skills as Array<Record<string, unknown>>).length).toBe(1);
  });

  test("handoff_space resolves space and optionally dispatches prompt", async () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-orchestrator-command-${crypto.randomUUID()}`,
    });
    dbManagers.push(db);
    const spaces = new SpaceRepository(db.db);
    spaces.create({
      spaceId: "space-main",
      resourceId: "resource:main",
      name: "Main Space",
      spaceType: "space",
      goal: "",
      turnModel: "sequential_all",
    });

    const executeTurnCalls: Array<{ spaceId: string; input: string; targetAgentId?: string }> = [];
    const service = new OrchestratorCommandService({
      repository: new OrchestratorCommandRepository(db.db),
      spaceAdminService: {
        getSpace: async (spaceId: string) => ({
          id: spaceId,
          name: "Design Space",
        }),
      } as any,
      spaceContextService: {} as any,
      spaceManager: {
        executeTurn: async (spaceId: string, input: string, targetAgentId?: string) => {
          executeTurnCalls.push({ spaceId, input, targetAgentId });
          return { turnId: "turn-handoff-1" };
        },
      } as any,
      defaultTargetSpaceId: "space-main",
    });

    const result = await service.submitCommand({
      commandType: "handoff_space",
      targetSpaceId: "space-main",
      payload: {
        handoffSpaceId: "space-design",
        promptText: "continue in the design space",
        targetAgentId: "agent-space",
      },
    });

    expect(result.status).toBe("completed");
    expect(result.result?.turnId).toBe("turn-handoff-1");
    expect((result.result?.handoff as Record<string, unknown>).toSpaceId).toBe("space-design");
    expect(((result.result?.handoff as Record<string, unknown>).space as Record<string, unknown>).name).toBe("Design Space");
    expect(executeTurnCalls).toEqual([
      {
        spaceId: "space-design",
        input: "continue in the design space",
        targetAgentId: "agent-space",
      },
    ]);
  });

  test("control-only mode blocks non-control commands", async () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-orchestrator-command-${crypto.randomUUID()}`,
    });
    dbManagers.push(db);

    const service = new OrchestratorCommandService({
      repository: new OrchestratorCommandRepository(db.db),
      spaceAdminService: {} as any,
      spaceContextService: {} as any,
      spaceManager: { executeTurn: async () => ({ turnId: "unused" }) } as any,
      defaultTargetSpaceId: "space-main",
      controlOnlyMode: true,
    });

    await expect(service.submitCommand({
      commandType: "run_space_prompt",
      targetSpaceId: "space-main",
      payload: { promptText: "should fail" },
    })).rejects.toThrow("control-only mode");
  });
});
