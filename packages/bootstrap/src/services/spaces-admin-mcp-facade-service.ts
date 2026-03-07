import type { OrchestratorCommandService } from "./orchestrator-command-service.js";
import {
  resolveHttpPrincipalContext,
  type HttpPrincipalAuthOptions,
} from "./http-principal-auth.js";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface SpacesAdminMcpFacadeServiceOptions {
  orchestratorCommandService: Pick<OrchestratorCommandService, "submitCommand">;
  defaultTargetSpaceId: string;
  principalAuth?: HttpPrincipalAuthOptions;
  /**
   * If true, tool calls require an authenticated principal identity from headers.
   */
  requireAuthenticatedPrincipal?: boolean;
}

export class SpacesAdminMcpFacadeService {
  constructor(private readonly options: SpacesAdminMcpFacadeServiceOptions) {}

  async handleRequest(req: Request, url: URL): Promise<Response | null> {
    if (url.pathname !== "/mcp/spaces-admin") {
      return null;
    }
    if (req.method !== "POST") {
      return jsonResponse({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32600,
          message: "Method not allowed",
        },
      }, 405);
    }

    const auth = resolveHttpPrincipalContext(req, this.options.principalAuth);
    if (!auth.ok) {
      return jsonResponse({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: mapErrorCode(auth.error.code),
          message: auth.error.message,
          data: { code: auth.error.code },
        },
      }, 401);
    }
    const authContext = {
      principalId: auth.context.principalId,
      deviceId: auth.context.deviceId,
    };

    if (this.options.requireAuthenticatedPrincipal && !authContext.principalId) {
      return jsonResponse({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: mapErrorCode("UNAUTHENTICATED"),
          message: "Authentication required",
          data: { code: "UNAUTHENTICATED" },
        },
      }, 401);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: "Parse error",
        },
      }, 400);
    }

    if (!isRecord(body)) {
      return jsonResponse({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32600,
          message: "Invalid request",
        },
      }, 400);
    }

    return this.handleJsonRpc(body as JsonRpcRequest, authContext);
  }

  private async handleJsonRpc(
    request: JsonRpcRequest,
    authContext: { principalId?: string; deviceId?: string },
  ): Promise<Response> {
    const id = request.id ?? null;
    const method = normalizeOptionalString(request.method);
    if (!method) {
      return jsonResponse({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32600,
          message: "Invalid request method",
        },
      }, 400);
    }

    try {
      switch (method) {
        case "initialize":
          return jsonResponse({
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: "2024-11-05",
              serverInfo: {
                name: "spaces-admin",
                version: "0.1.0",
              },
              capabilities: {
                tools: {},
              },
            },
          });
        case "tools/list":
          return jsonResponse({
            jsonrpc: "2.0",
            id,
            result: {
              tools: buildToolList(),
            },
          });
        case "tools/call": {
          const params = isRecord(request.params) ? request.params : {};
          const name = normalizeOptionalString(params.name);
          const rawArgs = isRecord(params.arguments) ? params.arguments : {};
          if (!name) {
            return jsonResponse({
              jsonrpc: "2.0",
              id,
              error: {
                code: -32602,
                message: "tools/call requires params.name",
              },
            }, 400);
          }

          const callResult = await this.invokeTool(name, rawArgs, authContext);
          return jsonResponse({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(callResult),
                },
              ],
              isError: false,
            },
          });
        }
        default:
          return jsonResponse({
            jsonrpc: "2.0",
            id,
            error: {
              code: -32601,
              message: `Method not found: ${method}`,
            },
          }, 404);
      }
    } catch (error) {
      const code = isRecord(error) && typeof error.code === "string" ? error.code : "INTERNAL";
      const message = error instanceof Error ? error.message : "Unexpected error";
      return jsonResponse({
        jsonrpc: "2.0",
        id,
        error: {
          code: mapErrorCode(code),
          message,
          data: { code },
        },
      }, mapHttpStatus(code));
    }
  }

  private async invokeTool(
    toolName: string,
    args: Record<string, unknown>,
    authContext: { principalId?: string; deviceId?: string },
  ): Promise<unknown> {
    const mapping = mapToolToCommand(toolName);
    if (!mapping) {
      throw new Error(`Unsupported tool: ${toolName}`);
    }

    const targetSpaceId = normalizeOptionalString(args.targetSpaceId)
      ?? this.options.defaultTargetSpaceId;
    const payload = { ...args };
    delete payload.targetSpaceId;

    const result = await this.options.orchestratorCommandService.submitCommand({
      commandType: mapping,
      targetSpaceId,
      principalId: authContext.principalId,
      deviceId: authContext.deviceId,
      correlationId: normalizeOptionalString(args.correlationId),
      idempotencyKey: normalizeOptionalString(args.idempotencyKey),
      payload,
    });
    return result;
  }
}

