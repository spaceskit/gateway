import { describe, expect, test } from "bun:test";
import { MessageTypes } from "../src/protocol.js";
import { makeClient, makeMessage, makeRouter } from "./message-router-test-helpers.js";

describe("MessageRouter gateway admin provider config handlers", () => {
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
});
