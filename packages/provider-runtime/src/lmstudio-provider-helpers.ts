import { LMStudioClient } from "@lmstudio/sdk";
import type { ChatLike } from "@lmstudio/sdk";
import type {
  GenerateResult,
  ModelMessage,
  TokenUsage,
} from "@spaceskit/core";
import {
  buildToolTransportPlan,
  decodeLmStudioToolCallId,
  mapLmStudioToolCallRequest,
  mergeLmStudioTextContent,
  sanitizeTransportToolName,
  type ToolTransportPlan,
} from "./lmstudio-tool-transport.js";

const DEFAULT_LMSTUDIO_BASE_URL = "ws://127.0.0.1:1234";
const LMSTUDIO_EXPECTED_CLOSE_MESSAGE = "websocket connection closed";

export interface LmStudioPredictionStatsLike {
  stopReason?: string;
  promptTokensCount?: number;
  predictedTokensCount?: number;
  totalTokensCount?: number;
}

export interface LmStudioPredictionResultLike {
  content?: string;
  stats?: LmStudioPredictionStatsLike;
}

export interface LmStudioPredictionLike extends AsyncIterable<{ content?: string }> {
  result(): Promise<LmStudioPredictionResultLike>;
}

export interface LmStudioModelInfoLike {
  maxContextLength?: number;
}

export interface LmStudioLoadedModelLike {
  identifier: string;
  path: string;
  modelKey: string;
  displayName: string;
  trainedForToolUse: boolean;
  getModelInfo(): Promise<LmStudioModelInfoLike>;
  respond(chat: ChatLike, opts?: Record<string, unknown>): LmStudioPredictionLike;
}

export interface LmStudioClientLike {
  llm: {
    listLoaded(): Promise<LmStudioLoadedModelLike[]>;
  };
  [Symbol.asyncDispose]?: () => Promise<void>;
}

export interface LmStudioLoadedModelInfo {
  id: string;
  modelKey: string;
  name: string;
  contextWindow?: number;
  supportsTools: boolean;
}

export type LmStudioClientFactory = (baseURL?: string) => LmStudioClientLike | Promise<LmStudioClientLike>;

export interface LmStudioSdkLoggerLike {
  debug: (...messages: unknown[]) => void;
  info: (...messages: unknown[]) => void;
  warn: (...messages: unknown[]) => void;
  error: (...messages: unknown[]) => void;
}

export { buildToolTransportPlan, mapLmStudioToolCallRequest };
export type { ToolTransportPlan };

export async function listLmStudioLoadedModels(options?: {
  baseURL?: string;
  clientFactory?: LmStudioClientFactory;
}): Promise<LmStudioLoadedModelInfo[]> {
  return withLmStudioClient(
    {
      baseURL: options?.baseURL,
      clientFactory: options?.clientFactory ?? createDefaultLmStudioClient,
    },
    async (client) => {
      const models = await client.llm.listLoaded();
      return Promise.all(models.map(async (model) => {
        const info = await safeGetLmStudioModelInfo(model);
        const modelId = model.identifier.trim() || model.modelKey.trim() || model.path.trim();
        return {
          id: modelId,
          modelKey: model.modelKey.trim() || modelId,
          name: model.displayName.trim() || modelId,
          ...(info?.maxContextLength !== undefined ? { contextWindow: info.maxContextLength } : {}),
          supportsTools: model.trainedForToolUse === true,
        };
      }));
    },
  );
}

export async function checkLmStudioAvailability(options?: {
  baseURL?: string;
  clientFactory?: LmStudioClientFactory;
}): Promise<{ available: boolean; reason: string; models: LmStudioLoadedModelInfo[] }> {
  try {
    const models = await listLmStudioLoadedModels(options);
    return {
      available: true,
      reason: models.length > 0
        ? `Detected ${models.length} loaded model(s) in LM Studio.`
        : "LM Studio SDK endpoint is reachable but no models are currently loaded.",
      models,
    };
  } catch (error) {
    return {
      available: false,
      reason: describeLmStudioError(error, options?.baseURL),
      models: [],
    };
  }
}

