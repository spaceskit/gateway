import { describe, expect, test } from "bun:test";
import { MessageTypes } from "../src/protocol.js";
import { makeClient, makeMessage, makeRouter } from "./message-router-test-helpers.js";

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

  test("routes gateway.get_runtime_defaults", async () => {
    const nowIso = new Date().toISOString();
    const calls: any[] = [];
    const router = makeRouter({
      getRuntimeDefaults: async (input: any) => {
        calls.push(input);
        return {
          main: {
            providerId: "codex-app-server",
            modelId: "codex-app-server/gpt-5.4",
          },
          concierge: {
            providerId: "openai",
            modelId: "openai/gpt-4.1",
          },
          updatedAt: nowIso,
        };
      },
    });

    const msg = makeMessage(MessageTypes.GATEWAY_GET_RUNTIME_DEFAULTS, {});
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_GET_RUNTIME_DEFAULTS);
    expect((response?.payload as any).defaults.main.providerId).toBe("codex-app-server");
    expect((response?.payload as any).defaults.concierge.modelId).toBe("openai/gpt-4.1");
    expect(calls).toHaveLength(1);
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
});
