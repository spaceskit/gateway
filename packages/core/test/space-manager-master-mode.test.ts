import { describe, expect, test } from "bun:test";
import { EventBus } from "../src/events/event-bus.js";
import { SpaceManager, type SaveTurnInput } from "../src/spaces/space-manager.js";
import type {
  AgentRuntime,
  AgentState,
  TurnContext,
  TurnEvent,
  TurnResult,
} from "../src/agents/agent-runtime.js";
import type { SpaceConfig, SpaceAgentAssignment, TurnModelConfig, TurnModelStrategy } from "../src/spaces/types.js";

interface RuntimeStep {
  output?: string;
  throwError?: Error;
}

class ScriptRuntime implements AgentRuntime {
  readonly state: AgentState = "idle";
  readonly contexts: TurnContext[] = [];
  private callCount = 0;

  constructor(
    readonly agentId: string,
    private readonly steps: RuntimeStep[],
  ) {}

  async *executeTurn(context: TurnContext): AsyncIterable<TurnEvent> {
    this.contexts.push(context);
    const step = this.steps[this.callCount] ?? { output: `default output from ${this.agentId}` };
    this.callCount += 1;
    if (step.throwError) {
      throw step.throwError;
    }
    yield completedEvent(this.agentId, context.turnId, step.output ?? "");
  }

  async *resumeWithFeedback(): AsyncIterable<TurnEvent> {}

  async cancel(): Promise<void> {}
}

function completedEvent(agentId: string, turnId: string, output: string): TurnEvent {
  const result: TurnResult = {
    agentId,
    turnId,
    messages: [{ role: "assistant", content: output }],
    toolCalls: [],
    toolResults: [],
    finalMessage: { role: "assistant", content: output },
    usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
    state: "idle",
  };
  return { type: "turn_completed", result };
}

function makeAssignment(
  agentId: string,
  role: SpaceAgentAssignment["role"],
  turnOrder: number,
  isPrimary = false,
): SpaceAgentAssignment {
  return {
    spaceId: "space-1",
    agentId,
    profileId: `${agentId}-profile`,
    role,
    turnOrder,
    isPrimary,
    assignedAt: new Date(),
  };
}

function makeSpaceConfig(params: {
  turnModel: TurnModelStrategy;
  agents: SpaceAgentAssignment[];
  turnModelConfig?: TurnModelConfig;
}): SpaceConfig {
  const now = new Date();
  return {
    id: "space-1",
    spaceUid: "11111111-1111-4111-8111-111111111111",
    resourceId: "resource:test",
    name: "Master Mode Test",
    turnModel: params.turnModel,
    turnModelConfig: params.turnModelConfig,
    agents: params.agents,
    capabilities: [],
    capabilityOverrides: {},
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  };
}

async function waitForSummaryEvent(
  eventBus: EventBus,
  timeoutMs = 1500,
): Promise<Record<string, unknown>> {
  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error("Timed out waiting for summary event"));
    }, timeoutMs);

    const unsub = eventBus.on("space.orchestrator_event", (event) => {
      clearTimeout(timer);
      unsub();
      resolve(event as Record<string, unknown>);
    });
  });
}

async function waitForTurnCompletions(
  eventBus: EventBus,
  turnId: string,
  expectedCount: number,
  timeoutMs = 1200,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let completionCount = 0;
    const timer = setTimeout(() => {
      unsub();
      reject(new Error("Timed out waiting for turn completion"));
    }, timeoutMs);

    const unsub = eventBus.on("space.turn_event", (event) => {
      const typed = event as { turnId?: string; event?: { type?: string } };
      if (typed.turnId !== turnId) return;
      if (typed.event?.type !== "turn_completed") return;
      completionCount += 1;
      if (completionCount >= expectedCount) {
        clearTimeout(timer);
        unsub();
        resolve();
      }
    });
  });
}

