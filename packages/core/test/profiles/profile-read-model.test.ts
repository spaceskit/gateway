import { describe, expect, test } from "bun:test";
import {
  toAgentTemplateReadModel,
  validateProfileModelConfig,
  transitionInsightState,
} from "../../src/profiles/profile-read-model.js";
import type { AgentProfile } from "../../src/profiles/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    profileId: "prof_abc123",
    name: "Research Agent",
    description: "A research assistant",
    personalityPrompt: "You are a thorough research assistant.",
    defaultSkillIds: ["web-search", "summarise"],
    defaultActionIds: ["browse", "cite"],
    providerHint: "anthropic",
    modelHint: "claude-sonnet-4-20250514",
    canModerate: false,
    isDefault: false,
    activeRevision: 3,
    status: "active",
    source: "user",
    createdAt: new Date("2026-01-15T10:00:00Z"),
    updatedAt: new Date("2026-02-20T14:30:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// toAgentTemplateReadModel
// ---------------------------------------------------------------------------

describe("toAgentTemplateReadModel", () => {
  test("maps all fields correctly", () => {
    const profile = makeProfile();
    const rm = toAgentTemplateReadModel(profile, 42);

    expect(rm.profileId).toBe("prof_abc123");
    expect(rm.name).toBe("Research Agent");
    expect(rm.personalitySummary).toBe("You are a thorough research assistant.");
    expect(rm.skills).toEqual(["web-search", "summarise"]);
    expect(rm.modelHints).toEqual(["anthropic", "claude-sonnet-4-20250514"]);
    expect(rm.status).toBe("active");
    expect(rm.usageCount).toBe(42);
    expect(rm.createdAt).toBe("2026-01-15T10:00:00.000Z");
    expect(rm.updatedAt).toBe("2026-02-20T14:30:00.000Z");
  });

  test("handles missing optional hints by filtering empties", () => {
    const profile = makeProfile({ providerHint: "", modelHint: "" });
    const rm = toAgentTemplateReadModel(profile);

    expect(rm.modelHints).toEqual([]);
  });

  test("uses default usageCount 0 when not provided", () => {
    const rm = toAgentTemplateReadModel(makeProfile());
    expect(rm.usageCount).toBe(0);
  });

  test("maps archived status", () => {
    const rm = toAgentTemplateReadModel(makeProfile({ status: "archived" }));
    expect(rm.status).toBe("archived");
  });
});

// ---------------------------------------------------------------------------
// validateProfileModelConfig
// ---------------------------------------------------------------------------

describe("validateProfileModelConfig", () => {
  test("passes with valid config", () => {
    const result = validateProfileModelConfig({
      preferredModels: ["claude-sonnet-4-20250514"],
      fallbackModels: ["gpt-4o"],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("passes with empty config (all optional)", () => {
    const result = validateProfileModelConfig({});
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("fails on empty preferredModels array", () => {
    const result = validateProfileModelConfig({ preferredModels: [] });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("preferredModels must be non-empty if specified");
  });

  test("detects duplicate preferredModels", () => {
    const result = validateProfileModelConfig({
      preferredModels: ["claude-sonnet-4-20250514", "gpt-4o", "claude-sonnet-4-20250514"],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Duplicate preferredModels"))).toBe(true);
  });

  test("detects duplicate fallbackModels", () => {
    const result = validateProfileModelConfig({
      fallbackModels: ["gpt-4o", "gpt-4o"],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Duplicate fallbackModels"))).toBe(true);
  });

  test("detects overlap between preferred and fallback", () => {
    const result = validateProfileModelConfig({
      preferredModels: ["claude-sonnet-4-20250514", "gpt-4o"],
      fallbackModels: ["gpt-4o", "llama-3"],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Models in both preferred and fallback"))).toBe(true);
  });

  test("returns multiple errors", () => {
    const result = validateProfileModelConfig({
      preferredModels: [],
      fallbackModels: ["gpt-4o", "gpt-4o"],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// transitionInsightState
// ---------------------------------------------------------------------------

describe("transitionInsightState", () => {
  test("proposed -> accept -> accepted", () => {
    expect(transitionInsightState("proposed", "accept")).toBe("accepted");
  });

  test("proposed -> reject -> rejected", () => {
    expect(transitionInsightState("proposed", "reject")).toBe("rejected");
  });

  test("proposed -> supersede -> superseded", () => {
    expect(transitionInsightState("proposed", "supersede")).toBe("superseded");
  });

  test("accepted -> supersede -> superseded", () => {
    expect(transitionInsightState("accepted", "supersede")).toBe("superseded");
  });

  test("rejected -> accept -> no-op (stays rejected)", () => {
    expect(transitionInsightState("rejected", "accept")).toBe("rejected");
  });

  test("rejected -> reject -> no-op (stays rejected)", () => {
    expect(transitionInsightState("rejected", "reject")).toBe("rejected");
  });

  test("superseded -> accept -> no-op (stays superseded)", () => {
    expect(transitionInsightState("superseded", "accept")).toBe("superseded");
  });

  test("accepted -> accept -> no-op (stays accepted)", () => {
    expect(transitionInsightState("accepted", "accept")).toBe("accepted");
  });
});
