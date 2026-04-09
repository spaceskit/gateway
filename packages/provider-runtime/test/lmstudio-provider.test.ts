import { describe, expect, test } from "bun:test";
import { ToolsUnsupportedError } from "../src/provider-errors.js";
import {
  LmStudioModelProvider,
  checkLmStudioAvailability,
  listLmStudioLoadedModels,
  normalizeLmStudioBaseURL,
} from "../src/lmstudio-provider.js";

function createPrediction(
  result: {
    content?: string;
    stats?: {
      stopReason?: string;
      promptTokensCount?: number;
      predictedTokensCount?: number;
      totalTokensCount?: number;
    };
  },
  fragments: Array<{ content?: string }> = [],
) {
  return {
    async result() {
      return result;
    },
    async *[Symbol.asyncIterator]() {
      for (const fragment of fragments) {
        yield fragment;
      }
    },
  };
}

describe("LmStudioModelProvider", () => {
  test("does not claim tool support when discovery falls back to the configured model", async () => {
    const provider = new LmStudioModelProvider({
      id: "lmstudio",
      name: "LM Studio",
      model: "lmstudio/qwen2.5-coder",
      clientFactory: async () => {
        throw new Error("LM Studio unavailable");
      },
    });

    const models = await provider.listModels();

    expect(models).toEqual([{
      id: "lmstudio/qwen2.5-coder",
      name: "qwen2.5-coder",
      provider: "lmstudio",
      isLocal: true,
      supportsTools: false,
    }]);
  });

  test("maps LM Studio raw tool callbacks into native tool calls", async () => {
    const provider = new LmStudioModelProvider({
      id: "lmstudio",
      name: "LM Studio",
      model: "lmstudio/qwen2.5-coder",
      clientFactory: async () => ({
        llm: {
          listLoaded: async () => [{
            identifier: "qwen2.5-coder",
            path: "qwen2.5-coder",
            modelKey: "qwen2.5-coder",
            displayName: "Qwen 2.5 Coder",
            trainedForToolUse: true,
            getModelInfo: async () => ({ maxContextLength: 65536 }),
            respond: (_chat, opts) => {
              (opts as Record<string, any>).onToolCallRequestEnd?.(1, {
                toolCallRequest: {
                  id: "call-1",
                  type: "function",
                  name: "lists_listLists",
                  arguments: {},
                },
                rawContent: "{\"name\":\"lists_listLists\"}",
              });
              return createPrediction({
                content: "",
                stats: {
                  stopReason: "toolCalls",
                  promptTokensCount: 12,
                  predictedTokensCount: 3,
                  totalTokensCount: 15,
                },
              });
            },
          }],
        },
      }),
    });

    const result = await provider.generate("lmstudio/qwen2.5-coder", {
      messages: [{ role: "user", content: "What are my reminder lists?" }],
      tools: [{
        name: "lists.listLists",
        description: "List reminder lists",
        inputSchema: { type: "object", properties: {} },
      }],
    });

    expect(result.finishReason).toBe("tool_calls");
    expect(result.message.toolCalls).toEqual([{
      id: expect.any(String),
      name: "lists.listLists",
      arguments: {},
    }]);
    expect(result.usage?.totalTokens).toBe(15);
  });

  test("throws tools unsupported when the loaded model is not trained for tool use", async () => {
    const provider = new LmStudioModelProvider({
      id: "lmstudio",
      name: "LM Studio",
      model: "lmstudio/qwen2.5-coder",
      clientFactory: async () => ({
        llm: {
          listLoaded: async () => [{
            identifier: "qwen2.5-coder",
            path: "qwen2.5-coder",
            modelKey: "qwen2.5-coder",
            displayName: "Qwen 2.5 Coder",
            trainedForToolUse: false,
            getModelInfo: async () => ({ maxContextLength: 65536 }),
            respond: () => {
              throw new Error("respond should not be called");
            },
          }],
        },
      }),
    });

    await expect(provider.generate("lmstudio/qwen2.5-coder", {
      messages: [{ role: "user", content: "Use a tool" }],
      tools: [{
        name: "files.read",
        description: "Read a file",
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
      }],
    })).rejects.toBeInstanceOf(ToolsUnsupportedError);
  });

  test("streams text deltas from LM Studio predictions", async () => {
    const provider = new LmStudioModelProvider({
      id: "lmstudio",
      name: "LM Studio",
      model: "lmstudio/qwen2.5-coder",
      clientFactory: async () => ({
        llm: {
          listLoaded: async () => [{
            identifier: "qwen2.5-coder",
            path: "qwen2.5-coder",
            modelKey: "qwen2.5-coder",
            displayName: "Qwen 2.5 Coder",
            trainedForToolUse: true,
            getModelInfo: async () => ({ maxContextLength: 65536 }),
            respond: () => createPrediction({
              content: "Hello",
              stats: {
                stopReason: "eosFound",
                promptTokensCount: 4,
                predictedTokensCount: 2,
                totalTokensCount: 6,
              },
            }, [
              { content: "Hel" },
              { content: "lo" },
            ]),
          }],
        },
      }),
    });

    const chunks = [];
    for await (const chunk of provider.stream("lmstudio/qwen2.5-coder", {
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
          promptTokens: 4,
          completionTokens: 2,
          totalTokens: 6,
          tokenAccuracy: "reported",
          usageSource: "ledger",
        },
        finishReason: "stop",
      },
    ]);
  });

  test("folds system prompts into the next LM Studio text turn instead of emitting raw system role entries", async () => {
    let receivedChat: unknown;
    const provider = new LmStudioModelProvider({
      id: "lmstudio",
      name: "LM Studio",
      model: "lmstudio/qwen2.5-coder",
      clientFactory: async () => ({
        llm: {
          listLoaded: async () => [{
            identifier: "qwen2.5-coder",
            path: "qwen2.5-coder",
            modelKey: "qwen2.5-coder",
            displayName: "Qwen 2.5 Coder",
            trainedForToolUse: true,
            getModelInfo: async () => ({ maxContextLength: 65536 }),
            respond: (chat) => {
              receivedChat = chat;
              return createPrediction({
                content: "Hello",
                stats: {
                  stopReason: "eosFound",
                  promptTokensCount: 4,
                  predictedTokensCount: 2,
                  totalTokensCount: 6,
                },
              });
            },
          }],
        },
      }),
    });

    await provider.generate("lmstudio/qwen2.5-coder", {
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Say hello" },
      ],
    });

    expect(receivedChat).toEqual({
      messages: [{
        role: "user",
        content: [{
          type: "text",
          text: "System instructions:\nYou are helpful.\n\nUser request:\nSay hello",
        }],
      }],
    });
  });
});

