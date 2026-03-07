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
  spaceConfiguratorService?: Record<string, unknown>;
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
    spaceConfiguratorService: options.spaceConfiguratorService as any,
    deviceIdentityService: options.deviceIdentityService as any,
    gatewaySkillCatalogService: options.gatewaySkillCatalogService as any,
    issueHttpPrincipalToken: options.issueHttpPrincipalToken as any,
  });
}

describe("MessageRouter configurator + device handlers", () => {
  test("routes preset list/get/apply flows", async () => {
    const router = makeRouter({
      spaceConfiguratorService: {
        listPresets: () => [{
          presetId: "system.space.chat_first",
          kind: "space",
          title: "Chat First",
          description: "Starter",
          source: "system",
          version: 1,
          tags: ["starter"],
        }],
        getPreset: () => ({
          presetId: "system.space.chat_first",
          kind: "space",
          title: "Chat First",
          description: "Starter",
          source: "system",
          version: 1,
          tags: ["starter"],
          spacePreset: {
            communicationMode: "chat_first",
            turnModel: "primary_only",
            baseAgents: [],
            agentPresetIds: [],
          },
        }),
        applyPresetToSpace: async () => ({
          applicationId: "preset-apply-1",
          presetId: "system.space.chat_first",
          spaceId: "space-main",
          createdSpace: false,
          appliedAgents: 1,
          skippedAgents: 0,
          appliedAt: new Date().toISOString(),
          space: {
            id: "space-main",
            resourceId: "resource-main",
            name: "Main",
            turnModel: "primary_only",
            agents: [],
            capabilities: [],
            capabilityOverrides: {},
            visibility: "shared",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
      },
    });

    const list = await router.handle(makeClient(), makeMessage(MessageTypes.PRESET_LIST, {}));
    expect(list?.type).toBe(MessageTypes.PRESET_LIST);
    expect((list?.payload as any).presets.length).toBe(1);

    const get = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.PRESET_GET, { presetId: "system.space.chat_first" }),
    );
    expect(get?.type).toBe(MessageTypes.PRESET_GET);
    expect((get?.payload as any).preset.presetId).toBe("system.space.chat_first");

    const apply = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.PRESET_APPLY_TO_SPACE, {
        presetId: "system.space.chat_first",
        targetSpaceId: "space-main",
      }),
    );
    expect(apply?.type).toBe(MessageTypes.PRESET_APPLY_TO_SPACE);
    expect((apply?.payload as any).appliedAgents).toBe(1);
  });

  test("routes template preview/create/save flows", async () => {
    const router = makeRouter({
      spaceConfiguratorService: {
        previewTemplate: () => ({
          template: {
            templateId: "template-1",
            title: "Template",
            communicationMode: "chat_first",
            agentPresetIds: [],
            createdBy: "principal-owner",
            updatedAt: new Date().toISOString(),
          },
          resolved: {
            templateId: "template-1",
            templateRevision: 1,
            name: "Template Space",
            resourceId: "resource-main",
            communicationMode: "chat_first",
            turnModel: "primary_only",
            initialAgents: [],
          },
          warnings: [],
        }),
        createFromTemplate: async () => ({
          template: {
            templateId: "template-1",
            title: "Template",
            communicationMode: "chat_first",
            agentPresetIds: [],
            createdBy: "principal-owner",
            updatedAt: new Date().toISOString(),
          },
          space: {
            id: "space-template",
            resourceId: "resource-main",
            name: "Template Space",
            turnModel: "primary_only",
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
            communicationMode: "chat_first",
            agentPresetIds: [],
            createdBy: "principal-owner",
            updatedAt: new Date().toISOString(),
          },
          created: true,
        }),
      },
    });

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
  });

  test("routes preset.save_agent and preset.archive_agent", async () => {
    const router = makeRouter({
      spaceConfiguratorService: {
        saveAgentPreset: async () => ({
          preset: {
            presetId: "user.agent.agent-preset-1",
            kind: "agent",
            title: "Planner",
            description: "Preset",
            source: "user",
            version: 1,
            tags: ["planner"],
            agentPreset: {
              defaultAgents: [],
            },
          },
          created: true,
        }),
        archiveAgentPreset: async () => ({
          presetId: "agent-preset-1",
          archived: true,
        }),
      },
    });

    const save = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.PRESET_SAVE_AGENT, {
        title: "Planner",
      }),
    );
    expect(save?.type).toBe(MessageTypes.PRESET_SAVE_AGENT);
    expect((save?.payload as any).created).toBe(true);

    const archive = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.PRESET_ARCHIVE_AGENT, {
        presetId: "agent-preset-1",
      }),
    );
    expect(archive?.type).toBe(MessageTypes.PRESET_ARCHIVE_AGENT);
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
