import { describe, expect, test } from "bun:test";
import { MessageTypes, type GatewayMessage } from "../src/protocol.js";
import { makeClient, makeMessage, makeRouter } from "./message-router-test-helpers.js";

describe("MessageRouter gateway admin agent management handlers", () => {
  test("routes gateway.set_runtime_defaults", async () => {
    const nowIso = new Date().toISOString();
    const calls: any[] = [];
    const router = makeRouter({
      setRuntimeDefaults: async (input: any) => {
        calls.push(input);
        return {
          defaults: {
            main: {
              providerId: "codex-app-server",
              modelId: "codex-app-server/gpt-5.4",
            },
            concierge: {
              providerId: "openai",
              modelId: "openai/gpt-4.1",
            },
            updatedAt: nowIso,
          },
          mainAgentState: {
            spaceId: "main-space",
            spaceUid: "11111111-2222-3333-4444-555555555555",
            mainAgentId: "main-agent",
            mainProfileId: "main-profile",
            providerHint: "codex-app-server",
            modelHint: "codex-app-server/gpt-5.4",
            status: "healthy",
            repaired: false,
            fallbackApplied: false,
            updatedAt: nowIso,
          },
          conciergeAgentState: {
            spaceId: "concierge-space",
            spaceUid: "aaaa1111-2222-3333-4444-555555555555",
            conciergeAgentId: "concierge-agent",
            conciergeProfileId: "concierge-profile",
            providerHint: "openai",
            modelHint: "openai/gpt-4.1",
            status: "healthy",
            repaired: false,
            fallbackApplied: false,
            updatedAt: nowIso,
          },
        };
      },
    });

    const msg = makeMessage(MessageTypes.GATEWAY_SET_RUNTIME_DEFAULTS, {
      main: {
        providerId: "codex-app-server",
        modelId: "codex-app-server/gpt-5.4",
      },
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_SET_RUNTIME_DEFAULTS);
    expect((response?.payload as any).defaults.main.modelId).toBe("codex-app-server/gpt-5.4");
    expect((response?.payload as any).mainAgentState.providerHint).toBe("codex-app-server");
    expect(calls).toEqual([{
      main: {
        providerId: "codex-app-server",
        modelId: "codex-app-server/gpt-5.4",
      },
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
});
