/**
 * GatewayToolProxy — Unix domain socket server that proxies tool execution
 * requests from the MCP bridge subprocess back to the gateway's tool executor.
 *
 * Protocol: newline-delimited JSON over Unix socket.
 * - Request:  { "type": "execute", "id": "...", "name": "shell.jira-search", "arguments": {...} }
 * - Response: { "id": "...", "result": {...}, "isError": false }
 *
 * Each connection handles exactly one tool call then closes.
 */
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import type { Server, Socket } from "node:net";
import type { ToolExecutor, ToolExecutionContext } from "./tool-executor.js";

interface ProxyRequest {
  type: "execute";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export class GatewayToolProxy {
  private readonly server: Server;
  private readonly path: string;
  private readonly toolExecutor: ToolExecutor;
  private readonly executionContext: ToolExecutionContext;
  private closed = false;

  private constructor(
    server: Server,
    path: string,
    toolExecutor: ToolExecutor,
    executionContext: ToolExecutionContext,
  ) {
    this.server = server;
    this.path = path;
    this.toolExecutor = toolExecutor;
    this.executionContext = executionContext;
  }

  get socketPath(): string {
    return this.path;
  }

  static async create(
    toolExecutor: ToolExecutor,
    executionContext: ToolExecutionContext,
    signal: AbortSignal,
  ): Promise<GatewayToolProxy> {
    const socketName = `spaceskit-mcp-bridge-${randomUUID().slice(0, 8)}.sock`;
    const socketPath = join(tmpdir(), socketName);

    const server = createServer();
    const proxy = new GatewayToolProxy(server, socketPath, toolExecutor, executionContext);

    server.on("connection", (socket: Socket) => {
      proxy.handleConnection(socket);
    });

    signal.addEventListener("abort", () => {
      proxy.close();
    }, { once: true });

    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(socketPath, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });

    return proxy;
  }

  private handleConnection(socket: Socket): void {
    let data = "";
    socket.setEncoding("utf8");

    socket.on("data", (chunk: string) => {
      data += chunk;
      // Check for newline delimiter
      const newlineIdx = data.indexOf("\n");
      if (newlineIdx !== -1) {
        const line = data.slice(0, newlineIdx).trim();
        data = data.slice(newlineIdx + 1);
        if (line) {
          this.handleRequest(line, socket);
        }
      }
    });

    socket.on("end", () => {
      // If we got data without a newline, try to process it
      const trimmed = data.trim();
      if (trimmed) {
        this.handleRequest(trimmed, socket);
      }
    });

    socket.on("error", () => {
      // Connection dropped — nothing to do
    });
  }

  private async handleRequest(raw: string, socket: Socket): Promise<void> {
    let request: ProxyRequest;
    try {
      request = JSON.parse(raw) as ProxyRequest;
    } catch {
      const errorResp = JSON.stringify({ id: "", result: "Invalid JSON request", isError: true });
      socket.end(errorResp);
      return;
    }

    if (request.type !== "execute" || !request.name) {
      const errorResp = JSON.stringify({ id: request.id ?? "", result: "Invalid request type", isError: true });
      socket.end(errorResp);
      return;
    }

    try {
      const toolCall = {
        id: request.id,
        name: request.name,
        arguments: request.arguments ?? {},
      };

      const permission = await this.toolExecutor.checkPermission(toolCall, this.executionContext);
      if (!permission.allowed) {
        const response = JSON.stringify({
          id: request.id,
          result: `Tool execution denied: ${permission.reason ?? `Tool "${request.name}" is not allowed in this turn.`}`,
          isError: true,
        });
        socket.end(response);
        return;
      }

      if (permission.requiresApproval) {
        const response = JSON.stringify({
          id: request.id,
          result: `Tool execution requires approval: ${permission.reason ?? `Tool "${request.name}" requires approval before it can run through the Claude MCP bridge.`}`,
          isError: true,
        });
        socket.end(response);
        return;
      }

      const result = await this.toolExecutor.execute(toolCall, this.executionContext);
      const response = JSON.stringify({
        id: request.id,
        result: result.result,
        isError: result.isError === true,
      });
      socket.end(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorResp = JSON.stringify({
        id: request.id,
        result: `Tool execution error: ${message}`,
        isError: true,
      });
      socket.end(errorResp);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.server.close();
    // Best-effort cleanup of socket file
    unlink(this.path).catch(() => {});
  }
}
