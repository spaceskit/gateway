import { describe, expect, test } from "bun:test";
import { EventBus } from "../../core/src/events/event-bus.js";
import { TaskOrchestrationService } from "../src/services/task-orchestration-service.js";

interface TaskRecordRow {
  task_id: string;
  space_id: string;
  requested_by: string;
  task_description: string;
  agent_tier: string;
  agent_count: number;
  topology: string;
  template_id: string;
  state: "pending" | "deploying" | "running" | "synthesizing" | "input_required" | "completed" | "failed";
  progress_json: string;
  artifact_ids_json: string;
  max_turns: number;
  created_at: string;
  completed_at: string | null;
  error_message: string;
}

class FakeTaskRecordRepo {
  private records = new Map<string, TaskRecordRow>();

  create(input: {
    taskId: string;
    spaceId: string;
    requestedBy: string;
    taskDescription: string;
    agentTier: string;
    agentCount: number;
    topology: string;
    templateId: string;
    maxTurns?: number;
  }): TaskRecordRow {
    const row: TaskRecordRow = {
      task_id: input.taskId,
      space_id: input.spaceId,
      requested_by: input.requestedBy,
      task_description: input.taskDescription,
      agent_tier: input.agentTier,
      agent_count: input.agentCount,
      topology: input.topology,
      template_id: input.templateId,
      state: "pending",
      progress_json: JSON.stringify({
        turnsCompleted: 0,
        turnsTotal: input.maxTurns ?? 20,
        currentPhase: "pending",
      }),
      artifact_ids_json: "[]",
      max_turns: input.maxTurns ?? 20,
      created_at: new Date().toISOString(),
      completed_at: null,
      error_message: "",
    };
    this.records.set(input.taskId, row);
    return row;
  }

  getById(taskId: string): TaskRecordRow | undefined {
    return this.records.get(taskId);
  }

  update(input: {
    taskId: string;
    state?: TaskRecordRow["state"];
    spaceId?: string;
    progress?: { turnsCompleted: number; turnsTotal: number; currentPhase: string };
    errorMessage?: string;
  }): TaskRecordRow | undefined {
    const existing = this.records.get(input.taskId);
    if (!existing) return undefined;
    const next: TaskRecordRow = {
      ...existing,
      space_id: input.spaceId ?? existing.space_id,
      state: input.state ?? existing.state,
      progress_json: input.progress ? JSON.stringify(input.progress) : existing.progress_json,
      error_message: input.errorMessage ?? existing.error_message,
      completed_at: input.state === "completed" || input.state === "failed"
        ? new Date().toISOString()
        : existing.completed_at,
    };
    this.records.set(input.taskId, next);
    return next;
  }

  listByRequestedBy(requestedBy: string): TaskRecordRow[] {
    return [...this.records.values()].filter((row) => row.requested_by === requestedBy);
  }
}