export function normalizeLmStudioBaseURL(baseURLRaw?: string): string | undefined {
  const trimmed = baseURLRaw?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed;
}

export function describeLmStudioError(error: unknown, baseURL?: string): string {
  const endpoint = normalizeLmStudioBaseURL(baseURL) ?? DEFAULT_LMSTUDIO_BASE_URL;
  const fallback = `Failed to discover models from LM Studio SDK endpoint: ${endpoint}`;
  if (!(error instanceof Error)) {
    return fallback;
  }

  const record = asRecord(error);
  const code = typeof record?.code === "string" ? record.code : undefined;
  const message = error.message.trim();
  if (
    code === "ConnectionRefused"
    || message.toLowerCase().includes("connection refused")
    || message.toLowerCase().includes("failed to connect")
    || message.toLowerCase().includes("econnrefused")
  ) {
    return `Connection refused at ${endpoint}. Open LM Studio and ensure at least one model is loaded.`;
  }

  return message ? `${message} (endpoint: ${endpoint})` : fallback;
}

export async function withLmStudioClient<T>(
  options: {
    baseURL?: string;
    clientFactory: LmStudioClientFactory;
  },
  run: (client: LmStudioClientLike) => Promise<T>,
): Promise<T> {
  const client = await options.clientFactory(options.baseURL);
  try {
    return await run(client);
  } finally {
    await disposeLmStudioClient(client);
  }
}

export function createDefaultLmStudioClient(baseURL?: string): LmStudioClientLike {
  return new LMStudioClient({
    baseUrl: normalizeLmStudioBaseURL(baseURL) ?? DEFAULT_LMSTUDIO_BASE_URL,
    logger: createLmStudioSdkLogger(),
  }) as unknown as LmStudioClientLike;
}

export function createLmStudioSdkLogger(
  baseLogger: LmStudioSdkLoggerLike = console,
): LmStudioSdkLoggerLike {
  return {
    debug: (...messages) => baseLogger.debug(...messages),
    info: (...messages) => baseLogger.info(...messages),
    warn: (...messages) => {
      if (isExpectedLmStudioCloseWarning(messages)) {
        return;
      }
      baseLogger.warn(...messages);
    },
    error: (...messages) => baseLogger.error(...messages),
  };
}

export async function disposeLmStudioClient(client: LmStudioClientLike): Promise<void> {
  const asyncDispose = client[Symbol.asyncDispose];
  if (typeof asyncDispose === "function") {
    await asyncDispose.call(client);
  }
}

export async function resolveLoadedLmStudioModel(
  client: LmStudioClientLike,
  providerModelId: string,
): Promise<LmStudioLoadedModelLike> {
  const normalizedTarget = providerModelId.trim().toLowerCase();
  const models = await client.llm.listLoaded();
  const match = models.find((model) => {
    const candidates = [
      model.identifier,
      model.modelKey,
      model.path,
    ].map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0);
    return candidates.includes(normalizedTarget);
  });

  if (!match) {
    throw new Error(
      `LM Studio rejected model "${providerModelId}" because it is not loaded. Load the model in LM Studio or choose an available model in Main Agent settings.`,
    );
  }
  return match;
}

