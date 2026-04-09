import { describe, expect, test } from "bun:test";
import { MessageRouter } from "../src/message-router.js";
import { MessageTypes, type GatewayMessage } from "../src/protocol.js";

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
  gatewayAdminService?: Record<string, unknown>,
  gatewayKnowledgeBaseService?: Record<string, unknown>,
  gatewayResetService?: Record<string, unknown>,
  spaceSharingService?: Record<string, unknown>,
  spaceManagerOverrides?: Record<string, unknown>,
  spaceQuotaService?: Record<string, unknown>,
  broadcastToSpace?: (spaceUid: string, msg: GatewayMessage) => void,
  conciergeEscalationService?: Record<string, unknown>,
): MessageRouter {
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
      invalidateCache: () => {},
      ...spaceManagerOverrides,
    } as any,
    spaceAdminService: undefined,
    gatewayAdminService: gatewayAdminService as any,
    gatewayKnowledgeBaseService: gatewayKnowledgeBaseService as any,
    gatewayResetService: gatewayResetService as any,
    spaceSharingService: spaceSharingService as any,
    spaceQuotaService: spaceQuotaService as any,
    capabilities: {
      invoke: async () => ({ ok: true }),
      register: () => {},
      deregister: () => {},
    } as any,
    logger,
    conciergeEscalationService: conciergeEscalationService as any,
    broadcastToSpace,
  });
}