function createProfileRepo() {
  const rows = new Map<string, {
    profile_id: string;
    name: string;
    description: string;
    can_moderate: number;
    is_default: number;
    preferred_tier?: string;
  }>();
  const revisions = new Map<string, {
    profile_id: string;
    personality_prompt: string;
    default_skill_set_ids_json: string;
    provider_hint: string;
    model_config_json: string;
  }>();

  const seed = (input: {
    profileId: string;
    name: string;
    description: string;
    canModerate: boolean;
    preferredTier?: string;
    providerHint?: string;
    modelId?: string;
  }) => {
    rows.set(input.profileId, {
      profile_id: input.profileId,
      name: input.name,
      description: input.description,
      can_moderate: input.canModerate ? 1 : 0,
      is_default: 0,
      preferred_tier: input.preferredTier,
    });
    revisions.set(input.profileId, {
      profile_id: input.profileId,
      personality_prompt: `${input.name} prompt`,
      default_skill_set_ids_json: "[]",
      provider_hint: input.providerHint ?? "",
      model_config_json: JSON.stringify({
        preferredModels: input.modelId ? [input.modelId] : [],
      }),
    });
  };

  seed({
    profileId: "archetype/research-coordinator",
    name: "Research Coordinator",
    description: "coord",
    canModerate: true,
    preferredTier: "advanced",
    providerHint: "anthropic",
  });
  seed({
    profileId: "archetype/researcher",
    name: "Researcher",
    description: "worker",
    canModerate: false,
    preferredTier: "standard",
  });

  return {
    repo: {
      getById(id: string) {
        return rows.get(id);
      },
      getActiveRevision(id: string) {
        return revisions.get(id);
      },
      create(input: {
        profileId: string;
        name: string;
        description?: string;
        personalityPrompt?: string;
        canModerate?: boolean;
        providerHint?: string;
        modelConfig?: unknown;
      }) {
        rows.set(input.profileId, {
          profile_id: input.profileId,
          name: input.name,
          description: input.description ?? "",
          can_moderate: input.canModerate ? 1 : 0,
          is_default: 0,
        });
        revisions.set(input.profileId, {
          profile_id: input.profileId,
          personality_prompt: input.personalityPrompt ?? "",
          default_skill_set_ids_json: "[]",
          provider_hint: input.providerHint ?? "",
          model_config_json: JSON.stringify(input.modelConfig ?? {}),
        });
      },
    },
    rows,
  };
}

