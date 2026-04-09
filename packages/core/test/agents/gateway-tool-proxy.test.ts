import { createConnection } from "node:net";
import { describe, expect, test } from "bun:test";
import { GatewayToolProxy } from "../../src/agents/gateway-tool-proxy.js";
import type { ToolExecutor, ToolExecutionContext, ToolPermission } from "../../src/agents/tool-executor.js";
import type { ToolCall, ToolDefinition, ToolResult } from "../../src/agents/model-provider.js";

const EXECUTION_CONTEXT: ToolExecutionContext = {
  spaceId: "space-1",
  agentId: "agent-1",
  turnId: "turn-1",
  lineageId: "lineage-1",
};

async function invokeProxy(
  socketPath: string,
  payload: Record<string, unknown>,
): Promise<{ id: string; result: unknown; isError?: boolean }> {
  return await new Promise((resolve, reject) => {
    const conn = createConnection(socketPath);
    let data = "";

    conn.setEncoding("utf8");
    conn.on("connect", () => {
      conn.write(`${JSON.stringify(payload)}\n`);
    });
    conn.on("data", (chunk: string) => {
      data += chunk;
    });
    conn.on("end", () => {
      try {
        resolve(JSON.parse(data) as { id: string; result: unknown; isError?: boolean });
      } catch (error) {
        reject(error);
      }
    });
    conn.on("error", reject);
  });
}

function buildToolExecutor(input: {
  permission: ToolPermission;
  execute?: (toolCall: ToolCall, context: ToolExecutionContext) => Promise<ToolResult>;
}): ToolExecutor {
  return {
    async getAvailableTools(_spaceId: string, _agentId: string): Promise<ToolDefinition[]> {
      return [];
    },
    async checkPermission(_toolCall: ToolCall, _context: ToolExecutionContext): Promise<ToolPermission> {
      return input.permission;
    },
    async execute(toolCall: ToolCall, context: ToolExecutionContext): Promise<ToolResult> {
      if (!input.execute) {
        throw new Error("execute should not have been called");
      }
      return await input.execute(toolCall, context);
    },
  };
}

describe("GatewayToolProxy", () => {
  test("executes bridged tools when the gateway permission check allows them", async () => {
    const abortController = new AbortController();
    const toolExecutor = buildToolExecutor({
      permission: { toolName: "shell.jira.me", allowed: true },
      execute: async (toolCall, context) => {
        expect(toolCall.name).toBe("shell.jira.me");
        expect(context.spaceId).toBe("space-1");
        return {
          toolCallId: toolCall.id,
          result: { ok: true, tool: toolCall.name },
        };
      },
    });

    const proxy = await GatewayToolProxy.create(toolExecutor, EXECUTION_CONTEXT, abortController.signal);
    try {
      const response = await invokeProxy(proxy.socketPath, {
        type: "execute",
        id: "call-1",
        name: "shell.jira.me",
        arguments: {},
      });

      expect(response).toEqual({
        id: "call-1",
        result: { ok: true, tool: "shell.jira.me" },
        isError: false,
      });
    } finally {
      proxy.close();
      abortController.abort();
    }
  });

  test("returns an explicit error when the gateway denies a bridged tool", async () => {
    const abortController = new AbortController();
    const toolExecutor = buildToolExecutor({
      permission: {
        toolName: "shell.jira.me",
        allowed: false,
        reason: "Shell execution is disabled for this agent",
      },
    });

    const proxy = await GatewayToolProxy.create(toolExecutor, EXECUTION_CONTEXT, abortController.signal);
    try {
      const response = await invokeProxy(proxy.socketPath, {
        type: "execute",
        id: "call-2",
        name: "shell.jira.me",
        arguments: {},
      });

      expect(response.id).toBe("call-2");
      expect(response.isError).toBe(true);
      expect(response.result).toBe("Tool execution denied: Shell execution is disabled for this agent");
    } finally {
      proxy.close();
      abortController.abort();
    }
  });

  test("returns an explicit error when the gateway requires approval for a bridged tool", async () => {
    const abortController = new AbortController();
    const toolExecutor = buildToolExecutor({
      permission: {
        toolName: "shell.jira.me",
        allowed: true,
        requiresApproval: true,
        reason: "Dangerous capability managed_shell requires approval",
      },
    });

    const proxy = await GatewayToolProxy.create(toolExecutor, EXECUTION_CONTEXT, abortController.signal);
    try {
      const response = await invokeProxy(proxy.socketPath, {
        type: "execute",
        id: "call-3",
        name: "shell.jira.me",
        arguments: {},
      });

      expect(response.id).toBe("call-3");
      expect(response.isError).toBe(true);
      expect(response.result).toBe(
        "Tool execution requires approval: Dangerous capability managed_shell requires approval",
      );
    } finally {
      proxy.close();
      abortController.abort();
    }
  });
});
