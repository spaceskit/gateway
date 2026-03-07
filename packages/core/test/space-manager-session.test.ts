import { describe, expect, test } from "bun:test";
import { EventBus } from "../src/events/event-bus.js";
import { SpaceManager, type SaveTurnInput } from "../src/spaces/space-manager.js";
import type {
  AgentRuntime,
  AgentState,
  TurnContext,
  TurnEvent,
} from "../src/agents/agent-runtime.js";
import type { SpaceConfig } from "../src/spaces/types.js";

class InspectRuntime implements AgentRuntime {
  readonly state: AgentState = "idle";
  readonly contexts: TurnContext[] = [];

  constructor(
    readonly agentId: string,
    private readonly responseForContext: (context: TurnContext) => string,
  ) {}

  async *executeTurn(context: TurnContext): AsyncIterable<TurnEvent> {
    this.contexts.push(context);
    const response = this.responseForContext(context);
    yield {
      type: "turn_completed",
      result: {
        agentId: this.agentId,
        turnId: context.turnId,
        messages: [
          ...context.messages,
          { role: "assistant", content: response },
        ],
        toolCalls: [],
        toolResults: [],
        finalMessage: { role: "assistant", content: response },
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        state: "idle",
      },
    };
  }

  async *resumeWithFeedback(): AsyncIterable<TurnEvent> {}

  async cancel(): Promise<void> {}
}

function makeSpaceConfig(turnModel: "primary_only" | "sequential_all"): SpaceConfig {
  const now = new Date();
  return {
    id: "space-1",
    spaceUid: "11111111-1111-4111-8111-111111111111",
    resourceId: "resource:main",
    name: "Session Continuity Test",
    turnModel,
    agents: [
      {
        spaceId: "space-1",
        agentId: "agent-1",
        profileId: "profile-1",
        role: "participant",
        turnOrder: 0,
        isPrimary: true,
        assignedAt: now,
      },
      {
        spaceId: "space-1",
        agentId: "agent-2",
        profileId: "profile-2",
        role: "participant",
        turnOrder: 1,
        isPrimary: false,
        assignedAt: now,
      },
    ],
    capabilities: [],
    capabilityOverrides: {},
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  };
}

async function waitForTurnFinished(
  eventBus: EventBus,
  turnId: string,
  expectedCompletions = 1,
  timeoutMs = 1200,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let completionCount = 0;
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`Timed out waiting for turn completion: ${turnId}`));
    }, timeoutMs);

    const unsub = eventBus.on("space.turn_event", (event) => {
      const typed = event as { turnId?: string; event?: { type?: string } };
      const eventTurnId = typed.turnId ?? "";
      const eventType = typed.event?.type ?? "";
      if (eventTurnId !== turnId) return;
      if (eventType === "error") {
        clearTimeout(timer);
        unsub();
        resolve();
        return;
      }
      if (eventType !== "turn_completed") return;
      completionCount += 1;
      if (completionCount >= expectedCompletions) {
        clearTimeout(timer);
        unsub();
        resolve();
      }
    });
  });
}

