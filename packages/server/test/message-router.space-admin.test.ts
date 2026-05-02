import { describe, expect, test } from "bun:test";
import { MessageRouter } from "../src/message-router.js";
import { MessageTypes, type GatewayMessage } from "../src/protocol.js";

interface SpaceLike {
  id: string;
  resourceId: string;
  name: string;
  goal?: string;
  orchestratorProfileId?: string;
  turnModel: string;
  agents: Array<Record<string, unknown>>;
  capabilities: string[];
  capabilityOverrides: Record<string, string>;
  visibility: "shared" | "private";
  createdAt: string;
  updatedAt: string;
}

const defaultSpace: SpaceLike = {
  id: "space-main",
  resourceId: "resource-main",
  name: "Main Space",
  goal: "Coordinate default flows",
  turnModel: "sequential_all",
  agents: [],
  capabilities: [],
  capabilityOverrides: {},
  visibility: "shared",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const defaultAssignment = {
  spaceId: "space-main",
  agentId: "agent-main",
  profileId: "profile-main",
  role: "participant",
  turnOrder: 0,
  isPrimary: true,
  assignedAt: new Date().toISOString(),
};

function makeClient(overrides: Record<string, unknown> = {}): any {
  return {
    id: "client-1",
    authenticated: true,
    clientType: "sdk",
    subscribedSpaces: new Set<string>(),
    connectedAt: new Date(),
    ...overrides,
  };
}

function makeMessage<T>(type: string, payload: T): GatewayMessage<T> {
  return {
    type,
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    payload,
  };
}

function makeRouter(
  spaceAdminService?: Record<string, unknown>,
  options: {
    broadcastToSpace?: (spaceId: string, msg: GatewayMessage) => void;
    spaceManager?: Record<string, unknown>;
    turnHistoryService?: Record<string, unknown>;
    spaceMemoryPolicyService?: Record<string, unknown>;
    spaceMcpService?: Record<string, unknown>;
    spaceWorkspaceService?: Record<string, unknown>;
    spaceQuotaService?: Record<string, unknown>;
  } = {},
): MessageRouter {
  const logger: any = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };

  return new MessageRouter({
    spaceManager: options.spaceManager ?? {
      executeTurn: async () => ({ turnId: "turn-1" }),
      resumeFeedback: async () => {},
      invalidateCache: () => {},
    } as any,
    spaceAdminService: spaceAdminService as any,
    capabilities: {
      invoke: async () => ({ ok: true }),
      register: () => {},
      deregister: () => {},
    } as any,
    logger,
    broadcastToSpace: options.broadcastToSpace,
    turnHistoryService: options.turnHistoryService as any,
    spaceMemoryPolicyService: options.spaceMemoryPolicyService as any,
    spaceMcpService: options.spaceMcpService as any,
    spaceWorkspaceService: options.spaceWorkspaceService as any,
    spaceQuotaService: options.spaceQuotaService as any,
  });
}