describe("MessageRouter gateway admin handlers", () => {
  test("returns NOT_AVAILABLE when gateway admin service is not configured", async () => {
    const router = makeRouter(undefined);
    const msg = makeMessage(MessageTypes.GATEWAY_DISCOVER_LOCAL_AGENTS, {});
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("FAILED_PRECONDITION");
    expect((response?.payload as any).retryable).toBe(false);
    expect((response?.payload as any).correlationId).toBe(msg.id);
  });

  test("routes gateway.discover_local_agents", async () => {
    const router = makeRouter({
      discoverLocalAgents: async () => [
        {
          id: "claude",
          name: "Claude",
          detected: true,
          recommendedProviderId: "anthropic",
          recommendedModel: "anthropic/claude-sonnet-4-5",
          requiresApiKey: true,
        },
      ],
    });

    const msg = makeMessage(MessageTypes.GATEWAY_DISCOVER_LOCAL_AGENTS, {});
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_DISCOVER_LOCAL_AGENTS);
    expect((response?.payload as any).agents.length).toBe(1);
    expect((response?.payload as any).agents[0].id).toBe("claude");
  });

  test("routes gateway.list_provider_configs", async () => {
    const router = makeRouter({
      listProviderConfigs: () => [
        {
          providerId: "openai",
          model: "openai/gpt-4.1",
          hasApiKey: true,
          updatedAt: new Date().toISOString(),
          source: "runtime",
        },
      ],
    });

    const msg = makeMessage(MessageTypes.GATEWAY_LIST_PROVIDER_CONFIGS, {});
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_LIST_PROVIDER_CONFIGS);
    expect((response?.payload as any).configs.length).toBe(1);
    expect((response?.payload as any).configs[0].providerId).toBe("openai");
  });

  test("acknowledges concierge.action_result", async () => {
    const resolved: any[] = [];
    const router = makeRouter(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        resolveRequest: async (input: any) => {
          resolved.push(input);
          return {
            requestId: input.requestId,
            status: "actioned",
            deliveryChannel: "notification",
          };
        },
      },
    );
    const msg = makeMessage(MessageTypes.CONCIERGE_ACTION_RESULT, {
      requestId: "request-1",
      status: "ok",
      payload: {
        opened: true,
      },
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.CONCIERGE_ACTION_RESULT);
    expect((response?.payload as any).acknowledged).toBe(true);
    expect((response?.payload as any).requestId).toBe("request-1");
    expect(resolved).toEqual([{
      requestId: "request-1",
      status: "ok",
      payload: {
        opened: true,
      },
      error: undefined,
    }]);
  });

  test("routes gateway.get_main_agent", async () => {
    const nowIso = new Date().toISOString();
    const calls: any[] = [];
    let invalidatedSpaceId: string | null = null;
    const router = makeRouter({
      resolveMainSpaceId: () => "main-space",
      getMainAgent: async (input: any) => {
        calls.push(input);
        return {
          spaceId: input.spaceId ?? "main-space",
          spaceUid: "11111111-2222-3333-4444-555555555555",
          mainAgentId: "main-agent",
          mainProfileId: "main-profile",
          providerHint: "openai",
          modelHint: "openai/gpt-4.1",
          status: "healthy",
          repaired: false,
          fallbackApplied: false,
          updatedAt: nowIso,
        };
      },
    }, undefined, undefined, undefined, {
      invalidateCache: (spaceId: string) => {
        invalidatedSpaceId = spaceId;
      },
    });

    const defaultMsg = makeMessage(MessageTypes.GATEWAY_GET_MAIN_AGENT, {});
    const defaultResponse = await router.handle(makeClient({ publicKey: "owner-1" }), defaultMsg);

    expect(defaultResponse?.type).toBe(MessageTypes.GATEWAY_GET_MAIN_AGENT);
    expect((defaultResponse?.payload as any).state.mainAgentId).toBe("main-agent");
    expect((defaultResponse?.payload as any).state.status).toBe("healthy");
    expect(calls[0]?.repairIfMissing).toBeUndefined();
    expect(invalidatedSpaceId).toBeNull();

    const strictMsg = makeMessage(MessageTypes.GATEWAY_GET_MAIN_AGENT, {
      repairIfMissing: false,
    });
    const strictResponse = await router.handle(makeClient({ publicKey: "owner-1" }), strictMsg);
    expect(strictResponse?.type).toBe(MessageTypes.GATEWAY_GET_MAIN_AGENT);
    expect(calls[1]?.repairIfMissing).toBe(false);
    expect(invalidatedSpaceId).toBeNull();
  });

  test("routes gateway.get_concierge_agent", async () => {
    const nowIso = new Date().toISOString();
    const calls: any[] = [];
    let invalidatedSpaceId: string | null = null;
    const router = makeRouter({
      getConciergeAgent: async (input: any) => {
        calls.push(input);
        return {
          spaceId: input.spaceId ?? "concierge-space",
          spaceUid: "aaaa1111-2222-3333-4444-555555555555",
          conciergeAgentId: "concierge-agent",
          conciergeProfileId: "concierge-profile",
          providerHint: "openai",
          modelHint: "openai/gpt-4.1",
          status: "healthy",
          repaired: false,
          fallbackApplied: false,
          updatedAt: nowIso,
        };
      },
    }, undefined, undefined, undefined, {
      invalidateCache: (spaceId: string) => {
        invalidatedSpaceId = spaceId;
      },
    });

    const defaultMsg = makeMessage(MessageTypes.GATEWAY_GET_CONCIERGE_AGENT, {});
    const defaultResponse = await router.handle(makeClient({ publicKey: "owner-1" }), defaultMsg);

    expect(defaultResponse?.type).toBe(MessageTypes.GATEWAY_GET_CONCIERGE_AGENT);
    expect((defaultResponse?.payload as any).state.conciergeAgentId).toBe("concierge-agent");
    expect((defaultResponse?.payload as any).state.status).toBe("healthy");
    expect(calls[0]?.repairIfMissing).toBeUndefined();
    expect(invalidatedSpaceId).toBeNull();

    const strictMsg = makeMessage(MessageTypes.GATEWAY_GET_CONCIERGE_AGENT, {
      repairIfMissing: false,
    });
    const strictResponse = await router.handle(makeClient({ publicKey: "owner-1" }), strictMsg);
    expect(strictResponse?.type).toBe(MessageTypes.GATEWAY_GET_CONCIERGE_AGENT);
    expect(calls[1]?.repairIfMissing).toBe(false);
    expect(invalidatedSpaceId).toBeNull();
  });

  test("invalidates runtime cache when gateway.get_main_agent repairs state", async () => {
    let invalidatedSpaceId: string | null = null;
    const router = makeRouter({
      getMainAgent: async () => ({
        spaceId: "main-space",
        spaceUid: "11111111-2222-3333-4444-555555555555",
        mainAgentId: "main-agent",
        mainProfileId: "main-profile",
        providerHint: "lmstudio",
        modelHint: "lmstudio/google/gemma-3-4b-it",
        status: "fallback",
        repaired: true,
        fallbackApplied: true,
        fallbackReason: "Configured model unavailable for provider lmstudio",
        updatedAt: new Date().toISOString(),
      }),
    }, undefined, undefined, undefined, {
      invalidateCache: (spaceId: string) => {
        invalidatedSpaceId = spaceId;
      },
    });

    const msg = makeMessage(MessageTypes.GATEWAY_GET_MAIN_AGENT, {});
    const response = await router.handle(makeClient({ publicKey: "owner-1" }), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_GET_MAIN_AGENT);
    expect((response?.payload as any).state.status).toBe("fallback");
    expect(invalidatedSpaceId).toBe("main-space");
  });

  test("validates gateway.set_main_agent payload", async () => {
    const router = makeRouter({
      resolveMainSpaceId: () => "main-space",
      setMainAgent: async () => {
        throw new Error("should not be called");
      },
    });

    const invalidMode = makeMessage(MessageTypes.GATEWAY_SET_MAIN_AGENT, {
      selectionMode: "unsupported",
    });
    const invalidModeResponse = await router.handle(makeClient({ publicKey: "owner-1" }), invalidMode);
    expect(invalidModeResponse?.type).toBe(MessageTypes.ERROR);
    expect((invalidModeResponse?.payload as any).code).toBe("INVALID_ARGUMENT");

    const missingProviderFields = makeMessage(MessageTypes.GATEWAY_SET_MAIN_AGENT, {
      selectionMode: "provider_model",
      providerId: "openai",
    });
    const missingProviderFieldsResponse = await router.handle(
      makeClient({ publicKey: "owner-1" }),
      missingProviderFields,
    );
    expect(missingProviderFieldsResponse?.type).toBe(MessageTypes.ERROR);
    expect((missingProviderFieldsResponse?.payload as any).code).toBe("INVALID_ARGUMENT");

    const missingTemplate = makeMessage(MessageTypes.GATEWAY_SET_MAIN_AGENT, {
      selectionMode: "agent_definition",
    });
    const missingTemplateResponse = await router.handle(
      makeClient({ publicKey: "owner-1" }),
      missingTemplate,
    );
    expect(missingTemplateResponse?.type).toBe(MessageTypes.ERROR);
    expect((missingTemplateResponse?.payload as any).code).toBe("INVALID_ARGUMENT");
  });

  test("routes gateway.set_main_agent", async () => {
    let received: any = null;
    let invalidatedSpaceId: string | null = null;
    const nowIso = new Date().toISOString();
    const router = makeRouter({
      resolveMainSpaceId: () => "main-space",
      setMainAgent: async (input: any) => {
        received = input;
        return {
          spaceId: "main-space",
          spaceUid: "11111111-2222-3333-4444-555555555555",
          mainAgentId: "main-agent",
          mainProfileId: "main-profile",
          providerHint: "codex",
          modelHint: "codex/gpt-5.2-codex",
          status: "repaired",
          repaired: true,
          fallbackApplied: false,
          updatedAt: nowIso,
        };
      },
    }, undefined, undefined, undefined, {
      invalidateCache: (spaceId: string) => {
        invalidatedSpaceId = spaceId;
      },
    });

    const msg = makeMessage(MessageTypes.GATEWAY_SET_MAIN_AGENT, {
      selectionMode: "provider_model",
      providerId: "codex",
      modelId: "gpt-5.2-codex",
      applyPersonaInstructions: false,
    });
    const response = await router.handle(makeClient({ publicKey: "owner-1" }), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_SET_MAIN_AGENT);
    expect(received.selectionMode).toBe("provider_model");
    expect(received.providerId).toBe("codex");
    expect(received.modelId).toBe("gpt-5.2-codex");
    expect(received.applyPersonaInstructions).toBe(false);
    expect(invalidatedSpaceId).toBe("main-space");
    expect((response?.payload as any).state.status).toBe("repaired");
  });

  test("routes gateway.set_concierge_agent", async () => {
    let received: any = null;
    let invalidatedSpaceId: string | null = null;
    const nowIso = new Date().toISOString();
    const router = makeRouter({
      getConciergeAgent: async () => ({
        spaceId: "concierge-space",
        spaceUid: "aaaa1111-2222-3333-4444-555555555555",
        conciergeAgentId: "concierge-agent",
        conciergeProfileId: "concierge-profile",
        status: "healthy",
        repaired: false,
        fallbackApplied: false,
        updatedAt: nowIso,
      }),
      setConciergeAgent: async (input: any) => {
        received = input;
        return {
          spaceId: "concierge-space",
          spaceUid: "aaaa1111-2222-3333-4444-555555555555",
          conciergeAgentId: "concierge-agent",
          conciergeProfileId: "concierge-profile",
          providerHint: "codex",
          modelHint: "codex/gpt-5.2-codex",
          status: "repaired",
          repaired: true,
          fallbackApplied: false,
          updatedAt: nowIso,
        };
      },
    }, undefined, undefined, undefined, {
      invalidateCache: (spaceId: string) => {
        invalidatedSpaceId = spaceId;
      },
    });

    const msg = makeMessage(MessageTypes.GATEWAY_SET_CONCIERGE_AGENT, {
      selectionMode: "provider_model",
      providerId: "codex",
      modelId: "gpt-5.2-codex",
      applyPersonaInstructions: false,
    });
    const response = await router.handle(makeClient({ publicKey: "owner-1" }), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_SET_CONCIERGE_AGENT);
    expect(received.selectionMode).toBe("provider_model");
    expect(received.providerId).toBe("codex");
    expect(received.modelId).toBe("gpt-5.2-codex");
    expect(received.applyPersonaInstructions).toBe(false);
    expect(invalidatedSpaceId).toBe("concierge-space");
    expect((response?.payload as any).state.status).toBe("repaired");
  });

  test("gateway.set_main_agent resets usage session and emits space.agent_updated", async () => {
    const broadcasts: GatewayMessage[] = [];
    let resetArgs: { spaceId: string; agentId: string; principalId: string } | null = null;
    const router = makeRouter(
      {
        getMainAgent: async () => ({
          spaceId: "main-space",
          spaceUid: "11111111-2222-3333-4444-555555555555",
          mainAgentId: "main-agent",
          mainProfileId: "profile-old",
          status: "healthy",
          repaired: false,
          fallbackApplied: false,
          updatedAt: new Date().toISOString(),
        }),
        setMainAgent: async () => ({
          spaceId: "main-space",
          spaceUid: "11111111-2222-3333-4444-555555555555",
          mainAgentId: "main-agent",
          mainProfileId: "profile-new",
          providerHint: "openai",
          modelHint: "openai/gpt-4.1",
          status: "healthy",
          repaired: false,
          fallbackApplied: false,
          updatedAt: new Date().toISOString(),
        }),
      },
      undefined,
      undefined,
      undefined,
      undefined,
      {
        resetAgentUsageSession: (spaceId: string, agentId: string, principalId: string) => {
          resetArgs = { spaceId, agentId, principalId };
          return { activeSession: { sessionId: "aus-1" } };
        },
      },
      (_spaceUid, msg) => {
        broadcasts.push(msg);
      },
    );

    const msg = makeMessage(MessageTypes.GATEWAY_SET_MAIN_AGENT, {
      selectionMode: "provider_model",
      providerId: "openai",
      modelId: "openai/gpt-4.1",
    });
    const response = await router.handle(makeClient({ publicKey: "owner-1" }), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_SET_MAIN_AGENT);
    expect(resetArgs).toEqual({
      spaceId: "main-space",
      agentId: "main-agent",
      principalId: "owner-1",
    });
    expect(broadcasts.length).toBe(1);
    expect(broadcasts[0].type).toBe(MessageTypes.SPACE_AGENT_UPDATED);
    expect((broadcasts[0].payload as any).oldProfileId).toBe("profile-old");
    expect((broadcasts[0].payload as any).newProfileId).toBe("profile-new");
  });

  test("gateway.set_main_agent uses fallback principal when publicKey is missing", async () => {
    let resetArgs: { spaceId: string; agentId: string; principalId: string } | null = null;
    const router = makeRouter(
      {
        getMainAgent: async () => ({
          spaceId: "main-space",
          spaceUid: "11111111-2222-3333-4444-555555555555",
          mainAgentId: "main-agent",
          mainProfileId: "profile-old",
          status: "healthy",
          repaired: false,
          fallbackApplied: false,
          updatedAt: new Date().toISOString(),
        }),
        setMainAgent: async () => ({
          spaceId: "main-space",
          spaceUid: "11111111-2222-3333-4444-555555555555",
          mainAgentId: "main-agent",
          mainProfileId: "profile-new",
          providerHint: "openai",
          modelHint: "openai/gpt-4.1",
          status: "healthy",
          repaired: false,
          fallbackApplied: false,
          updatedAt: new Date().toISOString(),
        }),
      },
      undefined,
      undefined,
      undefined,
      undefined,
      {
        resetAgentUsageSession: (spaceId: string, agentId: string, principalId: string) => {
          resetArgs = { spaceId, agentId, principalId };
          return { activeSession: { sessionId: "aus-1" } };
        },
      },
    );

    const msg = makeMessage(MessageTypes.GATEWAY_SET_MAIN_AGENT, {
      selectionMode: "provider_model",
      providerId: "openai",
      modelId: "openai/gpt-4.1",
    });
    const response = await router.handle(makeClient({ publicKey: undefined, deviceId: "dev-main-1" }), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_SET_MAIN_AGENT);
    expect(resetArgs).toEqual({
      spaceId: "main-space",
      agentId: "main-agent",
      principalId: "device:dev-main-1",
    });
  });

  test("denies gateway.set_main_agent when write access is denied", async () => {
    let called = false;
    const router = makeRouter(
      {
        resolveMainSpaceId: () => "main-space",
        setMainAgent: async () => {
          called = true;
          return {
            spaceId: "main-space",
            spaceUid: "11111111-2222-3333-4444-555555555555",
            mainAgentId: "main-agent",
            mainProfileId: "main-profile",
            status: "healthy",
            repaired: false,
            fallbackApplied: false,
            updatedAt: new Date().toISOString(),
          };
        },
      },
      undefined,
      undefined,
      {
        evaluateAccess: ({ action }: { action: string }) => ({
          allowed: action !== "write",
          enforced: true,
          reason: "Write access denied",
        }),
      },
    );

    const msg = makeMessage(MessageTypes.GATEWAY_SET_MAIN_AGENT, {
      selectionMode: "provider_model",
      providerId: "openai",
      modelId: "gpt-4.1",
    });
    const response = await router.handle(makeClient({ publicKey: "collaborator-1" }), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("PERMISSION_DENIED");
    expect(called).toBe(false);
  });

  test("routes gateway.get_provider_telemetry", async () => {
    let received: any = null;
    const router = makeRouter({
      listProviderConfigs: () => [
        {
          providerId: "codex",
          model: "codex/gpt-5.1-codex",
          hasApiKey: false,
          updatedAt: new Date().toISOString(),
          source: "runtime",
        },
      ],
      getProviderTelemetry: async (input: any) => {
        received = input;
        return [
          {
            providerId: "codex",
            status: "available",
            source: "codex_app_server",
            fetchedAt: new Date().toISOString(),
            windows: [
              {
                scopeId: "codex",
                window: "primary",
                usedPercent: 12,
                remainingPercent: 88,
                windowDurationMins: 300,
              },
            ],
          },
        ];
      },
    });

    const msg = makeMessage(MessageTypes.GATEWAY_GET_PROVIDER_TELEMETRY, {
      providerId: "codex",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_GET_PROVIDER_TELEMETRY);
    expect(received.providerId).toBe("codex");
    expect((response?.payload as any).telemetry.length).toBe(1);
    expect((response?.payload as any).telemetry[0].providerId).toBe("codex");
  });

  test("validates configured providerId for gateway.get_provider_telemetry", async () => {
    const router = makeRouter({
      listProviderConfigs: () => [
        {
          providerId: "openai",
          model: "openai/gpt-4.1",
          hasApiKey: true,
          updatedAt: new Date().toISOString(),
          source: "runtime",
        },
      ],
      getProviderTelemetry: async () => [],
    });

    const msg = makeMessage(MessageTypes.GATEWAY_GET_PROVIDER_TELEMETRY, {
      providerId: "codex",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
  });

  test("routes gateway.get_local_usage_telemetry", async () => {
    let received: any = null;
    const router = makeRouter({
      listProviderConfigs: () => [
        {
          providerId: "codex",
          model: "codex/gpt-5.1-codex",
          hasApiKey: false,
          updatedAt: new Date().toISOString(),
          source: "runtime",
        },
      ],
      getLocalUsageTelemetry: async (input: any) => {
        received = input;
        return [
          {
            providerId: "codex",
            status: "available",
            fetchedAt: new Date().toISOString(),
            quota: {
              available: true,
              sourceLabel: "codex-cli",
              windows: [
                {
                  window: "primary",
                  label: "session",
                  usedPercent: 12,
                  remainingPercent: 88,
                },
              ],
            },
            summary: {
              windowDays: 30,
              sessionCount: 1,
              inputTokens: 100,
              outputTokens: 50,
              totalTokens: 150,
            },
            sessions: [
              {
                sessionId: "session-1",
                lastActivityAt: new Date().toISOString(),
                inputTokens: 100,
                outputTokens: 50,
                totalTokens: 150,
              },
            ],
          },
        ];
      },
    });

    const msg = makeMessage(MessageTypes.GATEWAY_GET_LOCAL_USAGE_TELEMETRY, {
      providerId: "codex",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_GET_LOCAL_USAGE_TELEMETRY);
    expect(received.providerId).toBe("codex");
    expect((response?.payload as any).telemetry.length).toBe(1);
    expect((response?.payload as any).telemetry[0].providerId).toBe("codex");
  });

  test("validates configured providerId for gateway.get_local_usage_telemetry", async () => {
    const router = makeRouter({
      listProviderConfigs: () => [
        {
          providerId: "openai",
          model: "openai/gpt-4.1",
          hasApiKey: true,
          updatedAt: new Date().toISOString(),
          source: "runtime",
        },
      ],
      getLocalUsageTelemetry: async () => [],
    });

    const msg = makeMessage(MessageTypes.GATEWAY_GET_LOCAL_USAGE_TELEMETRY, {
      providerId: "codex",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
  });

  test("routes gateway.list_available_models", async () => {
    const router = makeRouter({
      listAvailableModels: async () => [
        {
          providerId: "openai",
          hasApiKey: false,
          requiresApiKey: false,
          baseURL: "http://127.0.0.1:1234/v1",
          detectionStatus: "available",
          models: [
            {
              id: "openai/qwen2.5-coder",
              displayName: "qwen2.5-coder",
              source: "detected",
              available: true,
            },
          ],
        },
      ],
    });

    const msg = makeMessage(MessageTypes.GATEWAY_LIST_AVAILABLE_MODELS, {});
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_LIST_AVAILABLE_MODELS);
    expect(Array.isArray((response?.payload as any).providers)).toBe(true);
    expect((response?.payload as any).providers[0].providerId).toBe("openai");
    expect((response?.payload as any).providers[0].models[0].id).toBe("openai/qwen2.5-coder");
  });

  test("validates providerId for gateway.set_provider_config", async () => {
    const router = makeRouter({
      setProviderConfig: () => ({
        providerId: "openai",
        model: "openai/gpt-4.1",
        hasApiKey: true,
        updatedAt: new Date().toISOString(),
        source: "runtime",
      }),
    });

    const msg = makeMessage(MessageTypes.GATEWAY_SET_PROVIDER_CONFIG, {
      model: "openai/gpt-4.1",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
  });

  test("routes gateway.set_provider_config", async () => {
    let received: any = null;
    const router = makeRouter({
      setProviderConfig: (input: any) => {
        received = input;
        return {
          providerId: "openai",
          model: input.model,
          baseURL: input.baseURL,
          hasApiKey: true,
          updatedAt: new Date().toISOString(),
          source: "runtime",
        };
      },
    });

    const msg = makeMessage(MessageTypes.GATEWAY_SET_PROVIDER_CONFIG, {
      providerId: "openai",
      model: "openai/gpt-4.1",
      apiKey: "test-key",
      baseURL: "http://127.0.0.1:1234/v1",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_SET_PROVIDER_CONFIG);
    expect(received.providerId).toBe("openai");
    expect((response?.payload as any).config.baseURL).toBe("http://127.0.0.1:1234/v1");
  });

  test("passes through apiKeySecretRef for gateway.set_provider_config", async () => {
    let received: any = null;
    const router = makeRouter({
      setProviderConfig: (input: any) => {
        received = input;
        return {
          providerId: input.providerId,
          model: input.model,
          hasApiKey: true,
          apiKeySecretRef: input.apiKeySecretRef,
          updatedAt: new Date().toISOString(),
          source: "runtime",
        };
      },
    });

    const msg = makeMessage(MessageTypes.GATEWAY_SET_PROVIDER_CONFIG, {
      providerId: "anthropic",
      model: "anthropic/claude-sonnet-4-5",
      apiKeySecretRef: "secretref-anthropic-primary",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_SET_PROVIDER_CONFIG);
    expect(received.apiKeySecretRef).toBe("secretref-anthropic-primary");
    expect((response?.payload as any).config.apiKeySecretRef).toBe("secretref-anthropic-primary");
  });

  test("validates providerId for gateway.remove_provider_config", async () => {
    const router = makeRouter({
      removeProviderConfig: () => {},
    });

    const msg = makeMessage(MessageTypes.GATEWAY_REMOVE_PROVIDER_CONFIG, {});
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
  });

  test("routes gateway.remove_provider_config", async () => {
    const removed: string[] = [];
    const router = makeRouter({
      removeProviderConfig: (providerId: string) => {
        removed.push(providerId);
      },
    });

    const msg = makeMessage(MessageTypes.GATEWAY_REMOVE_PROVIDER_CONFIG, {
      providerId: "openai",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_REMOVE_PROVIDER_CONFIG);
    expect(removed).toEqual(["openai"]);
    expect((response?.payload as any).providerId).toBe("openai");
  });

  test("returns NOT_AVAILABLE when gateway reset service is not configured", async () => {
    const router = makeRouter({});
    const msg = makeMessage(MessageTypes.GATEWAY_FACTORY_RESET, {
      confirmation: "DELETE resource:main",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("FAILED_PRECONDITION");
  });

  test("validates missing and blank confirmation for gateway.factory_reset", async () => {
    let calls = 0;
    const router = makeRouter(
      {},
      undefined,
      {
        factoryResetGateway: async () => {
          calls += 1;
          return {
            gatewayId: "resource:main",
            gatewayUuid: "11111111-2222-3333-4444-555555555555",
            resetAt: new Date().toISOString(),
            tablesCleared: 1,
            rowsDeleted: 1,
          };
        },
      },
    );

    const invalidMessages = [
      makeMessage(MessageTypes.GATEWAY_FACTORY_RESET, {}),
      makeMessage(MessageTypes.GATEWAY_FACTORY_RESET, { confirmation: "   " }),
    ];

    for (const msg of invalidMessages) {
      const response = await router.handle(makeClient({ publicKey: "principal-1" }), msg);
      expect(response?.type).toBe(MessageTypes.ERROR);
      expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
    }

    expect(calls).toBe(0);
  });

  test("routes gateway.factory_reset", async () => {
    let received: any = null;
    const router = makeRouter(
      {},
      undefined,
      {
        factoryResetGateway: async (input: any) => {
          received = input;
          return {
            gatewayId: "resource:main",
            gatewayUuid: "11111111-2222-3333-4444-555555555555",
            resetAt: "2026-02-27T10:00:00.000Z",
            tablesCleared: 12,
            rowsDeleted: 77,
          };
        },
      },
    );

    const msg = makeMessage(MessageTypes.GATEWAY_FACTORY_RESET, {
      confirmation: "DELETE resource:main",
      apiVersion: "v1",
    });
    const response = await router.handle(
      makeClient({ publicKey: "principal-1", deviceId: "device-1" }),
      msg,
    );

    expect(response?.type).toBe(MessageTypes.GATEWAY_FACTORY_RESET);
    expect(received).toEqual({
      apiVersion: "v1",
      confirmation: "DELETE resource:main",
      requestedBy: "principal-1",
      requestedDeviceId: "device-1",
    });
    expect((response?.payload as any).gatewayId).toBe("resource:main");
    expect((response?.payload as any).rowsDeleted).toBe(77);
  });

  test("validates localClientId for gateway.provision_local_profile", async () => {
    const router = makeRouter({
      provisionLocalProfile: async () => ({
        profileId: "local-claude-profile",
        profileName: "Claude Agent",
        created: true,
        providerId: "anthropic",
        model: "anthropic/claude-sonnet-4-5",
      }),
    });

    const msg = makeMessage(MessageTypes.GATEWAY_PROVISION_LOCAL_PROFILE, {
      profileId: "local-claude-profile",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
  });

  test("routes gateway.provision_local_profile", async () => {
    let received: any = null;
    const router = makeRouter({
      provisionLocalProfile: async (input: any) => {
        received = input;
        return {
          profileId: "local-claude-profile",
          profileName: "Claude Agent",
          created: true,
          providerId: "anthropic",
          model: "anthropic/claude-sonnet-4-5",
          agentId: "claude-agent",
          assignmentCreated: true,
        };
      },
    });

    const msg = makeMessage(MessageTypes.GATEWAY_PROVISION_LOCAL_PROFILE, {
      localClientId: "claude",
      profileId: "local-claude-profile",
      agentId: "claude-agent",
      spaceId: "main-space",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_PROVISION_LOCAL_PROFILE);
    expect(received.localClientId).toBe("claude");
    expect((response?.payload as any).assignmentCreated).toBe(true);
  });

  test("validates providerId and secret for gateway.put_secret_ref", async () => {
    const router = makeRouter({
      putSecretRef: () => ({
        secretRef: {
          secretRef: "secretref-openai-primary",
          providerId: "openai",
          label: "OpenAI Primary",
          backend: "gateway_encrypted",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        created: true,
      }),
    });

    const msg = makeMessage(MessageTypes.GATEWAY_PUT_SECRET_REF, {
      providerId: "openai",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
  });

  test("routes gateway.put_secret_ref", async () => {
    let received: any = null;
    const router = makeRouter({
      putSecretRef: (input: any) => {
        received = input;
        return {
          secretRef: {
            secretRef: "secretref-openai-primary",
            providerId: "openai",
            label: "OpenAI Primary",
            backend: "gateway_encrypted",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          created: true,
        };
      },
    });

    const msg = makeMessage(MessageTypes.GATEWAY_PUT_SECRET_REF, {
      providerId: "openai",
      label: "OpenAI Primary",
      secret: "sk-test",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_PUT_SECRET_REF);
    expect(received.secret).toBe("sk-test");
    expect((response?.payload as any).created).toBe(true);
    expect((response?.payload as any).secretRef.secretRef).toBe("secretref-openai-primary");
  });

  test("routes gateway.list_secret_refs", async () => {
    let receivedProviderId: string | undefined;
    const router = makeRouter({
      listSecretRefs: (providerId?: string) => {
        receivedProviderId = providerId;
        return [
          {
            secretRef: "secretref-openai-primary",
            providerId: "openai",
            label: "OpenAI Primary",
            backend: "gateway_encrypted",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ];
      },
    });

    const msg = makeMessage(MessageTypes.GATEWAY_LIST_SECRET_REFS, {
      providerId: "openai",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_LIST_SECRET_REFS);
    expect(receivedProviderId).toBe("openai");
    expect((response?.payload as any).secretRefs.length).toBe(1);
  });

  test("validates secretRef for gateway.delete_secret_ref", async () => {
    const router = makeRouter({
      deleteSecretRef: () => true,
    });

    const msg = makeMessage(MessageTypes.GATEWAY_DELETE_SECRET_REF, {});
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
  });

  test("routes gateway.delete_secret_ref", async () => {
    const deleted: string[] = [];
    const router = makeRouter({
      deleteSecretRef: (secretRef: string) => {
        deleted.push(secretRef);
        return true;
      },
    });

    const msg = makeMessage(MessageTypes.GATEWAY_DELETE_SECRET_REF, {
      secretRef: "secretref-openai-primary",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_DELETE_SECRET_REF);
    expect(deleted).toEqual(["secretref-openai-primary"]);
    expect((response?.payload as any).deleted).toBe(true);
  });

  test("returns FAILED_PRECONDITION when knowledge base service is not configured", async () => {
    const router = makeRouter({});
    const msg = makeMessage(MessageTypes.GATEWAY_KB_LIST_ENTRIES, {});
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("FAILED_PRECONDITION");
  });

  test("routes gateway.kb_list_entries", async () => {
    let received: any = null;
    const router = makeRouter(
      {},
      {
        listEntries: (input: any) => {
          received = input;
          return [
            {
              entryId: "kb-1",
              name: "Gateway Docs",
              kind: "web",
              uri: "https://example.com/docs",
              tags: ["docs"],
              scopeType: "global",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ];
        },
      },
    );

    const msg = makeMessage(MessageTypes.GATEWAY_KB_LIST_ENTRIES, {
      spaceId: "space-1",
      query: "gateway",
      tags: ["docs"],
      kinds: ["web"],
      limit: 25,
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_KB_LIST_ENTRIES);
    expect(received.spaceId).toBe("space-1");
    expect(received.query).toBe("gateway");
    expect(received.limit).toBe(25);
    expect((response?.payload as any).entries.length).toBe(1);
  });

  test("validates required fields for gateway.kb_upsert_entry", async () => {
    const router = makeRouter(
      {},
      {
        upsertEntry: () => ({}),
      },
    );

    const msg = makeMessage(MessageTypes.GATEWAY_KB_UPSERT_ENTRY, {
      name: "Missing fields",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
  });

  test("routes gateway.kb_upsert_entry", async () => {
    let received: any = null;
    const router = makeRouter(
      {},
      {
        upsertEntry: (input: any) => {
          received = input;
          return {
            entryId: "kb-2",
            name: input.name,
            kind: input.kind,
            uri: input.uri,
            description: input.description,
            tags: input.tags ?? [],
            scopeType: input.scopeType,
            spaceId: input.spaceId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        },
      },
    );

    const msg = makeMessage(MessageTypes.GATEWAY_KB_UPSERT_ENTRY, {
      name: "Space Runbook",
      kind: "file",
      uri: "file:///tmp/runbook.md",
      description: "Runbook",
      tags: ["runbook"],
      scopeType: "space",
      spaceId: "space-a",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_KB_UPSERT_ENTRY);
    expect(received.scopeType).toBe("space");
    expect(received.spaceId).toBe("space-a");
    expect((response?.payload as any).entry.entryId).toBe("kb-2");
  });

  test("validates entryId for gateway.kb_delete_entry", async () => {
    const router = makeRouter(
      {},
      {
        deleteEntry: () => true,
      },
    );

    const msg = makeMessage(MessageTypes.GATEWAY_KB_DELETE_ENTRY, {});
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
  });

  test("routes gateway.kb_delete_entry", async () => {
    const deleted: string[] = [];
    const router = makeRouter(
      {},
      {
        deleteEntry: (entryId: string) => {
          deleted.push(entryId);
          return true;
        },
      },
    );

    const msg = makeMessage(MessageTypes.GATEWAY_KB_DELETE_ENTRY, {
      entryId: "kb-3",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_KB_DELETE_ENTRY);
    expect(deleted).toEqual(["kb-3"]);
    expect((response?.payload as any).deleted).toBe(true);
  });
});
