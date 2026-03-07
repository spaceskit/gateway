import { describe, expect, test } from "bun:test";
import {
  validateTemplateForApply,
  toTemplateReadModel,
} from "../../src/templates/template-read-model.js";
import type {
  SpaceTemplateReadModel,
  TemplateApplyResult,
  TemplateCommunicationMode,
  TemplateValidationResult,
} from "../../src/templates/template-read-model.js";
import type { SpaceTemplate } from "../../src/spaces/space-templates.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTemplate(overrides: Partial<SpaceTemplate> = {}): SpaceTemplate {
  return {
    templateId: "tpl-1",
    name: "Test Template",
    description: "A test template",
    version: 1,
    turnModel: "sequential_all",
    agents: [
      { agentId: "agent-a", profileId: "profile-a", isPrimary: true },
    ],
    capabilities: [],
    rules: [],
    tags: ["demo"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// toTemplateReadModel
// ---------------------------------------------------------------------------

describe("toTemplateReadModel", () => {
  test("maps all fields correctly", () => {
    const tpl = makeTemplate();
    const rm = toTemplateReadModel(tpl, {
      communicationMode: "async_notes",
      status: "active",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
    });

    expect(rm.templateId).toBe("tpl-1");
    expect(rm.name).toBe("Test Template");
    expect(rm.description).toBe("A test template");
    expect(rm.agentCount).toBe(1);
    expect(rm.communicationMode).toBe("async_notes");
    expect(rm.tags).toEqual(["demo"]);
    expect(rm.status).toBe("active");
    expect(rm.createdAt).toBe("2026-01-01T00:00:00Z");
    expect(rm.updatedAt).toBe("2026-01-02T00:00:00Z");
  });

  test("handles missing optional fields with defaults", () => {
    const tpl = makeTemplate({
      description: undefined,
      tags: undefined,
    });
    const rm = toTemplateReadModel(tpl);

    expect(rm.description).toBe("");
    expect(rm.tags).toEqual([]);
    expect(rm.communicationMode).toBe("chat_first");
    expect(rm.status).toBe("active");
    // createdAt / updatedAt should be ISO strings
    expect(rm.createdAt).toBeTruthy();
    expect(rm.updatedAt).toBeTruthy();
  });

  test("agentCount reflects number of agents", () => {
    const tpl = makeTemplate({
      agents: [
        { agentId: "a", isPrimary: true },
        { agentId: "b", isPrimary: false },
        { agentId: "c", isPrimary: false },
      ],
    });
    const rm = toTemplateReadModel(tpl);
    expect(rm.agentCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// validateTemplateForApply
// ---------------------------------------------------------------------------

describe("validateTemplateForApply", () => {
  test("passes with valid template", () => {
    const result = validateTemplateForApply(makeTemplate(), []);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  test("fails on empty name", () => {
    const result = validateTemplateForApply(
      makeTemplate({ name: "   " }),
      [],
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("name is required"));
  });

  test("fails on no agents", () => {
    const result = validateTemplateForApply(
      makeTemplate({ agents: [] }),
      [],
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("at least one agent"));
  });

  test("detects duplicate agentIds", () => {
    const result = validateTemplateForApply(
      makeTemplate({
        agents: [
          { agentId: "dup", isPrimary: true },
          { agentId: "dup", isPrimary: false },
        ],
      }),
      [],
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("Duplicate"));
    expect(result.errors).toContainEqual(expect.stringContaining("dup"));
  });

  test("warns on missing primary agent", () => {
    const result = validateTemplateForApply(
      makeTemplate({
        agents: [
          { agentId: "a", isPrimary: false },
          { agentId: "b", isPrimary: false },
        ],
      }),
      [],
    );
    expect(result.valid).toBe(true);
    expect(result.warnings).toContainEqual(expect.stringContaining("no primary agent"));
  });

  test("warns on name collision with existing spaces", () => {
    const result = validateTemplateForApply(
      makeTemplate({ name: "My Space" }),
      ["My Space", "Other Space"],
    );
    expect(result.valid).toBe(true);
    expect(result.warnings).toContainEqual(expect.stringContaining("already exists"));
  });

  test("returns multiple errors", () => {
    const result = validateTemplateForApply(
      makeTemplate({ name: "", agents: [] }),
      [],
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Type shape checks
// ---------------------------------------------------------------------------

describe("TemplateApplyResult shape", () => {
  test("has expected fields", () => {
    const result: TemplateApplyResult = {
      spaceId: "space-1",
      templateId: "tpl-1",
      agentsAdded: ["agent-a", "agent-b"],
      warnings: ["a warning"],
    };

    expect(result.spaceId).toBe("space-1");
    expect(result.templateId).toBe("tpl-1");
    expect(result.agentsAdded).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
  });
});

describe("TemplateCommunicationMode", () => {
  test("covers all modes", () => {
    const modes: TemplateCommunicationMode[] = [
      "async_notes",
      "chat_first",
      "structured_handoff",
    ];
    expect(modes).toHaveLength(3);
    expect(new Set(modes).size).toBe(3);
  });
});

describe("TemplateValidationResult shape", () => {
  test("has expected fields", () => {
    const result: TemplateValidationResult = {
      valid: true,
      errors: [],
      warnings: ["just a warning"],
    };
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });
});
