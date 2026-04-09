import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CapabilityProvider, CapabilityType, ProviderSource } from "@spaceskit/core";

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

interface ToolDescriptor {
  operation: string;
  remoteName: string;
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
  private readonly toolDescriptors = new Map<string, ToolDescriptor>();
  private client: Client | null = null;
  private transport: Transport | null = null;

  constructor(config: MCPCapabilityConfig) {
    this.id = config.id;
    this.name = config.name;
    this.capabilityType = config.capabilityType;
    this.config = config;
  }

  async connect(): Promise<void> {
    const candidates = this.createTransportCandidates();
    let lastError: unknown;

    for (const transport of candidates) {
      const client = new Client({
        name: "spaceskit-mcp-runtime",
        version: "0.1.0",
      });

      try {
        await client.connect(transport);
        const tools = await this.listAllTools(client);
        const serverSlug = normalizeServerSlug(this.id);

        this.toolDescriptors.clear();
        this.operations.length = 0;
        for (const tool of tools) {
          const operation = `${serverSlug}__${normalizeToolSlug(tool.name)}`;
          this.toolDescriptors.set(operation, {
            operation,
            remoteName: tool.name,
          });
          this.operations.push(operation);
        }

        this.client = client;
        this.transport = transport;
        this.available = true;
        this.lastHealthCheck = new Date();
        return;
      } catch (error) {
        lastError = error;
        await safelyCloseTransport(transport);
        await safelyCloseClient(client);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async invoke(operation: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) {
      await this.connect();
    }

    const descriptor = this.toolDescriptors.get(operation)
      ?? Array.from(this.toolDescriptors.values()).find((entry) => entry.remoteName === operation);
    if (!descriptor) {
      throw new Error(`MCP operation not found: ${operation}`);
    }

    return this.client!.callTool({
      name: descriptor.remoteName,
      arguments: args ?? {},
    });
  }

  async disconnect(): Promise<void> {
    await safelyCloseClient(this.client);
    this.client = null;
    await safelyCloseTransport(this.transport);
    this.transport = null;
    this.available = false;
  }

  private createTransportCandidates(): Transport[] {
    if (this.config.transport === "stdio") {
      return [new StdioClientTransport({
        command: this.config.endpoint,
        args: this.config.args,
        env: this.config.env,
        stderr: "pipe",
      })];
    }

    const requestInit = this.config.headers
      ? { headers: this.config.headers }
      : undefined;
    const endpointUrl = new URL(this.config.endpoint);
    return [
      new StreamableHTTPClientTransport(endpointUrl, { requestInit }),
      new SSEClientTransport(endpointUrl, { requestInit }),
    ];
  }

  private async listAllTools(client: Client): Promise<Array<{ name: string }>> {
    const collected: Array<{ name: string }> = [];
    let cursor: string | undefined;

    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      collected.push(...page.tools.map((tool) => ({ name: tool.name })));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    return collected;
  }
}

async function safelyCloseClient(client: Client | null): Promise<void> {
  if (!client) return;
  const close = (client as unknown as { close?: () => Promise<void> }).close;
  if (typeof close === "function") {
    await close.call(client).catch(() => undefined);
  }
}

async function safelyCloseTransport(transport: Transport | null): Promise<void> {
  if (!transport) return;
  await transport.close().catch(() => undefined);
}

function normalizeServerSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^mcp-space-/, "space-")
    .replace(/^mcp$/, "global")
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "server";
}

function normalizeToolSlug(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "tool";
}
