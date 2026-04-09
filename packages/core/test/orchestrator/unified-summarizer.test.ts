import { describe, expect, test } from "bun:test";
import {
  synthesizeSummary,
  resolveFraming,
  buildPromptMessages,
} from "../../src/orchestrator/unified-summarizer.js";
import type {
  SynthesizeSummaryInput,
  SynthesizeSummaryDeps,
} from "../../src/orchestrator/unified-summarizer.js";
import type { ModelProvider, GenerateResult, GenerateOptions, ModelInfo, StreamChunk } from "../../src/agents/model-provider.js";

function makeProvider(response: string, shouldThrow = false): ModelProvider {
  return {
    id: "test-provider",
    name: "Test Provider",
    isLocal: true,
    toolSupportMode: "native",
    async checkHealth() {
      return { available: true };
    },
    async listModels(): Promise<ModelInfo[]> {
      return [];
    },
    async generate(_model: string, _options: GenerateOptions): Promise<GenerateResult> {
      if (shouldThrow) {
        throw new Error("LLM call failed");
      }
      return {
        message: { role: "assistant", content: response },
        finishReason: "stop",
      };
    },
    async *stream(): AsyncIterable<StreamChunk> {},
  };
}

function makeInput(overrides?: Partial<SynthesizeSummaryInput>): SynthesizeSummaryInput {
  return {
    conversationTopology: "broadcast_team",
    turnModel: "primary_only",
    userInput: "Research gateway reliability patterns",
    participants: [
      { agentId: "coordinator", isPrimary: true, status: "completed", finalMessage: "Coordinated 2 workers." },
      { agentId: "worker-1", isPrimary: false, status: "completed", finalMessage: "Found 3 patterns." },
    ],
    peerReview: { enabled: false, status: "not_run", completed: 0, assignments: 0, failed: 0 },
    highlights: [],
    ...overrides,
  };
}

describe("resolveFraming", () => {
  test("broadcast_team/primary_only framing includes coordinator language", () => {
    const framing = resolveFraming("primary_only", "broadcast_team");
    expect(framing).toContain("coordinator");
    expect(framing).toContain("worker");
  });

  test("debate_synthesis framing includes debaters language", () => {
    const framing = resolveFraming("debate_synthesis", "broadcast_team");
    expect(framing).toContain("Debaters");
    expect(framing).toContain("synthesizer");
  });

  test("shared_team_chat/sequential_all framing includes collaboration language", () => {
    const framing = resolveFraming("sequential_all", "shared_team_chat");
    expect(framing).toContain("collaborated");
    expect(framing).toContain("discussion");
  });

  test("direct topology framing indicates single agent", () => {
    const framing = resolveFraming("sequential_all", "direct");
    expect(framing).toContain("single agent");
  });

  test("fallback framing for unknown combinations", () => {
    const framing = resolveFraming("round_robin", "broadcast_team");
    expect(framing).toContain("Multiple agents");
  });
});

describe("buildPromptMessages", () => {
  test("long messages are truncated", () => {
    const longMessage = "x".repeat(2000);
    const input = makeInput({
      participants: [
        { agentId: "agent-1", isPrimary: true, status: "completed", finalMessage: longMessage },
        { agentId: "agent-2", isPrimary: false, status: "completed", finalMessage: "Short." },
      ],
    });

    const { user } = buildPromptMessages(input);
    // The long message should be truncated to ~500 chars
    expect(user.length).toBeLessThan(longMessage.length);
    expect(user).toContain("...");
  });

  test("failed participants appear with error", () => {
    const input = makeInput({
      participants: [
        { agentId: "coordinator", isPrimary: true, status: "completed", finalMessage: "Done." },
        { agentId: "worker-1", isPrimary: false, status: "failed", error: "Timeout exceeded" },
      ],
    });

    const { user } = buildPromptMessages(input);
    expect(user).toContain("FAILED");
    expect(user).toContain("Timeout exceeded");
  });

  test("peer review appears when completed", () => {
    const input = makeInput({
      peerReview: { enabled: true, status: "completed", completed: 2, assignments: 3, failed: 0 },
    });

    const { user } = buildPromptMessages(input);
    expect(user).toContain("Peer review");
    expect(user).toContain("2/3");
  });

  test("highlights appear in prompt", () => {
    const input = makeInput({
      highlights: [
        { agentId: "worker-1", text: "Key finding about caching" },
      ],
    });

    const { user } = buildPromptMessages(input);
    expect(user).toContain("Key highlights");
    expect(user).toContain("Key finding about caching");
  });
});

describe("synthesizeSummary", () => {
  test("returns LLM-generated text", async () => {
    const provider = makeProvider("The research team identified 3 reliability patterns for the gateway.");
    const input = makeInput();
    const deps: SynthesizeSummaryDeps = { modelProvider: provider, modelId: "test-model" };

    const result = await synthesizeSummary(input, deps);
    expect(result).toBe("The research team identified 3 reliability patterns for the gateway.");
  });

  test("empty LLM response throws", async () => {
    const provider = makeProvider("");
    const input = makeInput();
    const deps: SynthesizeSummaryDeps = { modelProvider: provider, modelId: "test-model" };

    await expect(synthesizeSummary(input, deps)).rejects.toThrow("empty response");
  });

  test("LLM error propagates", async () => {
    const provider = makeProvider("", true);
    const input = makeInput();
    const deps: SynthesizeSummaryDeps = { modelProvider: provider, modelId: "test-model" };

    await expect(synthesizeSummary(input, deps)).rejects.toThrow("LLM call failed");
  });
});
