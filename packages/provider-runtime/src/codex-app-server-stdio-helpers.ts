import { createConnection } from "node:net";
import type {
  GatewayToolBridgeConfig,
  ToolCall,
  ToolResult,
} from "@spaceskit/core";
import { inferContextWindow } from "@spaceskit/core";
import {
  extractDeveloperInstructions,
  mapApprovalPolicy,
  mapSandboxMode,
} from "./codex-app-server-request-mapping.js";
import {
  buildDynamicTools,
  resolveGatewayToolBridgeConfig,
} from "./codex-app-server-tool-protocol.js";
import type {
  CodexAppServerAuthAccount,
  CodexAppServerAuthMode,
  CodexAppServerAuthStatus,
  CodexAppServerDiscoveredModel,
  CodexAppServerTurnInput,
} from "./codex-app-server-provider.js";

const DEFAULT_MODEL_LIST_LIMIT = 100;

type JsonRecord = Record<string, unknown>;
type JsonRpcId = number | string;
type SendCodexRequest = (method: string, params?: unknown) => Promise<unknown>;
type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};
type AppServerPublisher = (message: {
  kind: "request";
  id: JsonRpcId;
  method: string;
  params: unknown;
} | {
  kind: "notification";
  method: string;
  params: unknown;
}) => void;

export async function prepareCodexAppServerThread(
  input: CodexAppServerTurnInput,
  sendRequest: SendCodexRequest,
): Promise<{ threadId: string }> {
  const providerSessionHandle = input.options.providerSessionHandle;
  const developerInstructions = extractDeveloperInstructions(input.options.messages);
  if (providerSessionHandle?.type === "codex_app_server_thread") {
    const resumed = await sendRequest("thread/resume", {
      threadId: providerSessionHandle.threadId,
      ...(input.model ? { model: input.model } : {}),
      ...(input.options.workingDirectory ? { cwd: input.options.workingDirectory } : {}),
      ...(mapApprovalPolicy(input.options.accessMode, input.options.approvalBypassEnabled)
        ? { approvalPolicy: mapApprovalPolicy(input.options.accessMode, input.options.approvalBypassEnabled) }
        : {}),
      ...(mapSandboxMode(input.options.accessMode) ? { sandbox: mapSandboxMode(input.options.accessMode) } : {}),
      ...(developerInstructions ? { developerInstructions } : {}),
      persistExtendedHistory: false,
    }) as { thread?: unknown };
    return { threadId: extractThreadId(resumed?.thread) ?? providerSessionHandle.threadId };
  }

  const started = await sendRequest("thread/start", {
    ...(input.model ? { model: input.model } : {}),
    ...(input.options.workingDirectory ? { cwd: input.options.workingDirectory } : {}),
    ...(mapApprovalPolicy(input.options.accessMode, input.options.approvalBypassEnabled)
      ? { approvalPolicy: mapApprovalPolicy(input.options.accessMode, input.options.approvalBypassEnabled) }
      : {}),
    ...(mapSandboxMode(input.options.accessMode) ? { sandbox: mapSandboxMode(input.options.accessMode) } : {}),
    ...(developerInstructions ? { developerInstructions } : {}),
    dynamicTools: buildDynamicTools(resolveGatewayToolBridgeConfig(input.options)),
    experimentalRawEvents: false,
    persistExtendedHistory: false,
  }) as { thread?: unknown };
  const threadId = extractThreadId(started?.thread);
  if (!threadId) {
    throw new Error("Codex app-server did not return a thread id.");
  }
  const sessionTitle = asString(input.options.sessionTitle);
  if (sessionTitle) {
    await sendRequest("thread/name/set", {
      threadId,
      name: sessionTitle,
    }).catch(() => {});
  }
  return { threadId };
}

