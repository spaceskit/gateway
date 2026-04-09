import { describe, expect, test } from "bun:test";
import { MessageRouter } from "../src/message-router.js";
import { MessageTypes, type GatewayMessage } from "../src/protocol.js";

function makeClient(overrides: Record<string, unknown> = {}): any {
  return {
    id: "client-1",
    authenticated: true,
    clientType: "sdk",
    publicKey: "principal-owner",
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

function makeRouter(options: {
  spaceTemplateService?: Record<string, unknown>;
  deviceIdentityService?: Record<string, unknown>;
  gatewaySkillCatalogService?: Record<string, unknown>;
  issueHttpPrincipalToken?: (input: {
    principalId: string;
    deviceId?: string;
    ttlSeconds?: number;
  }) => Promise<Record<string, unknown>> | Record<string, unknown>;
} = {}): MessageRouter {
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
    capabilities: {
      invoke: async () => ({ ok: true }),
      register: () => {},
      deregister: () => {},
    } as any,
    logger,
    spaceTemplateService: options.spaceTemplateService as any,
    deviceIdentityService: options.deviceIdentityService as any,
    gatewaySkillCatalogService: options.gatewaySkillCatalogService as any,
    issueHttpPrincipalToken: options.issueHttpPrincipalToken as any,
  });
}

