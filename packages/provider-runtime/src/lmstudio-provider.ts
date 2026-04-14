import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { LMStudioClient } from "@lmstudio/sdk";
import type { ChatLike, FunctionToolCallRequest, LLMTool, LLMToolParameters } from "@lmstudio/sdk";
import type {
  GenerateOptions,
  GenerateResult,
  ModelInfo,
  ModelMessage,
  ModelProvider,
  StreamChunk,
  TokenUsage,
  ToolCall,
  ToolDefinition,
} from "@spaceskit/core";
import { ToolsUnsupportedError, UnsupportedProviderError } from "./provider-errors.js";

const DEFAULT_LMSTUDIO_BASE_URL = "ws://127.0.0.1:1234";
const TOOL_CALL_ID_PREFIX = "lmstudio_tool_call";
const LMSTUDIO_EXPECTED_CLOSE_MESSAGE = "websocket connection closed";

interface ModelReference {
  providerId: "lmstudio";
  fullModelId: string;
  providerModelId: string;
}

interface LmStudioPredictionStatsLike {
  stopReason?: string;
  promptTokensCount?: number;
  predictedTokensCount?: number;
  totalTokensCount?: number;
}

interface LmStudioPredictionResultLike {
  content?: string;
  stats?: LmStudioPredictionStatsLike;
}

interface LmStudioPredictionLike extends AsyncIterable<{ content?: string }> {
  result(): Promise<LmStudioPredictionResultLike>;
}

interface LmStudioModelInfoLike {
  maxContextLength?: number;
}

interface LmStudioLoadedModelLike {
  identifier: string;
  path: string;
  modelKey: string;
  displayName: string;
  trainedForToolUse: boolean;
  getModelInfo(): Promise<LmStudioModelInfoLike>;
  respond(chat: ChatLike, opts?: Record<string, unknown>): LmStudioPredictionLike;
}

interface LmStudioClientLike {
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

export interface LmStudioProviderConfig {
  id: string;
  name: string;
  model: string;
  baseURL?: string;
  isLocal?: boolean;
  clientFactory?: LmStudioClientFactory;
}

export interface LmStudioSdkLoggerLike {
  debug: (...messages: unknown[]) => void;
  info: (...messages: unknown[]) => void;
  warn: (...messages: unknown[]) => void;
  error: (...messages: unknown[]) => void;
}

export class LmStudioModelProvider implements ModelProvider {
  readonly id: string;
  readonly name: string;
  readonly isLocal: boolean;
  readonly toolSupportMode = "native" as const;

  private readonly config: LmStudioProviderConfig;
  private readonly clientFactory: LmStudioClientFactory;

  constructor(config: LmStudioProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.isLocal = config.isLocal ?? true;
    this.config = config;
    this.clientFactory = config.clientFactory ?? createDefaultLmStudioClient;
  }

