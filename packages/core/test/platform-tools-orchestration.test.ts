import { describe, expect, test } from "bun:test";
import { createPlatformToolExecutor } from "../src/agents/platform-tools.js";

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    spaceAdminService: {
      async getSpace() { return null; },
      async listSpaces() { return []; },
      async listAgentAssignments() { return []; },
    },
    capabilityRegistry: {
      listProviders: () => [],
      getProviders: () => [],
      getProvidersForSpace: () => [],
      listTypes: () => [],
    },
    ...overrides,
  };
}

describe("platform orchestration tools", () => {
  test("getTaskProgress is principal-scoped", async () => {
    const executor = createPlatformToolExecutor(makeConfig({
      taskOrchestrationService: {
        async orchestrate() {
          return {
            taskId: "task-1",
            spaceId: "space-1",
            rootTurnId: "turn-1",
            templateId: "archetype/research",
            agentCount: 3,
            state: "running",
          };
        },
        getTaskProgress(taskId: string, requestedBy?: string) {
          if (taskId !== "task-1" || requestedBy !== "owner-1") return undefined;
          return {
            taskId,
            state: "running",
            spaceId: "space-1",
            progress: { turnsCompleted: 0, turnsTotal: 20, currentPhase: "executing", rootTurnId: "turn-1" },
            taskDescription: "task",
            agentTier: "template-default",
            agentCount: 3,
            createdAt: new Date().toISOString(),
            completedAt: null,
            errorMessage: "",
          };
        },
        listTasks() {
          return [];
        },
      },
    }) as never);

    const denied = await executor(
      "platform.getTaskProgress",
      { taskId: "task-1" },
      { spaceId: "space-1", agentId: "agent-1", turnId: "turn-1", principalId: "other-user" },
    );
    expect(denied.isError).toBe(true);

    const allowed = await executor(
      "platform.getTaskProgress",
      { taskId: "task-1" },
      { spaceId: "space-1", agentId: "agent-1", turnId: "turn-1", principalId: "owner-1" },
    );
    expect(allowed.isError).toBeUndefined();
    expect((allowed.result as Record<string, unknown>).taskId).toBe("task-1");
    expect(((allowed.result as Record<string, unknown>).progress as Record<string, unknown>).rootTurnId).toBe("turn-1");
  });

  test("orchestrateTask returns the root turn id for immediate correlation", async () => {
    const executor = createPlatformToolExecutor(makeConfig({
      taskOrchestrationService: {
        async orchestrate() {
          return {
            taskId: "task-1",
            spaceId: "space-1",
            rootTurnId: "turn-99",
            templateId: "archetype/research",
            agentCount: 3,
            state: "running",
          };
        },
        getTaskProgress() {
          return undefined;
        },
        listTasks() {
          return [];
        },
      },
    }) as never);

    const result = await executor(
      "platform.orchestrateTask",
      { taskDescription: "Investigate regression", templateHint: "research" },
      { spaceId: "space-1", agentId: "agent-1", turnId: "turn-1", principalId: "owner-1" },
    );

    expect(result.isError).toBeUndefined();
    expect((result.result as Record<string, unknown>).rootTurnId).toBe("turn-99");
  });

  test("searchExperiences uses empty scope in embedded mode and requires a principal in external mode", async () => {
    const embeddedCalls: Array<Record<string, unknown>> = [];
    const embeddedExecutor = createPlatformToolExecutor(makeConfig({
      gatewayProfile: "embedded",
      memoryProvider: {
        async search(query: Record<string, unknown>) {
          embeddedCalls.push(query);
          return { results: [] };
        },
      },
    }) as never);

    const embeddedResult = await embeddedExecutor(
      "platform.searchExperiences",
      { query: "gateway reliability" },
      { spaceId: "space-1", agentId: "agent-1", turnId: "turn-1" },
    );
    expect(embeddedResult.isError).toBeUndefined();
    expect(embeddedCalls[0]?.scope).toEqual({});

    const externalExecutor = createPlatformToolExecutor(makeConfig({
      gatewayProfile: "external",
      memoryProvider: {
        async search() {
          return { results: [] };
        },
      },
    }) as never);

    const externalResult = await externalExecutor(
      "platform.searchExperiences",
      { query: "gateway reliability" },
      { spaceId: "space-1", agentId: "agent-1", turnId: "turn-1" },
    );
    expect(externalResult.isError).toBe(true);
  });
});