describe("MessageRouter space admin handlers", () => {
  test("returns NOT_AVAILABLE when space admin service is not configured", async () => {
    const router = makeRouter(undefined);
    const msg = makeMessage(MessageTypes.SPACE_LIST, {});
    const response = await router.handle(makeClient(), msg);

    expect(response).not.toBeNull();
    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("FAILED_PRECONDITION");
    expect((response?.payload as any).retryable).toBe(false);
    expect((response?.payload as any).correlationId).toBe(msg.id);
  });

  test("validates required fields for space.create", async () => {
    const router = makeRouter({
      createSpace: async () => defaultSpace,
    });
    const msg = makeMessage(MessageTypes.SPACE_CREATE, { name: "Missing Resource" });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
    expect((response?.payload as any).correlationId).toBe(msg.id);
  });

  test("routes space.create and returns created space", async () => {
    let receivedInput: any = null;
    const createdSpace: SpaceLike = { ...defaultSpace, id: "space-created", name: "Created Space" };

    const router = makeRouter({
      createSpace: async (input: any) => {
        receivedInput = input;
        return createdSpace;
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_CREATE, {
      resourceId: "resource-a",
      name: "Created Space",
      spaceType: "space",
      visibility: "shared",
      thinkingCapturePolicy: "FULL",
      initialAgents: [
        {
          agentId: "agent-a",
          profileId: "profile-a",
          role: "participant",
          turnOrder: 0,
          isPrimary: true,
        },
      ],
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_CREATE);
    expect(response?.replyTo).toBe(msg.id);
    expect((response?.payload as any).space.id).toBe("space-created");
    expect(receivedInput).not.toBeNull();
    expect(receivedInput.resourceId).toBe("resource-a");
    expect(receivedInput.thinkingCapturePolicy).toBe("FULL");
    expect(receivedInput.initialAgents.length).toBe(1);
    expect(receivedInput.initialAgents[0].agentId).toBe("agent-a");
  });

  test("filters invalid statuses for space.list before invoking service", async () => {
    let receivedOptions: any = null;
    const router = makeRouter({
      listSpaces: async (options: any) => {
        receivedOptions = options;
        return [];
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_LIST, {
      statuses: ["created", "active", "nope", "failed"],
      limit: 5,
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_LIST);
    expect((response?.payload as any).spaces).toEqual([]);
    expect(receivedOptions.statuses).toEqual(["created", "active", "failed"]);
    expect(receivedOptions.limit).toBe(5);
  });

  test("routes space.add_agent and includes updated space", async () => {
    const router = makeRouter({
      addAgent: async () => defaultAssignment,
      getSpace: async () => ({ ...defaultSpace, agents: [defaultAssignment] }),
    });

    const msg = makeMessage(MessageTypes.SPACE_ADD_AGENT, {
      spaceId: "space-main",
      agentId: "agent-main",
      profileId: "profile-main",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_ADD_AGENT);
    expect((response?.payload as any).assignment.agentId).toBe("agent-main");
    expect((response?.payload as any).space.id).toBe("space-main");
  });

  test("validates required fields for space.add_agent", async () => {
    const router = makeRouter({
      addAgent: async () => defaultAssignment,
      getSpace: async () => defaultSpace,
    });

    const msg = makeMessage(MessageTypes.SPACE_ADD_AGENT, {
      spaceId: "space-main",
      agentId: "agent-main",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
  });

  test("routes space.remove_agent and returns removal response", async () => {
    const router = makeRouter({
      removeAgent: async () => true,
      getSpace: async () => ({ ...defaultSpace, agents: [] }),
    });

    const msg = makeMessage(MessageTypes.SPACE_REMOVE_AGENT, {
      spaceId: "space-main",
      agentId: "agent-main",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_REMOVE_AGENT);
    expect((response?.payload as any).removed).toBe(true);
    expect((response?.payload as any).spaceId).toBe("space-main");
  });

  test("routes space.update_agent_assignment", async () => {
    const updatedAssignment = { ...defaultAssignment, role: "global_coordinator" };
    const router = makeRouter({
      listAgentAssignments: async () => [defaultAssignment],
      updateAgentAssignment: async () => updatedAssignment,
      getSpace: async () => ({ ...defaultSpace, agents: [updatedAssignment] }),
    });

    const msg = makeMessage(MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT, {
      spaceId: "space-main",
      agentId: "agent-main",
      role: "global_coordinator",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT);
    expect((response?.payload as any).assignment.role).toBe("global_coordinator");
  });

  test("broadcasts space.agent_updated when assignment profile changes", async () => {
    const updatedAssignment = { ...defaultAssignment, profileId: "profile-next" };
    const broadcasts: GatewayMessage[] = [];
    const router = makeRouter({
      listAgentAssignments: async () => [defaultAssignment],
      updateAgentAssignment: async () => updatedAssignment,
      getSpace: async () => ({ ...defaultSpace, agents: [updatedAssignment] }),
    }, {
      broadcastToSpace: (_spaceId, message) => {
        broadcasts.push(message);
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT, {
      spaceId: "space-main",
      agentId: "agent-main",
      profileId: "profile-next",
    });

    const response = await router.handle(makeClient(), msg);
    expect(response?.type).toBe(MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT);
    expect(broadcasts.length).toBe(1);
    expect(broadcasts[0].type).toBe(MessageTypes.SPACE_AGENT_UPDATED);
    expect((broadcasts[0].payload as any).oldProfileId).toBe("profile-main");
    expect((broadcasts[0].payload as any).newProfileId).toBe("profile-next");
  });

  test("resets agent usage session when profile changes", async () => {
    const updatedAssignment = { ...defaultAssignment, profileId: "profile-next" };
    let resetCalled = false;
    let resetArgs: Record<string, string> | null = null;

    const router = makeRouter({
      listAgentAssignments: async () => [defaultAssignment],
      updateAgentAssignment: async () => updatedAssignment,
      getSpace: async () => ({ ...defaultSpace, agents: [updatedAssignment] }),
    }, {
      broadcastToSpace: () => {},
      spaceQuotaService: {
        resetAgentUsageSession: (spaceId: string, agentId: string, principalId: string) => {
          resetCalled = true;
          resetArgs = { spaceId, agentId, principalId };
          return { sessionId: "new-session" };
        },
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT, {
      spaceId: "space-main",
      agentId: "agent-main",
      profileId: "profile-next",
    });

    const response = await router.handle(
      makeClient({ publicKey: "pk-user-1" }),
      msg,
    );

    expect(response?.type).toBe(MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT);
    expect(resetCalled).toBe(true);
    expect(resetArgs).toEqual({
      spaceId: "space-main",
      agentId: "agent-main",
      principalId: "pk-user-1",
    });
  });

  test("does not reset usage session when profile stays the same", async () => {
    const updatedAssignment = { ...defaultAssignment, role: "global_coordinator" };
    let resetCalled = false;

    const router = makeRouter({
      listAgentAssignments: async () => [defaultAssignment],
      updateAgentAssignment: async () => updatedAssignment,
      getSpace: async () => ({ ...defaultSpace, agents: [updatedAssignment] }),
    }, {
      spaceQuotaService: {
        resetAgentUsageSession: () => {
          resetCalled = true;
          return { sessionId: "new-session" };
        },
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT, {
      spaceId: "space-main",
      agentId: "agent-main",
      role: "global_coordinator",
    });

    await router.handle(makeClient({ publicKey: "pk-user-1" }), msg);
    expect(resetCalled).toBe(false);
  });

  test("resets usage session and broadcasts when resetSession=true without profile change", async () => {
    const updatedAssignment = { ...defaultAssignment, role: "global_coordinator" };
    let resetCalled = false;
    const broadcasts: GatewayMessage[] = [];

    const router = makeRouter({
      listAgentAssignments: async () => [defaultAssignment],
      updateAgentAssignment: async () => updatedAssignment,
      getSpace: async () => ({ ...defaultSpace, agents: [updatedAssignment] }),
    }, {
      broadcastToSpace: (_spaceId, message) => {
        broadcasts.push(message);
      },
      spaceQuotaService: {
        resetAgentUsageSession: () => {
          resetCalled = true;
          return { sessionId: "new-session" };
        },
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT, {
      spaceId: "space-main",
      agentId: "agent-main",
      role: "global_coordinator",
      resetSession: true,
    });

    const response = await router.handle(makeClient({ publicKey: "pk-user-1" }), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT);
    expect(resetCalled).toBe(true);
    expect(broadcasts.length).toBe(1);
    expect(broadcasts[0].type).toBe(MessageTypes.SPACE_AGENT_UPDATED);
    expect((broadcasts[0].payload as any).oldProfileId).toBe("profile-main");
    expect((broadcasts[0].payload as any).newProfileId).toBe("profile-main");
  });

  test("uses deterministic fallback principal for session reset when publicKey is missing", async () => {
    const updatedAssignment = { ...defaultAssignment, profileId: "profile-next" };
    let resetArgs: { spaceId: string; agentId: string; principalId: string } | null = null;

    const router = makeRouter({
      listAgentAssignments: async () => [defaultAssignment],
      updateAgentAssignment: async () => updatedAssignment,
      getSpace: async () => ({ ...defaultSpace, agents: [updatedAssignment] }),
    }, {
      spaceQuotaService: {
        resetAgentUsageSession: (spaceId: string, agentId: string, principalId: string) => {
          resetArgs = { spaceId, agentId, principalId };
          return { sessionId: "new-session" };
        },
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT, {
      spaceId: "space-main",
      agentId: "agent-main",
      profileId: "profile-next",
    });

    const response = await router.handle(makeClient({ publicKey: undefined, deviceId: "device-abc" }), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT);
    expect(resetArgs).toEqual({
      spaceId: "space-main",
      agentId: "agent-main",
      principalId: "device:device-abc",
    });
  });

  test("routes space.set_orchestrator", async () => {
    const router = makeRouter({
      setSpaceOrchestrator: async () => ({
        ...defaultSpace,
        orchestratorProfileId: "profile-orchestrator",
      }),
    });

    const msg = makeMessage(MessageTypes.SPACE_SET_ORCHESTRATOR, {
      spaceId: "space-main",
      profileId: "profile-orchestrator",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_SET_ORCHESTRATOR);
    expect((response?.payload as any).space.orchestratorProfileId).toBe("profile-orchestrator");
  });

  test("routes space.set_thinking_capture_policy", async () => {
    let received: { spaceId: string; policy: string } | null = null;
    const router = makeRouter({
      getSpace: async () => defaultSpace,
    }, {
      spaceMemoryPolicyService: {
        setThinkingCapturePolicy: async (spaceId: string, policy: string) => {
          received = { spaceId, policy };
          return policy;
        },
        getThinkingCapturePolicy: () => "FULL",
        getSpaceMemoryPolicy: () => ({
          experienceCapture: "INHERIT",
          privacyMode: "STANDARD",
        }),
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_SET_THINKING_CAPTURE_POLICY, {
      spaceId: "space-main",
      thinkingCapturePolicy: "FULL",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_SET_THINKING_CAPTURE_POLICY);
    expect(received).toEqual({
      spaceId: "space-main",
      policy: "FULL",
    });
    expect((response?.payload as any).space.thinkingCapturePolicy).toBe("FULL");
  });

  test("routes space.get_memory_policy", async () => {
    const router = makeRouter({
      getSpace: async () => defaultSpace,
    }, {
      spaceMemoryPolicyService: {
        getThinkingCapturePolicy: () => "SUMMARY",
        getSpaceMemoryPolicy: () => ({
          experienceCapture: "DISABLED",
          privacyMode: "INCOGNITO_SESSION",
        }),
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_GET_MEMORY_POLICY, {
      spaceId: "space-main",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_GET_MEMORY_POLICY);
    expect((response?.payload as any).memoryPolicy).toEqual({
      experienceCapture: "DISABLED",
      privacyMode: "INCOGNITO_SESSION",
    });
  });

  test("routes space.set_memory_policy", async () => {
    let received: any = null;
    const router = makeRouter({
      getSpace: async () => defaultSpace,
    }, {
      spaceMemoryPolicyService: {
        setSpaceMemoryPolicy: async (spaceId: string, memoryPolicy: Record<string, string>) => {
          received = { spaceId, memoryPolicy };
          return undefined;
        },
        getThinkingCapturePolicy: () => "SUMMARY",
        getSpaceMemoryPolicy: () => ({
          experienceCapture: "DISABLED",
          privacyMode: "STANDARD",
        }),
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_SET_MEMORY_POLICY, {
      spaceId: "space-main",
      memoryPolicy: {
        experienceCapture: "DISABLED",
        privacyMode: "STANDARD",
      },
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_SET_MEMORY_POLICY);
    expect(received).toEqual({
      spaceId: "space-main",
      memoryPolicy: {
        experienceCapture: "DISABLED",
        privacyMode: "STANDARD",
      },
    });
    expect((response?.payload as any).space.memoryPolicy).toEqual({
      experienceCapture: "DISABLED",
      privacyMode: "STANDARD",
    });
  });

  test("routes space.end_incognito_session", async () => {
    const router = makeRouter({
      getSpace: async () => defaultSpace,
    }, {
      spaceMemoryPolicyService: {
        endIncognitoSession: async () => ({
          ended: true,
          purged: true,
          reason: "manual",
          purgedAt: "2026-03-20T09:00:00.000Z",
          sessionId: "session-1",
        }),
        getThinkingCapturePolicy: () => "FULL",
        getSpaceMemoryPolicy: () => ({
          experienceCapture: "INHERIT",
          privacyMode: "STANDARD",
        }),
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_END_INCOGNITO_SESSION, {
      spaceId: "space-main",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_END_INCOGNITO_SESSION);
    expect((response?.payload as any).ended).toBe(true);
    expect((response?.payload as any).reason).toBe("manual");
    expect((response?.payload as any).sessionId).toBe("session-1");
  });

  test("validates required fields for space.set_orchestrator", async () => {
    const router = makeRouter({
      setSpaceOrchestrator: async () => defaultSpace,
    });

    const msg = makeMessage(MessageTypes.SPACE_SET_ORCHESTRATOR, {
      spaceId: "space-main",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
  });

  test("routes space.list_agent_assignments", async () => {
    const router = makeRouter({
      listAgentAssignments: async () => [defaultAssignment],
    });

    const msg = makeMessage(MessageTypes.SPACE_LIST_AGENT_ASSIGNMENTS, {
      spaceId: "space-main",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_LIST_AGENT_ASSIGNMENTS);
    expect((response?.payload as any).assignments.length).toBe(1);
    expect((response?.payload as any).assignments[0].agentId).toBe("agent-main");
  });

  test("routes space.add_skill and returns updated skills", async () => {
    const router = makeRouter({
      addSkillToSpace: async () => ["skill.code.review", "skill.sync.query"],
      getSpace: async () => ({ ...defaultSpace, skillIds: ["skill.code.review", "skill.sync.query"] }),
    });

    const msg = makeMessage(MessageTypes.SPACE_ADD_SKILL, {
      spaceId: "space-main",
      skillId: "skill.sync.query",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_ADD_SKILL);
    expect((response?.payload as any).spaceId).toBe("space-main");
    expect((response?.payload as any).skillId).toBe("skill.sync.query");
    expect((response?.payload as any).skills).toEqual(["skill.code.review", "skill.sync.query"]);
  });

  test("validates required fields for space.add_skill", async () => {
    const router = makeRouter({
      addSkillToSpace: async () => [],
    });

    const msg = makeMessage(MessageTypes.SPACE_ADD_SKILL, {
      spaceId: "space-main",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
  });

  test("routes space.remove_skill and returns removal response", async () => {
    const router = makeRouter({
      removeSkillFromSpace: async () => ({ removed: true, skills: ["skill.code.review"] }),
      getSpace: async () => ({ ...defaultSpace, skillIds: ["skill.code.review"] }),
    });

    const msg = makeMessage(MessageTypes.SPACE_REMOVE_SKILL, {
      spaceId: "space-main",
      skillId: "skill.sync.query",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_REMOVE_SKILL);
    expect((response?.payload as any).removed).toBe(true);
    expect((response?.payload as any).skills).toEqual(["skill.code.review"]);
  });

  test("routes space.list_skills", async () => {
    const router = makeRouter({
      listSpaceSkills: async () => ["skill.code.review"],
    });

    const msg = makeMessage(MessageTypes.SPACE_LIST_SKILLS, {
      spaceId: "space-main",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_LIST_SKILLS);
    expect((response?.payload as any).spaceId).toBe("space-main");
    expect((response?.payload as any).skills).toEqual(["skill.code.review"]);
  });

  test("routes space resource CRUD handlers", async () => {
    const resource = {
      resourceId: "resource-1",
      spaceId: "space-main",
      uri: "file:///tmp/project",
      type: "folder",
      label: "Project",
      addedAt: new Date(),
    };

    const router = makeRouter({
      addResource: async () => resource,
      removeResource: async () => true,
      listResources: async () => [resource],
    });

    const addResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_ADD_RESOURCE, {
        spaceId: "space-main",
        uri: "file:///tmp/project",
        type: "folder",
        label: "Project",
      }),
    );
    expect(addResponse?.type).toBe(MessageTypes.SPACE_ADD_RESOURCE);
    expect((addResponse?.payload as any).resource.resourceId).toBe("resource-1");

    const listResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_LIST_RESOURCES, {
        spaceId: "space-main",
      }),
    );
    expect(listResponse?.type).toBe(MessageTypes.SPACE_LIST_RESOURCES);
    expect((listResponse?.payload as any).resources.length).toBe(1);

    const removeResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_REMOVE_RESOURCE, {
        spaceId: "space-main",
        resourceId: "resource-1",
      }),
    );
    expect(removeResponse?.type).toBe(MessageTypes.SPACE_REMOVE_RESOURCE);
    expect((removeResponse?.payload as any).removed).toBe(true);
  });

  test("routes workspace get/set handlers", async () => {
    const workspace = {
      spaceId: "space-main",
      spaceUid: "11111111-1111-1111-8111-111111111111",
      mode: "managed",
      effectiveWorkspaceRoot: "/tmp/spaces/space-main",
      metaPath: "/tmp/spaces/space-main/.space",
      logsPath: "/tmp/spaces/space-main/.space/logs",
      workPath: "/tmp/spaces/space-main/.space/work",
      sharedContextPath: "/tmp/spaces/space-main/.space/shared-context",
      scratchpadsPath: "/tmp/spaces/space-main/.space/scratchpads",
      layoutVersion: 2,
      gitRepoDetected: false,
      metadataStatus: "ready",
      updatedAt: new Date().toISOString(),
    };

    const router = makeRouter(
      {
        getSpace: async () => ({
          ...defaultSpace,
          spaceUid: workspace.spaceUid,
        }),
      },
      {
        spaceWorkspaceService: {
          getWorkspace: async () => workspace,
          setWorkspace: async () => ({
            ...workspace,
            mode: "folder_bound",
            explicitWorkspaceRoot: "/tmp/explicit",
            effectiveWorkspaceRoot: "/tmp/explicit",
            metaPath: "/tmp/explicit/.space",
            logsPath: "/tmp/explicit/.space/logs",
            workPath: "/tmp/explicit/.space/work",
            sharedContextPath: "/tmp/explicit/.space/shared-context",
            scratchpadsPath: "/tmp/explicit/.space/scratchpads",
            gitRepoDetected: false,
          }),
          ensureWorkspace: async () => workspace,
        },
      },
    );

    const getResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_GET_WORKSPACE, { spaceId: "space-main" }),
    );
    expect(getResponse?.type).toBe(MessageTypes.SPACE_GET_WORKSPACE);
    expect((getResponse?.payload as any).workspace.spaceId).toBe("space-main");

    const setResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_SET_WORKSPACE, {
        spaceId: "space-main",
        workspaceRoot: "/tmp/explicit",
      }),
    );
    expect(setResponse?.type).toBe(MessageTypes.SPACE_SET_WORKSPACE);
    expect((setResponse?.payload as any).workspace.mode).toBe("folder_bound");
    expect((setResponse?.payload as any).workspace.explicitWorkspaceRoot).toBe("/tmp/explicit");
  });

  test("invalidates cached agent runtimes after workspace root changes", async () => {
    const workspace = {
      spaceId: "space-main",
      spaceUid: "11111111-1111-1111-8111-111111111111",
      mode: "managed",
      effectiveWorkspaceRoot: "/tmp/spaces/space-main",
      metaPath: "/tmp/spaces/space-main/.space",
      logsPath: "/tmp/spaces/space-main/.space/logs",
      workPath: "/tmp/spaces/space-main/.space/work",
      sharedContextPath: "/tmp/spaces/space-main/.space/shared-context",
      scratchpadsPath: "/tmp/spaces/space-main/.space/scratchpads",
      layoutVersion: 2,
      gitRepoDetected: false,
      metadataStatus: "ready",
      updatedAt: new Date().toISOString(),
    };
    const invalidatedSpaceIds: string[] = [];

    const router = makeRouter(
      {
        getSpace: async () => ({
          ...defaultSpace,
          spaceUid: workspace.spaceUid,
        }),
      },
      {
        spaceManager: {
          executeTurn: async () => ({ turnId: "turn-1" }),
          resumeFeedback: async () => {},
          invalidateCache: (spaceId: string) => {
            invalidatedSpaceIds.push(spaceId);
          },
        },
        spaceWorkspaceService: {
          getWorkspace: async () => workspace,
          setWorkspace: async () => ({
            ...workspace,
            mode: "folder_bound",
            explicitWorkspaceRoot: "/tmp/explicit",
            effectiveWorkspaceRoot: "/tmp/explicit",
            metaPath: "/tmp/explicit/.space",
            logsPath: "/tmp/explicit/.space/logs",
            workPath: "/tmp/explicit/.space/work",
            sharedContextPath: "/tmp/explicit/.space/shared-context",
            scratchpadsPath: "/tmp/explicit/.space/scratchpads",
            gitRepoDetected: false,
          }),
          ensureWorkspace: async () => workspace,
        },
      },
    );

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_SET_WORKSPACE, {
        spaceId: "space-main",
        workspaceRoot: "/tmp/explicit",
      }),
    );

    expect(response?.type).toBe(MessageTypes.SPACE_SET_WORKSPACE);
    expect(invalidatedSpaceIds).toEqual(["space-main"]);
  });

  test("routes space.list_turns with deterministic pagination metadata", async () => {
    const createdAt = new Date().toISOString();
    const completedAt = new Date().toISOString();
    const router = makeRouter(
      {
        getSpace: async (spaceId: string) => ({
          ...defaultSpace,
          id: spaceId,
          spaceUid: "11111111-1111-1111-8111-111111111111",
        }),
      },
      {
        turnHistoryService: {
          listSpaceTurns: async (input: { spaceId: string; limit: number; offset: number }) => {
            expect(input.spaceId).toBe("space-main");
            expect(input.limit).toBe(2);
            expect(input.offset).toBe(0);
            return {
              turns: [
                {
                  turnId: "turn-1",
                  agentId: "agent-main",
                  status: "completed",
                  inputText: "hello",
                  outputText: "world",
                  promptTokens: 11,
                  completionTokens: 7,
                  totalTokens: 18,
                  createdAt,
                  completedAt,
                },
                {
                  turnId: "turn-2",
                  agentId: "agent-main",
                  status: "completed",
                  inputText: "hi",
                  outputText: "there",
                  promptTokens: 13,
                  completionTokens: 5,
                  totalTokens: 18,
                  createdAt,
                  completedAt,
                },
              ],
              total: 5,
            };
          },
        },
      },
    );

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_LIST_TURNS, {
        spaceId: "space-main",
        limit: 2,
        offset: 0,
      }),
    );

    expect(response?.type).toBe(MessageTypes.SPACE_LIST_TURNS);
    expect((response?.payload as any).spaceId).toBe("space-main");
    expect((response?.payload as any).spaceUid).toBe("11111111-1111-1111-8111-111111111111");
    expect((response?.payload as any).turns.length).toBe(2);
    expect((response?.payload as any).turns[0].promptTokens).toBe(11);
    expect((response?.payload as any).turns[0].completionTokens).toBe(7);
    expect((response?.payload as any).turns[0].totalTokens).toBe(18);
    expect((response?.payload as any).total).toBe(5);
    expect((response?.payload as any).nextOffset).toBe(2);
  });

  test("routes space.list_turns cursor delta reads via lastSeenTurnId", async () => {
    const createdAt = new Date().toISOString();
    const router = makeRouter(
      {
        getSpace: async (spaceId: string) => ({
          ...defaultSpace,
          id: spaceId,
          spaceUid: "11111111-1111-1111-8111-111111111111",
        }),
      },
      {
        turnHistoryService: {
          listSpaceTurns: async (input: {
            spaceId: string;
            limit: number;
            offset: number;
            lastSeenTurnId?: string;
          }) => {
            expect(input.spaceId).toBe("space-main");
            expect(input.limit).toBe(20);
            expect(input.offset).toBe(0);
            expect(input.lastSeenTurnId).toBe("turn-seen-1");
            return {
              turns: [
                {
                  turnId: "turn-2",
                  agentId: "agent-main",
                  status: "completed",
                  inputText: "delta input",
                  outputText: "delta output",
                  promptTokens: 4,
                  completionTokens: 6,
                  totalTokens: 10,
                  createdAt,
                  completedAt: createdAt,
                },
              ],
              total: 1,
            };
          },
        },
      },
    );

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_LIST_TURNS, {
        spaceId: "space-main",
        limit: 20,
        offset: 999,
        lastSeenTurnId: "turn-seen-1",
      }),
    );

    expect(response?.type).toBe(MessageTypes.SPACE_LIST_TURNS);
    expect((response?.payload as any).turns.length).toBe(1);
    expect((response?.payload as any).total).toBe(1);
    expect((response?.payload as any).nextOffset).toBeUndefined();
  });

  test("validates required space identifier for space.list_turns", async () => {
    const router = makeRouter(
      {
        getSpace: async () => ({ ...defaultSpace, spaceUid: "space-uid-main" }),
      },
      {
        turnHistoryService: {
          listSpaceTurns: async () => ({ turns: [], total: 0 }),
        },
      },
    );

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_LIST_TURNS, {
        limit: 100,
        offset: 0,
      }),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
  });

  test("returns NOT_AVAILABLE when turn history service is not configured", async () => {
    const router = makeRouter({
      getSpace: async () => ({ ...defaultSpace, spaceUid: "space-uid-main" }),
    });

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_LIST_TURNS, {
        spaceId: "space-main",
        limit: 100,
        offset: 0,
      }),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("FAILED_PRECONDITION");
  });

  test("maps space admin typed errors into protocol error responses", async () => {
    const router = makeRouter({
      createSpace: async () => {
        throw {
          code: "ALREADY_EXISTS",
          message: "Space already exists",
        };
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_CREATE, {
      resourceId: "resource-a",
      name: "Existing Space",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("ALREADY_EXISTS");
    expect((response?.payload as any).message).toContain("already");
  });

  test("routes MCP endpoint lifecycle operations", async () => {
    const router = makeRouter(
      {
        getSpace: async () => ({ ...defaultSpace }),
      },
      {
        spaceMcpService: {
          isConfiguredForSpace: () => true,
          getSpaceEndpoint: () => ({
            endpointId: "endpoint-1",
            spaceId: "space-main",
            transport: "sse",
            endpoint: "https://mcp.example/sse",
            args: [],
            enabled: true,
            healthStatus: "ok",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
          setSpaceEndpoint: async () => ({
            endpointId: "endpoint-1",
            spaceId: "space-main",
            transport: "sse",
            endpoint: "https://mcp.example/sse",
            args: [],
            enabled: true,
            healthStatus: "ok",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
          clearSpaceEndpoint: async () => true,
          discoverSpaceAgents: async () => ({ endpointId: "endpoint-1", agents: [] }),
          approveSpaceAgent: async () => ({
            assignment: defaultAssignment,
            binding: {
              runtimeKind: "external_mcp",
              spaceId: "space-main",
              agentId: "agent-main",
              endpointId: "endpoint-1",
              remoteAgentId: "remote-1",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }),
          listBindings: () => [],
          removeBinding: () => true,
        },
      },
    );

    const getResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_GET_MCP_ENDPOINT, { spaceId: "space-main" }),
    );
    expect(getResponse?.type).toBe(MessageTypes.SPACE_GET_MCP_ENDPOINT);
    expect((getResponse?.payload as any).endpoint.endpointId).toBe("endpoint-1");

    const setResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_SET_MCP_ENDPOINT, {
        spaceId: "space-main",
        transport: "sse",
        endpoint: "https://mcp.example/sse",
      }),
    );
    expect(setResponse?.type).toBe(MessageTypes.SPACE_SET_MCP_ENDPOINT);
    expect((setResponse?.payload as any).endpoint.spaceId).toBe("space-main");

    const clearResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_CLEAR_MCP_ENDPOINT, { spaceId: "space-main" }),
    );
    expect(clearResponse?.type).toBe(MessageTypes.SPACE_CLEAR_MCP_ENDPOINT);
    expect((clearResponse?.payload as any).cleared).toBe(true);
  });

  test("decorates assignment responses with external MCP runtime metadata", async () => {
    const router = makeRouter(
      {
        listAgentAssignments: async () => [defaultAssignment],
      },
      {
        spaceMcpService: {
          isConfiguredForSpace: () => true,
          getSpaceEndpoint: () => null,
          setSpaceEndpoint: async () => null,
          clearSpaceEndpoint: async () => true,
          discoverSpaceAgents: async () => ({ endpointId: "endpoint-1", agents: [] }),
          approveSpaceAgent: async () => ({
            assignment: defaultAssignment,
            binding: {
              runtimeKind: "external_mcp",
              spaceId: "space-main",
              agentId: "agent-main",
              endpointId: "endpoint-1",
              remoteAgentId: "remote-1",
              displayName: "Remote Agent",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }),
          listBindings: () => [{
            agentId: "agent-main",
            endpointId: "endpoint-1",
            remoteAgentId: "remote-1",
            displayName: "Remote Agent",
          }],
          removeBinding: () => true,
        },
      },
    );

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_LIST_AGENT_ASSIGNMENTS, { spaceId: "space-main" }),
    );

    expect(response?.type).toBe(MessageTypes.SPACE_LIST_AGENT_ASSIGNMENTS);
    expect((response?.payload as any).assignments[0].runtimeKind).toBe("external_mcp");
    expect((response?.payload as any).assignments[0].endpointId).toBe("endpoint-1");
    expect((response?.payload as any).assignments[0].remoteAgentId).toBe("remote-1");
  });
});