  async checkHealth(): Promise<{ available: boolean; latencyMs?: number }> {
    const startedAt = Date.now();
    const availability = await checkLmStudioAvailability({
      baseURL: this.config.baseURL,
      clientFactory: this.clientFactory,
    });
    return {
      available: availability.available,
      latencyMs: Date.now() - startedAt,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const reference = this.parseModelReference(this.config.model, this.id);
    try {
      const models = await listLmStudioLoadedModels({
        baseURL: this.config.baseURL,
        clientFactory: this.clientFactory,
      });
      if (models.length > 0) {
        return models.map((model) => ({
          id: `lmstudio/${model.id}`,
          name: model.name || model.id,
          provider: "lmstudio",
          ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
          supportsTools: model.supportsTools,
          isLocal: true,
        }));
      }
    } catch {
      // Fall back to the configured model when discovery is unavailable.
    }

    return [{
      id: reference.fullModelId,
      name: reference.providerModelId,
      provider: reference.providerId,
      isLocal: true,
      supportsTools: false,
    }];
  }

  async generate(model: string, options: GenerateOptions): Promise<GenerateResult> {
    const reference = this.parseModelReference(model || this.config.model, this.id);
    return withLmStudioClient(
      {
        baseURL: this.config.baseURL,
        clientFactory: this.clientFactory,
      },
      async (client) => {
        const loadedModel = await resolveLoadedLmStudioModel(client, reference.providerModelId);
        if (options.tools?.length && loadedModel.trainedForToolUse === false) {
          throw new ToolsUnsupportedError(
            "lmstudio",
            `Model "${reference.providerModelId}" is not trained for tool use in LM Studio.`,
          );
        }

        const toolPlan = buildToolTransportPlan(options.tools);
        let toolCallFailure: Error | null = null;
        const capturedToolCalls: ToolCall[] = [];
        const prediction = loadedModel.respond(
          toLmStudioChat(options.messages),
          {
            ...(typeof options.temperature === "number" ? { temperature: options.temperature } : {}),
            ...(typeof options.maxTokens === "number" ? { maxTokens: options.maxTokens } : {}),
            ...(options.stopSequences?.length ? { stopStrings: options.stopSequences } : {}),
            ...(options.signal ? { signal: options.signal } : {}),
            ...(toolPlan
              ? {
                rawTools: {
                  type: "toolArray",
                  tools: toolPlan.tools,
                },
                toolNaming: "passThrough",
                onToolCallRequestEnd: (
                  _callId: number,
                  info: { toolCallRequest: FunctionToolCallRequest },
                ) => {
                  capturedToolCalls.push(mapLmStudioToolCallRequest(info.toolCallRequest, toolPlan));
                },
                onToolCallRequestFailure: (_callId: number, error: Error) => {
                  toolCallFailure = error;
                },
              }
              : {}),
          } as Record<string, unknown>,
        );

        const predictionResult = await prediction.result();
        const finishReason = normalizeLmStudioFinishReason(predictionResult.stats?.stopReason);

        if (capturedToolCalls.length > 0) {
          return {
            message: {
              role: "assistant",
              content: normalizeTextContent(predictionResult.content),
              toolCalls: capturedToolCalls,
            },
            usage: asLmStudioTokenUsage(predictionResult.stats)
              ?? estimateUsage(options.messages, JSON.stringify(capturedToolCalls)),
            finishReason: "tool_calls",
          };
        }

        if (finishReason === "tool_calls") {
          if (toolCallFailure) {
            throw toolCallFailure;
          }
          throw new Error(
            `LM Studio reported tool calls for model "${reference.providerModelId}" without a parsed tool request.`,
          );
        }

        const content = normalizeTextContent(predictionResult.content);
        return {
          message: {
            role: "assistant",
            content,
          },
          usage: asLmStudioTokenUsage(predictionResult.stats) ?? estimateUsage(options.messages, content),
          finishReason,
        };
      },
    );
  }

  async *stream(model: string, options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.tools?.length) {
      throw new ToolsUnsupportedError("lmstudio", "Streaming with gateway tools is not supported.");
    }

    const reference = this.parseModelReference(model || this.config.model, this.id);
    const client = await this.clientFactory(this.config.baseURL);
    try {
      const loadedModel = await resolveLoadedLmStudioModel(client, reference.providerModelId);
      const prediction = loadedModel.respond(
        toLmStudioChat(options.messages),
        {
          ...(typeof options.temperature === "number" ? { temperature: options.temperature } : {}),
          ...(typeof options.maxTokens === "number" ? { maxTokens: options.maxTokens } : {}),
          ...(options.stopSequences?.length ? { stopStrings: options.stopSequences } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        } as Record<string, unknown>,
      );

      for await (const fragment of prediction) {
        const text = normalizeTextContent(fragment.content);
        if (!text) {
          continue;
        }
        yield {
          type: "text_delta",
          text,
        };
      }

      const predictionResult = await prediction.result();
      yield {
        type: "finish",
        usage: asLmStudioTokenUsage(predictionResult.stats)
          ?? estimateUsage(options.messages, normalizeTextContent(predictionResult.content)),
        finishReason: normalizeLmStudioFinishReason(predictionResult.stats?.stopReason),
      };
    } finally {
      await disposeLmStudioClient(client);
    }
  }

  private parseModelReference(modelIdRaw: string, providerHintRaw?: string): ModelReference {
    const modelId = modelIdRaw.trim();
    if (!modelId) {
      throw new Error("Model ID is required");
    }

    const [prefixRaw, ...rest] = modelId.split("/");
    if (rest.length > 0) {
      const providerId = normalizeProviderId(prefixRaw);
      if (!providerId) {
        throw new UnsupportedProviderError(prefixRaw, "Unsupported LM Studio provider.");
      }
      const providerModelId = rest.join("/").trim();
      if (!providerModelId) {
        throw new Error(`Invalid model ID: ${modelId}`);
      }
      const hintedProviderId = normalizeProviderId(providerHintRaw);
      if (hintedProviderId && hintedProviderId !== providerId) {
        throw new UnsupportedProviderError(
          `${hintedProviderId}/${providerModelId}`,
          `Model "${modelId}" does not belong to provider ${hintedProviderId}.`,
        );
      }
      return {
        providerId,
        fullModelId: `${providerId}/${providerModelId}`,
        providerModelId,
      };
    }

    const providerId = normalizeProviderId(providerHintRaw);
    if (!providerId) {
      throw new Error(`Model "${modelId}" is missing a provider prefix.`);
    }
    return {
      providerId,
      fullModelId: `${providerId}/${modelId}`,
      providerModelId: modelId,
    };
  }
}

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

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:") {
      parsed.protocol = "ws:";
    } else if (parsed.protocol === "https:") {
      parsed.protocol = "wss:";
    }
    const pathname = parsed.pathname.replace(/\/+$/, "");
    parsed.pathname = pathname === "/v1" ? "/" : (pathname || "/");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return trimmed;
  }
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