describe("SpaceManager master-mode orchestration", () => {
  test("activates master mode for coordinator + guests and executes planner -> guest -> synthesis", async () => {
    const eventBus = new EventBus();
    const saves: SaveTurnInput[] = [];
    const runtimeByAgent = new Map<string, ScriptRuntime>();
    const config = makeSpaceConfig({
      turnModel: "primary_only",
      agents: [
        makeAssignment("master-1", "global_coordinator", 0, true),
        makeAssignment("guest-1", "participant", 1),
      ],
    });

    runtimeByAgent.set("master-1", new ScriptRuntime("master-1", [
      {
        output: JSON.stringify({
          globalInstruction: "Focus on reliability findings.",
          guestInstructions: {
            "guest-1": "Return a concise reliability report.",
          },
        }),
      },
      { output: "Master final synthesis." },
    ]));
    runtimeByAgent.set("guest-1", new ScriptRuntime("guest-1", [{ output: "Guest reliability report." }]));

    const emittedTurnEvents: Array<{ agentId?: string; eventType?: string }> = [];
    eventBus.on("space.turn_event", (event) => {
      const typed = event as { agentId?: string; event?: { type?: string } };
      emittedTurnEvents.push({ agentId: typed.agentId, eventType: typed.event?.type });
    });

    const manager = new SpaceManager({
      eventBus,
      loadSpaceConfig: async () => config,
      updateSpaceStatus: async () => undefined,
      saveTurn: async (turn) => {
        saves.push(turn);
      },
      loadHistory: async () => [],
      loadAgentHistory: async () => [],
      resolveRuntime: async (_spaceId, agentId) => runtimeByAgent.get(agentId)!,
    });

    await manager.executeTurn("space-1", "Need a rollout plan");
    await waitForSummaryEvent(eventBus);

    const masterRuntime = runtimeByAgent.get("master-1")!;
    const guestRuntime = runtimeByAgent.get("guest-1")!;

    expect(masterRuntime.contexts).toHaveLength(2);
    expect(guestRuntime.contexts).toHaveLength(1);
    expect(saves.map((entry) => entry.agentId)).toEqual(["guest-1", "master-1"]);

    const guestMessages = guestRuntime.contexts[0]?.messages ?? [];
    const guestPrompt = guestMessages[guestMessages.length - 1]?.content ?? "";
    expect(guestPrompt).toContain("Return a concise reliability report.");

    const completionAgentIds = emittedTurnEvents
      .filter((entry) => entry.eventType === "turn_completed")
      .map((entry) => entry.agentId);
    expect(completionAgentIds).toEqual(["guest-1", "master-1"]);
  });

  test("falls back to deterministic guest delegation when planner JSON is invalid", async () => {
    const eventBus = new EventBus();
    const runtimeByAgent = new Map<string, ScriptRuntime>();
    const config = makeSpaceConfig({
      turnModel: "sequential_all",
      agents: [
        makeAssignment("master-1", "global_coordinator", 0, true),
        makeAssignment("guest-1", "participant", 1),
      ],
    });

    runtimeByAgent.set("master-1", new ScriptRuntime("master-1", [
      { output: "this is not json" },
      { output: "Master synthesis despite fallback." },
    ]));
    runtimeByAgent.set("guest-1", new ScriptRuntime("guest-1", [{ output: "Guest fallback report." }]));

    const manager = new SpaceManager({
      eventBus,
      loadSpaceConfig: async () => config,
      updateSpaceStatus: async () => undefined,
      saveTurn: async () => undefined,
      loadHistory: async () => [],
      loadAgentHistory: async () => [],
      resolveRuntime: async (_spaceId, agentId) => runtimeByAgent.get(agentId)!,
    });

    await manager.executeTurn("space-1", "Investigate incident");
    await waitForSummaryEvent(eventBus);

    const fallbackGuestMessages = runtimeByAgent.get("guest-1")!.contexts[0]?.messages ?? [];
    const guestPrompt = fallbackGuestMessages[fallbackGuestMessages.length - 1]?.content ?? "";
    expect(guestPrompt).toContain("Guest guest-1: execute the user's request directly (\"Investigate incident\").");
    expect(guestPrompt).toContain("Use available tools when they help gather concrete facts.");
  });

  test("uses global planner instruction when guest instructions are missing", async () => {
    const eventBus = new EventBus();
    const runtimeByAgent = new Map<string, ScriptRuntime>();
    const config = makeSpaceConfig({
      turnModel: "sequential_all",
      agents: [
        makeAssignment("master-1", "global_coordinator", 0, true),
        makeAssignment("guest-1", "participant", 1),
      ],
    });

    runtimeByAgent.set("master-1", new ScriptRuntime("master-1", [
      {
        output: JSON.stringify({
          globalInstruction: "Check reminders and return exact pending items.",
        }),
      },
      { output: "Master synthesis from global-only planner output." },
    ]));
    runtimeByAgent.set("guest-1", new ScriptRuntime("guest-1", [{ output: "Guest report from global-only instruction." }]));

    const manager = new SpaceManager({
      eventBus,
      loadSpaceConfig: async () => config,
      updateSpaceStatus: async () => undefined,
      saveTurn: async () => undefined,
      loadHistory: async () => [],
      loadAgentHistory: async () => [],
      resolveRuntime: async (_spaceId, agentId) => runtimeByAgent.get(agentId)!,
    });

    await manager.executeTurn("space-1", "Can you check reminders?");
    await waitForSummaryEvent(eventBus);

    const guestMessages = runtimeByAgent.get("guest-1")!.contexts[0]?.messages ?? [];
    const guestPrompt = guestMessages[guestMessages.length - 1]?.content ?? "";
    expect(guestPrompt).toContain("Check reminders and return exact pending items.");
  });

  test("accepts single-guest planner output with snake_case keys and placeholder guest key", async () => {
    const eventBus = new EventBus();
    const runtimeByAgent = new Map<string, ScriptRuntime>();
    const config = makeSpaceConfig({
      turnModel: "sequential_all",
      agents: [
        makeAssignment("master-1", "global_coordinator", 0, true),
        makeAssignment("guest-1", "participant", 1),
      ],
    });

    runtimeByAgent.set("master-1", new ScriptRuntime("master-1", [
      {
        output: JSON.stringify({
          global_instruction: "Focus on reminder tasks.",
          guestInstructions: {
            "<guest_agent_id>": "Check Apple Reminders and report pending tasks.",
          },
        }),
      },
      { output: "Master synthesis after tolerant planner parse." },
    ]));
    runtimeByAgent.set("guest-1", new ScriptRuntime("guest-1", [{ output: "Guest reminder report." }]));

    const manager = new SpaceManager({
      eventBus,
      loadSpaceConfig: async () => config,
      updateSpaceStatus: async () => undefined,
      saveTurn: async () => undefined,
      loadHistory: async () => [],
      loadAgentHistory: async () => [],
      resolveRuntime: async (_spaceId, agentId) => runtimeByAgent.get(agentId)!,
    });

    await manager.executeTurn("space-1", "Can you check reminders?");
    await waitForSummaryEvent(eventBus);

    const guestMessages = runtimeByAgent.get("guest-1")!.contexts[0]?.messages ?? [];
    const guestPrompt = guestMessages[guestMessages.length - 1]?.content ?? "";
    expect(guestPrompt).toContain("Check Apple Reminders and report pending tasks.");
    expect(guestPrompt).not.toContain("provide a concise, actionable report for the master orchestrator");
  });

  test("maps planner guest instructions by order when key count matches guests", async () => {
    const eventBus = new EventBus();
    const runtimeByAgent = new Map<string, ScriptRuntime>();
    const config = makeSpaceConfig({
      turnModel: "sequential_all",
      agents: [
        makeAssignment("master-1", "global_coordinator", 0, true),
        makeAssignment("guest-1", "participant", 1),
        makeAssignment("guest-2", "participant", 2),
      ],
    });

    runtimeByAgent.set("master-1", new ScriptRuntime("master-1", [
      {
        output: JSON.stringify({
          globalInstruction: "Split diagnostics.",
          guestInstructions: {
            alpha: "Guest one: check connectors.",
            beta: "Guest two: check orchestration logs.",
          },
        }),
      },
      { output: "Master synthesis after ordered mapping." },
    ]));
    runtimeByAgent.set("guest-1", new ScriptRuntime("guest-1", [{ output: "guest-1 report" }]));
    runtimeByAgent.set("guest-2", new ScriptRuntime("guest-2", [{ output: "guest-2 report" }]));

    const manager = new SpaceManager({
      eventBus,
      loadSpaceConfig: async () => config,
      updateSpaceStatus: async () => undefined,
      saveTurn: async () => undefined,
      loadHistory: async () => [],
      loadAgentHistory: async () => [],
      resolveRuntime: async (_spaceId, agentId) => runtimeByAgent.get(agentId)!,
    });

    await manager.executeTurn("space-1", "Run diagnostics");
    await waitForSummaryEvent(eventBus);

    const guest1Messages = runtimeByAgent.get("guest-1")!.contexts[0]?.messages ?? [];
    const guest2Messages = runtimeByAgent.get("guest-2")!.contexts[0]?.messages ?? [];
    const guest1Prompt = guest1Messages[guest1Messages.length - 1]?.content ?? "";
    const guest2Prompt = guest2Messages[guest2Messages.length - 1]?.content ?? "";
    expect(guest1Prompt).toContain("Guest one: check connectors.");
    expect(guest2Prompt).toContain("Guest two: check orchestration logs.");
  });

  test("continues to synthesis when a guest fails and marks summary as degraded", async () => {
    const eventBus = new EventBus();
    const saves: SaveTurnInput[] = [];
    const runtimeByAgent = new Map<string, ScriptRuntime>();
    const config = makeSpaceConfig({
      turnModel: "sequential_all",
      agents: [
        makeAssignment("master-1", "global_coordinator", 0, true),
        makeAssignment("guest-1", "participant", 1),
        makeAssignment("guest-2", "participant", 2),
      ],
    });

    runtimeByAgent.set("master-1", new ScriptRuntime("master-1", [
      {
        output: JSON.stringify({
          globalInstruction: "Collect deployment signals.",
          guestInstructions: {
            "guest-1": "Analyze gateway health only.",
            "guest-2": "Analyze app-side rendering only.",
          },
        }),
      },
      { output: "Master synthesis after partial guest failure." },
    ]));
    runtimeByAgent.set("guest-1", new ScriptRuntime("guest-1", [
      { throwError: new Error("guest-1 unavailable") },
    ]));
    runtimeByAgent.set("guest-2", new ScriptRuntime("guest-2", [
      { output: "guest-2 report" },
    ]));

    const emittedErrors: Array<{ agentId?: string; type?: string }> = [];
    eventBus.on("space.turn_event", (event) => {
      const typed = event as { agentId?: string; event?: { type?: string } };
      if (typed.event?.type === "error") {
        emittedErrors.push({ agentId: typed.agentId, type: typed.event.type });
      }
    });

    const manager = new SpaceManager({
      eventBus,
      loadSpaceConfig: async () => config,
      updateSpaceStatus: async () => undefined,
      saveTurn: async (turn) => {
        saves.push(turn);
      },
      loadHistory: async () => [],
      loadAgentHistory: async () => [],
      resolveRuntime: async (_spaceId, agentId) => runtimeByAgent.get(agentId)!,
    });

    await manager.executeTurn("space-1", "Are we healthy?");
    const summaryEvent = await waitForSummaryEvent(eventBus);

    const payload = summaryEvent.event as Record<string, unknown>;
    const summary = payload.summary as Record<string, unknown>;
    expect(summary.status).toBe("degraded");
    expect(typeof summary.finalSummaryText).toBe("string");
    expect(summary.finalSummaryText as string).toContain("degraded");

    expect(runtimeByAgent.get("master-1")?.contexts).toHaveLength(2);
    expect(saves.map((entry) => entry.agentId)).toEqual(["guest-2", "master-1"]);
    expect(emittedErrors.some((entry) => entry.agentId === "guest-1")).toBe(true);
  });

  test("respects per-space override disabling master mode", async () => {
    const eventBus = new EventBus();
    const runtimeByAgent = new Map<string, ScriptRuntime>();
    const config = makeSpaceConfig({
      turnModel: "sequential_all",
      turnModelConfig: {
        strategy: "sequential_all",
        masterModeEnabled: false,
      },
      agents: [
        makeAssignment("master-1", "global_coordinator", 0, true),
        makeAssignment("guest-1", "participant", 1),
      ],
    });

    runtimeByAgent.set("master-1", new ScriptRuntime("master-1", [{ output: "stale master response" }]));
    runtimeByAgent.set("guest-1", new ScriptRuntime("guest-1", [{ output: "stale guest response" }]));

    const manager = new SpaceManager({
      eventBus,
      loadSpaceConfig: async () => config,
      updateSpaceStatus: async () => undefined,
      saveTurn: async () => undefined,
      loadHistory: async () => [],
      loadAgentHistory: async () => [],
      resolveRuntime: async (_spaceId, agentId) => runtimeByAgent.get(agentId)!,
    });

    await manager.executeTurn("space-1", "Stale behavior check");
    await waitForSummaryEvent(eventBus);

    const masterContext = runtimeByAgent.get("master-1")!.contexts[0]!;
    expect(runtimeByAgent.get("master-1")?.contexts).toHaveLength(1);
    expect(masterContext.messages).toHaveLength(1);
    expect(masterContext.messages[0]?.content).toBe("Stale behavior check");
  });

  test("keeps stale primary_only behavior when activation gate is not met", async () => {
    const eventBus = new EventBus();
    const saves: SaveTurnInput[] = [];
    const runtimeByAgent = new Map<string, ScriptRuntime>();
    const config = makeSpaceConfig({
      turnModel: "primary_only",
      agents: [
        makeAssignment("primary-1", "participant", 0, true),
        makeAssignment("guest-1", "participant", 1),
      ],
    });

    runtimeByAgent.set("primary-1", new ScriptRuntime("primary-1", [{ output: "primary-only response" }]));
    runtimeByAgent.set("guest-1", new ScriptRuntime("guest-1", [{ output: "should not execute" }]));

    const manager = new SpaceManager({
      eventBus,
      loadSpaceConfig: async () => config,
      updateSpaceStatus: async () => undefined,
      saveTurn: async (turn) => {
        saves.push(turn);
      },
      loadHistory: async () => [],
      loadAgentHistory: async () => [],
      resolveRuntime: async (_spaceId, agentId) => runtimeByAgent.get(agentId)!,
    });

    const ack = await manager.executeTurn("space-1", "Primary only request");
    await waitForTurnCompletions(eventBus, ack.turnId, 1);

    expect(saves).toHaveLength(1);
    expect(saves[0]?.agentId).toBe("primary-1");
    expect(runtimeByAgent.get("guest-1")?.contexts ?? []).toHaveLength(0);
  });

  test("applies per-turn topology and target subsets without mutating the space default", async () => {
    const eventBus = new EventBus();
    const saves: SaveTurnInput[] = [];
    const runtimeByAgent = new Map<string, ScriptRuntime>();
    const config = makeSpaceConfig({
      turnModel: "sequential_all",
      turnModelConfig: {
        strategy: "sequential_all",
        masterModeEnabled: false,
      },
      agents: [
        makeAssignment("plan-coordinator", "global_coordinator", 0, true),
        makeAssignment("plan-worker", "participant", 1),
        makeAssignment("code-lead", "participant", 2),
        makeAssignment("code-reviewer", "participant", 3),
        makeAssignment("extra-agent", "participant", 4),
      ],
    });

    runtimeByAgent.set("plan-coordinator", new ScriptRuntime("plan-coordinator", [
      {
        output: JSON.stringify({
          globalInstruction: "Discuss only the Workbench plan.",
          guestInstructions: {
            "plan-worker": "Review the implementation plan for risk.",
          },
        }),
      },
      { output: "Planning synthesis." },
    ]));
    runtimeByAgent.set("plan-worker", new ScriptRuntime("plan-worker", [{ output: "Planning risk report." }]));
    runtimeByAgent.set("code-lead", new ScriptRuntime("code-lead", [{ output: "Implementation done." }]));
    runtimeByAgent.set("code-reviewer", new ScriptRuntime("code-reviewer", [{ output: "Implementation reviewed." }]));
    runtimeByAgent.set("extra-agent", new ScriptRuntime("extra-agent", [{ output: "Should not run." }]));

    const summaryEvents: Array<Record<string, unknown>> = [];
    eventBus.on("space.orchestrator_event", (event) => {
      summaryEvents.push(event as Record<string, unknown>);
    });

    const manager = new SpaceManager({
      eventBus,
      loadSpaceConfig: async () => config,
      updateSpaceStatus: async () => undefined,
      saveTurn: async (turn) => {
        saves.push(turn);
      },
      loadHistory: async () => [],
      loadAgentHistory: async () => [],
      resolveRuntime: async (_spaceId, agentId) => runtimeByAgent.get(agentId)!,
    });

    const planningAck = await manager.executeTurn("space-1", "Plan this Workbench run", undefined, {
      targetAgentIds: [" plan-coordinator ", "plan-worker", "plan-coordinator"],
      conversationTopology: "broadcast_team",
      mode: "plan",
    });
    await waitForSummaryEvent(eventBus);

    const implementationAck = await manager.executeTurn("space-1", "Implement the Workbench run", undefined, {
      targetAgentIds: ["code-reviewer", "code-lead"],
      conversationTopology: "shared_team_chat",
      replyToTurnId: planningAck.turnId,
      mode: "execute",
    });
    await waitForSummaryEvent(eventBus);

    expect(implementationAck.turnId).toBeString();
    expect(runtimeByAgent.get("plan-coordinator")?.contexts).toHaveLength(2);
    expect(runtimeByAgent.get("plan-worker")?.contexts).toHaveLength(1);
    expect(runtimeByAgent.get("code-lead")?.contexts).toHaveLength(1);
    expect(runtimeByAgent.get("code-reviewer")?.contexts).toHaveLength(1);
    expect(runtimeByAgent.get("extra-agent")?.contexts).toHaveLength(0);
    expect(saves.map((entry) => entry.agentId)).toEqual([
      "plan-worker",
      "plan-coordinator",
      "code-lead",
      "code-reviewer",
    ]);
    expect(summaryEvents.map((event) => (event.event as any).summary.turnModel)).toEqual([
      "primary_only",
      "sequential_all",
    ]);
    expect(config.turnModel).toBe("sequential_all");
    expect(config.turnModelConfig?.masterModeEnabled).toBe(false);
  });
});
