import { describe, expect, test } from "bun:test";
import {
  getTierDefinitions,
  isCapabilityTier,
  resolveTierProviderHints,
  resolveUserLabel,
} from "../../src/agents/capability-tiers.js";

describe("capability tiers", () => {
  test("resolves user labels to the current tier identifiers", () => {
    expect(resolveUserLabel("quick")).toBe("local");
    expect(resolveUserLabel(" balanced ")).toBe("standard");
    expect(resolveUserLabel("Pro")).toBe("advanced");
    expect(resolveUserLabel("unknown-tier")).toBeUndefined();
  });

  test("returns the configured provider hints for advanced capability", () => {
    expect(resolveTierProviderHints("advanced")).toEqual({
      providers: ["anthropic", "openai", "openrouter"],
      modelIds: {
        anthropic: "claude-sonnet-4-20250514",
        openai: "gpt-4.1",
        openrouter: "anthropic/claude-sonnet-4",
      },
      contextWindow: { min: 128_000, max: 200_000 },
      costClass: "high",
    });
  });

  test("exposes only the live capability tiers", () => {
    expect(getTierDefinitions().map((definition) => definition.id)).toEqual([
      "local",
      "standard",
      "advanced",
    ]);
    expect(isCapabilityTier("local")).toBe(true);
    expect(isCapabilityTier("fast")).toBe(false);
  });
});
