/**
 * MCP Client capability bridge backed by `@ai-sdk/mcp`.
 *
 * This package isolates the remaining AI SDK dependency to capability
 * transport only. Model execution lives elsewhere.
 */

import type { CapabilityProvider, CapabilityType, ProviderSource } from "@spaceskit/core";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";

interface MCPClient {
  tools(): Promise<Record<string, unknown>>;
  close?(): Promise<void>;
}

interface MCPExecutableTool {
  execute?: (args: Record<string, unknown>) => Promise<unknown>;
  call?: (args: Record<string, unknown>) => Promise<unknown>;
  invoke?: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface MCPCapabilityConfig {
  id: string;
  name: string;
  transport: "sse" | "stdio";
  endpoint: string;
  args?: string[];
  headers?: Record<string, string>;
  env?: Record<string, string>;
  capabilityType: CapabilityType;
}

export class MCPCapabilityProvider implements CapabilityProvider {
  readonly id: string;
  readonly name: string;
  readonly source: ProviderSource = "connector";
  readonly capabilityType: CapabilityType;
  readonly operations: string[] = [];
  available = false;
  lastHealthCheck?: Date;

  private readonly config: MCPCapabilityConfig;
  private client: MCPClient | null = null;

  constructor(config: MCPCapabilityConfig) {
    this.id = config.id;
    this.name = config.name;
    this.capabilityType = config.capabilityType;
    this.config = config;
  }

  async connect(): Promise<void> {
    type MCPClientFactory = (config: Record<string, unknown>) => Promise<MCPClient>;
    let createMCPClient: MCPClientFactory | undefined;
    try {
      const mcpModule = await import("@ai-sdk/mcp" as string);
      createMCPClient = mcpModule.experimental_createMCPClient ?? mcpModule.createMCPClient;
    } catch {
      throw new Error("@ai-sdk/mcp package not found. Install it with: bun add @ai-sdk/mcp");
    }

    if (!createMCPClient) {
      throw new Error("createMCPClient not found in @ai-sdk/mcp");
    }

    this.client = this.config.transport === "sse"
      ? await createMCPClient({
        transport: {
          type: "sse",
          url: this.config.endpoint,
          headers: this.config.headers,
        },
      })
      : await createMCPClient({
        transport: new Experimental_StdioMCPTransport({
          command: this.config.endpoint,
          args: this.config.args,
          env: this.config.env,
          stderr: "pipe",
        }),
      });

    const tools = await this.client.tools();
    this.operations.length = 0;
    this.operations.push(...Object.keys(tools));
    this.available = true;
    this.lastHealthCheck = new Date();
  }

  async getTools(): Promise<Record<string, unknown>> {
    if (!this.client) {
      await this.connect();
    }
    return this.client!.tools();
  }

  async invoke(operation: string, args: Record<string, unknown>): Promise<unknown> {
    const tools = await this.getTools();
    const tool = tools[operation] as MCPExecutableTool | undefined;
    if (!tool) {
      throw new Error(`MCP operation not found: ${operation}`);
    }

    const executor = tool.execute ?? tool.call ?? tool.invoke;
    if (typeof executor !== "function") {
      throw new Error(`MCP operation is not executable: ${operation}`);
    }

    return executor(args ?? {});
  }

  async disconnect(): Promise<void> {
    if (this.client?.close) {
      await this.client.close();
    }
    this.client = null;
    this.available = false;
  }
}