describe("MessageRouter configurator + device handlers", () => {
  test("routes template list/get/preview/create/save/archive flows", async () => {
    const router = makeRouter({
      spaceTemplateService: {
        listTemplates: () => ([
          {
            templateId: "template-1",
            name: "Template",
            description: "Two-agent planning template",
            status: "active",
            activeRevision: 1,
            communicationMode: "async_notes",
            conversationTopology: "shared_team_chat",
            promptPackId: "shared-team-chat-v1",
            turnModel: "sequential_all",
            agentDefinitions: [],
            createdBy: "principal-owner",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]),
        getTemplate: () => ({
          templateId: "template-1",
          name: "Template",
          description: "Two-agent planning template",
          status: "active",
          activeRevision: 1,
          communicationMode: "async_notes",
          conversationTopology: "shared_team_chat",
          promptPackId: "shared-team-chat-v1",
          turnModel: "sequential_all",
          agentDefinitions: [],
          createdBy: "principal-owner",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        previewTemplate: () => ({
          template: {
            templateId: "template-1",
            title: "Template",
            communicationMode: "async_notes",
            conversationTopology: "shared_team_chat",
            promptPackId: "shared-team-chat-v1",
            agentPresetIds: [],
            createdBy: "principal-owner",
            updatedAt: new Date().toISOString(),
          },
          resolved: {
            templateId: "template-1",
            templateRevision: 1,
            name: "Template Space",
            resourceId: "resource-main",
            communicationMode: "async_notes",
            conversationTopology: "shared_team_chat",
            promptPackId: "shared-team-chat-v1",
            turnModel: "sequential_all",
            initialAgents: [],
          },
          warnings: [],
        }),
        createFromTemplate: async () => ({
          template: {
            templateId: "template-1",
            title: "Template",
            communicationMode: "async_notes",
            conversationTopology: "shared_team_chat",
            promptPackId: "shared-team-chat-v1",
            agentPresetIds: [],
            createdBy: "principal-owner",
            updatedAt: new Date().toISOString(),
          },
          space: {
            id: "space-template",
            resourceId: "resource-main",
            name: "Template Space",
            turnModel: "sequential_all",
            agents: [],
            capabilities: [],
            capabilityOverrides: {},
            visibility: "shared",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
        saveTemplate: async () => ({
          template: {
            templateId: "template-1",
            title: "Template",
            communicationMode: "async_notes",
            conversationTopology: "shared_team_chat",
            promptPackId: "shared-team-chat-v1",
            agentPresetIds: [],
            createdBy: "principal-owner",
            updatedAt: new Date().toISOString(),
          },
          created: true,
        }),
        archiveTemplate: () => ({
          template: {
            templateId: "template-1",
            name: "Template",
            description: "Two-agent planning template",
            status: "archived",
            activeRevision: 1,
            communicationMode: "async_notes",
            conversationTopology: "shared_team_chat",
            promptPackId: "shared-team-chat-v1",
            turnModel: "sequential_all",
            agentDefinitions: [],
            createdBy: "principal-owner",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          archived: true,
        }),
      },
    });

    const list = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_LIST_TEMPLATES, {}),
    );
    expect(list?.type).toBe(MessageTypes.SPACE_LIST_TEMPLATES);
    expect((list?.payload as any).templates.length).toBe(1);

    const get = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_GET_TEMPLATE, { templateId: "template-1" }),
    );
    expect(get?.type).toBe(MessageTypes.SPACE_GET_TEMPLATE);

    const preview = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_PREVIEW_TEMPLATE, { templateId: "template-1" }),
    );
    expect(preview?.type).toBe(MessageTypes.SPACE_PREVIEW_TEMPLATE);

    const create = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_CREATE_FROM_TEMPLATE, {
        templateId: "template-1",
        resourceId: "resource-main",
      }),
    );
    expect(create?.type).toBe(MessageTypes.SPACE_CREATE_FROM_TEMPLATE);

    const save = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_SAVE_TEMPLATE, { title: "Template" }),
    );
    expect(save?.type).toBe(MessageTypes.SPACE_SAVE_TEMPLATE);
    expect((save?.payload as any).created).toBe(true);

    const archive = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_ARCHIVE_TEMPLATE, { templateId: "template-1" }),
    );
    expect(archive?.type).toBe(MessageTypes.SPACE_ARCHIVE_TEMPLATE);
    expect((archive?.payload as any).archived).toBe(true);
  });

  test("routes gateway.skill_* catalog operations", async () => {
    const router = makeRouter({
      gatewaySkillCatalogService: {
        listSkills: () => [{
          skillId: "anthropic/pdf",
          name: "PDF",
          description: "PDF extraction skill",
          contentMarkdown: "## Use PDF parser",
          sourceRef: "https://docs.anthropic.com",
          tags: ["pdf"],
          status: "active",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
        getSkill: () => ({
          skillId: "anthropic/pdf",
          name: "PDF",
          description: "PDF extraction skill",
          contentMarkdown: "## Use PDF parser",
          sourceRef: "https://docs.anthropic.com",
          tags: ["pdf"],
          status: "active",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        upsertSkill: () => ({
          skill: {
            skillId: "custom/skill",
            name: "Custom",
            description: "",
            contentMarkdown: "custom",
            sourceRef: "",
            tags: ["custom"],
            status: "active",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          created: true,
        }),
        deleteSkill: () => true,
      },
    });

    const list = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.GATEWAY_SKILL_LIST, {}),
    );
    expect(list?.type).toBe(MessageTypes.GATEWAY_SKILL_LIST);
    expect((list?.payload as any).skills.length).toBe(1);

    const get = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.GATEWAY_SKILL_GET, { skillId: "anthropic/pdf" }),
    );
    expect(get?.type).toBe(MessageTypes.GATEWAY_SKILL_GET);

    const upsert = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.GATEWAY_SKILL_UPSERT, {
        name: "Custom",
        contentMarkdown: "custom",
      }),
    );
    expect(upsert?.type).toBe(MessageTypes.GATEWAY_SKILL_UPSERT);
    expect((upsert?.payload as any).created).toBe(true);

    const del = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.GATEWAY_SKILL_DELETE, { skillId: "custom/skill" }),
    );
    expect(del?.type).toBe(MessageTypes.GATEWAY_SKILL_DELETE);
    expect((del?.payload as any).deleted).toBe(true);
  });

  test("routes device lifecycle operations", async () => {
    const router = makeRouter({
      deviceIdentityService: {
        registerDevice: () => ({
          created: true,
          device: {
            deviceId: "device-1",
            principalId: "principal-owner",
            publicKey: "device-key",
            keyVersion: "1",
            status: "active",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
        rotateDeviceKey: () => ({
          deviceId: "device-1",
          principalId: "principal-owner",
          publicKey: "device-key-2",
          keyVersion: "2",
          status: "active",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        revokeDevice: () => ({
          deviceId: "device-1",
          revoked: true,
          device: {
            deviceId: "device-1",
            principalId: "principal-owner",
            publicKey: "device-key-2",
            keyVersion: "2",
            status: "revoked",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            revokedAt: new Date().toISOString(),
          },
        }),
        listDevices: () => [{
          deviceId: "device-1",
          principalId: "principal-owner",
          publicKey: "device-key-2",
          keyVersion: "2",
          status: "revoked",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revokedAt: new Date().toISOString(),
        }],
      },
    });

    const register = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.AUTH_REGISTER_DEVICE, {
        deviceId: "device-1",
        publicKey: "device-key",
      }),
    );
    expect(register?.type).toBe(MessageTypes.AUTH_REGISTER_DEVICE);
    expect((register?.payload as any).created).toBe(true);

    const rotate = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.AUTH_ROTATE_DEVICE_KEY, {
        deviceId: "device-1",
        nextPublicKey: "device-key-2",
      }),
    );
    expect(rotate?.type).toBe(MessageTypes.AUTH_ROTATE_DEVICE_KEY);
    expect((rotate?.payload as any).device.keyVersion).toBe("2");

    const revoke = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.AUTH_REVOKE_DEVICE, {
        deviceId: "device-1",
      }),
    );
    expect(revoke?.type).toBe(MessageTypes.AUTH_REVOKE_DEVICE);
    expect((revoke?.payload as any).revoked).toBe(true);

    const list = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.AUTH_LIST_DEVICES, {}),
    );
    expect(list?.type).toBe(MessageTypes.AUTH_LIST_DEVICES);
    expect((list?.payload as any).devices.length).toBe(1);
  });

  test("issues HTTP principal token for authenticated callers", async () => {
    let captured: any = null;
    const router = makeRouter({
      issueHttpPrincipalToken: (input) => {
        captured = input;
        return {
          token: "token-1",
          tokenType: "Bearer",
          principalId: input.principalId,
          deviceId: input.deviceId,
          issuedAt: "2026-03-02T21:00:00.000Z",
          expiresAt: "2026-03-02T21:05:00.000Z",
          ttlSeconds: input.ttlSeconds ?? 300,
        };
      },
    });

    const response = await router.handle(
      makeClient({ publicKey: "principal-owner", deviceId: "device-owner" }),
      makeMessage(MessageTypes.AUTH_ISSUE_HTTP_PRINCIPAL_TOKEN, {
        ttlSeconds: 240,
      }),
    );

    expect(response?.type).toBe(MessageTypes.AUTH_ISSUE_HTTP_PRINCIPAL_TOKEN);
    expect(captured).toEqual({
      principalId: "principal-owner",
      deviceId: "device-owner",
      ttlSeconds: 240,
    });
    expect((response?.payload as any).token).toBe("token-1");
    expect((response?.payload as any).ttlSeconds).toBe(240);
  });

  test("rejects invalid or unavailable HTTP principal token issuance", async () => {
    const missingIssuerRouter = makeRouter();
    const missingIssuerResponse = await missingIssuerRouter.handle(
      makeClient(),
      makeMessage(MessageTypes.AUTH_ISSUE_HTTP_PRINCIPAL_TOKEN, {}),
    );
    expect(missingIssuerResponse?.type).toBe(MessageTypes.ERROR);
    expect((missingIssuerResponse?.payload as any).code).toBe("FAILED_PRECONDITION");

    const invalidTtlRouter = makeRouter({
      issueHttpPrincipalToken: () => ({
        token: "token-1",
        tokenType: "Bearer",
        principalId: "principal-owner",
        issuedAt: "2026-03-02T21:00:00.000Z",
        expiresAt: "2026-03-02T21:05:00.000Z",
        ttlSeconds: 300,
      }),
    });
    const invalidTtlResponse = await invalidTtlRouter.handle(
      makeClient(),
      makeMessage(MessageTypes.AUTH_ISSUE_HTTP_PRINCIPAL_TOKEN, {
        ttlSeconds: 0,
      }),
    );
    expect(invalidTtlResponse?.type).toBe(MessageTypes.ERROR);
    expect((invalidTtlResponse?.payload as any).code).toBe("INVALID_ARGUMENT");
  });
});