function buildToolList(): Array<Record<string, unknown>> {
  return [
    {
      name: "spaces.admin.list_rooms",
      description: "List available rooms/spaces from the main orchestrator control plane.",
      inputSchema: {
        type: "object",
        properties: {
          targetSpaceId: { type: "string" },
          statuses: { type: "array", items: { type: "string" } },
          resourceId: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
    {
      name: "spaces.admin.create_room",
      description: "Create a room/space.",
      inputSchema: {
        type: "object",
        properties: {
          targetSpaceId: { type: "string" },
          resourceId: { type: "string" },
          name: { type: "string" },
          spaceId: { type: "string" },
          spaceType: { type: "string" },
          goal: { type: "string" },
        },
        required: ["resourceId", "name"],
      },
    },
    {
      name: "spaces.admin.list_skills",
      description: "List gateway-level skills.",
      inputSchema: {
        type: "object",
        properties: {
          targetSpaceId: { type: "string" },
          query: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          status: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
    {
      name: "spaces.admin.create_skill",
      description: "Create a gateway-level skill.",
      inputSchema: {
        type: "object",
        properties: {
          targetSpaceId: { type: "string" },
          skillId: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          contentMarkdown: { type: "string" },
          sourceRef: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          status: { type: "string" },
        },
        required: ["name", "contentMarkdown"],
      },
    },
    {
      name: "spaces.admin.handoff_room",
      description: "Hand off user flow to a target room and optionally dispatch a prompt.",
      inputSchema: {
        type: "object",
        properties: {
          targetSpaceId: { type: "string" },
          handoffSpaceId: { type: "string" },
          promptText: { type: "string" },
          targetAgentId: { type: "string" },
        },
        required: ["handoffSpaceId"],
      },
    },
  ];
}

function mapToolToCommand(
  toolName: string,
): "list_rooms" | "create_room" | "list_skills" | "create_skill" | "handoff_room" | null {
  switch (toolName) {
    case "spaces.admin.list_rooms":
      return "list_rooms";
    case "spaces.admin.create_room":
      return "create_room";
    case "spaces.admin.list_skills":
      return "list_skills";
    case "spaces.admin.create_skill":
      return "create_skill";
    case "spaces.admin.handoff_room":
      return "handoff_room";
    default:
      return null;
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResponse(payload: JsonRpcResponse, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mapErrorCode(code: string): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return -32001;
    case "INVALID_ARGUMENT":
      return -32602;
    case "NOT_FOUND":
      return -32004;
    case "PERMISSION_DENIED":
      return -32003;
    case "FAILED_PRECONDITION":
      return -32002;
    default:
      return -32000;
  }
}

function mapHttpStatus(code: string): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "INVALID_ARGUMENT":
      return 400;
    case "NOT_FOUND":
      return 404;
    case "PERMISSION_DENIED":
      return 403;
    case "FAILED_PRECONDITION":
      return 412;
    default:
      return 500;
  }
}
