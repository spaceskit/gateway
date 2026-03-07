import { describe, expect, test } from "bun:test";
import { EventBus } from "../src/events/event-bus.js";
import { SpaceManager } from "../src/spaces/space-manager.js";
import type {
  AgentRuntime,
  AgentState,
  TurnContext,
  TurnEvent,
} from "../src/agents/agent-runtime.js";
import type { ModelMessage } from "../src/agents/model-provider.js";
import type { SpaceConfig } from "../src/spaces/types.js";

class StubRuntime implements AgentRuntime {
  readonly agentId: string;
  readonly state: AgentState = "idle";

  constructor(agentId: string, private readonly response: string) {
    this.agentId = agentId;
  }

  async *executeTurn(context: TurnContext): AsyncIterable<TurnEvent> {
    yield { type: "text_delta", text: `${this.agentId}: ${this.response.slice(0, 20)}` };
    yield {
      type: "turn_completed",
      result: {
        agentId: this.agentId,
        turnId: context.turnId,
        messages: [
          ...context.messages,
          { role: "assistant", content: this.response },
        ],
        toolCalls: [],
        toolResults: [],
        finalMessage: { role: "assistant", content: this.response },
        usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
        state: "idle",
      },
    };
  }

  async *resumeWithFeedback(): AsyncIterable<TurnEvent> {}

  async cancel(): Promise<void> {}
}

function makeSpaceConfig(agentCount: number): SpaceConfig {
  const now = new Date();
  return {
    id: "space-1",
    spaceUid: "11111111-1111-4111-8111-111111111111",
    resourceId: "resource:main",
    name: "Summary Test",
    turnModel: "sequential_all",
    agents: Array.from({ length: agentCount }).map((_, index) => ({
      spaceId: "space-1",
      agentId: `agent-${index + 1}`,
      profileId: `profile-${index + 1}`,
      role: "participant",
      turnOrder: index,
      isPrimary: index === 0,
      assignedAt: now,
    })),
    capabilities: [],
    capabilityOverrides: {},
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  };
}

async function waitForEvent<T>(
  eventBus: EventBus,
  type: string,
  timeoutMs = 1000,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`Timed out waiting for event: ${type}`));
    }, timeoutMs);

    const unsub = eventBus.on(type, (event) => {
      clearTimeout(timer);
      unsub();
      resolve(event as T);
    });
  });
}

describe("SpaceManager orchestrator summary events", () => {
  test("emits summary.completed for multi-agent discussions", async () => {
    const eventBus = new EventBus();
    const config = makeSpaceConfig(2);
    const saves: Array<{ output: string; agentId: string }> = [];

    const manager = new SpaceManager({
      eventBus,
      loadSpaceConfig: async () => config,
      updateSpaceStatus: async () => undefined,
      saveTurn: async (turn) => {
        saves.push({ output: turn.output, agentId: turn.agentId });
      },
      loadHistory: async () => [{ role: "user", content: "Start" } satisfies ModelMessage],
      resolveRuntime: async (_spaceId, agentId) => new StubRuntime(agentId, `response from ${agentId}`),
    });

    await manager.executeTurn("space-1", "Discuss rollout plan");

    const summaryEvent = await waitForEvent<Record<string, unknown>>(
      eventBus,
      "space.orchestrator_event",
      1500,
    );

    expect(summaryEvent.eventType).toBe("summary.completed");
    const payload = summaryEvent.event as Record<string, unknown>;
    expect(payload.type).toBe("summary.completed");

    const summary = payload.summary as Record<string, unknown>;
    expect(summary.status).toBe("completed");
    expect(summary.turnModel).toBe("sequential_all");

    const participants = summary.participants as Array<Record<string, unknown>>;
    expect(participants.length).toBe(2);
    expect(participants[0]?.agentId).toBe("agent-1");
    expect(participants[1]?.agentId).toBe("agent-2");
    expect(typeof summary.finalSummaryText).toBe("string");
    expect((summary.finalSummaryText as string).length).toBeGreaterThan(0);

    expect(saves.length).toBeGreaterThanOrEqual(1);
  });

  test("does not emit summary event for single-agent turns", async () => {
    const eventBus = new EventBus();
    const config = makeSpaceConfig(1);
    let summaryEventCount = 0;

    eventBus.on("space.orchestrator_event", () => {
      summaryEventCount += 1;
    });

    const manager = new SpaceManager({
      eventBus,
      loadSpaceConfig: async () => config,
      updateSpaceStatus: async () => undefined,
      saveTurn: async () => undefined,
      loadHistory: async () => [{ role: "user", content: "Start" } satisfies ModelMessage],
      resolveRuntime: async (_spaceId, agentId) => new StubRuntime(agentId, `response from ${agentId}`),
    });

    await manager.executeTurn("space-1", "Single agent request");
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(summaryEventCount).toBe(0);
  });
});
