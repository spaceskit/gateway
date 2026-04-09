import { describe, expect, test } from "bun:test";
import { EventBus } from "../../src/events/event-bus.js";
import { SpaceManager } from "../../src/spaces/space-manager.js";
import type { AgentRuntime, AgentState, TurnContext, TurnEvent } from "../../src/agents/agent-runtime.js";
import type { ModelMessage } from "../../src/agents/model-provider.js";
import type { SpaceConfig } from "../../src/spaces/types.js";

class StubRuntime implements AgentRuntime {
  readonly state: AgentState = "idle";

  constructor(readonly agentId: string, private readonly response: string) {}

  async *executeTurn(context: TurnContext): AsyncIterable<TurnEvent> {
    yield { type: "text_delta", text: this.response.slice(0, 20) };
    yield {
      type: "turn_completed",
      result: {
        agentId: this.agentId,
        turnId: context.turnId,
        messages: [...context.messages, { role: "assistant", content: this.response }],
        toolCalls: [],
        toolResults: [],
        finalMessage: { role: "assistant", content: this.response },
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        state: "idle",
      },
    };
  }

  async *resumeWithFeedback(): AsyncIterable<TurnEvent> {}
  async cancel(): Promise<void> {}
}

function makeConfig(): SpaceConfig {
  const now = new Date();
  return {
    id: "space-1",
    spaceUid: "space-1",
    resourceId: "resource-1",
    name: "Reflection Summary",
    turnModel: "sequential_all",
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

describe("SpaceManager reflection summaries", () => {
  test("uses the reflection service for transcript-visible summary text", async () => {
    const eventBus = new EventBus();
    const events: Array<Record<string, unknown>> = [];
    eventBus.on("space.orchestrator_event", (event) => {
      events.push(event as Record<string, unknown>);
    });

    const manager = new SpaceManager({
      eventBus,
      loadSpaceConfig: async () => makeConfig(),
      updateSpaceStatus: async () => undefined,
      saveTurn: async () => undefined,
      loadHistory: async () => [{ role: "user", content: "Start" } satisfies ModelMessage],
      resolveRuntime: async (_spaceId, agentId) => new StubRuntime(agentId, `response from ${agentId}`),
      reflectionService: {
        async runSummaryJob() {
          return {
            summaryText: "Reflection summary text.",
            fallbackMode: "heuristic",
            trace: {
              jobType: "summary",
              kind: "orchestrator",
              source: "space-manager",
              fallbackMode: "heuristic",
              generatedAt: new Date().toISOString(),
            },
          };
        },
      },
    });

    await manager.executeTurn("space-1", "Summarize this");
    await new Promise((resolve) => setTimeout(resolve, 50));

    const payload = events[0]?.event as Record<string, unknown>;
    const summary = payload.summary as Record<string, unknown>;
    expect(summary.finalSummaryText).toBe("Reflection summary text.");
  });
});
