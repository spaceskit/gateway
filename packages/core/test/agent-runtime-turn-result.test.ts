import { describe, expect, test, mock, spyOn } from "bun:test";
import { emitPromptBridgeWarning } from "../src/agents/agent-runtime-turn-result.js";
import type { TurnContext } from "../src/agents/agent-runtime.js";

function makeContext(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    spaceId: "space-123",
    turnId: "turn-456",
    messages: [],
    lineageId: "lineage-789",
    hopCount: 0,
    maxHops: 10,
    ...overrides,
  };
}

describe("emitPromptBridgeWarning", () => {
  test("emitting a prompt bridge warning calls onWarning with full payload (code, spaceId, agentId, turnId, providerId, modelId, ...details)", () => {
    const onWarning = mock((_payload: Record<string, unknown>) => {});
    const context = makeContext({ spaceId: "space-abc", turnId: "turn-xyz" });

    emitPromptBridgeWarning(
      "prompt_bridge_tool_missing_tool_call_id",
      context,
      "agent-1",
      "provider-1",
      "model-1",
      { toolName: "lists.listLists", extra: 42 },
      onWarning,
    );

    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onWarning.mock.calls[0]?.[0]).toEqual({
      code: "prompt_bridge_tool_missing_tool_call_id",
      spaceId: "space-abc",
      agentId: "agent-1",
      turnId: "turn-xyz",
      providerId: "provider-1",
      modelId: "model-1",
      toolName: "lists.listLists",
      extra: 42,
    });
  });

  test("emitting without onWarning is silent — no console.warn output", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      emitPromptBridgeWarning(
        "prompt_bridge_tool_missing_tool_call_id",
        makeContext(),
        "agent-1",
        "provider-1",
        "model-1",
        { toolName: "lists.listLists" },
      );
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("emitting without details still produces a payload with required base fields", () => {
    const onWarning = mock((_payload: Record<string, unknown>) => {});
    emitPromptBridgeWarning(
      "some_code",
      makeContext({ spaceId: "s", turnId: "t" }),
      "a",
      "p",
      "m",
      undefined,
      onWarning,
    );
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onWarning.mock.calls[0]?.[0]).toEqual({
      code: "some_code",
      spaceId: "s",
      agentId: "a",
      turnId: "t",
      providerId: "p",
      modelId: "m",
    });
  });
});