describe("LM Studio helpers", () => {
  test("normalizes legacy HTTP base URLs to SDK websocket URLs", () => {
    expect(normalizeLmStudioBaseURL("http://127.0.0.1:1234/v1")).toBe("ws://127.0.0.1:1234");
    expect(normalizeLmStudioBaseURL("ws://127.0.0.1:1234")).toBe("ws://127.0.0.1:1234");
  });

  test("lists loaded LM Studio models and availability through the shared helper", async () => {
    const clientFactory = async () => ({
      llm: {
        listLoaded: async () => [{
          identifier: "google/gemma-3-4b",
          path: "google/gemma-3-4b",
          modelKey: "google/gemma-3-4b",
          displayName: "Gemma 3 4B",
          trainedForToolUse: true,
          getModelInfo: async () => ({ maxContextLength: 131072 }),
          respond: () => createPrediction({}),
        }],
      },
    });

    const models = await listLmStudioLoadedModels({ clientFactory });
    expect(models).toEqual([{
      id: "google/gemma-3-4b",
      modelKey: "google/gemma-3-4b",
      name: "Gemma 3 4B",
      contextWindow: 131072,
      supportsTools: true,
    }]);

    const availability = await checkLmStudioAvailability({ clientFactory });
    expect(availability.available).toBe(true);
    expect(availability.models).toHaveLength(1);
  });
});
