import { describe, expect, test } from "bun:test";
import { EventBus } from "@spaceskit/core";
import { A2AHandler } from "../src/a2a/a2a-handler.js";

async function createStreamingTask(handler: A2AHandler): Promise<{ taskId: string; response: Response }> {
  const response = await handler.handleRequest(new Request("http://localhost/a2a/tasks", {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      agentId: "agent-1",
      message: {
        role: "user",
        parts: [{ type: "text", text: "Research this." }],
      },
    }),
  }));

  if (!response) {
    throw new Error("Expected an A2A response");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Expected a streaming body");
  }
  const started = await readNextSseEvent(reader);
  reader.releaseLock();
  return { taskId: started.taskId as string, response };
}

async function readNextSseEvent(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Record<string, unknown>> {
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      throw new Error("Stream ended before next SSE event");
    }
    buffer += new TextDecoder().decode(value);
    const delimiterIndex = buffer.indexOf("\n\n");
    if (delimiterIndex >= 0) {
      const chunk = buffer.slice(0, delimiterIndex);
      const dataLine = chunk.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) {
        throw new Error(`Missing data line in chunk: ${chunk}`);
      }
      return JSON.parse(dataLine.slice("data: ".length)) as Record<string, unknown>;
    }
  }
}

function createHandler(eventBus: EventBus): A2AHandler {
  return new A2AHandler({
    eventBus,
    baseUrl: "http://localhost",
    logger: { info() {}, warn() {}, error() {}, debug() {} } as any,
    authRequired: false,
    loadProfile: async () => ({
      name: "Agent",
      description: "Test agent",
      personalityPrompt: "Be helpful.",
      defaultSkillIds: [],
      activeRevision: 1,
    }),
    listProfiles: async () => [],
    spaceManager: {
      executeTurn: async () => ({ turnId: "turn-1" }),
    } as any,
  });
}

async function readJson(response: Response): Promise<any> {
  return await response.json();
}