async function waitForState(
  service: TaskOrchestrationService,
  taskId: string,
  expected: "completed" | "failed",
): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (service.getTaskProgress(taskId)?.state === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for task state ${expected}`);
}

describe("TaskOrchestrationService", () => {
  test("returns a real spaceId immediately and completes only after orchestrator summary event", async () => {
    const eventBus = new EventBus();
    const taskRecordRepo = new FakeTaskRecordRepo();
    const createdSpaces: string[] = [];
    const addAgentCalls: Array<{ agentId: string; profileId: string }> = [];
    const { repo: profileRepo } = createProfileRepo();

    const service = new TaskOrchestrationService({
      eventBus,
      taskRecordRepo: taskRecordRepo as never,
      spaceTemplateRepo: {
        getActiveRevision: () => undefined,
        list: () => [],
      } as never,
      profileRepo,
      spaceAdminService: {
        async createSpace() {
          createdSpaces.push("space-1");
          return { id: "space-1" };
        },
        async addAgent(input: { agentId: string; profileId: string }) {
          addAgentCalls.push(input);
          return input;
        },
      } as never,
      spaceManager: {
        async executeTurn() {
          return { turnId: "turn-1" };
        },
      } as never,
    });

    const result = await service.orchestrate({
      taskDescription: "Research gateway reliability",
      requestedBy: "user-1",
      templateHint: "research",
    });

    expect(result.spaceId).toBe("space-1");
    expect(result.rootTurnId).toBe("turn-1");
    expect(result.state).toBe("running");
    expect(createdSpaces).toEqual(["space-1"]);
    expect(addAgentCalls).toHaveLength(3);
    expect(service.getTaskProgress(result.taskId)?.state).toBe("running");
    expect(service.getTaskProgress(result.taskId)?.progress.rootTurnId).toBe("turn-1");

    eventBus.emit({
      type: "space.orchestrator_event",
      timestamp: new Date(),
      spaceId: "space-1",
      correlationId: result.rootTurnId,
      eventType: "summary.completed",
      event: {
        summary: {
          finalSummaryText: "done",
        },
      },
    });

    await waitForState(service, result.taskId, "completed");
    expect(service.getTaskProgress(result.taskId)?.state).toBe("completed");
    expect(service.getTaskProgress(result.taskId)?.progress.rootTurnId).toBe("turn-1");
  });

  test("creates tier-adjusted worker profiles when requested tier overrides the archetype default", async () => {
    const eventBus = new EventBus();
    const taskRecordRepo = new FakeTaskRecordRepo();
    const addAgentCalls: Array<{ agentId: string; profileId: string }> = [];
    const { repo: profileRepo, rows } = createProfileRepo();

    const service = new TaskOrchestrationService({
      eventBus,
      taskRecordRepo: taskRecordRepo as never,
      spaceTemplateRepo: {
        getActiveRevision: () => undefined,
        list: () => [],
      } as never,
      profileRepo,
      spaceAdminService: {
        async createSpace() {
          return { id: "space-2" };
        },
        async addAgent(input: { agentId: string; profileId: string }) {
          addAgentCalls.push(input);
          return input;
        },
      } as never,
      spaceManager: {
        async executeTurn() {
          return { turnId: "turn-2" };
        },
      } as never,
    });

    const result = await service.orchestrate({
      taskDescription: "Research with advanced workers",
      requestedBy: "user-1",
      templateHint: "research",
      agentTier: "advanced",
    });

    expect(rows.has("archetype/researcher::advanced")).toBe(true);
    expect(addAgentCalls.some((call) => call.profileId === "archetype/researcher::advanced")).toBe(true);

    eventBus.emit({
      type: "space.orchestrator_event",
      timestamp: new Date(),
      spaceId: result.spaceId,
      correlationId: result.rootTurnId,
      eventType: "summary.completed",
      event: { summary: { finalSummaryText: "done" } },
    });

    await waitForState(service, result.taskId, "completed");
  });

  test("reused spaces tolerate duplicate agent assignments and feedback checkpoints become input_required", async () => {
    const eventBus = new EventBus();
    const taskRecordRepo = new FakeTaskRecordRepo();
    const emittedProgress: Array<Record<string, unknown>> = [];
    const addAgentCalls: Array<{ agentId: string; profileId: string }> = [];
    const { repo: profileRepo } = createProfileRepo();

    eventBus.on("task.progress", (event) => {
      emittedProgress.push(event as Record<string, unknown>);
    });

    const service = new TaskOrchestrationService({
      eventBus,
      taskRecordRepo: taskRecordRepo as never,
      spaceTemplateRepo: {
        getActiveRevision: () => undefined,
        list: () => [],
      } as never,
      profileRepo,
      spaceAdminService: {
        async createSpace() {
          throw new Error("should not create a new space");
        },
        async addAgent(input: { agentId: string; profileId: string }) {
          addAgentCalls.push(input);
          if (input.agentId === "coordinator") {
            throw { code: "ALREADY_EXISTS", message: "already there" };
          }
          return input;
        },
      } as never,
      spaceManager: {
        async executeTurn() {
          return { turnId: "turn-3" };
        },
      } as never,
    });

    const result = await service.orchestrate({
      taskDescription: "Continue the investigation",
      requestedBy: "user-1",
      templateHint: "research",
      spaceId: "existing-space",
    });

    eventBus.emit({
      type: "space.turn_event",
      timestamp: new Date(),
      spaceId: "existing-space",
      turnId: result.rootTurnId,
      event: {
        type: "text_delta",
        text: "working on it",
      },
    });

    eventBus.emit({
      type: "space.turn_event",
      timestamp: new Date(),
      spaceId: "existing-space",
      turnId: result.rootTurnId,
      event: {
        type: "feedback_requested",
        request: {
          description: "Need confirmation before proceeding",
        },
      },
    });

    for (let i = 0; i < 20; i += 1) {
      if (service.getTaskProgress(result.taskId)?.state === "input_required") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const progress = service.getTaskProgress(result.taskId);
    expect(progress?.state).toBe("input_required");
    expect(progress?.progress.currentPhase).toBe("input-required");
    expect(progress?.progress.latestMessage).toBe("Need confirmation before proceeding");
    expect(emittedProgress.length).toBeGreaterThan(0);
    expect(addAgentCalls.length).toBeGreaterThan(1);
  });

  test("direct tasks can run with a single seeded agent", async () => {
    const eventBus = new EventBus();
    const taskRecordRepo = new FakeTaskRecordRepo();
    const addAgentCalls: Array<{ agentId: string; profileId: string }> = [];
    const { repo: profileRepo } = createProfileRepo();

    const service = new TaskOrchestrationService({
      eventBus,
      taskRecordRepo: taskRecordRepo as never,
      spaceTemplateRepo: {
        getActiveRevision: () => undefined,
        list: () => [],
      } as never,
      profileRepo,
      spaceAdminService: {
        async createSpace() {
          return { id: "space-direct" };
        },
        async addAgent(input: { agentId: string; profileId: string }) {
          addAgentCalls.push(input);
          if (input.agentId === "agent-1") {
            throw { code: "ALREADY_EXISTS", message: "seeded" };
          }
          return input;
        },
      } as never,
      spaceManager: {
        async executeTurn() {
          return { turnId: "turn-direct" };
        },
      } as never,
    });

    const result = await service.orchestrate({
      taskDescription: "Answer directly",
      requestedBy: "user-1",
      topology: "direct",
      spaceId: "space-direct",
      agentCount: 1,
      maxTurns: 1,
    });

    expect(result.rootTurnId).toBe("turn-direct");
    expect(addAgentCalls).toHaveLength(0);

    eventBus.emit({
      type: "space.turn_event",
      timestamp: new Date(),
      spaceId: "space-direct",
      turnId: "turn-direct",
      event: {
        type: "turn_completed",
        result: {
          finalMessage: { content: "done" },
        },
      },
    });

    await waitForState(service, result.taskId, "completed");
    expect(service.getTaskProgress(result.taskId)?.state).toBe("completed");
  });

  test("returns the root turn id immediately for downstream correlation", async () => {
    const eventBus = new EventBus();
    const taskRecordRepo = new FakeTaskRecordRepo();
    const { repo: profileRepo } = createProfileRepo();

    const service = new TaskOrchestrationService({
      eventBus,
      taskRecordRepo: taskRecordRepo as never,
      spaceTemplateRepo: {
        getActiveRevision: () => undefined,
        list: () => [],
      } as never,
      profileRepo,
      spaceAdminService: {
        async createSpace() {
          return { id: "space-root" };
        },
        async addAgent() {
          return {};
        },
      } as never,
      spaceManager: {
        async executeTurn() {
          return { turnId: "root-turn-42" };
        },
      } as never,
    });

    const result = await service.orchestrate({
      taskDescription: "Correlate task stream",
      requestedBy: "user-1",
      templateHint: "research",
    });

    expect(result.rootTurnId).toBe("root-turn-42");
    expect(service.getTaskProgress(result.taskId)?.state).toBe("running");
    expect(service.getTaskProgress(result.taskId)?.progress.rootTurnId).toBe("root-turn-42");
  });

  test("catches summary events emitted during executeTurn's finally block", async () => {
    const eventBus = new EventBus();
    const taskRecordRepo = new FakeTaskRecordRepo();
    const { repo: profileRepo } = createProfileRepo();

    // SpaceManager mock that emits the summary event synchronously
    // during executeTurn (simulating the finally block behavior)
    const service = new TaskOrchestrationService({
      eventBus,
      taskRecordRepo: taskRecordRepo as never,
      spaceTemplateRepo: {
        getActiveRevision: () => undefined,
        list: () => [],
      } as never,
      profileRepo,
      spaceAdminService: {
        async createSpace() {
          return { id: "space-sync" };
        },
        async addAgent() {
          return {};
        },
      } as never,
      spaceManager: {
        async executeTurn() {
          const turnId = "turn-sync";
          // Emit summary event synchronously before returning
          // (simulates emitSummaryEvent in finally block)
          eventBus.emit({
            type: "space.orchestrator_event",
            timestamp: new Date(),
            spaceId: "space-sync",
            correlationId: turnId,
            eventType: "summary.completed",
            event: {
              summary: {
                finalSummaryText: "Synthesized summary from LLM",
              },
            },
          });
          return { turnId };
        },
      } as never,
    });

    const result = await service.orchestrate({
      taskDescription: "Test early subscription",
      requestedBy: "user-1",
      templateHint: "research",
    });

    // The summary event was emitted during executeTurn but the early
    // listener should have buffered and replayed it
    await waitForState(service, result.taskId, "completed");
    const progress = service.getTaskProgress(result.taskId);
    expect(progress?.state).toBe("completed");
    expect(progress?.progress.finalSummaryText).toBe("Synthesized summary from LLM");
  });

  test("rejects empty task description", async () => {
    const eventBus = new EventBus();
    const taskRecordRepo = new FakeTaskRecordRepo();
    const { repo: profileRepo } = createProfileRepo();

    const service = new TaskOrchestrationService({
      eventBus,
      taskRecordRepo: taskRecordRepo as never,
      spaceTemplateRepo: { getActiveRevision: () => undefined, list: () => [] } as never,
      profileRepo,
      spaceAdminService: { async createSpace() { return { id: "s" }; }, async addAgent() { return {}; } } as never,
      spaceManager: { async executeTurn() { return { turnId: "t" }; } } as never,
    });

    await expect(service.orchestrate({
      taskDescription: "   ",
      requestedBy: "user-1",
    })).rejects.toThrow("required and cannot be empty");
  });

  test("rejects task description shorter than 10 characters", async () => {
    const eventBus = new EventBus();
    const taskRecordRepo = new FakeTaskRecordRepo();
    const { repo: profileRepo } = createProfileRepo();

    const service = new TaskOrchestrationService({
      eventBus,
      taskRecordRepo: taskRecordRepo as never,
      spaceTemplateRepo: { getActiveRevision: () => undefined, list: () => [] } as never,
      profileRepo,
      spaceAdminService: { async createSpace() { return { id: "s" }; }, async addAgent() { return {}; } } as never,
      spaceManager: { async executeTurn() { return { turnId: "t" }; } } as never,
    });

    await expect(service.orchestrate({
      taskDescription: "short",
      requestedBy: "user-1",
    })).rejects.toThrow("at least 10 characters");
  });

  test("truncates task descriptions longer than 2000 characters", async () => {
    const eventBus = new EventBus();
    const taskRecordRepo = new FakeTaskRecordRepo();
    const { repo: profileRepo } = createProfileRepo();
    let capturedDescription = "";

    const service = new TaskOrchestrationService({
      eventBus,
      taskRecordRepo: taskRecordRepo as never,
      spaceTemplateRepo: { getActiveRevision: () => undefined, list: () => [] } as never,
      profileRepo,
      spaceAdminService: {
        async createSpace(input: { goal?: string }) {
          capturedDescription = input.goal ?? "";
          return { id: "space-trunc" };
        },
        async addAgent() { return {}; },
      } as never,
      spaceManager: { async executeTurn() { return { turnId: "turn-trunc" }; } } as never,
    });

    const longDesc = "A".repeat(3000);
    const result = await service.orchestrate({
      taskDescription: longDesc,
      requestedBy: "user-1",
      templateHint: "research",
    });

    expect(capturedDescription.length).toBe(2000);
    expect(result.spaceId).toBe("space-trunc");

    // Clean up by completing the task
    eventBus.emit({
      type: "space.orchestrator_event",
      timestamp: new Date(),
      spaceId: "space-trunc",
      correlationId: result.rootTurnId,
      eventType: "summary.completed",
      event: { summary: { finalSummaryText: "done" } },
    });
    await waitForState(service, result.taskId, "completed");
  });

  test("onTaskDescriptionTruncated callback fires when input description exceeds the budget", async () => {
    const eventBus = new EventBus();
    const taskRecordRepo = new FakeTaskRecordRepo();
    const { repo: profileRepo } = createProfileRepo();
    const truncations: Array<{ from: number; to: number }> = [];

    const service = new TaskOrchestrationService({
      eventBus,
      taskRecordRepo: taskRecordRepo as never,
      spaceTemplateRepo: { getActiveRevision: () => undefined, list: () => [] } as never,
      profileRepo,
      spaceAdminService: {
        async createSpace() { return { id: "space-trunc-cb" }; },
        async addAgent() { return {}; },
      } as never,
      spaceManager: { async executeTurn() { return { turnId: "turn-trunc-cb" }; } } as never,
      onTaskDescriptionTruncated: (info) => truncations.push(info),
    });

    const longDesc = "B".repeat(2500);
    const result = await service.orchestrate({
      taskDescription: longDesc,
      requestedBy: "user-1",
      templateHint: "research",
    });

    expect(truncations).toEqual([{ from: 2500, to: 2000 }]);

    eventBus.emit({
      type: "space.orchestrator_event",
      timestamp: new Date(),
      spaceId: "space-trunc-cb",
      correlationId: result.rootTurnId,
      eventType: "summary.completed",
      event: { summary: { finalSummaryText: "done" } },
    });
    await waitForState(service, result.taskId, "completed");
  });

  test("default (no onTaskDescriptionTruncated callback) does NOT write to console.warn", async () => {
    const eventBus = new EventBus();
    const taskRecordRepo = new FakeTaskRecordRepo();
    const { repo: profileRepo } = createProfileRepo();

    const service = new TaskOrchestrationService({
      eventBus,
      taskRecordRepo: taskRecordRepo as never,
      spaceTemplateRepo: { getActiveRevision: () => undefined, list: () => [] } as never,
      profileRepo,
      spaceAdminService: {
        async createSpace() { return { id: "space-trunc-silent" }; },
        async addAgent() { return {}; },
      } as never,
      spaceManager: { async executeTurn() { return { turnId: "turn-trunc-silent" }; } } as never,
    });

    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = ((...args: unknown[]) => {
      warnings.push(args);
    }) as typeof console.warn;

    let result: Awaited<ReturnType<typeof service.orchestrate>>;
    try {
      result = await service.orchestrate({
        taskDescription: "C".repeat(2500),
        requestedBy: "user-1",
        templateHint: "research",
      });
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings).toEqual([]);

    eventBus.emit({
      type: "space.orchestrator_event",
      timestamp: new Date(),
      spaceId: "space-trunc-silent",
      correlationId: result.rootTurnId,
      eventType: "summary.completed",
      event: { summary: { finalSummaryText: "done" } },
    });
    await waitForState(service, result.taskId, "completed");
  });

  test("onTaskDescriptionTruncated callback does NOT fire when description is within budget", async () => {
    const eventBus = new EventBus();
    const taskRecordRepo = new FakeTaskRecordRepo();
    const { repo: profileRepo } = createProfileRepo();
    const truncations: Array<{ from: number; to: number }> = [];

    const service = new TaskOrchestrationService({
      eventBus,
      taskRecordRepo: taskRecordRepo as never,
      spaceTemplateRepo: { getActiveRevision: () => undefined, list: () => [] } as never,
      profileRepo,
      spaceAdminService: {
        async createSpace() { return { id: "space-no-trunc" }; },
        async addAgent() { return {}; },
      } as never,
      spaceManager: { async executeTurn() { return { turnId: "turn-no-trunc" }; } } as never,
      onTaskDescriptionTruncated: (info) => truncations.push(info),
    });

    const result = await service.orchestrate({
      taskDescription: "Short enough description for the budget",
      requestedBy: "user-1",
      templateHint: "research",
    });

    expect(truncations).toEqual([]);

    eventBus.emit({
      type: "space.orchestrator_event",
      timestamp: new Date(),
      spaceId: "space-no-trunc",
      correlationId: result.rootTurnId,
      eventType: "summary.completed",
      event: { summary: { finalSummaryText: "done" } },
    });
    await waitForState(service, result.taskId, "completed");
  });

  test("rejects agentCount greater than 10", async () => {
    const eventBus = new EventBus();
    const taskRecordRepo = new FakeTaskRecordRepo();
    const { repo: profileRepo } = createProfileRepo();

    const service = new TaskOrchestrationService({
      eventBus,
      taskRecordRepo: taskRecordRepo as never,
      spaceTemplateRepo: { getActiveRevision: () => undefined, list: () => [] } as never,
      profileRepo,
      spaceAdminService: { async createSpace() { return { id: "s" }; }, async addAgent() { return {}; } } as never,
      spaceManager: { async executeTurn() { return { turnId: "t" }; } } as never,
    });

    await expect(service.orchestrate({
      taskDescription: "Research something important",
      requestedBy: "user-1",
      agentCount: 15,
    })).rejects.toThrow("must not exceed 10");
  });

  test("rejects maxTurns greater than 50", async () => {
    const eventBus = new EventBus();
    const taskRecordRepo = new FakeTaskRecordRepo();
    const { repo: profileRepo } = createProfileRepo();

    const service = new TaskOrchestrationService({
      eventBus,
      taskRecordRepo: taskRecordRepo as never,
      spaceTemplateRepo: { getActiveRevision: () => undefined, list: () => [] } as never,
      profileRepo,
      spaceAdminService: { async createSpace() { return { id: "s" }; }, async addAgent() { return {}; } } as never,
      spaceManager: { async executeTurn() { return { turnId: "t" }; } } as never,
    });

    await expect(service.orchestrate({
      taskDescription: "Research something important",
      requestedBy: "user-1",
      maxTurns: 100,
    })).rejects.toThrow("must not exceed 50");
  });

  test("marks the task failed and cleans up when executeTurn throws before returning a root turn id", async () => {
    const eventBus = new EventBus();
    const taskRecordRepo = new FakeTaskRecordRepo();
    const { repo: profileRepo } = createProfileRepo();
    const failedEvents: Array<Record<string, unknown>> = [];

    eventBus.on("task.failed", (event) => {
      failedEvents.push(event as Record<string, unknown>);
    });

    const service = new TaskOrchestrationService({
      eventBus,
      taskRecordRepo: taskRecordRepo as never,
      spaceTemplateRepo: {
        getActiveRevision: () => undefined,
        list: () => [],
      } as never,
      profileRepo,
      spaceAdminService: {
        async createSpace() {
          return { id: "space-error" };
        },
        async addAgent() {
          return {};
        },
      } as never,
      spaceManager: {
        async executeTurn() {
          throw new Error("executeTurn exploded");
        },
      } as never,
    });

    await expect(service.orchestrate({
      taskDescription: "Trigger execution failure",
      requestedBy: "user-1",
      templateHint: "research",
    })).rejects.toThrow("executeTurn exploded");

    const failedTask = taskRecordRepo.listByRequestedBy("user-1")[0];
    expect(failedTask?.state).toBe("failed");
    expect(failedTask?.error_message).toBe("executeTurn exploded");
    expect(JSON.parse(failedTask?.progress_json ?? "{}")).toMatchObject({
      currentPhase: "failed",
      latestMessage: "executeTurn exploded",
    });
    expect(failedEvents).toHaveLength(1);

    eventBus.emit({
      type: "space.orchestrator_event",
      timestamp: new Date(),
      spaceId: "space-error",
      correlationId: "turn-late",
      eventType: "summary.completed",
      event: {
        summary: {
          finalSummaryText: "late summary should be ignored",
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(taskRecordRepo.listByRequestedBy("user-1")[0]?.state).toBe("failed");
  });
});