describe("SpaceManager session continuity", () => {
  test("reuses runtime instances for the same agent across turns", async () => {
    const eventBus = new EventBus();
    const saves: SaveTurnInput[] = [];
    const runtimeByAgent = new Map<string, InspectRuntime>();
    let resolveRuntimeCalls = 0;
    const singleAgentConfig = makeSpaceConfig("primary_only");
    singleAgentConfig.agents = [singleAgentConfig.agents[0]!];

    const manager = new SpaceManager({
      eventBus,
      loadSpaceConfig: async () => singleAgentConfig,
      updateSpaceStatus: async () => undefined,
      saveTurn: async (turn) => {
        saves.push(turn);
      },
      loadHistory: async () => [],
      loadAgentHistory: async () => [],
      resolveRuntime: async (_spaceId, agentId) => {
        resolveRuntimeCalls += 1;
        const existing = runtimeByAgent.get(agentId);
        if (existing) return existing;
        const runtime = new InspectRuntime(agentId, () => `response:${agentId}`);
        runtimeByAgent.set(agentId, runtime);
        return runtime;
      },
    });

    const first = await manager.executeTurn("space-1", "first");
    await waitForTurnFinished(eventBus, first.turnId);

    const second = await manager.executeTurn("space-1", "second");
    await waitForTurnFinished(eventBus, second.turnId);

    expect(resolveRuntimeCalls).toBe(1);
    expect(saves).toHaveLength(2);
    expect(saves[0]?.turnId).toContain(`${first.turnId}:agent-1`);
    expect(saves[0]?.userTurnId).toBe(first.turnId);
    expect(saves[1]?.turnId).toContain(`${second.turnId}:agent-1`);
    expect(saves[1]?.userTurnId).toBe(second.turnId);
  });

  test("maintains per-agent session history and still respects sequential turn model ordering", async () => {
    const eventBus = new EventBus();
    const saves: SaveTurnInput[] = [];
    const runtimeByAgent = new Map<string, InspectRuntime>();

    const manager = new SpaceManager({
      eventBus,
      loadSpaceConfig: async () => makeSpaceConfig("sequential_all"),
      updateSpaceStatus: async () => undefined,
      saveTurn: async (turn) => {
        saves.push(turn);
      },
      loadHistory: async () => [],
      loadAgentHistory: async (_spaceId, agentId) => {
        if (agentId === "agent-1") {
          return [{ role: "assistant", content: "agent-1 prior context" }];
        }
        return [{ role: "assistant", content: "agent-2 prior context" }];
      },
      resolveRuntime: async (_spaceId, agentId) => {
        const existing = runtimeByAgent.get(agentId);
        if (existing) return existing;
        const runtime = new InspectRuntime(agentId, () => `${agentId} says hi`);
        runtimeByAgent.set(agentId, runtime);
        return runtime;
      },
    });

    const ack = await manager.executeTurn("space-1", "new user input");
    await waitForTurnFinished(eventBus, ack.turnId, 2);

    const agent1Ctx = runtimeByAgent.get("agent-1")?.contexts[0];
    const agent2Ctx = runtimeByAgent.get("agent-2")?.contexts[0];

    expect(agent1Ctx).toBeDefined();
    expect(agent2Ctx).toBeDefined();

    expect(agent1Ctx?.messages.map((m) => m.content)).toEqual([
      "agent-1 prior context",
      "new user input",
    ]);

    expect(agent2Ctx?.messages.map((m) => m.content)).toEqual([
      "agent-2 prior context",
      "new user input",
      "agent-1 says hi",
    ]);

    expect(saves).toHaveLength(2);
    expect(saves.every((turn) => turn.userTurnId === ack.turnId)).toBe(true);
  });

  test("falls back to space turn model when targetAgentId is stale or invalid", async () => {
    const eventBus = new EventBus();
    const runtimeByAgent = new Map<string, InspectRuntime>();
    const singleAgentConfig = makeSpaceConfig("primary_only");

    const manager = new SpaceManager({
      eventBus,
      loadSpaceConfig: async () => singleAgentConfig,
      updateSpaceStatus: async () => undefined,
      saveTurn: async () => undefined,
      loadHistory: async () => [],
      loadAgentHistory: async () => [],
      resolveRuntime: async (_spaceId, agentId) => {
        const existing = runtimeByAgent.get(agentId);
        if (existing) return existing;
        const runtime = new InspectRuntime(agentId, () => `response:${agentId}`);
        runtimeByAgent.set(agentId, runtime);
        return runtime;
      },
    });

    const ack = await manager.executeTurn("space-1", "hello", "STALE-AGENT-ID");
    await waitForTurnFinished(eventBus, ack.turnId);

    expect(runtimeByAgent.get("agent-1")?.contexts).toHaveLength(1);
    expect(runtimeByAgent.get("agent-2")?.contexts ?? []).toHaveLength(0);
  });
});
