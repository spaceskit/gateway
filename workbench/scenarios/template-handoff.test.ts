import { describe, expect, test } from "bun:test";
import {
  buildWorkbenchPlanArtifactPayload,
  selectWorkbenchLiveAgents,
  WORKBENCH_PLAN_ARTIFACT_TAGS,
} from "./template-handoff.js";

const PLAN_AGENTS = [
  { agentId: "plan-coordinator", profileId: "plan-coordinator-opus", role: "global_coordinator", turnOrder: 0, isPrimary: true },
  { agentId: "plan-codex-architect", profileId: "plan-codex-architect", role: "participant", turnOrder: 1, isPrimary: false },
  { agentId: "plan-opus-reviewer", profileId: "plan-opus-reviewer", role: "participant", turnOrder: 2, isPrimary: false },
  { agentId: "plan-gemini-constraints", profileId: "plan-gemini-constraints", role: "participant", turnOrder: 3, isPrimary: false },
  { agentId: "plan-lmstudio-maintainer", profileId: "plan-lmstudio-maintainer", role: "participant", turnOrder: 4, isPrimary: false },
  { agentId: "plan-apple-continuity", profileId: "plan-apple-continuity", role: "participant", turnOrder: 5, isPrimary: false },
];

describe("template handoff helpers", () => {
  test("omits unavailable optional local providers without dropping required providers", () => {
    const selection = selectWorkbenchLiveAgents({
      templateId: "workbench/plan-discussion",
      agents: PLAN_AGENTS,
      availableProviderIds: new Set([
        "codex-app-server",
        "claude-agent-sdk",
        "gemini",
        "apple",
      ]),
    });

    expect(selection.missingRequiredProviders).toEqual([]);
    expect(selection.requiredProvidersUsed).toEqual([
      "claude-agent-sdk",
      "codex-app-server",
      "gemini",
    ]);
    expect(selection.optionalProvidersUsed).toEqual(["apple"]);
    expect(selection.optionalProvidersOmitted).toEqual(["lmstudio"]);
    expect(selection.agents.map((agent) => agent.profileId)).toEqual([
      "plan-coordinator-opus",
      "plan-codex-architect",
      "plan-opus-reviewer",
      "plan-gemini-constraints",
      "plan-apple-continuity",
    ]);
  });

  test("reports missing required providers for the live staged run", () => {
    const selection = selectWorkbenchLiveAgents({
      templateId: "workbench/plan-discussion",
      agents: PLAN_AGENTS,
      availableProviderIds: new Set(["claude-agent-sdk", "gemini", "apple", "lmstudio"]),
    });

    expect(selection.missingRequiredProviders).toEqual(["codex-app-server"]);
  });

  test("builds a structured handoff artifact payload for plan storage", () => {
    const payload = buildWorkbenchPlanArtifactPayload({
      markdown: "# Plan\n\nImplementation steps.",
      sourceTemplateId: "workbench/plan-discussion",
      targetTemplateId: "workbench/code-implementation",
      sourceSpaceId: "space-plan",
      sourceTurnId: "turn-plan",
      requiredProvidersUsed: ["claude-agent-sdk", "codex-app-server", "gemini"],
      optionalProvidersUsed: ["apple"],
      optionalProvidersOmitted: ["lmstudio"],
    });

    expect(payload.type).toBe("workbench.plan");
    expect(payload.title).toBe("Workbench template handoff plan");
    expect(payload.mimeType).toBe("application/json");
    expect(JSON.parse(payload.tagsJson)).toEqual(WORKBENCH_PLAN_ARTIFACT_TAGS);
    expect(JSON.parse(payload.contentJson)).toEqual({
      schemaVersion: 1,
      kind: "workbench.plan",
      markdown: "# Plan\n\nImplementation steps.",
      sourceTemplateId: "workbench/plan-discussion",
      targetTemplateId: "workbench/code-implementation",
      sourceSpaceId: "space-plan",
      sourceTurnId: "turn-plan",
      requiredProvidersUsed: ["claude-agent-sdk", "codex-app-server", "gemini"],
      optionalProvidersUsed: ["apple"],
      optionalProvidersOmitted: ["lmstudio"],
    });
  });
});
