import { describe, expect, test } from "bun:test";
import {
  MAX_PINNED_DECISIONS,
  MAX_DECISION_LENGTH,
  validateDecisionText,
  canAddDecision,
  transitionPinnedDecision,
} from "../../src/orchestrator/pinned-decisions.js";

describe("validateDecisionText", () => {
  test("valid text passes", () => {
    const result = validateDecisionText("Use TypeScript for all new modules");
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("empty text fails", () => {
    const result = validateDecisionText("");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("required");
  });

  test("whitespace-only text fails", () => {
    const result = validateDecisionText("   ");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("required");
  });

  test("text over 120 chars fails", () => {
    const longText = "x".repeat(121);
    const result = validateDecisionText(longText);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("exceeds");
    expect(result.errors[0]).toContain("121");
  });

  test("text exactly 120 chars passes", () => {
    const exactText = "x".repeat(120);
    const result = validateDecisionText(exactText);
    expect(result.valid).toBe(true);
  });
});

describe("canAddDecision", () => {
  test("true when under limit", () => {
    expect(canAddDecision(0)).toBe(true);
    expect(canAddDecision(15)).toBe(true);
    expect(canAddDecision(29)).toBe(true);
  });

  test("false at limit (30)", () => {
    expect(canAddDecision(30)).toBe(false);
    expect(canAddDecision(31)).toBe(false);
  });
});

describe("transitionPinnedDecision", () => {
  test("proposed -> approve -> approved with approvedBy", () => {
    const result = transitionPinnedDecision("proposed", "approve", "user-1");
    expect(result.status).toBe("approved");
    expect(result.approvedBy).toBe("user-1");
  });

  test("proposed -> reject -> rejected", () => {
    const result = transitionPinnedDecision("proposed", "reject", "user-1");
    expect(result.status).toBe("rejected");
    expect(result.approvedBy).toBeUndefined();
  });

  test("approved -> reject -> no-op (stays approved)", () => {
    const result = transitionPinnedDecision("approved", "reject", "user-1");
    expect(result.status).toBe("approved");
  });

  test("rejected -> approve -> no-op (stays rejected)", () => {
    const result = transitionPinnedDecision("rejected", "approve", "user-1");
    expect(result.status).toBe("rejected");
  });

  test("propose action always returns proposed (idempotent)", () => {
    expect(transitionPinnedDecision("proposed", "propose", "a").status).toBe("proposed");
    expect(transitionPinnedDecision("approved", "propose", "a").status).toBe("proposed");
    expect(transitionPinnedDecision("rejected", "propose", "a").status).toBe("proposed");
  });
});

describe("constants", () => {
  test("MAX_PINNED_DECISIONS is 30", () => {
    expect(MAX_PINNED_DECISIONS).toBe(30);
  });

  test("MAX_DECISION_LENGTH is 120", () => {
    expect(MAX_DECISION_LENGTH).toBe(120);
  });
});