describe("A2AHandler multi-agent task tracking", () => {
  test("does not complete broadcast-team streams until orchestrator summary completes", async () => {
    const eventBus = new EventBus();
    const handler = createHandler(eventBus);
    const { taskId, response } = await createStreamingTask(handler);
    const reader = response.body!.getReader();
    const spaceId = `a2a-${taskId}`;

    eventBus.emit({
      type: "space.turn_event",
      timestamp: new Date(),
      spaceId,
      turnId: "turn-1",
      conversationTopology: "broadcast_team",
      event: {
        type: "turn_completed",
        result: {
          finalMessage: { content: "Worker draft" },
        },
      },
    } as any);

    const pending = readNextSseEvent(reader);
    const stillPending = await Promise.race([
      pending.then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 100)),
    ]);
    expect(stillPending).toBeTrue();

    eventBus.emit({
      type: "space.orchestrator_event",
      timestamp: new Date(),
      spaceId,
      correlationId: "turn-1",
      eventType: "summary.completed",
      event: {
        type: "summary.completed",
        summary: {
          finalSummaryText: "Final synthesized answer",
        },
      },
    } as any);

    const completed = await pending;
    expect(completed.type).toBe("task.completed");
    expect((completed.task as any).state).toBe("completed");
    expect((completed.task as any).messages.at(-1).parts[0].text).toBe("Final synthesized answer");
  });

  test("still completes direct tasks on the root turn completion event", async () => {
    const eventBus = new EventBus();
    const handler = createHandler(eventBus);
    const { taskId, response } = await createStreamingTask(handler);
    const reader = response.body!.getReader();
    const spaceId = `a2a-${taskId}`;

    eventBus.emit({
      type: "space.turn_event",
      timestamp: new Date(),
      spaceId,
      turnId: "turn-1",
      conversationTopology: "direct",
      event: {
        type: "turn_completed",
        result: {
          finalMessage: { content: "Direct answer" },
        },
      },
    } as any);

    const completed = await readNextSseEvent(reader);
    expect(completed.type).toBe("task.completed");
    expect((completed.task as any).state).toBe("completed");
    expect((completed.task as any).messages.at(-1).parts[0].text).toBe("Direct answer");
  });

  test("routes metadata-driven A2A tasks through task orchestration with principal context", async () => {
    const eventBus = new EventBus();
    const orchestrateCalls: Array<Record<string, unknown>> = [];
    const handler = new A2AHandler({
      eventBus,
      baseUrl: "http://localhost",
      logger: { info() {}, warn() {}, error() {}, debug() {} } as any,
      authRequired: true,
      resolvePrincipalContext: () => ({ principalId: "principal-1", deviceId: "device-1" }),
      taskOrchestrationService: {
        orchestrate: async (input) => {
          orchestrateCalls.push(input as Record<string, unknown>);
          return {
            taskId: "task-orch-1",
            spaceId: "space-orch-1",
            state: "running",
          };
        },
      },
      loadProfile: async () => null,
      listProfiles: async () => [],
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-1" }),
      } as any,
    });

    const response = await handler.handleRequest(new Request("http://localhost/a2a/tasks", {
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          role: "user",
          parts: [{ type: "text", text: "Investigate this." }],
        },
        metadata: {
          templateHint: "research",
          agentCount: 3,
          agentTier: "advanced",
          topology: "broadcast_team",
          maxTurns: 5,
        },
      }),
    }));

    expect(response).not.toBeNull();
    const payload = await readJson(response!);
    expect(payload.task.id).toBe("task-orch-1");
    expect(payload.task.state).toBe("working");
    expect(orchestrateCalls).toEqual([{
      taskDescription: "Investigate this.",
      requestedBy: "principal-1",
      deviceId: "device-1",
      templateHint: "research",
      agentCount: 3,
      agentTier: "advanced",
      topology: "broadcast_team",
      maxTurns: 5,
      templateId: undefined,
      spaceId: undefined,
    }]);
  });

  test("seeds a direct single-agent space before delegating A2A tasks to orchestration", async () => {
    const eventBus = new EventBus();
    const createSpaceCalls: Array<Record<string, unknown>> = [];
    const addAgentCalls: Array<Record<string, unknown>> = [];
    const orchestrateCalls: Array<Record<string, unknown>> = [];
    const handler = new A2AHandler({
      eventBus,
      baseUrl: "http://localhost",
      logger: { info() {}, warn() {}, error() {}, debug() {} } as any,
      authRequired: false,
      resolvePrincipalContext: () => ({ principalId: "principal-2", deviceId: "device-2" }),
      taskOrchestrationService: {
        orchestrate: async (input) => {
          orchestrateCalls.push(input as Record<string, unknown>);
          return {
            taskId: "task-orch-2",
            spaceId: "space-direct-1",
            state: "running",
          };
        },
      },
      spaceAdminService: {
        createSpace: async (input) => {
          createSpaceCalls.push(input as Record<string, unknown>);
          return { id: "space-direct-1" };
        },
        addAgent: async (input) => {
          addAgentCalls.push(input as Record<string, unknown>);
          return {};
        },
      },
      loadProfile: async () => null,
      listProfiles: async () => [],
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-1" }),
      } as any,
    });

    const response = await handler.handleRequest(new Request("http://localhost/a2a/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentId: "researcher-1",
        message: {
          role: "user",
          parts: [{ type: "text", text: "Answer directly." }],
        },
      }),
    }));

    expect(response).not.toBeNull();
    const payload = await readJson(response!);
    expect(payload.task.id).toBe("task-orch-2");
    expect(createSpaceCalls).toHaveLength(1);
    expect(addAgentCalls).toEqual([{
      spaceId: "space-direct-1",
      agentId: "agent-1",
      profileId: "researcher-1",
      role: "participant",
      isPrimary: true,
      spawnContext: "Answer directly.",
    }]);
    expect(orchestrateCalls).toEqual([{
      taskDescription: "Answer directly.",
      requestedBy: "principal-2",
      deviceId: "device-2",
      templateId: undefined,
      templateHint: undefined,
      agentCount: 1,
      agentTier: undefined,
      topology: "direct",
      spaceId: "space-direct-1",
      maxTurns: 1,
    }]);
  });

  test("streams task lifecycle events emitted by the orchestration service", async () => {
    const eventBus = new EventBus();
    const handler = new A2AHandler({
      eventBus,
      baseUrl: "http://localhost",
      logger: { info() {}, warn() {}, error() {}, debug() {} } as any,
      authRequired: false,
      taskOrchestrationService: {
        orchestrate: async () => ({
          taskId: "task-orch-3",
          spaceId: "space-orch-3",
          state: "running",
        }),
      },
      loadProfile: async () => null,
      listProfiles: async () => [],
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-1" }),
      } as any,
    });

    const response = await handler.handleRequest(new Request("http://localhost/a2a/tasks", {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          role: "user",
          parts: [{ type: "text", text: "Coordinate this." }],
        },
      }),
    }));

    const reader = response!.body!.getReader();
    const started = await readNextSseEvent(reader);
    expect(started.taskId).toBe("task-orch-3");

    eventBus.emit({
      type: "task.progress",
      timestamp: new Date(),
      spaceId: "space-orch-3",
      data: {
        taskId: "task-orch-3",
        message: "Coordinator is synthesizing",
      },
    } as any);
    const progress = await readNextSseEvent(reader);
    expect(progress.type).toBe("task.progress");
    expect((progress.message as any).parts[0].text).toBe("Coordinator is synthesizing");

    eventBus.emit({
      type: "task.completed",
      timestamp: new Date(),
      spaceId: "space-orch-3",
      data: {
        taskId: "task-orch-3",
        finalSummaryText: "Completed answer",
      },
    } as any);
    const completed = await readNextSseEvent(reader);
    expect(completed.type).toBe("task.completed");
    expect((completed.task as any).messages.at(-1).parts[0].text).toBe("Completed answer");
  });

  test("hydrates durable completed task state when the in-memory task map misses", async () => {
    const eventBus = new EventBus();
    const handler = new A2AHandler({
      eventBus,
      baseUrl: "http://localhost",
      logger: { info() {}, warn() {}, error() {}, debug() {} } as any,
      authRequired: true,
      resolvePrincipalContext: () => ({ principalId: "principal-3", deviceId: "device-3" }),
      taskOrchestrationService: {
        orchestrate: async () => ({
          taskId: "task-unused",
          spaceId: "space-unused",
          state: "running",
        }),
        getTaskProgress: (taskId, requestedBy) => {
          expect(taskId).toBe("task-durable-1");
          expect(requestedBy).toBe("principal-3");
          return {
            taskId,
            state: "completed",
            spaceId: "space-durable-1",
            progress: {
              turnsCompleted: 3,
              turnsTotal: 3,
              currentPhase: "completed",
              latestMessage: "Coordinator is wrapping up",
              finalSummaryText: "Durable final answer",
              rootTurnId: "turn-durable-1",
            },
            taskDescription: "Coordinate a durable answer.",
            agentTier: "advanced",
            agentCount: 3,
            topology: "broadcast_team",
            createdAt: "2026-03-13T09:00:00.000Z",
            completedAt: "2026-03-13T09:05:00.000Z",
            errorMessage: "",
          };
        },
      },
      loadProfile: async () => null,
      listProfiles: async () => [],
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-1" }),
      } as any,
    });

    const response = await handler.handleRequest(new Request("http://localhost/a2a/tasks/task-durable-1", {
      method: "GET",
      headers: {
        Authorization: "Bearer token",
      },
    }));

    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    const payload = await readJson(response!);
    expect(payload.task.id).toBe("task-durable-1");
    expect(payload.task.state).toBe("completed");
    expect(payload.task.messages).toEqual([
      {
        role: "user",
        parts: [{ type: "text", text: "Coordinate a durable answer." }],
      },
      {
        role: "agent",
        parts: [{ type: "text", text: "Durable final answer" }],
      },
    ]);
    expect(payload.task.metadata).toEqual({
      spaceId: "space-durable-1",
      rootTurnId: "turn-durable-1",
      conversationTopology: "broadcast_team",
    });
  });

  test("hydrates durable input-required and failed tasks from orchestration reads", async () => {
    const eventBus = new EventBus();
    const requestedByCalls: Array<string | undefined> = [];
    const handler = new A2AHandler({
      eventBus,
      baseUrl: "http://localhost",
      logger: { info() {}, warn() {}, error() {}, debug() {} } as any,
      authRequired: true,
      resolvePrincipalContext: () => ({ principalId: "principal-4" }),
      taskOrchestrationService: {
        orchestrate: async () => ({
          taskId: "task-unused",
          spaceId: "space-unused",
          state: "running",
        }),
        getTaskProgress: (taskId, requestedBy) => {
          requestedByCalls.push(requestedBy);
          if (taskId === "task-input-1") {
            return {
              taskId,
              state: "input_required",
              spaceId: "space-input-1",
              progress: {
                turnsCompleted: 1,
                turnsTotal: 4,
                currentPhase: "input_required",
                latestMessage: "Need a decision on which path to pursue.",
                rootTurnId: "turn-input-1",
              },
              taskDescription: "Compare the options.",
              agentTier: "standard",
              agentCount: 2,
              topology: "shared_team_chat",
              createdAt: "2026-03-13T10:00:00.000Z",
              completedAt: null,
              errorMessage: "",
            };
          }
          if (taskId === "task-failed-1") {
            return {
              taskId,
              state: "failed",
              spaceId: "space-failed-1",
              progress: {
                turnsCompleted: 2,
                turnsTotal: 4,
                currentPhase: "failed",
              },
              taskDescription: "Run the durable task.",
              agentTier: "standard",
              agentCount: 2,
              topology: "broadcast_team",
              createdAt: "2026-03-13T11:00:00.000Z",
              completedAt: "2026-03-13T11:01:00.000Z",
              errorMessage: "Coordinator failed to synthesize the result.",
            };
          }
          return undefined;
        },
      },
      loadProfile: async () => null,
      listProfiles: async () => [],
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-1" }),
      } as any,
    });

    const inputResponse = await handler.handleRequest(new Request("http://localhost/a2a/tasks/task-input-1", {
      method: "GET",
      headers: {
        Authorization: "Bearer token",
      },
    }));
    expect(inputResponse).not.toBeNull();
    const inputPayload = await readJson(inputResponse!);
    expect(inputPayload.task.state).toBe("input-required");
    expect(inputPayload.task.messages.at(-1).parts[0].text).toBe("Need a decision on which path to pursue.");

    const failedResponse = await handler.handleRequest(new Request("http://localhost/a2a/tasks/task-failed-1", {
      method: "GET",
      headers: {
        Authorization: "Bearer token",
      },
    }));
    expect(failedResponse).not.toBeNull();
    const failedPayload = await readJson(failedResponse!);
    expect(failedPayload.task.state).toBe("failed");
    expect(failedPayload.task.messages.at(-1).parts[0].text).toBe("Coordinator failed to synthesize the result.");
    expect(requestedByCalls).toEqual(["principal-4", "principal-4"]);
  });
});
