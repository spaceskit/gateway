import { describe, expect, test } from "bun:test";
import { OpenAICompatibleModelProvider } from "../src/openai-compatible-provider.js";

describe("OpenAICompatibleModelProvider", () => {
  test("maps tool calls from chat completions responses", async () => {
    const provider = new OpenAICompatibleModelProvider({
      id: "openrouter",
      name: "OpenRouter",
      model: "openrouter/openai/gpt-4.1-mini",
      apiKey: "test-key",
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: "",
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: {
                name: "workspace_search",
                arguments: "{\"query\":\"app state\"}",
              },
            }],
          },
        }],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    });

    const result = await provider.generate("openrouter/openai/gpt-4.1-mini", {
      messages: [{ role: "user", content: "Search the repo" }],
      tools: [{
        name: "workspace_search",
        description: "Search files",
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
      }],
    });

    expect(result.finishReason).toBe("tool_calls");
    expect(result.message.toolCalls).toEqual([{
      id: "call-1",
      name: "workspace_search",
      arguments: { query: "app state" },
    }]);
    expect(result.usage?.totalTokens).toBe(16);
  });

  test("streams text deltas from SSE chat completions", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode([
          "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}",
          "",
          "data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}",
          "",
          "data: {\"choices\":[{\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":2,\"total_tokens\":4}}",
          "",
          "data: [DONE]",
          "",
        ].join("\n")));
        controller.close();
      },
    });

    const provider = new OpenAICompatibleModelProvider({
      id: "groq",
      name: "Groq",
      model: "groq/llama-3.3-70b-versatile",
      apiKey: "test-key",
      fetchImpl: async () => new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    });

    const chunks = [];
    for await (const chunk of provider.stream("groq/llama-3.3-70b-versatile", {
      messages: [{ role: "user", content: "Say hello" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: "text_delta", text: "Hel" },
      { type: "text_delta", text: "lo" },
      {
        type: "finish",
        usage: {
          promptTokens: 2,
          completionTokens: 2,
          totalTokens: 4,
          tokenAccuracy: "reported",
          usageSource: "ledger",
        },
        finishReason: "stop",
      },
    ]);
  });

  test("flushes a trailing SSE event without a final blank separator", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          "data: {\"choices\":[{\"delta\":{\"content\":\"tail\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":1,\"total_tokens\":2}}",
        ));
        controller.close();
      },
    });

    const provider = new OpenAICompatibleModelProvider({
      id: "groq",
      name: "Groq",
      model: "groq/llama-3.3-70b-versatile",
      apiKey: "test-key",
      fetchImpl: async () => new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    });

    const chunks = [];
    for await (const chunk of provider.stream("groq/llama-3.3-70b-versatile", {
      messages: [{ role: "user", content: "Say tail" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: "text_delta", text: "tail" },
      {
        type: "finish",
        usage: {
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
          tokenAccuracy: "reported",
          usageSource: "ledger",
        },
        finishReason: "stop",
      },
    ]);
  });

  test("rejects mismatched provider-prefixed model ids", async () => {
    const provider = new OpenAICompatibleModelProvider({
      id: "openai",
      name: "OpenAI",
      model: "openai/gpt-4.1",
      apiKey: "test-key",
      fetchImpl: async () => {
        throw new Error("should not fetch");
      },
    });

    await expect(provider.generate("groq/llama-3.3-70b-versatile", {
      messages: [{ role: "user", content: "Say hi" }],
    })).rejects.toThrow("does not belong to provider openai");
  });

  test("marks tool-unsupported bad requests with a dedicated error code", async () => {
    const provider = new OpenAICompatibleModelProvider({
      id: "lmstudio",
      name: "LM Studio",
      model: "lmstudio/qwen2.5-coder",
      fetchImpl: async () => new Response(JSON.stringify({
        error: { message: "This model does not support function calling or tools." },
      }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    });

    await expect(provider.generate("lmstudio/qwen2.5-coder", {
      messages: [{ role: "user", content: "Use the tool" }],
      tools: [{
        name: "workspace_search",
        description: "Search files",
        inputSchema: { type: "object", properties: {} },
      }],
    })).rejects.toMatchObject({
      code: "TOOLS_UNSUPPORTED",
    });
  });

  test("sends reasoning_effort for OpenAI o-series models when effort is set", async () => {
    let capturedBody: Record<string, unknown> | undefined;

    const provider = new OpenAICompatibleModelProvider({
      id: "openai",
      name: "OpenAI",
      model: "openai/o3",
      apiKey: "test-key",
      fetchImpl: async (_url, init) => {
        capturedBody = JSON.parse(init!.body as string) as Record<string, unknown>;
        return new Response(JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: "done" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    await provider.generate("openai/o3", {
      messages: [{ role: "user", content: "Think about this" }],
      effort: "high",
    });

    expect(capturedBody?.reasoning_effort).toBe("high");
  });

  test("maps effort 'max' to reasoning_effort 'high' for o-series", async () => {
    let capturedBody: Record<string, unknown> | undefined;

    const provider = new OpenAICompatibleModelProvider({
      id: "openai",
      name: "OpenAI",
      model: "openai/o4-mini",
      apiKey: "test-key",
      fetchImpl: async (_url, init) => {
        capturedBody = JSON.parse(init!.body as string) as Record<string, unknown>;
        return new Response(JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: "done" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    await provider.generate("openai/o4-mini", {
      messages: [{ role: "user", content: "Think about this" }],
      effort: "max",
    });

    expect(capturedBody?.reasoning_effort).toBe("high");
  });

  test("does NOT send reasoning_effort for non-o-series OpenAI models", async () => {
    let capturedBody: Record<string, unknown> | undefined;

    const provider = new OpenAICompatibleModelProvider({
      id: "openai",
      name: "OpenAI",
      model: "openai/gpt-4.1",
      apiKey: "test-key",
      fetchImpl: async (_url, init) => {
        capturedBody = JSON.parse(init!.body as string) as Record<string, unknown>;
        return new Response(JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: "done" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    await provider.generate("openai/gpt-4.1", {
      messages: [{ role: "user", content: "Think about this" }],
      effort: "high",
    });

    expect(capturedBody?.reasoning_effort).toBeUndefined();
  });

  test("does NOT send reasoning_effort for non-OpenAI providers", async () => {
    let capturedBody: Record<string, unknown> | undefined;

    const provider = new OpenAICompatibleModelProvider({
      id: "openrouter",
      name: "OpenRouter",
      model: "openrouter/openai/o3",
      apiKey: "test-key",
      fetchImpl: async (_url, init) => {
        capturedBody = JSON.parse(init!.body as string) as Record<string, unknown>;
        return new Response(JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: "done" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    await provider.generate("openrouter/openai/o3", {
      messages: [{ role: "user", content: "Think about this" }],
      effort: "high",
    });

    expect(capturedBody?.reasoning_effort).toBeUndefined();
  });
});
