import { describe, test, expect } from "bun:test";
import {
  createBudget,
  remainingForNextParticipant,
  recordParticipantSpend,
  estimateTokens,
} from "../../src/orchestrator/context-budget.js";

describe("context-budget", () => {
  test("createBudget calculates totalBudgetTokens as 75% of model window", () => {
    const budget = createBudget(128_000, 0, 0);
    expect(budget.totalBudgetTokens).toBe(96_000);
    expect(budget.calibrationFactor).toBe(1.0);
    expect(budget.spentByParticipants.size).toBe(0);
  });

  test("createBudget reserves estimated tokens for system prompt and user input", () => {
    // 400 chars / 4 = 100 tokens for system, 200 chars / 4 = 50 tokens for user
    const budget = createBudget(128_000, 400, 200);
    expect(budget.reservedForSystemPrompt).toBe(100);
    expect(budget.reservedForUserInput).toBe(50);
  });

  test("remainingForNextParticipant returns correct value with no spends", () => {
    const budget = createBudget(128_000, 400, 200);
    // 96000 - 100 - 50 = 95850
    expect(remainingForNextParticipant(budget)).toBe(95_850);
  });

  test("remainingForNextParticipant accounts for participant spends", () => {
    const budget = createBudget(128_000, 400, 200);
    recordParticipantSpend(budget, "agent-a", 10_000);
    recordParticipantSpend(budget, "agent-b", 5_000);
    // 96000 - 100 - 50 - 10000 - 5000 = 80850
    expect(remainingForNextParticipant(budget)).toBe(80_850);
  });

  test("recordParticipantSpend accumulates for the same agent", () => {
    const budget = createBudget(100_000, 0, 0);
    recordParticipantSpend(budget, "agent-x", 1000);
    recordParticipantSpend(budget, "agent-x", 2000);
    expect(budget.spentByParticipants.get("agent-x")).toBe(3000);
  });

  test("recordParticipantSpend tracks multiple agents independently", () => {
    const budget = createBudget(100_000, 0, 0);
    recordParticipantSpend(budget, "agent-a", 500);
    recordParticipantSpend(budget, "agent-b", 700);
    expect(budget.spentByParticipants.get("agent-a")).toBe(500);
    expect(budget.spentByParticipants.get("agent-b")).toBe(700);
  });

  test("estimateTokens with default calibration factor", () => {
    // 100 chars / 4 * 1.0 = 25
    expect(estimateTokens(100)).toBe(25);
    // 13 chars / 4 = 3.25 → ceil = 4
    expect(estimateTokens(13)).toBe(4);
  });

  test("estimateTokens with custom calibration factor", () => {
    // 100 chars / 4 * 2.0 = 50
    expect(estimateTokens(100, 2.0)).toBe(50);
    // 100 chars / 4 * 0.5 = 12.5 → ceil = 13
    expect(estimateTokens(100, 0.5)).toBe(13);
  });

  test("estimateTokens with zero chars returns zero", () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(0, 2.0)).toBe(0);
  });

  test("edge case: empty budget has full remaining", () => {
    const budget = createBudget(10_000, 0, 0);
    expect(remainingForNextParticipant(budget)).toBe(7_500);
  });

  test("edge case: overspent budget returns negative remaining", () => {
    const budget = createBudget(10_000, 0, 0);
    // Total budget is 7500, spend 8000
    recordParticipantSpend(budget, "agent-greedy", 8000);
    expect(remainingForNextParticipant(budget)).toBe(-500);
  });

  test("edge case: very small model window", () => {
    const budget = createBudget(100, 40, 40);
    // totalBudget = 75, systemReserved = 10, userReserved = 10
    expect(budget.totalBudgetTokens).toBe(75);
    expect(remainingForNextParticipant(budget)).toBe(55);
  });
});
