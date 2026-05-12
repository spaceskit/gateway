import { describe, expect, test } from "bun:test";
import { MessageTypes } from "../src/protocol.js";
import { makeClient, makeMessage, makeRouter } from "./message-router-test-helpers.js";

describe("MessageRouter gateway admin telemetry handlers", () => {
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

  test("routes gateway.get_local_usage_telemetry with providerIds batch", async () => {
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
        {
          providerId: "openai",
          model: "openai/gpt-4.1",
          hasApiKey: true,
          updatedAt: new Date().toISOString(),
          source: "runtime",
        },
        {
          providerId: "claude",
          model: "claude/sonnet",
          hasApiKey: false,
          updatedAt: new Date().toISOString(),
          source: "runtime",
        },
      ],
      getLocalUsageTelemetry: async (input: any) => {
        received = input;
        return [];
      },
    });

    const msg = makeMessage(MessageTypes.GATEWAY_GET_LOCAL_USAGE_TELEMETRY, {
      providerIds: ["codex", "openai"],
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_GET_LOCAL_USAGE_TELEMETRY);
    expect(received.providerIds).toEqual(["codex", "openai"]);
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
});
