import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import type { FunctionToolCallRequest, LLMTool, LLMToolParameters } from "@lmstudio/sdk";
import type {
  ModelMessage,
  ToolCall,
  ToolDefinition,
} from "@spaceskit/core";

const TOOL_CALL_ID_PREFIX = "lmstudio_tool_call";

export interface ToolTransportPlan {
  tools: LLMTool[];
  transportToCanonical: Map<string, string>;
}

export function buildToolTransportPlan(tools?: ToolDefinition[]): ToolTransportPlan | undefined {
  if (!tools?.length) {
    return undefined;
  }

  const usedNames = new Set<string>();
  const transportToCanonical = new Map<string, string>();
  const transportTools: LLMTool[] = [];
  for (const tool of tools) {
    const transportName = uniqueTransportToolName(tool.name, usedNames);
    transportToCanonical.set(transportName, tool.name);
    transportTools.push({
      type: "function",
      function: {
        name: transportName,
        ...(tool.description ? { description: tool.description } : {}),
        parameters: normalizeToolSchema(tool.inputSchema),
      },
    });
  }

  return {
    tools: transportTools,
    transportToCanonical,
  };
}

export function mapLmStudioToolCallRequest(
  request: FunctionToolCallRequest,
  toolPlan: ToolTransportPlan,
): ToolCall {
  const transportName = typeof request.name === "string"
    ? request.name.trim()
    : "";
  const canonicalName = toolPlan.transportToCanonical.get(transportName) ?? transportName;
  const rawId = typeof request.id === "string" && request.id.trim().length > 0
    ? request.id.trim()
    : randomUUID();
  return {
    id: encodeLmStudioToolCallId(rawId, transportName || sanitizeTransportToolName(canonicalName)),
    name: canonicalName || transportName,
    arguments: asRecord(request.arguments) ?? {},
  };
}

export function decodeLmStudioToolCallId(encodedId?: string): { rawId: string; transportName: string } | null {
  const value = encodedId?.trim();
  if (!value || !value.startsWith(`${TOOL_CALL_ID_PREFIX}:`)) {
    return null;
  }

  try {
    const payload = value.slice(TOOL_CALL_ID_PREFIX.length + 1);
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const rawId = typeof parsed.rawId === "string" ? parsed.rawId.trim() : "";
    const transportName = typeof parsed.transportName === "string" ? parsed.transportName.trim() : "";
    if (!rawId || !transportName) {
      return null;
    }
    return { rawId, transportName };
  } catch {
    return null;
  }
}

export function sanitizeTransportToolName(toolName: string): string {
  const normalized = toolName
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) {
    return "tool";
  }
  if (/^[0-9]/.test(normalized)) {
    return `tool_${normalized}`;
  }
  return normalized;
}

export function mergeLmStudioTextContent(
  pendingSystemText: string | undefined,
  messageText: string,
  role: ModelMessage["role"],
): string {
  const trimmedMessageText = messageText.trim();
  if (!pendingSystemText) {
    return trimmedMessageText;
  }

  if (!trimmedMessageText) {
    return `System instructions:\n${pendingSystemText}`;
  }

  if (role === "user") {
    return `System instructions:\n${pendingSystemText}\n\nUser request:\n${trimmedMessageText}`;
  }

  return `System instructions:\n${pendingSystemText}\n\n${trimmedMessageText}`;
}

function encodeLmStudioToolCallId(rawId: string, transportName: string): string {
  const payload = Buffer.from(JSON.stringify({ rawId, transportName }), "utf8").toString("base64url");
  return `${TOOL_CALL_ID_PREFIX}:${payload}`;
}

function uniqueTransportToolName(toolName: string, usedNames: Set<string>): string {
  const base = sanitizeTransportToolName(toolName);
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function normalizeToolSchema(input: unknown): LLMToolParameters {
  const schema = asRecord(input);
  if (!schema) {
    return {
      type: "object",
      properties: {},
      additionalProperties: false,
    };
  }

  const required = Array.isArray(schema.required)
    ? schema.required.filter((value): value is string => typeof value === "string")
    : undefined;
  const defs = asRecord(schema.$defs) as Record<string, any> | null;
  return {
    type: "object",
    properties: (asRecord(schema.properties) ?? {}) as Record<string, any>,
    ...(required ? { required } : {}),
    ...(typeof schema.additionalProperties === "boolean"
      ? { additionalProperties: schema.additionalProperties }
      : { additionalProperties: false }),
    ...(defs ? { $defs: defs } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
