import { describe, expect, test } from "bun:test";
import { MessageRouter } from "../src/message-router.js";
import { MessageTypes, type GatewayMessage } from "../src/protocol.js";

function makeClient(overrides: Record<string, unknown> = {}): any {
  return {
    id: "client-1",
    authenticated: true,
    clientType: "sdk",
    publicKey: "principal-1",
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

function makeRouter(gatewayIdentityService?: Record<string, unknown>): MessageRouter {
  const logger: any = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };

  return new MessageRouter({
    spaceManager: {
      executeTurn: async () => ({ turnId: "turn-1" }),
      resumeFeedback: async () => {},
    } as any,
    gatewayIdentityService: gatewayIdentityService as any,
    capabilities: {
      invoke: async () => ({ ok: true }),
      register: () => {},
      deregister: () => {},
    } as any,
    logger,
  });
}

describe("MessageRouter identity handlers", () => {
  test("broadcasts space.agent_updated when a runtime-relevant agent definition update affects active spaces", async () => {
    const broadcasts: Array<{ spaceUid: string; msg: GatewayMessage }> = [];
    const invalidatedSpaces: string[] = [];
    const calls: Array<[string, any]> = [];

    const router = new MessageRouter({
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-1" }),
        resumeFeedback: async () => {},
        invalidateCache: (spaceId: string) => {
          invalidatedSpaces.push(spaceId);
        },
      } as any,
      gatewayIdentityService: {
        getAgentDefinition: () => ({
          agentDefinitionId: "main-profile",
          personaId: "persona-default",
          name: "Existing",
          description: "",
          instructions: "",
          defaultSkillIds: [],
          providerHint: "openai",
          modelHint: "openai/gpt-4.1",
          modelConfig: { preferredModels: ["openai/gpt-4.1"] },
          isDefault: false,
          status: "active",
          activeRevision: 1,
          source: "manual",
          createdAt: "2026-03-15T08:00:00.000Z",
          updatedAt: "2026-03-15T08:00:00.000Z",
        }),
        updateAgentDefinition: (payload: any) => {
          calls.push(["update", payload]);
          return {
            agentDefinition: {
              agentDefinitionId: payload.agentDefinitionId,
              personaId: "persona-default",
              name: "Existing",
              description: "",
              instructions: "",
              defaultSkillIds: [],
              providerHint: "anthropic",
              modelHint: "anthropic/claude-sonnet-4-5",
              modelConfig: { preferredModels: ["anthropic/claude-sonnet-4-5"] },
              isDefault: false,
              status: "active",
              activeRevision: 2,
              source: "manual",
              createdAt: "2026-03-15T08:00:00.000Z",
              updatedAt: "2026-03-15T08:05:00.000Z",
            },
            newRevision: 2,
          };
        },
      } as any,
      listAssignmentsByProfileId: (profileId: string) => {
        expect(profileId).toBe("main-profile");
        return [
          { spaceId: "space-1", agentId: "assistant", profileId: "main-profile" },
        ];
      },
      capabilities: {
        invoke: async () => ({ ok: true }),
        register: () => {},
        deregister: () => {},
      } as any,
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        child: () => ({
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
          child: () => undefined,
        }),
      } as any,
      resolveSpaceUid: async (spaceId: string) => `uid-${spaceId}`,
      broadcastToSpace: (spaceUid, msg) => {
        broadcasts.push({ spaceUid, msg });
      },
    } as any);

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.IDENTITY_UPDATE_AGENT_DEFINITION, {
        agentDefinitionId: "main-profile",
        providerHint: "anthropic",
        modelHint: "anthropic/claude-sonnet-4-5",
      }),
    );

    expect(response?.type).toBe(MessageTypes.IDENTITY_UPDATE_AGENT_DEFINITION);
    expect(calls).toHaveLength(1);
    expect(invalidatedSpaces).toEqual(["space-1"]);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.spaceUid).toBe("uid-space-1");
    expect((broadcasts[0]?.msg.payload as any)?.spaceId).toBe("space-1");
    expect((broadcasts[0]?.msg.payload as any)?.agentId).toBe("assistant");
    expect((broadcasts[0]?.msg.payload as any)?.oldProfileId).toBe("main-profile");
    expect((broadcasts[0]?.msg.payload as any)?.newProfileId).toBe("main-profile");
  });

  test("routes identity.list_personas and identity.archive_persona", async () => {
    const calls: Array<[string, any]> = [];
    const router = makeRouter({
      listPersonas: () => [
        {
          personaId: "persona-default",
          name: "Focused Guide",
          description: "Clear, calm, direct guidance with restrained emotion.",
          tone: "Direct and clear.",
          style: "Concise, structured, and practical.",
          emotionalLayer: "Steady and supportive without excess chatter.",
          constraints: [],
          instructions: "Stay task focused.",
          isDefault: true,
          status: "active",
          activeRevision: 1,
          source: "system",
          createdAt: "2026-03-15T08:00:00.000Z",
          updatedAt: "2026-03-15T08:00:00.000Z",
        },
      ],
      archivePersona: (payload: any) => {
        calls.push(["archive", payload]);
        return {
          persona: {
            personaId: payload.personaId,
            name: "Focused Guide",
            description: "Clear, calm, direct guidance with restrained emotion.",
            tone: "Direct and clear.",
            style: "Concise, structured, and practical.",
            emotionalLayer: "Steady and supportive without excess chatter.",
            constraints: [],
            instructions: "Stay task focused.",
            isDefault: true,
            status: "archived",
            activeRevision: 1,
            source: "system",
            createdAt: "2026-03-15T08:00:00.000Z",
            updatedAt: "2026-03-15T08:00:00.000Z",
          },
          archived: true,
        };
      },
    });

    const listResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.IDENTITY_LIST_PERSONAS, {
        includeArchived: false,
      }),
    );

    expect(listResponse?.type).toBe(MessageTypes.IDENTITY_LIST_PERSONAS);
    expect((listResponse?.payload as any).personas[0]?.personaId).toBe("persona-default");

    const archiveResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.IDENTITY_ARCHIVE_PERSONA, {
        personaId: "persona-default",
      }),
    );

    expect(archiveResponse?.type).toBe(MessageTypes.IDENTITY_ARCHIVE_PERSONA);
    expect(calls.map(([kind]) => kind)).toEqual(["archive"]);
  });

  test("routes identity.list_agent_definitions", async () => {
    const router = makeRouter({
      listAgentDefinitions: () => [
        {
          agentDefinitionId: "main-profile",
          personaId: "persona-default",
          name: "Main Profile",
          description: "Main runtime profile",
          instructions: "Stay concise.",
          defaultSkillIds: [],
          providerHint: "openai",
          modelHint: "openai/gpt-4.1",
          modelConfig: { preferredModels: ["openai/gpt-4.1"] },
          isDefault: true,
          status: "active",
          activeRevision: 3,
          source: "manual",
          createdAt: "2026-03-15T08:00:00.000Z",
          updatedAt: "2026-03-15T08:00:00.000Z",
        },
      ],
    });

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.IDENTITY_LIST_AGENT_DEFINITIONS, {
        includeArchived: false,
      }),
    );

    expect(response?.type).toBe(MessageTypes.IDENTITY_LIST_AGENT_DEFINITIONS);
    expect((response?.payload as any).agentDefinitions[0]?.agentDefinitionId).toBe("main-profile");
  });

  test("routes identity.create/update/archive_agent_definition", async () => {
    const calls: Array<[string, any]> = [];
    const router = makeRouter({
      getAgentDefinition: (agentDefinitionId: string) => ({
        agentDefinitionId,
        personaId: "persona-default",
        name: "Existing",
        description: "",
        instructions: "",
        defaultSkillIds: [],
        providerHint: "openai",
        modelHint: "openai/gpt-4.1",
        modelConfig: { preferredModels: ["openai/gpt-4.1"] },
        isDefault: false,
        status: "active",
        activeRevision: 1,
        source: "manual",
        createdAt: "2026-03-15T08:00:00.000Z",
        updatedAt: "2026-03-15T08:00:00.000Z",
      }),
      createAgentDefinition: (payload: any) => {
        calls.push(["create", payload]);
        return {
          agentDefinition: {
            agentDefinitionId: payload.agentDefinitionId ?? "created-profile",
            personaId: payload.personaId,
            name: payload.name,
            description: payload.description ?? "",
            instructions: payload.instructions ?? "",
            defaultSkillIds: payload.defaultSkillIds ?? [],
            providerHint: payload.providerHint,
            modelHint: payload.modelHint,
            modelConfig: payload.modelConfig,
            isDefault: payload.isDefault === true,
            status: "active",
            activeRevision: 1,
            source: "manual",
            createdAt: "2026-03-15T08:00:00.000Z",
            updatedAt: "2026-03-15T08:00:00.000Z",
          },
          created: true,
        };
      },
      updateAgentDefinition: (payload: any) => {
        calls.push(["update", payload]);
        return {
          agentDefinition: {
            agentDefinitionId: payload.agentDefinitionId,
            personaId: payload.personaId,
            name: payload.name ?? "Existing",
            description: payload.description ?? "",
            instructions: payload.instructions ?? "",
            defaultSkillIds: payload.defaultSkillIds ?? [],
            providerHint: payload.providerHint ?? "openai",
            modelHint: payload.modelHint ?? "openai/gpt-4.1",
            modelConfig: payload.modelConfig ?? { preferredModels: ["openai/gpt-4.1"] },
            isDefault: false,
            status: "active",
            activeRevision: 2,
            source: "manual",
            createdAt: "2026-03-15T08:00:00.000Z",
            updatedAt: "2026-03-15T08:00:00.000Z",
          },
          newRevision: 2,
        };
      },
      archiveAgentDefinition: (payload: any) => {
        calls.push(["archive", payload]);
        return {
          agentDefinition: {
            agentDefinitionId: payload.agentDefinitionId,
            personaId: "persona-default",
            name: "Existing",
            description: "",
            instructions: "",
            defaultSkillIds: [],
            providerHint: "openai",
            modelHint: "openai/gpt-4.1",
            modelConfig: { preferredModels: ["openai/gpt-4.1"] },
            isDefault: false,
            status: "archived",
            activeRevision: 2,
            source: "manual",
            createdAt: "2026-03-15T08:00:00.000Z",
            updatedAt: "2026-03-15T08:00:00.000Z",
          },
          archived: true,
        };
      },
    });

    const createResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.IDENTITY_CREATE_AGENT_DEFINITION, {
        name: "Created Profile",
        providerHint: "openai",
        modelHint: "openai/gpt-4.1",
        modelConfig: { preferredModels: ["openai/gpt-4.1"] },
      }),
    );
    expect(createResponse?.type).toBe(MessageTypes.IDENTITY_CREATE_AGENT_DEFINITION);

    const updateResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.IDENTITY_UPDATE_AGENT_DEFINITION, {
        agentDefinitionId: "existing-profile",
        modelHint: "openai/gpt-4.1-mini",
        modelConfig: { preferredModels: ["openai/gpt-4.1-mini"] },
      }),
    );
    expect(updateResponse?.type).toBe(MessageTypes.IDENTITY_UPDATE_AGENT_DEFINITION);

    const archiveResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.IDENTITY_ARCHIVE_AGENT_DEFINITION, {
        agentDefinitionId: "existing-profile",
      }),
    );
    expect(archiveResponse?.type).toBe(MessageTypes.IDENTITY_ARCHIVE_AGENT_DEFINITION);
    expect(calls.map(([kind]) => kind)).toEqual(["create", "update", "archive"]);
  });
});
