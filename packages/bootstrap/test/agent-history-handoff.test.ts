import { describe, expect, test } from "bun:test";
import {
  buildDeterministicHandoffDigest,
  listTurnsForActiveSessionBoundary,
  type HandoffTurnLike,
} from "../src/index.js";

function makeTurn(
  id: string,
  createdAt: string,
  inputText: string,
  outputText: string,
): HandoffTurnLike {
  return {
    turn_id: id,
    created_at: createdAt,
    input_json: JSON.stringify({ text: inputText }),
    output_json: JSON.stringify({ text: outputText }),
  };
}

function makeSessionTurn(
  id: string,
  createdAt: string,
  inputText: string,
  outputText: string,
): HandoffTurnLike & { user_turn_id: string } {
  return {
    ...makeTurn(id, createdAt, inputText, outputText),
    user_turn_id: "",
  };
}

describe("buildDeterministicHandoffDigest", () => {
  test("is deterministic for stable turn input", () => {
    const turns = [
      makeTurn("turn-1", "2026-03-01T00:00:00.000Z", "User one", "Assistant one"),
      makeTurn("turn-2", "2026-03-01T00:00:01.000Z", "User two", "Assistant two"),
    ];

    const first = buildDeterministicHandoffDigest(turns);
    const second = buildDeterministicHandoffDigest(turns);
    expect(first).toBe(second);
  });

  test("keeps only the most recent exchanges and clips long text", () => {
    const turns: HandoffTurnLike[] = [];
    for (let index = 1; index <= 10; index += 1) {
      turns.push(
        makeTurn(
          `turn-${index}`,
          `2026-03-01T00:00:${String(index).padStart(2, "0")}.000Z`,
          `User ${index}`,
          index === 10 ? "x".repeat(400) : `Assistant ${index}`,
        ),
      );
    }

    const digest = buildDeterministicHandoffDigest(turns);
    expect(digest).not.toContain("User: User 1\n");
    expect(digest).toContain("1. User: User 3");
    expect(digest).toContain("8. User: User 10");
    expect(digest).toContain("Assistant: " + "x".repeat(280) + "…");
  });
});

describe("listTurnsForActiveSessionBoundary", () => {
  test("uses repository boundary query when available", () => {
    const turns = [makeSessionTurn("turn-2", "2026-03-01T00:00:02.000Z", "User", "Assistant")];
    class RepoWithBoundMethod {
      readonly turns: Array<HandoffTurnLike & { user_turn_id: string }>;

      constructor(initialTurns: Array<HandoffTurnLike & { user_turn_id: string }>) {
        this.turns = initialTurns;
      }

      listBySpaceAndAgentSince(
        _spaceId: string,
        _agentId: string,
        _sinceIso: string,
        _limit = 100,
      ): Array<HandoffTurnLike & { user_turn_id: string }> {
        return this.turns;
      }

      listBySpaceAndAgent(): Array<HandoffTurnLike & { user_turn_id: string }> {
        throw new Error("fallback should not execute");
      }
    }
    const repo = new RepoWithBoundMethod(turns);

    const result = listTurnsForActiveSessionBoundary(
      repo,
      "space-main",
      "agent-main",
      "2026-03-01T00:00:01.000Z",
      5,
    );

    expect(result).toEqual(turns);
  });

  test("falls back to in-memory boundary filtering when boundary query is missing", () => {
    const turns = [
      makeSessionTurn("turn-3", "2026-03-01T00:00:03.000Z", "Latest", "Reply latest"),
      makeSessionTurn("turn-2", "2026-03-01T00:00:02.000Z", "Boundary", "Reply boundary"),
      makeSessionTurn("turn-1", "2026-03-01T00:00:01.000Z", "Older", "Reply older"),
    ];
    const repo = {
      listBySpaceAndAgent: () => turns,
    };

    const result = listTurnsForActiveSessionBoundary(
      repo,
      "space-main",
      "agent-main",
      "2026-03-01T00:00:02.000Z",
      5,
    );

    expect(result.map((turn) => turn.turn_id)).toEqual(["turn-3", "turn-2"]);
  });
});
