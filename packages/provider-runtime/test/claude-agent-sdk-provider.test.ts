import { describe, expect, test } from "bun:test";
import type { StreamChunk } from "@spaceskit/core";
import { ClaudeAgentSdkModelProvider } from "../src/claude-agent-sdk-provider.js";

async function collectChunks(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

async function* streamMessages(...messages: any[]): AsyncIterable<any> {
  for (const message of messages) {
    yield message;
  }
}

describe("ClaudeAgentSdkModelProvider", () => {
  test("discovers SDK models and prefers host login without injecting API keys", async () => {
    let capturedParams: Record<string, any> | undefined;
    let closed = false;

    const metadataQuery = Object.assign(streamMessages(), {
      supportedModels: async () => ([
        {
          value: "claude-sonnet-4-6",
          displayName: "Claude Sonnet 4.6",
          description: "Balanced reasoning and speed",
        },
        {
          value: "claude-opus-4-6",
          displayName: "Claude Opus 4.6",
          description: "Highest capability reasoning",
        },
      ]),
      accountInfo: async () => ({
        email: "agent@example.com",
        organization: "Acme",
        subscriptionType: "max",
        tokenSource: "oauth",
        apiProvider: "firstParty",
      }),
      close: async () => {
        closed = true;
      },
    });

    const provider = new ClaudeAgentSdkModelProvider({
      id: "claude-agent-sdk",
      name: "Claude Agent SDK",
      model: "claude-agent-sdk/claude-sonnet-4-5",
      authMode: "host_login",
      queryImpl: (params) => {
        capturedParams = params as Record<string, any>;
        return metadataQuery as any;
      },
    });

    const models = await provider.listModels();

    expect(models.map((entry) => entry.id)).toEqual([
      "claude-agent-sdk/claude-sonnet-4-6",
      "claude-agent-sdk/claude-opus-4-6",
    ]);
    expect(capturedParams?.options?.env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(capturedParams?.options?.settings).toMatchObject({
      forceLoginMethod: "claudeai",
    });
    expect(capturedParams?.options?.settingSources).toEqual(["user", "project", "local"]);
    expect(closed).toBe(true);
  });

  test("maps SDK partial messages, MCP tool activity, and usage into gateway stream chunks", async () => {
    let capturedParams: Record<string, any> | undefined;

    const provider = new ClaudeAgentSdkModelProvider({
      id: "claude-agent-sdk",
      name: "Claude Agent SDK",
      model: "claude-agent-sdk/claude-sonnet-4-5",
      apiKey: "sk-anthropic-test",
      queryImpl: (params) => {
        capturedParams = params as Record<string, any>;
        return streamMessages(
          {
            type: "stream_event",
            event: {
              type: "content_block_start",
              index: 0,
              content_block: {
                type: "mcp_tool_use",
                id: "call-1",
                name: "workspace_search",
                server_name: "spaceskit-gateway",
                input: {},
              },
            },
            parent_tool_use_id: null,
            uuid: "msg-1",
            session_id: "session-1",
          },
          {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              index: 0,
              delta: {
                type: "input_json_delta",
                partial_json: "{\"query\":\"claude agent sdk\"}",
              },
            },
            parent_tool_use_id: null,
            uuid: "msg-2",
            session_id: "session-1",
          },
          {
            type: "stream_event",
            event: {
              type: "content_block_stop",
              index: 0,
            },
            parent_tool_use_id: null,
            uuid: "msg-3",
            session_id: "session-1",
          },
          {
            type: "user",
            message: { role: "user", content: [{ type: "text", text: "tool result" }] },
            parent_tool_use_id: "call-1",
            tool_use_result: {
              matches: ["gateway/packages/provider-runtime/src/index.ts"],
            },
            isSynthetic: true,
            uuid: "msg-4",
            session_id: "session-1",
          },
          {
            type: "stream_event",
            event: {
              type: "content_block_start",
              index: 1,
              content_block: {
                type: "text",
                text: "",
              },
            },
            parent_tool_use_id: null,
            uuid: "msg-5",
            session_id: "session-1",
          },
          {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              index: 1,
              delta: {
                type: "text_delta",
                text: "Done",
              },
            },
            parent_tool_use_id: null,
            uuid: "msg-6",
            session_id: "session-1",
          },
          {
            type: "stream_event",
            event: {
              type: "content_block_stop",
              index: 1,
            },
            parent_tool_use_id: null,
            uuid: "msg-7",
            session_id: "session-1",
          },
          {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "Done",
            stop_reason: "end_turn",
            usage: {
              input_tokens: 11,
              output_tokens: 7,
              cache_read_input_tokens: 2,
              cache_creation_input_tokens: 1,
            },
            modelUsage: {},
            permission_denials: [],
            total_cost_usd: 0,
            duration_ms: 1,
            duration_api_ms: 1,
            num_turns: 1,
            uuid: "msg-8",
            session_id: "session-1",
          },
        );
      },
    });

    const chunks = await collectChunks(provider.stream("claude-agent-sdk/claude-sonnet-4-5", {
      messages: [{ role: "user", content: "Search the provider runtime" }],
      workingDirectory: "/tmp/spaces-workspace",
      accessMode: "default",
      effort: "medium",
      mcpBridgeConfig: {
        bridgeScriptPath: "/tmp/gateway-mcp-bridge.ts",
        toolDefsJson: "[{\"name\":\"workspace_search\"}]",
        socketPath: "/tmp/spaceskit.sock",
      },
      thinkingConfig: {
        enabled: true,
        budgetTokens: 4096,
        display: "summarized",
      },
    }));

    expect(capturedParams?.prompt).toContain("Search the provider runtime");
    expect(capturedParams?.options?.model).toBe("claude-sonnet-4-5");
    expect(capturedParams?.options?.cwd).toBe("/tmp/spaces-workspace");
    expect(capturedParams?.options?.includePartialMessages).toBe(true);
    expect(capturedParams?.options?.permissionMode).toBe("default");
    expect(capturedParams?.options?.tools).toEqual(["Read", "Glob", "Grep", "WebSearch", "WebFetch"]);
    expect(capturedParams?.options?.thinking).toEqual({
      type: "enabled",
      budgetTokens: 4096,
      display: "summarized",
    });
    expect(capturedParams?.options?.effort).toBe("medium");
    expect(capturedParams?.options?.mcpServers).toEqual({
      "spaceskit-gateway": {
        command: "bun",
        args: ["run", "/tmp/gateway-mcp-bridge.ts"],
        env: {
          GATEWAY_TOOLS_JSON: "[{\"name\":\"workspace_search\"}]",
          GATEWAY_SOCKET_PATH: "/tmp/spaceskit.sock",
        },
      },
    });
    expect(capturedParams?.options?.env?.ANTHROPIC_API_KEY).toBe("sk-anthropic-test");

    expect(chunks).toEqual([
      {
        type: "tool_call_start",
        toolCall: {
          id: "call-1",
          name: "workspace_search",
          arguments: {},
        },
      },
      {
        type: "tool_call_delta",
        toolCall: {
          id: "call-1",
          name: "workspace_search",
          arguments: {},
        },
        text: "{\"query\":\"claude agent sdk\"}",
      },
      {
        type: "tool_call_end",
        toolCall: {
          id: "call-1",
          name: "workspace_search",
          arguments: {
            query: "claude agent sdk",
          },
        },
      },
      {
        type: "tool_result",
        toolResult: {
          toolCallId: "call-1",
          result: {
            matches: ["gateway/packages/provider-runtime/src/index.ts"],
          },
        },
      },
      {
        type: "text_delta",
        text: "Done",
      },
      {
        type: "finish",
        usage: {
          promptTokens: 11,
          completionTokens: 7,
          totalTokens: 18,
          tokenAccuracy: "reported",
          usageSource: "ledger",
          usageDetails: {
            inputNoCacheTokens: 8,
            inputCacheReadTokens: 2,
            inputCacheWriteTokens: 1,
            outputTextTokens: 7,
          },
        },
        finishReason: "stop",
      },
    ]);
  });

  test("maps full_access approvals and finish usage for generate()", async () => {
    let capturedParams: Record<string, any> | undefined;

    const provider = new ClaudeAgentSdkModelProvider({
      id: "claude-agent-sdk",
      name: "Claude Agent SDK",
      model: "claude-agent-sdk/claude-sonnet-4-5",
      apiKey: "sk-anthropic-test",
      queryImpl: (params) => {
        capturedParams = params as Record<string, any>;
        return streamMessages({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "done",
          stop_reason: "end_turn",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
          modelUsage: {},
          permission_denials: [],
          total_cost_usd: 0,
          duration_ms: 1,
          duration_api_ms: 1,
          num_turns: 1,
          uuid: "msg-9",
          session_id: "session-2",
        });
      },
    });

    const result = await provider.generate("claude-agent-sdk/claude-sonnet-4-5", {
      messages: [{ role: "user", content: "Say done" }],
      accessMode: "full_access",
      approvalBypassEnabled: true,
      effort: "high",
      thinkingConfig: {
        enabled: true,
        budgetTokens: 16_384,
        display: "summarized",
      },
    });

    expect(capturedParams?.options?.permissionMode).toBe("bypassPermissions");
    expect(capturedParams?.options?.allowDangerouslySkipPermissions).toBe(true);
    expect(capturedParams?.options?.tools).toEqual({
      type: "preset",
      preset: "claude_code",
    });
    expect(capturedParams?.options?.effort).toBe("high");
    expect(capturedParams?.options?.thinking).toEqual({
      type: "enabled",
      budgetTokens: 16_384,
      display: "summarized",
    });

    expect(result).toEqual({
      message: {
        role: "assistant",
        content: "done",
      },
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        tokenAccuracy: "reported",
        usageSource: "ledger",
        usageDetails: {
          inputNoCacheTokens: 10,
          inputCacheReadTokens: 0,
          inputCacheWriteTokens: 0,
          outputTextTokens: 5,
        },
      },
      finishReason: "stop",
    });
  });
});
