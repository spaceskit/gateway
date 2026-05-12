import type {
  GatewayToolBridgeConfig,
  GenerateOptions,
  ToolCall,
} from "@spaceskit/core";

const DYNAMIC_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const DYNAMIC_TOOL_NAME_PREFIX = "spaceskit_";

type JsonRecord = Record<string, unknown>;

export type CodexDynamicTool = {
  name: string;
  description: string;
  inputSchema: unknown;
};

export function resolveGatewayToolBridgeConfig(options: GenerateOptions): GatewayToolBridgeConfig | undefined {
  return options.gatewayToolBridgeConfig ?? options.mcpBridgeConfig;
}

export function buildDynamicTools(config?: GatewayToolBridgeConfig): CodexDynamicTool[] {
  if (!config) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(config.toolDefsJson);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const tools: CodexDynamicTool[] = [];
  for (const entry of parsed) {
    const record = asRecord(entry);
    const name = asString(record?.name);
    if (!name) {
      continue;
    }
    tools.push({
      name: encodeDynamicToolName(name),
      description: asString(record?.description) || name,
      inputSchema: record?.inputSchema ?? record?.parameters ?? { type: "object" },
    });
  }
  return tools;
}

export function toDynamicToolContentItems(result: unknown): Array<{ type: "inputText"; text: string }> {
  if (typeof result === "string") {
    return [{ type: "inputText", text: result }];
  }
  return [{
    type: "inputText",
    text: JSON.stringify(result ?? null),
  }];
}

export function normalizeDynamicToolCall(params: unknown): ToolCall | null {
  const record = asRecord(params);
  const id = asString(record?.callId);
  const name = decodeDynamicToolName(asString(record?.tool));
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    arguments: asRecord(record?.arguments) ?? {},
  };
}

export function encodeDynamicToolName(name: string): string {
  if (DYNAMIC_TOOL_NAME_PATTERN.test(name)) {
    return name;
  }
  return `${DYNAMIC_TOOL_NAME_PREFIX}${Buffer.from(name, "utf8").toString("hex")}`;
}

export function decodeDynamicToolName(name: string | undefined): string | undefined {
  if (!name) {
    return undefined;
  }
  if (!name.startsWith(DYNAMIC_TOOL_NAME_PREFIX)) {
    return name;
  }
  const encoded = name.slice(DYNAMIC_TOOL_NAME_PREFIX.length);
  if (!encoded || encoded.length % 2 !== 0 || /[^0-9a-f]/i.test(encoded)) {
    return name;
  }
  try {
    return Buffer.from(encoded, "hex").toString("utf8");
  } catch {
    return name;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}
