import { describe, expect, test } from "bun:test";
import {
  createPlatformToolDefinitions,
  createPlatformToolExecutor,
  createPlatformToolFilter,
  isPlatformTool,
} from "../../src/agents/platform-tools.js";
import type { PlatformToolConfig, PlatformToolExecutionContext } from "../../src/agents/platform-tools.js";
import { DefaultToolExecutor } from "../../src/agents/default-tool-executor.js";
import { CapabilityRegistry } from "../../src/capabilities/registry.js";
import { EventBus } from "../../src/events/event-bus.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpaceAdminService(overrides: {
  spaces?: Array<{
    id: string;
    name: string;
    goal?: string;
    turnModel?: string;
    agents: Array<{
      agentId: string;
      profileId: string;
      role: string;
      turnOrder: number;
      isPrimary: boolean;
      assignedAt: Date;
    }>;
    capabilities?: string[];
    visibility?: string;
    createdAt?: Date;
    updatedAt?: Date;
  }>;
} = {}) {
  const spaces = overrides.spaces ?? [
    {
      id: "space-main",
      name: "Main Space",
      goal: "Test space",
      turnModel: "sequential_all",
      agents: [
        {
          agentId: "agent-coordinator",
          profileId: "profile-coord",
          role: "global_coordinator",
          turnOrder: 0,
          isPrimary: true,
          assignedAt: new Date("2025-01-01"),
        },
        {
          agentId: "agent-worker",
          profileId: "profile-worker",
          role: "participant",
          turnOrder: 1,
          isPrimary: false,
          assignedAt: new Date("2025-01-01"),
        },
      ],
      capabilities: ["shell", "filesystem"],
      visibility: "shared",
      createdAt: new Date("2025-01-01"),
      updatedAt: new Date("2025-01-02"),
    },
  ];

  return {
    getSpace: async (spaceId: string) => {
      const space = spaces.find((s) => s.id === spaceId);
      if (!space) return null;
      return {
        ...space,
        spaceUid: spaceId,
        resourceId: "resource-1",
        capabilityOverrides: {},
        createdAt: space.createdAt ?? new Date("2025-01-01"),
        updatedAt: space.updatedAt ?? new Date("2025-01-02"),
      };
    },
    listSpaces: async (options?: { statuses?: string[]; limit?: number }) => {
      let filtered = spaces;
      if (options?.statuses?.length) {
        filtered = filtered.filter((s) => options.statuses!.includes((s as Record<string, unknown>).status as string ?? "active"));
      }
      const limit = options?.limit ?? 20;
      return filtered.slice(0, limit).map((s) => ({
        ...s,
        spaceUid: s.id,
        resourceId: "resource-1",
        capabilityOverrides: {},
        createdAt: s.createdAt ?? new Date("2025-01-01"),
        updatedAt: s.updatedAt ?? new Date("2025-01-02"),
      }));
    },
    listAgentAssignments: async (spaceId: string) => {
      const space = spaces.find((s) => s.id === spaceId);
      if (!space) throw new Error(`Space not found: ${spaceId}`);
      return space.agents.map((a) => ({
        spaceId,
        ...a,
      }));
    },
    listResources: async () => [],
  } as unknown as PlatformToolConfig["spaceAdminService"];
}

function makeTurnRepo(rows: Array<{
  turn_id: string;
  space_id: string;
  actor_type: string;
  actor_id: string;
  input_json: string | null;
  output_json: string | null;
  status: string;
  token_input_count: number;
  token_output_count: number;
  created_at: string;
  completed_at: string | null;
}> = []) {
  return {
    listBySpace: (spaceId: string, limit = 100) =>
      rows.filter((r) => r.space_id === spaceId).slice(0, limit),
    countBySpace: (spaceId: string) =>
      rows.filter((r) => r.space_id === spaceId).length,
  };
}

function makeProfileRepo(profiles: Record<string, {
  profile_id: string;
  name: string;
  description: string;
  can_moderate: number;
  is_default: number;
  active_revision: number;
  archived: number;
  created_at: string;
  updated_at: string;
  revision?: {
    profile_id: string;
    revision: number;
    personality_prompt: string;
    default_skill_set_ids_json: string;
    provider_hint: string;
    model_hint: string;
    created_at: string;
  };
}> = {}) {
  return {
    getById: (profileId: string) => profiles[profileId],
    getActiveRevision: (profileId: string) => profiles[profileId]?.revision,
  };
}