export function toLmStudioChat(messages: ModelMessage[]): ChatLike {
  const history: Array<Record<string, unknown>> = [];
  const pendingSystemMessages: string[] = [];

  const consumePendingSystemText = (): string | undefined => {
    if (pendingSystemMessages.length === 0) {
      return undefined;
    }
    const merged = pendingSystemMessages.join("\n\n").trim();
    pendingSystemMessages.length = 0;
    return merged.length > 0 ? merged : undefined;
  };

  for (const message of messages) {
    if (message.role === "system") {
      const text = message.content.trim();
      if (text.length > 0) {
        pendingSystemMessages.push(text);
      }
      continue;
    }

    if (message.role === "tool") {
      const decoded = decodeLmStudioToolCallId(message.toolCallId);
      history.push({
        role: "tool",
        content: [{
          type: "toolCallResult",
          content: message.content,
          ...(decoded?.rawId ? { toolCallId: decoded.rawId } : {}),
        }],
      });
      continue;
    }

    const content: Array<Record<string, unknown>> = [];
    const pendingSystemText = consumePendingSystemText();
    const textContent = mergeLmStudioTextContent(pendingSystemText, message.content, message.role);
    if (textContent.length > 0) {
      content.push({
        type: "text",
        text: textContent,
      });
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      for (const toolCall of message.toolCalls) {
        const decoded = decodeLmStudioToolCallId(toolCall.id);
        content.push({
          type: "toolCallRequest",
          toolCallRequest: {
            ...(decoded?.rawId ? { id: decoded.rawId } : {}),
            type: "function",
            name: decoded?.transportName ?? sanitizeTransportToolName(toolCall.name),
            arguments: toolCall.arguments,
          },
        });
      }
    }

    if (content.length === 0) {
      continue;
    }
    history.push({
      role: message.role,
      content,
    });
  }

  const trailingSystemText = consumePendingSystemText();
  if (trailingSystemText) {
    history.push({
      role: "user",
      content: [{
        type: "text",
        text: `System instructions:\n${trailingSystemText}`,
      }],
    });
  }

  return {
    messages: history,
  } as unknown as ChatLike;
}

export function asLmStudioTokenUsage(stats: LmStudioPredictionStatsLike | undefined): TokenUsage | undefined {
  const promptTokens = asNumber(stats?.promptTokensCount);
  const completionTokens = asNumber(stats?.predictedTokensCount);
  const totalTokens = asNumber(stats?.totalTokensCount)
    ?? (
      promptTokens !== undefined && completionTokens !== undefined
        ? promptTokens + completionTokens
        : undefined
    );
  if (promptTokens === undefined || completionTokens === undefined || totalTokens === undefined) {
    return undefined;
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    tokenAccuracy: "reported",
    usageSource: "ledger",
  };
}

export function normalizeLmStudioFinishReason(value: unknown): GenerateResult["finishReason"] {
  switch (value) {
    case "toolCalls":
      return "tool_calls";
    case "maxPredictedTokensReached":
    case "contextLengthReached":
      return "length";
    case "failed":
      return "error";
    case "eosFound":
    case "stopStringFound":
      return "stop";
    case "userStopped":
    case "modelUnloaded":
      return "other";
    default:
      return "stop";
  }
}

export function estimateUsage(messages: ModelMessage[], output: string): TokenUsage {
  const promptChars = messages.reduce((total, message) => total + message.content.length, 0);
  const promptTokens = Math.ceil(promptChars / 4);
  const completionTokens = Math.ceil(output.length / 4);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    tokenAccuracy: "estimated",
    usageSource: "ledger",
  };
}

export function normalizeProviderId(providerIdRaw?: string): "lmstudio" | null {
  const providerId = providerIdRaw?.trim().toLowerCase();
  if (providerId === "lmstudio") {
    return providerId;
  }
  return null;
}

export function normalizeTextContent(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isExpectedLmStudioCloseWarning(messages: unknown[]): boolean {
  const normalizedStringMessages = messages
    .filter((message): message is string => typeof message === "string")
    .map((message) => message.trim().toLowerCase());
  const hasStringifiedCloseWarning = normalizedStringMessages.some((message) =>
    message.includes("websocket error:")
    && message.includes(LMSTUDIO_EXPECTED_CLOSE_MESSAGE),
  );
  if (hasStringifiedCloseWarning) {
    return true;
  }

  const hasWebSocketErrorPrefix = normalizedStringMessages.some((message) => message.includes("websocket error:"));
  if (!hasWebSocketErrorPrefix) {
    return false;
  }

  return messages.some((message) => {
    if (message instanceof Error) {
      return message.message.trim().toLowerCase() === LMSTUDIO_EXPECTED_CLOSE_MESSAGE;
    }
    const record = asRecord(message);
    return typeof record?.message === "string"
      && record.message.trim().toLowerCase() === LMSTUDIO_EXPECTED_CLOSE_MESSAGE;
  });
}

async function safeGetLmStudioModelInfo(
  model: LmStudioLoadedModelLike,
): Promise<LmStudioModelInfoLike | undefined> {
  try {
    return await model.getModelInfo();
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
