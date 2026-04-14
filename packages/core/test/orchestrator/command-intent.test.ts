import { describe, expect, test } from "bun:test";
import {
  parseCommandIntent,
  routeCommandIntent,
  suggestModelTier,
} from "../../src/orchestrator/command-intent.js";
import type {
  CommandComplexity,
  CommandIntent,
} from "../../src/orchestrator/command-intent.js";

describe("parseCommandIntent", () => {
  test("'list spaces' -> list_spaces, simple", () => {
    const result = parseCommandIntent("list spaces");
    expect(result.type).toBe("list_spaces");
    expect(result.complexity).toBe("simple");
    expect(result.confidence).toBe(1.0);
  });

  test("'create space' -> create_space, moderate", () => {
    const result = parseCommandIntent("create space");
    expect(result.type).toBe("create_space");
    expect(result.complexity).toBe("moderate");
    expect(result.confidence).toBe(1.0);
  });

  test("case insensitive: 'Create Space' -> create_space", () => {
    const result = parseCommandIntent("Create Space");
    expect(result.type).toBe("create_space");
    expect(result.complexity).toBe("moderate");
  });

  test("extracts quoted name: 'create space \"My Space\"'", () => {
    const result = parseCommandIntent('create space "My Space"');
    expect(result.type).toBe("create_space");
    expect(result.params.name).toBe("My Space");
  });

  test("'add agent' -> add_agent, moderate", () => {
    const result = parseCommandIntent("add agent");
    expect(result.type).toBe("add_agent");
    expect(result.complexity).toBe("moderate");
    expect(result.confidence).toBe(1.0);
  });

  test("'remove agent' -> remove_agent, moderate", () => {
    const result = parseCommandIntent("remove agent");
    expect(result.type).toBe("remove_agent");
    expect(result.complexity).toBe("moderate");
    expect(result.confidence).toBe(1.0);
  });

  test("'list agents' -> list_agents, simple", () => {
    const result = parseCommandIntent("list agents");
    expect(result.type).toBe("list_agents");
    expect(result.complexity).toBe("simple");
    expect(result.confidence).toBe(1.0);
  });

  test("'share this' -> share_space, complex", () => {
    const result = parseCommandIntent("share this");
    expect(result.type).toBe("share_space");
    expect(result.complexity).toBe("complex");
    expect(result.confidence).toBe(0.5);
  });

  test("'research the regression' -> orchestrate_task, complex", () => {
    const result = parseCommandIntent("research the regression");
    expect(result.type).toBe("orchestrate_task");
    expect(result.complexity).toBe("complex");
  });

  test("'check task progress' -> check_task_progress, simple", () => {
    const result = parseCommandIntent("check task progress");
    expect(result.type).toBe("check_task_progress");
    expect(result.complexity).toBe("simple");
  });

  test("'what do we know about launch failures' -> search_knowledge, moderate", () => {
    const result = parseCommandIntent("what do we know about launch failures");
    expect(result.type).toBe("search_knowledge");
    expect(result.complexity).toBe("moderate");
  });

  test("'open space \"Research\"' -> navigate_to_space, simple", () => {
    const result = parseCommandIntent('open space "Research"');
    expect(result.type).toBe("navigate_to_space");
    expect(result.complexity).toBe("simple");
    expect(result.params.name).toBe("Research");
  });

  test("unrecognized text -> unknown", () => {
    const result = parseCommandIntent("do something random");
    expect(result.type).toBe("unknown");
    expect(result.confidence).toBe(0);
  });

  test("empty string -> unknown", () => {
    const result = parseCommandIntent("");
    expect(result.type).toBe("unknown");
    expect(result.confidence).toBe(0);
  });

  test("preserves rawText (trimmed)", () => {
    const result = parseCommandIntent("  list spaces  ");
    expect(result.rawText).toBe("list spaces");
  });

  test("extracts multiple quoted params", () => {
    const result = parseCommandIntent('create space "First" "Second"');
    expect(result.params.name).toBe("First");
    expect(result.params.param1).toBe("Second");
  });
});