async function withLmStudioClient<T>(
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

function createDefaultLmStudioClient(baseURL?: string): LmStudioClientLike {
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

async function disposeLmStudioClient(client: LmStudioClientLike): Promise<void> {
  const asyncDispose = client[Symbol.asyncDispose];
  if (typeof asyncDispose === "function") {
    await asyncDispose.call(client);
  }
}

async function resolveLoadedLmStudioModel(
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

async function safeGetLmStudioModelInfo(
  model: LmStudioLoadedModelLike,
): Promise<LmStudioModelInfoLike | undefined> {
  try {
    return await model.getModelInfo();
  } catch {
    return undefined;
  }
}

function toLmStudioChat(messages: ModelMessage[]): ChatLike {
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

function mergeLmStudioTextContent(
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

interface ToolTransportPlan {
  tools: LLMTool[];
  transportToCanonical: Map<string, string>;
}

function buildToolTransportPlan(tools?: ToolDefinition[]): ToolTransportPlan | undefined {
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

function mapLmStudioToolCallRequest(
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

function encodeLmStudioToolCallId(rawId: string, transportName: string): string {
  const payload = Buffer.from(JSON.stringify({ rawId, transportName }), "utf8").toString("base64url");
  return `${TOOL_CALL_ID_PREFIX}:${payload}`;
}

function decodeLmStudioToolCallId(encodedId?: string): { rawId: string; transportName: string } | null {
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

function sanitizeTransportToolName(toolName: string): string {
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

function asLmStudioTokenUsage(stats: LmStudioPredictionStatsLike | undefined): TokenUsage | undefined {
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

function normalizeLmStudioFinishReason(value: unknown): GenerateResult["finishReason"] {
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

function estimateUsage(messages: ModelMessage[], output: string): TokenUsage {
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

function normalizeProviderId(providerIdRaw?: string): "lmstudio" | null {
  const providerId = providerIdRaw?.trim().toLowerCase();
  if (providerId === "lmstudio") {
    return providerId;
  }
  return null;
}

function normalizeTextContent(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
