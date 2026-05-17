import { describe, expect, test } from "bun:test";
import {
  ARCHETYPE_PROFILES,
  ARCHETYPE_TEMPLATES,
  buildTemplateConfigJson,
} from "../src/seed/archetype-templates.js";

function templateConfig(templateId: string): Record<string, any> {
  const template = ARCHETYPE_TEMPLATES.find((entry) => entry.templateId === templateId);
  if (!template) {
    throw new Error(`Template missing: ${templateId}`);
  }
  return JSON.parse(buildTemplateConfigJson(template));
}

function profileRuntime(profileId: string): { providerHint: string; modelId: string } {
  const profile = ARCHETYPE_PROFILES.find((entry) => entry.profileId === profileId);
  if (!profile) {
    throw new Error(`Profile missing: ${profileId}`);
  }
  return {
    providerHint: profile.providerHint,
    modelId: profile.modelId,
  };
}

function expectProfileRuntimes(expected: Record<string, { providerHint: string; modelId: string }>): void {
  for (const [profileId, runtime] of Object.entries(expected)) {
    expect(profileRuntime(profileId)).toEqual(runtime);
  }
}

describe("workbench archetype templates", () => {
  test("seeds the plan discussion template with exact runtime hints", () => {
    const template = ARCHETYPE_TEMPLATES.find((entry) => entry.templateId === "workbench/plan-discussion");
    expect(template?.archetypeId).toBe("discussion");
    expect(template?.agents.map((agent) => agent.profileId)).toEqual([
      "plan-coordinator-opus",
      "plan-codex-architect",
      "plan-opus-reviewer",
      "plan-gemini-constraints",
      "plan-lmstudio-maintainer",
      "plan-apple-continuity",
    ]);

    const config = templateConfig("workbench/plan-discussion");
    expect(config.baseAgents).toHaveLength(6);
    expect(config.baseAgents[0]).toMatchObject({
      agentId: "plan-coordinator",
      profileId: "plan-coordinator-opus",
      role: "global_coordinator",
      isPrimary: true,
    });
    expect(config.metadata).toMatchObject({
      archetypeId: "discussion",
      category: "team_pattern",
      complexityTier: "advanced",
      topology: "broadcast_team",
    });

    expectProfileRuntimes({
      "plan-coordinator-opus": {
        providerHint: "claude-agent-sdk",
        modelId: "claude-agent-sdk/claude-opus-4-6",
      },
      "plan-codex-architect": {
        providerHint: "codex-app-server",
        modelId: "codex-app-server/gpt-5.4",
      },
      "plan-opus-reviewer": {
        providerHint: "claude-agent-sdk",
        modelId: "claude-agent-sdk/claude-opus-4-6",
      },
      "plan-gemini-constraints": {
        providerHint: "gemini",
        modelId: "gemini/gemini-2.5-flash",
      },
      "plan-lmstudio-maintainer": {
        providerHint: "lmstudio",
        modelId: "lmstudio/qwen2.5-coder",
      },
      "plan-apple-continuity": {
        providerHint: "apple",
        modelId: "apple/apple-on-device",
      },
    });
  });

  test("seeds the code implementation template with exact runtime hints", () => {
    const template = ARCHETYPE_TEMPLATES.find((entry) => entry.templateId === "workbench/code-implementation");
    expect(template?.archetypeId).toBe("coding");
    expect(template?.agents.map((agent) => agent.profileId)).toEqual([
      "code-lead-codex",
      "code-opus-reviewer",
      "code-gemini-integrator",
      "code-lmstudio-maintainer",
      "code-apple-continuity",
    ]);

    const config = templateConfig("workbench/code-implementation");
    expect(config.baseAgents).toHaveLength(5);
    expect(config.baseAgents[0]).toMatchObject({
      agentId: "code-lead",
      profileId: "code-lead-codex",
      role: "global_coordinator",
      isPrimary: true,
    });
    expect(config.metadata).toMatchObject({
      archetypeId: "coding",
      category: "team_pattern",
      complexityTier: "advanced",
      topology: "shared_team_chat",
    });

    expectProfileRuntimes({
      "code-lead-codex": {
        providerHint: "codex-app-server",
        modelId: "codex-app-server/gpt-5.4",
      },
      "code-opus-reviewer": {
        providerHint: "claude-agent-sdk",
        modelId: "claude-agent-sdk/claude-opus-4-6",
      },
      "code-gemini-integrator": {
        providerHint: "gemini",
        modelId: "gemini/gemini-2.5-flash",
      },
      "code-lmstudio-maintainer": {
        providerHint: "lmstudio",
        modelId: "lmstudio/qwen2.5-coder",
      },
      "code-apple-continuity": {
        providerHint: "apple",
        modelId: "apple/apple-on-device",
      },
    });
  });
});