describe("routeCommandIntent", () => {
  test("list_spaces -> space.list, requiresInference=false", () => {
    const intent: CommandIntent = {
      type: "list_spaces",
      complexity: "simple",
      params: {},
      rawText: "list spaces",
      confidence: 1.0,
    };
    const result = routeCommandIntent(intent);
    expect(result.targetMessageType).toBe("space.list");
    expect(result.requiresInference).toBe(false);
  });

  test("create_space -> space.create, requiresInference=true", () => {
    const intent: CommandIntent = {
      type: "create_space",
      complexity: "moderate",
      params: {},
      rawText: "create space",
      confidence: 1.0,
    };
    const result = routeCommandIntent(intent);
    expect(result.targetMessageType).toBe("space.create");
    expect(result.requiresInference).toBe(true);
  });

  test("unknown -> no targetMessageType, requiresInference=true", () => {
    const intent: CommandIntent = {
      type: "unknown",
      complexity: "simple",
      params: {},
      rawText: "gibberish",
      confidence: 0,
    };
    const result = routeCommandIntent(intent);
    expect(result.targetMessageType).toBeUndefined();
    expect(result.requiresInference).toBe(true);
  });

  test("add_agent -> space.add_agent", () => {
    const intent: CommandIntent = {
      type: "add_agent",
      complexity: "moderate",
      params: {},
      rawText: "add agent",
      confidence: 1.0,
    };
    const result = routeCommandIntent(intent);
    expect(result.targetMessageType).toBe("space.add_agent");
    expect(result.requiresInference).toBe(true);
  });

  test("remove_agent -> space.remove_agent, requiresInference=false", () => {
    const intent: CommandIntent = {
      type: "remove_agent",
      complexity: "moderate",
      params: {},
      rawText: "remove agent",
      confidence: 1.0,
    };
    const result = routeCommandIntent(intent);
    expect(result.targetMessageType).toBe("space.remove_agent");
    expect(result.requiresInference).toBe(false);
  });

  test("share_space -> space.share_create_invite, requiresInference=true", () => {
    const intent: CommandIntent = {
      type: "share_space",
      complexity: "complex",
      params: {},
      rawText: "share this",
      confidence: 0.5,
    };
    const result = routeCommandIntent(intent);
    expect(result.targetMessageType).toBe("space.share_create_invite");
    expect(result.requiresInference).toBe(true);
  });

  test("orchestrate_task remains inference-routed instead of inventing a message type", () => {
    const intent: CommandIntent = {
      type: "orchestrate_task",
      complexity: "complex",
      params: {},
      rawText: "research the regression",
      confidence: 0.8,
    };
    const result = routeCommandIntent(intent);
    expect(result.targetMessageType).toBeUndefined();
    expect(result.requiresInference).toBe(true);
    expect(result.details).toContain("inference");
  });

  test("result includes intent reference", () => {
    const intent: CommandIntent = {
      type: "list_spaces",
      complexity: "simple",
      params: {},
      rawText: "list spaces",
      confidence: 1.0,
    };
    const result = routeCommandIntent(intent);
    expect(result.intent).toBe(intent);
  });

  test("unknown result details mention inference", () => {
    const intent: CommandIntent = {
      type: "unknown",
      complexity: "simple",
      params: {},
      rawText: "random",
      confidence: 0,
    };
    const result = routeCommandIntent(intent);
    expect(result.details).toContain("inference");
  });
});

describe("suggestModelTier", () => {
  test("simple -> fast", () => {
    expect(suggestModelTier("simple")).toBe("fast");
  });

  test("moderate -> standard", () => {
    expect(suggestModelTier("moderate")).toBe("standard");
  });

  test("complex -> capable", () => {
    expect(suggestModelTier("complex")).toBe("capable");
  });
});