function makeDefaultContext(overrides: Partial<PlatformToolExecutionContext> = {}): PlatformToolExecutionContext {
  return {
    spaceId: "space-main",
    agentId: "agent-coordinator",
    turnId: "turn-123",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: Tool definitions
// ---------------------------------------------------------------------------

describe("platform tool definitions", () => {
  test("returns 6 tool definitions", () => {
    const defs = createPlatformToolDefinitions();
    expect(defs).toHaveLength(6);
  });

  test("all tool names start with platform.", () => {
    const defs = createPlatformToolDefinitions();
    for (const def of defs) {
      expect(def.name.startsWith("platform.")).toBe(true);
    }
  });

  test("each tool has description and inputSchema", () => {
    const defs = createPlatformToolDefinitions();
    for (const def of defs) {
      expect(def.description.length).toBeGreaterThan(10);
      expect(def.inputSchema).toBeDefined();
      expect(def.inputSchema.type).toBe("object");
    }
  });

  test("getAgentProfile requires profileId", () => {
    const defs = createPlatformToolDefinitions();
    const profileTool = defs.find((d) => d.name === "platform.getAgentProfile");
    expect(profileTool).toBeDefined();
    expect((profileTool!.inputSchema as Record<string, unknown>).required).toEqual(["profileId"]);
  });
});

// ---------------------------------------------------------------------------
// Tests: isPlatformTool
// ---------------------------------------------------------------------------

describe("isPlatformTool", () => {
  test("returns true for platform.* names", () => {
    expect(isPlatformTool("platform.getSpaceStatus")).toBe(true);
    expect(isPlatformTool("platform.listSpaces")).toBe(true);
  });

  test("returns false for non-platform names", () => {
    expect(isPlatformTool("shell.run")).toBe(false);
    expect(isPlatformTool("lists.listLists")).toBe(false);
    expect(isPlatformTool("platformgetSpaceStatus")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: Tool executor
// ---------------------------------------------------------------------------

describe("platform tool executor", () => {
  test("getSpaceStatus returns space info", async () => {
    const spaceAdmin = makeSpaceAdminService();
    const turnRepo = makeTurnRepo([
      {
        turn_id: "t1",
        space_id: "space-main",
        actor_type: "agent",
        actor_id: "agent-coordinator",
        input_json: JSON.stringify("Hello"),
        output_json: JSON.stringify("Hi there"),
        status: "completed",
        token_input_count: 10,
        token_output_count: 20,
        created_at: "2025-01-01T00:00:00Z",
        completed_at: "2025-01-01T00:00:01Z",
      },
    ]);
    const executor = createPlatformToolExecutor({
      spaceAdminService: spaceAdmin,
      capabilityRegistry: new CapabilityRegistry(new EventBus()),
      turnRepo,
      profileRepo: null,
    });

    const result = await executor("platform.getSpaceStatus", {}, makeDefaultContext());
    expect(result.isError).toBeFalsy();
    const data = result.result as Record<string, unknown>;
    expect(data.spaceId).toBe("space-main");
    expect(data.name).toBe("Main Space");
    expect(data.agentCount).toBe(2);
    expect(data.turnCount).toBe(1);
    expect((data.agents as Array<Record<string, unknown>>)).toHaveLength(2);
  });

  test("getSpaceStatus defaults to context spaceId", async () => {
    const spaceAdmin = makeSpaceAdminService();
    const executor = createPlatformToolExecutor({
      spaceAdminService: spaceAdmin,
      capabilityRegistry: new CapabilityRegistry(new EventBus()),
      turnRepo: null,
      profileRepo: null,
    });

    const result = await executor("platform.getSpaceStatus", {}, makeDefaultContext());
    expect(result.isError).toBeFalsy();
    expect((result.result as Record<string, unknown>).spaceId).toBe("space-main");
  });

  test("getSpaceStatus returns error for unknown space", async () => {
    const spaceAdmin = makeSpaceAdminService();
    const executor = createPlatformToolExecutor({
      spaceAdminService: spaceAdmin,
      capabilityRegistry: new CapabilityRegistry(new EventBus()),
      turnRepo: null,
      profileRepo: null,
    });

    const result = await executor("platform.getSpaceStatus", { spaceId: "nonexistent" }, makeDefaultContext());
    expect(result.isError).toBe(true);
    expect((result.result as Record<string, unknown>).error).toContain("not found");
  });

  test("listSpaces returns all spaces", async () => {
    const spaceAdmin = makeSpaceAdminService();
    const executor = createPlatformToolExecutor({
      spaceAdminService: spaceAdmin,
      capabilityRegistry: new CapabilityRegistry(new EventBus()),
      turnRepo: null,
      profileRepo: null,
    });

    const result = await executor("platform.listSpaces", {}, makeDefaultContext());
    expect(result.isError).toBeFalsy();
    const data = result.result as Record<string, unknown>;
    expect(data.totalReturned).toBe(1);
    expect((data.spaces as Array<Record<string, unknown>>)[0].name).toBe("Main Space");
  });

  test("listAgents returns agents with profile names", async () => {
    const spaceAdmin = makeSpaceAdminService();
    const profileRepo = makeProfileRepo({
      "profile-coord": {
        profile_id: "profile-coord",
        name: "Coordinator Agent",
        description: "The main coordinator",
        can_moderate: 1,
        is_default: 0,
        active_revision: 1,
        archived: 0,
        created_at: "2025-01-01",
        updated_at: "2025-01-01",
      },
    });
    const executor = createPlatformToolExecutor({
      spaceAdminService: spaceAdmin,
      capabilityRegistry: new CapabilityRegistry(new EventBus()),
      turnRepo: null,
      profileRepo,
    });

    const result = await executor("platform.listAgents", {}, makeDefaultContext());
    expect(result.isError).toBeFalsy();
    const data = result.result as Record<string, unknown>;
    const agents = data.agents as Array<Record<string, unknown>>;
    expect(agents).toHaveLength(2);
    expect(agents[0].profileName).toBe("Coordinator Agent");
    expect(agents[1].profileName).toBeNull();
  });

  test("getAgentProfile returns profile details", async () => {
    const spaceAdmin = makeSpaceAdminService();
    const profileRepo = makeProfileRepo({
      "profile-coord": {
        profile_id: "profile-coord",
        name: "Coordinator Agent",
        description: "The main coordinator",
        can_moderate: 1,
        is_default: 0,
        active_revision: 2,
        archived: 0,
        created_at: "2025-01-01",
        updated_at: "2025-01-02",
        revision: {
          profile_id: "profile-coord",
          revision: 2,
          personality_prompt: "You are a coordinator.",
          default_skill_set_ids_json: '["skill-a","skill-b"]',
          provider_hint: "anthropic",
          model_hint: "claude-sonnet-4-20250514",
          created_at: "2025-01-02",
        },
      },
    });
    const executor = createPlatformToolExecutor({
      spaceAdminService: spaceAdmin,
      capabilityRegistry: new CapabilityRegistry(new EventBus()),
      turnRepo: null,
      profileRepo,
    });

    const result = await executor("platform.getAgentProfile", { profileId: "profile-coord" }, makeDefaultContext());
    expect(result.isError).toBeFalsy();
    const data = result.result as Record<string, unknown>;
    expect(data.name).toBe("Coordinator Agent");
    expect(data.canModerate).toBe(true);
    expect(data.modelHint).toBe("claude-sonnet-4-20250514");
    expect(data.defaultSkillIds).toEqual(["skill-a", "skill-b"]);
  });

  test("getAgentProfile returns error when profileId missing", async () => {
    const spaceAdmin = makeSpaceAdminService();
    const executor = createPlatformToolExecutor({
      spaceAdminService: spaceAdmin,
      capabilityRegistry: new CapabilityRegistry(new EventBus()),
      turnRepo: null,
      profileRepo: makeProfileRepo(),
    });

    const result = await executor("platform.getAgentProfile", {}, makeDefaultContext());
    expect(result.isError).toBe(true);
  });

  test("listRecentTurns returns truncated content", async () => {
    const longContent = "x".repeat(300);
    const turnRepo = makeTurnRepo([
      {
        turn_id: "t1",
        space_id: "space-main",
        actor_type: "agent",
        actor_id: "agent-coordinator",
        input_json: JSON.stringify(longContent),
        output_json: JSON.stringify("short output"),
        status: "completed",
        token_input_count: 100,
        token_output_count: 50,
        created_at: "2025-01-01T00:00:00Z",
        completed_at: "2025-01-01T00:00:05Z",
      },
    ]);
    const executor = createPlatformToolExecutor({
      spaceAdminService: makeSpaceAdminService(),
      capabilityRegistry: new CapabilityRegistry(new EventBus()),
      turnRepo,
      profileRepo: null,
    });

    const result = await executor("platform.listRecentTurns", {}, makeDefaultContext());
    expect(result.isError).toBeFalsy();
    const data = result.result as Record<string, unknown>;
    const turns = data.turns as Array<Record<string, unknown>>;
    expect(turns).toHaveLength(1);
    // Input was 300 chars, should be truncated to 200 + "..."
    expect((turns[0].inputPreview as string).length).toBeLessThanOrEqual(203);
    expect((turns[0].inputPreview as string).endsWith("...")).toBe(true);
    // Short output should not be truncated
    expect(turns[0].outputPreview).toBe("short output");
  });

  test("listRecentTurns respects limit", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      turn_id: `t${i}`,
      space_id: "space-main",
      actor_type: "agent",
      actor_id: "agent-coordinator",
      input_json: null,
      output_json: null,
      status: "completed",
      token_input_count: 0,
      token_output_count: 0,
      created_at: `2025-01-01T00:00:${String(i).padStart(2, "0")}Z`,
      completed_at: null,
    }));
    const executor = createPlatformToolExecutor({
      spaceAdminService: makeSpaceAdminService(),
      capabilityRegistry: new CapabilityRegistry(new EventBus()),
      turnRepo: makeTurnRepo(rows),
      profileRepo: null,
    });

    const result = await executor("platform.listRecentTurns", { limit: 5 }, makeDefaultContext());
    const data = result.result as Record<string, unknown>;
    expect(data.totalReturned).toBe(5);
  });

  test("getSystemStatus returns uptime and capabilities", async () => {
    const eventBus = new EventBus();
    const registry = new CapabilityRegistry(eventBus);
    registry.register(
      { id: "shell-local", name: "Shell", source: "builtin", capabilityType: "shell", operations: ["run"], available: true },
      { invoke: async () => ({}) },
    );

    const executor = createPlatformToolExecutor({
      spaceAdminService: makeSpaceAdminService(),
      capabilityRegistry: registry,
      turnRepo: null,
      profileRepo: null,
      startedAt: new Date(Date.now() - 60_000), // 1 minute ago
    });

    const result = await executor("platform.getSystemStatus", {}, makeDefaultContext());
    expect(result.isError).toBeFalsy();
    const data = result.result as Record<string, unknown>;
    expect(data.registeredCapabilities).toEqual(["shell"]);
    expect(typeof data.uptimeMs).toBe("number");
    expect(typeof data.uptimeHuman).toBe("string");
    expect(data.activeSpaceCount).toBe(1);
  });

  test("unknown tool name returns error", async () => {
    const executor = createPlatformToolExecutor({
      spaceAdminService: makeSpaceAdminService(),
      capabilityRegistry: new CapabilityRegistry(new EventBus()),
      turnRepo: null,
      profileRepo: null,
    });

    const result = await executor("platform.unknown", {}, makeDefaultContext());
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: Role-gating filter
// ---------------------------------------------------------------------------

describe("platform tool filter (role gating)", () => {
  test("allows global_coordinator", async () => {
    const spaceAdmin = makeSpaceAdminService();
    const filter = createPlatformToolFilter(spaceAdmin);
    expect(await filter("space-main", "agent-coordinator")).toBe(true);
  });

  test("denies participant", async () => {
    const spaceAdmin = makeSpaceAdminService();
    const filter = createPlatformToolFilter(spaceAdmin);
    expect(await filter("space-main", "agent-worker")).toBe(false);
  });

  test("denies unknown agent", async () => {
    const spaceAdmin = makeSpaceAdminService();
    const filter = createPlatformToolFilter(spaceAdmin);
    expect(await filter("space-main", "agent-unknown")).toBe(false);
  });

  test("allows space_moderator", async () => {
    const spaceAdmin = makeSpaceAdminService({
      spaces: [
        {
          id: "space-mod",
          name: "Mod Space",
          turnModel: "sequential_all",
          agents: [
            {
              agentId: "agent-mod",
              profileId: "profile-mod",
              role: "space_moderator",
              turnOrder: 0,
              isPrimary: false,
              assignedAt: new Date(),
            },
          ],
        },
      ],
    });
    const filter = createPlatformToolFilter(spaceAdmin);
    expect(await filter("space-mod", "agent-mod")).toBe(true);
  });

  test("returns false on error (e.g. space not found)", async () => {
    const spaceAdmin = makeSpaceAdminService();
    const filter = createPlatformToolFilter(spaceAdmin);
    // Space doesn't exist — listAgentAssignments will throw
    expect(await filter("nonexistent", "agent-1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: Integration with DefaultToolExecutor
// ---------------------------------------------------------------------------

describe("DefaultToolExecutor with injected platform tools", () => {
  function makeExecutor(agentRole: "global_coordinator" | "participant" = "global_coordinator") {
    const eventBus = new EventBus();
    const registry = new CapabilityRegistry(eventBus);
    const spaceAdmin = makeSpaceAdminService();

    const platformToolDefs = createPlatformToolDefinitions();
    const platformToolExec = createPlatformToolExecutor({
      spaceAdminService: spaceAdmin,
      capabilityRegistry: registry,
      turnRepo: null,
      profileRepo: null,
    });
    const platformFilter = createPlatformToolFilter(spaceAdmin);

    const executor = new DefaultToolExecutor({
      capabilityRegistry: registry,
      eventBus,
      injectedToolDefinitions: platformToolDefs,
      injectedToolExecutor: platformToolExec,
      injectedToolFilter: platformFilter,
      resolveSecurityScope: async () => ({
        agentId: agentRole === "global_coordinator" ? "agent-coordinator" : "agent-worker",
        permissionMode: "sandbox" as const,
        allowedCapabilities: [],
        filesystemScope: "",
        allowNetwork: true,
        allowShell: false,
        commandAllowlist: [],
        maxTokensPerTurn: 4096,
        maxToolCallsPerTurn: 50,
        requireOutputReview: false,
      }),
    });

    return { executor, eventBus };
  }

  test("getAvailableTools includes platform tools for coordinator", async () => {
    const { executor } = makeExecutor("global_coordinator");
    const tools = await executor.getAvailableTools("space-main", "agent-coordinator");
    const platformTools = tools.filter((t) => t.name.startsWith("platform."));
    expect(platformTools.length).toBe(6);
  });

  test("getAvailableTools excludes platform tools for participant", async () => {
    const { executor } = makeExecutor("participant");
    const tools = await executor.getAvailableTools("space-main", "agent-worker");
    const platformTools = tools.filter((t) => t.name.startsWith("platform."));
    expect(platformTools.length).toBe(0);
  });

  test("checkPermission allows platform tool for coordinator", async () => {
    const { executor } = makeExecutor("global_coordinator");
    const permission = await executor.checkPermission(
      { id: "call-1", name: "platform.getSpaceStatus", arguments: {} },
      { spaceId: "space-main", agentId: "agent-coordinator", turnId: "t1", lineageId: "l1" },
    );
    expect(permission.allowed).toBe(true);
  });

  test("checkPermission denies platform tool for participant", async () => {
    const { executor } = makeExecutor("participant");
    const permission = await executor.checkPermission(
      { id: "call-1", name: "platform.getSpaceStatus", arguments: {} },
      { spaceId: "space-main", agentId: "agent-worker", turnId: "t1", lineageId: "l1" },
    );
    expect(permission.allowed).toBe(false);
    expect(permission.reasonCode).toBe("injected_tool_not_authorized");
  });

  test("execute routes platform tool to injected executor", async () => {
    const { executor } = makeExecutor("global_coordinator");
    const result = await executor.execute(
      { id: "call-1", name: "platform.getSpaceStatus", arguments: {} },
      { spaceId: "space-main", agentId: "agent-coordinator", turnId: "t1", lineageId: "l1" },
    );
    expect(result.isError).toBeFalsy();
    expect((result.result as Record<string, unknown>).spaceId).toBe("space-main");
  });

  test("execute emits tool.executed event for platform tools", async () => {
    const { executor, eventBus } = makeExecutor("global_coordinator");
    const events: Array<Record<string, unknown>> = [];
    eventBus.on("tool.executed", (e) => events.push(e));

    await executor.execute(
      { id: "call-1", name: "platform.getSystemStatus", arguments: {} },
      { spaceId: "space-main", agentId: "agent-coordinator", turnId: "t1", lineageId: "l1" },
    );

    expect(events.length).toBe(1);
    expect(events[0].toolName).toBe("platform.getSystemStatus");
    expect(events[0].isError).toBe(false);
  });
});