export async function readAllCodexAppServerModels(
  providerId: string,
  sendRequest: SendCodexRequest,
): Promise<CodexAppServerDiscoveredModel[]> {
  const models: CodexAppServerDiscoveredModel[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;

  while (true) {
    const response = await sendRequest("model/list", {
      limit: DEFAULT_MODEL_LIST_LIMIT,
      includeHidden: false,
      ...(cursor ? { cursor } : {}),
    }) as { data?: unknown; nextCursor?: unknown };

    for (const entry of asArray(response?.data)) {
      const normalized = normalizeDiscoveredModel(providerId, entry);
      if (!normalized) {
        continue;
      }
      const key = normalized.id.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      models.push(normalized);
    }

    cursor = asString(response?.nextCursor);
    if (!cursor) {
      break;
    }
  }

  models.sort((lhs, rhs) => {
    if (Boolean(lhs.isDefault) !== Boolean(rhs.isDefault)) {
      return lhs.isDefault ? -1 : 1;
    }
    return lhs.displayName.localeCompare(rhs.displayName);
  });
  return models;
}

export async function executeGatewayToolCall(
  config: GatewayToolBridgeConfig | undefined,
  toolCall: ToolCall,
): Promise<ToolResult> {
  if (!config) {
    return {
      toolCallId: toolCall.id,
      result: "Gateway tool bridge is not configured for this turn.",
      isError: true,
    };
  }

  return await new Promise<ToolResult>((resolve) => {
    const socket = createConnection(config.socketPath);
    let buffer = "";

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({
        type: "execute",
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      })}\n`);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
    });
    socket.on("end", () => {
      const response = safeParseJson(buffer.trim());
      const record = asRecord(response);
      resolve({
        toolCallId: toolCall.id,
        result: record?.result ?? buffer.trim(),
        ...(typeof record?.isError === "boolean" ? { isError: record.isError } : {}),
      });
    });
    socket.on("error", (error) => {
      resolve({
        toolCallId: toolCall.id,
        result: error instanceof Error ? error.message : String(error),
        isError: true,
      });
    });
  });
}

export function normalizeAuthAccount(account: unknown): CodexAppServerAuthAccount | undefined {
  const record = asRecord(account);
  if (!record) {
    return undefined;
  }
  if (asString(record.type) === "chatgpt") {
    const normalized: CodexAppServerAuthAccount = {
      email: asString(record.email),
      subscriptionType: asString(record.planType),
      tokenSource: "chatgpt",
      apiProvider: "openai",
    };
    return Object.values(normalized).some(Boolean) ? normalized : undefined;
  }
  if (asString(record.type) === "apiKey") {
    return {
      tokenSource: "api_key",
      apiProvider: "openai",
    };
  }
  return undefined;
}

export function inferAuthStatus(
  authMode: CodexAppServerAuthMode,
  apiKey: string | undefined,
  accountResponse: { account?: unknown; requiresOpenaiAuth?: unknown } | null | undefined,
): CodexAppServerAuthStatus {
  if (authMode === "api_key" && !apiKey) {
    return "needs_key";
  }
  const account = asRecord(accountResponse?.account);
  const accountType = asString(account?.type);
  if (accountType === "apiKey" || accountType === "chatgpt") {
    return "authenticated";
  }
  if (authMode === "host_login") {
    return accountResponse?.requiresOpenaiAuth === true ? "needs_auth" : "needs_auth";
  }
  return apiKey ? "authenticated" : "needs_key";
}

export function inferProbeErrorStatus(
  authMode: CodexAppServerAuthMode,
  detectionError: string,
): CodexAppServerAuthStatus {
  if (authMode === "api_key") {
    return "error";
  }
  const normalized = detectionError.trim().toLowerCase();
  if (
    normalized.includes("sign in")
    || normalized.includes("login")
    || normalized.includes("oauth")
    || normalized.includes("authenticate")
    || normalized.includes("unauthorized")
  ) {
    return "needs_auth";
  }
  return "error";
}

export function extractTurnId(turn: unknown): string | undefined {
  return asString(asRecord(turn)?.id);
}

export function extractTurnErrorMessage(turn: JsonRecord | null): string | undefined {
  return asString(asRecord(turn?.error)?.message);
}

export function parseCodexAppServerLine(
  line: string,
  pendingRequests: Map<string, PendingRequest>,
  publish: AppServerPublisher,
): void {
  let payload: unknown;
  try {
    payload = JSON.parse(line);
  } catch {
    return;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return;
  }

  const record = payload as JsonRecord;
  const id = record.id as JsonRpcId | undefined;
  const method = asString(record.method);
  if (id !== undefined && !method) {
    const pending = pendingRequests.get(String(id));
    if (!pending) {
      return;
    }
    pendingRequests.delete(String(id));
    if (record.error && typeof record.error === "object") {
      const errorRecord = record.error as JsonRecord;
      pending.reject(new Error(asString(errorRecord.message) || "Codex app-server request failed."));
      return;
    }
    pending.resolve(record.result);
    return;
  }

  if (!method) {
    return;
  }

  if (id !== undefined) {
    publish({
      kind: "request",
      id,
      method,
      params: record.params,
    });
    return;
  }

  publish({
    kind: "notification",
    method,
    params: record.params,
  });
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

export function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeDiscoveredModel(
  providerId: string,
  entry: unknown,
): CodexAppServerDiscoveredModel | null {
  const record = asRecord(entry);
  const rawModel = asString(record?.model) || asString(record?.id);
  if (!rawModel) {
    return null;
  }
  const id = rawModel.toLowerCase().startsWith(`${providerId}/`)
    ? rawModel
    : `${providerId}/${rawModel}`;
  return {
    id,
    displayName: asString(record?.displayName) || rawModel,
    contextWindow: inferContextWindow(providerId, rawModel),
    defaultReasoningEffort: asString(record?.defaultReasoningEffort),
    supportedReasoningEfforts: asArray(record?.supportedReasoningEfforts)
      .map((value) => asString(value))
      .filter((value): value is string => Boolean(value)),
    isDefault: Boolean(record?.isDefault),
  };
}

function extractThreadId(thread: unknown): string | undefined {
  return asString(asRecord(thread)?.id);
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
