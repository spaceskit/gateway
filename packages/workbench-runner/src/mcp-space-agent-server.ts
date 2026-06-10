#!/usr/bin/env bun

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const REMOTE_AGENT_ID = "workbench-remote-agent";
const REMOTE_AGENT_DISPLAY_NAME = "Workbench Remote Agent";

const server = new McpServer({
  name: "workbench-space-agent",
  version: "1.0.0",
});

server.tool(
  "spaceskit.agent.list",
  "List deterministic remote agents for workbench chat testing.",
  {},
  async () => {
    const structuredContent = {
      agents: [
        {
          remoteAgentId: REMOTE_AGENT_ID,
          displayName: REMOTE_AGENT_DISPLAY_NAME,
          description: "Deterministic remote MCP agent used by the headless workbench harness.",
        },
      ],
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(structuredContent),
        },
      ],
      structuredContent,
    };
  },
);

server.tool(
  "spaceskit.agent.execute_turn",
  "Execute a deterministic remote-agent turn and echo the latest user input.",
  {
    remoteAgentId: z.string(),
    turnId: z.string(),
    messages: z.array(z.object({
      role: z.string(),
      content: z.string(),
    }).passthrough()).default([]),
  },
  async (args) => {
    const lastUserMessage = [...args.messages]
      .reverse()
      .find((message) => message.role === "user");
    const prompt = lastUserMessage?.content ?? "";
    const finalText = `[${args.remoteAgentId}] ${prompt}`;
    const structuredContent = {
      outputText: finalText,
      finalMessage: {
        role: "assistant",
        content: finalText,
      },
      messages: [
        ...args.messages,
        {
          role: "assistant",
          content: finalText,
        },
      ],
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      metadata: {
        finishReason: "stop",
      },
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(structuredContent),
        },
      ],
      structuredContent,
    };
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
