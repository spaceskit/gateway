import { describe, expect, test } from "bun:test";
import {
  isSummaryEligible,
  assembleSummary,
} from "../../src/orchestrator/summary-protocol.js";
import type { SummaryDecision } from "../../src/orchestrator/summary-protocol.js";

describe("isSummaryEligible", () => {
  test("true for 2+ agents and 3+ turns", () => {
    expect(isSummaryEligible(3, 2)).toBe(true);
    expect(isSummaryEligible(5, 3)).toBe(true);
    expect(isSummaryEligible(10, 10)).toBe(true);
  });

  test("false for 1 agent", () => {
    expect(isSummaryEligible(3, 1)).toBe(false);
    expect(isSummaryEligible(100, 1)).toBe(false);
  });

  test("false for fewer than 3 turns", () => {
    expect(isSummaryEligible(2, 2)).toBe(false);
    expect(isSummaryEligible(0, 5)).toBe(false);
    expect(isSummaryEligible(1, 3)).toBe(false);
  });
});

describe("assembleSummary", () => {
  const baseTurns = [
    { turnId: "t1", agentId: "agent-a", text: "Hello from A" },
    { turnId: "t2", agentId: "agent-b", text: "Hello from B" },
    { turnId: "t3", agentId: "agent-a", text: "Follow-up from A" },
  ];

  test("creates valid payload", () => {
    const result = assembleSummary({
      summaryId: "s1",
      spaceId: "space-1",
      turns: baseTurns,
      nowIso: "2026-02-28T00:00:00.000Z",
    });

    expect(result.summaryId).toBe("s1");
    expect(result.spaceId).toBe("space-1");
    expect(result.completedAt).toBe("2026-02-28T00:00:00.000Z");
    expect(result.synthesizedText).toContain("[agent-a]: Hello from A");
    expect(result.synthesizedText).toContain("[agent-b]: Hello from B");
  });

  test("deduplicates agent IDs", () => {
    const result = assembleSummary({
      summaryId: "s1",
      spaceId: "space-1",
      turns: baseTurns,
    });

    expect(result.participatingAgents).toEqual(["agent-a", "agent-b"]);
  });

  test("includes all turn IDs", () => {
    const result = assembleSummary({
      summaryId: "s1",
      spaceId: "space-1",
      turns: baseTurns,
    });

    expect(result.turnIds).toEqual(["t1", "t2", "t3"]);
  });

  test("uses provided decisions", () => {
    const decisions: SummaryDecision[] = [
      { text: "Use TypeScript", proposedBy: "agent-a", status: "accepted" },
    ];
    const result = assembleSummary({
      summaryId: "s1",
      spaceId: "space-1",
      turns: baseTurns,
      decisions,
    });

    expect(result.keyDecisions).toEqual(decisions);
  });

  test("defaults to empty decisions when not provided", () => {
    const result = assembleSummary({
      summaryId: "s1",
      spaceId: "space-1",
      turns: baseTurns,
    });

    expect(result.keyDecisions).toEqual([]);
  });

  test("version is 1", () => {
    const result = assembleSummary({
      summaryId: "s1",
      spaceId: "space-1",
      turns: baseTurns,
    });

    expect(result.version).toBe(1);
  });
});
