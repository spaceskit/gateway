import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createConnection } from "node:net";
import type {
  GenerateOptions,
  GenerateResult,
  GatewayToolBridgeConfig,
  ModelInfo,
  ModelProvider,
  ProviderSessionHandle,
  StreamChunk,
  TokenUsage,
  ToolCall,
  ToolResult,
} from "@spaceskit/core";
import { inferContextWindow } from "@spaceskit/core";
import {
  buildCommandApprovalRequest,
  buildFileApprovalRequest,
  mapCommandApprovalDecision,
  mapFileApprovalDecision,
  requestProviderFeedback,
} from "./codex-app-server-approvals.js";
import {
  extractDeveloperInstructions,
  mapApprovalPolicy,
  mapReasoningEffort,
  mapReasoningSummary,
  mapSandboxMode,
  toUserInputs,
} from "./codex-app-server-request-mapping.js";
import {
  CodexTurnStreamContext,
  isVisibleAssistantTextChunk,
  mapCompletedItemToChunks,
  normalizeTokenUsage,
  type AppServerInboundMessage,
} from "./codex-app-server-stream-mapping.js";
import {
  buildDynamicTools,
  normalizeDynamicToolCall,
  resolveGatewayToolBridgeConfig,
  toDynamicToolContentItems,
} from "./codex-app-server-tool-protocol.js";

export {
  decodeDynamicToolName,
  encodeDynamicToolName,
} from "./codex-app-server-tool-protocol.js";

const DEFAULT_CLIENT_INFO = {
  name: "spaces-gateway",
  version: "0.1.0",
} as const;

const DEFAULT_MODEL_LIST_LIMIT = 100;

type JsonRpcId = number | string;
type JsonRecord = Record<string, unknown>;
type SpawnFn = typeof spawn;

export type CodexAppServerAuthMode = "api_key" | "host_login";
export type CodexAppServerAuthStatus = "authenticated" | "needs_key" | "needs_auth" | "error" | "unsupported";

export interface CodexAppServerAuthAccount {
  email?: string;
  subscriptionType?: string;
  tokenSource?: string;
  apiProvider?: string;
}

export interface CodexAppServerDiscoveredModel {
  id: string;
  displayName: string;
  contextWindow?: number;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: string[];
  isDefault?: boolean;
}

export interface CodexAppServerProbeResult {
  authMode: CodexAppServerAuthMode;
  authStatus: CodexAppServerAuthStatus;
  authAccount?: CodexAppServerAuthAccount;
  models: CodexAppServerDiscoveredModel[];
  detectionError?: string;
}

export interface CodexAppServerProbeInput {
  providerId: string;
  model: string;
  authMode: CodexAppServerAuthMode;
  apiKey?: string;
}

export interface CodexAppServerTurnInput {
  providerId: string;
  model: string;
  authMode: CodexAppServerAuthMode;
  apiKey?: string;
  options: GenerateOptions;
}

export interface CodexAppServerClientLike {
  probeMetadata(input: CodexAppServerProbeInput): Promise<CodexAppServerProbeResult>;
  streamTurn(input: CodexAppServerTurnInput): AsyncIterable<StreamChunk>;
}

export interface CodexAppServerProviderConfig {
  id: string;
  name: string;
  model: string;
  apiKey?: string;
  authMode?: CodexAppServerAuthMode;
  isLocal?: boolean;
  env?: Record<string, string | undefined>;
  executablePath?: string;
  spawnImpl?: SpawnFn;
  clientFactory?: () => CodexAppServerClientLike;
}

export class CodexAppServerModelProvider implements ModelProvider {
  readonly id: string;
  readonly name: string;
  readonly isLocal: boolean;

  private readonly config: CodexAppServerProviderConfig;
  private readonly client: CodexAppServerClientLike;

  constructor(config: CodexAppServerProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.isLocal = config.isLocal ?? false;
    this.config = config;
    this.client = config.clientFactory?.() ?? new StdioCodexAppServerClient(config);
  }

  async checkHealth(): Promise<{ available: boolean; latencyMs?: number }> {
    const startedAt = Date.now();
    const metadata = await this.probeMetadata();
    return {
      available: metadata.authStatus === "authenticated",
      latencyMs: Date.now() - startedAt,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const metadata = await this.probeMetadata();
    if (metadata.models.length > 0) {
      return metadata.models.map((model) => ({
        id: model.id,
        name: model.displayName,
        provider: this.id,
        contextWindow: model.contextWindow,
        supportsTools: true,
        isLocal: this.isLocal,
      }));
    }

    const modelId = this.resolveModelId(this.config.model);
    return [{
      id: `${this.id}/${modelId}`,
      name: modelId,
      provider: this.id,
      contextWindow: inferContextWindow(this.id, modelId),
      supportsTools: true,
      isLocal: this.isLocal,
    }];
  }

  async probeMetadata(): Promise<CodexAppServerProbeResult> {
    const authMode = this.resolveAuthMode();
    return this.client.probeMetadata({
      providerId: this.id,
      model: this.resolveModelId(this.config.model),
      authMode,
      apiKey: this.resolveApiKey(authMode),
    });
  }

  async generate(model: string, options: GenerateOptions): Promise<GenerateResult> {
    const chunks: StreamChunk[] = [];
    for await (const chunk of this.stream(model, options)) {
      chunks.push(chunk);
    }

    const text = chunks
      .filter((chunk) => chunk.type === "text_delta" && typeof chunk.text === "string" && isVisibleAssistantTextChunk(chunk))
      .map((chunk) => chunk.text as string)
      .join("");
    const finish = [...chunks].reverse().find((chunk) => chunk.type === "finish");
    const feedback = [...chunks].reverse().find((chunk) => chunk.type === "feedback_request");

    return {
      message: {
        role: "assistant",
        content: text,
      },
      finishReason: finish?.finishReason ?? (feedback ? "other" : "stop"),
      ...(finish?.usage ? { usage: finish.usage } : {}),
      ...(finish?.providerSessionHandle ? { providerSessionHandle: finish.providerSessionHandle } : {}),
      ...(feedback?.feedbackRequest ? { feedbackRequest: feedback.feedbackRequest } : {}),
    };
  }

  async *stream(model: string, options: GenerateOptions): AsyncIterable<StreamChunk> {
    const resolvedModel = this.resolveModelId(model || this.config.model);
    const authMode = this.resolveAuthMode();
    yield* this.client.streamTurn({
      providerId: this.id,
      model: resolvedModel,
      authMode,
      apiKey: this.resolveApiKey(authMode),
      options,
    });
  }

  private resolveAuthMode(): CodexAppServerAuthMode {
    return this.config.authMode ?? "api_key";
  }

  private resolveApiKey(authMode: CodexAppServerAuthMode): string | undefined {
    if (authMode !== "api_key") {
      return undefined;
    }
    const configured = this.config.apiKey?.trim();
    if (configured) {
      return configured;
    }
    const envApiKey = this.config.env?.OPENAI_API_KEY?.trim();
    if (envApiKey) {
      return envApiKey;
    }
    return process.env.OPENAI_API_KEY?.trim() || undefined;
  }

  private resolveModelId(modelIdRaw: string): string {
    const trimmed = modelIdRaw.trim();
    const providerPrefix = `${this.id}/`;
    if (trimmed.toLowerCase().startsWith(providerPrefix)) {
      return trimmed.slice(providerPrefix.length);
    }
    return trimmed;
  }
}

class StdioCodexAppServerClient implements CodexAppServerClientLike {
  private readonly executablePath: string;
  private readonly spawnImpl: SpawnFn;
  private readonly env?: Record<string, string | undefined>;
  private child: ChildProcessWithoutNullStreams | null = null;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;
  private requestCounter = 1;
  private readonly pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private readonly subscribers = new Set<(message: AppServerInboundMessage) => void>();
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private loggedInApiKey?: string;

  constructor(config: CodexAppServerProviderConfig) {
    this.executablePath = config.executablePath?.trim() || "codex";
    this.spawnImpl = config.spawnImpl ?? spawn;
    this.env = config.env;
  }

  async probeMetadata(input: CodexAppServerProbeInput): Promise<CodexAppServerProbeResult> {
    if (input.authMode === "api_key" && !input.apiKey) {
      return {
        authMode: input.authMode,
        authStatus: "needs_key",
        models: [],
      };
    }

    try {
      await this.ensureAuthenticated(input.authMode, input.apiKey);
      const accountResponse = await this.sendRequest("account/read", { refreshToken: false }) as {
        account?: unknown;
        requiresOpenaiAuth?: unknown;
      };
      const models = await this.readAllModels(input.providerId);

      return {
        authMode: input.authMode,
        authStatus: inferAuthStatus(input.authMode, input.apiKey, accountResponse),
        authAccount: normalizeAuthAccount(accountResponse?.account),
        models,
      };
    } catch (error) {
      const detectionError = error instanceof Error ? error.message : String(error);
      return {
        authMode: input.authMode,
        authStatus: inferProbeErrorStatus(input.authMode, detectionError),
        models: [],
        ...(detectionError ? { detectionError } : {}),
      };
    }
  }

  async *streamTurn(input: CodexAppServerTurnInput): AsyncIterable<StreamChunk> {
    await this.ensureAuthenticated(input.authMode, input.apiKey);

    const thread = await this.prepareThread(input);
    const threadId = thread.threadId;
    const providerSessionHandle: ProviderSessionHandle = {
      type: "codex_app_server_thread",
      threadId,
    };
    const streamContext = new CodexTurnStreamContext();
    const unsubscribe = this.subscribe((message) => {
      streamContext.push(message);
    });

    let turnId: string | undefined;
    let usage: TokenUsage | undefined;
    let abortListener: (() => void) | undefined;

    try {
      const startTurnResponse = await this.sendRequest("turn/start", {
        threadId,
        input: toUserInputs(input.options.messages, Boolean(input.options.providerSessionHandle)),
        ...(input.options.workingDirectory ? { cwd: input.options.workingDirectory } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(mapReasoningEffort(input.options.effort) ? { effort: mapReasoningEffort(input.options.effort) } : {}),
        ...(mapReasoningSummary(input.options) ? { summary: mapReasoningSummary(input.options) } : {}),
      }) as { turn?: unknown };
      turnId = extractTurnId(startTurnResponse?.turn);

      const signal = input.options.signal;
      if (signal) {
        const onAbort = () => {
          if (turnId) {
            void this.sendRequest("turn/interrupt", { threadId, turnId }).catch(() => {});
          }
        };
        signal.addEventListener("abort", onAbort, { once: true });
        abortListener = () => signal.removeEventListener("abort", onAbort);
      }

      while (true) {
        const inbound = await streamContext.next();
        if (!inbound) {
          break;
        }

        if (inbound.kind === "request") {
          if (inbound.method === "item/tool/call") {
            const toolCall = normalizeDynamicToolCall(inbound.params);
            if (!toolCall) {
              await this.respond(inbound.id, {
                contentItems: [{ type: "inputText", text: "Invalid dynamic tool request." }],
                success: false,
              });
              continue;
            }

            yield { type: "tool_call_start", toolCall };
            yield { type: "tool_call_end", toolCall };

            const toolResult = await executeGatewayToolCall(
              resolveGatewayToolBridgeConfig(input.options),
              toolCall,
            );
            yield { type: "tool_result", toolResult };

            await this.respond(inbound.id, {
              contentItems: toDynamicToolContentItems(toolResult.result),
              success: toolResult.isError !== true,
            });
            continue;
          }

          if (inbound.method === "item/commandExecution/requestApproval") {
            const feedback = await requestProviderFeedback(
              input.options.feedbackHandler,
              buildCommandApprovalRequest(inbound.params),
            );
            await this.respond(inbound.id, {
              decision: mapCommandApprovalDecision(feedback),
            });
            continue;
          }

          if (inbound.method === "item/fileChange/requestApproval") {
            const feedback = await requestProviderFeedback(
              input.options.feedbackHandler,
              buildFileApprovalRequest(inbound.params),
            );
            await this.respond(inbound.id, {
              decision: mapFileApprovalDecision(feedback),
            });
            continue;
          }

          await this.respond(inbound.id, {});
          continue;
        }

        switch (inbound.method) {
          case "turn/started": {
            turnId = extractTurnId((inbound.params as JsonRecord | undefined)?.turn) ?? turnId;
            yield { type: "state_changed", state: "thinking" };
            break;
          }

          case "item/agentMessage/delta": {
            const itemId = asString((inbound.params as JsonRecord | undefined)?.itemId);
            if (itemId) {
              streamContext.noteDelta(itemId);
            }
            const delta = asString((inbound.params as JsonRecord | undefined)?.delta);
            if (delta) {
              yield {
                type: "text_delta",
                text: delta,
                transcriptVisibility: "activity_only",
                streamKind: "provider_client",
              };
            }
            break;
          }

          case "item/reasoning/textDelta":
          case "item/reasoning/summaryTextDelta":
          case "item/plan/delta":
          case "item/commandExecution/outputDelta":
          case "item/fileChange/outputDelta": {
            const itemId = asString((inbound.params as JsonRecord | undefined)?.itemId);
            if (itemId) {
              streamContext.noteDelta(itemId);
            }
            const delta = asString((inbound.params as JsonRecord | undefined)?.delta);
            if (delta) {
              yield {
                type: "reasoning_delta",
                text: delta,
              };
            }
            break;
          }

          case "item/started": {
            const item = asRecord((inbound.params as JsonRecord | undefined)?.item);
            const itemType = asString(item?.type);
            if (itemType === "commandExecution" || itemType === "fileChange") {
              yield { type: "state_changed", state: "acting" };
            }
            break;
          }

          case "item/completed": {
            yield* mapCompletedItemToChunks(inbound.params, streamContext);
            break;
          }

          case "thread/tokenUsage/updated": {
            const params = inbound.params as JsonRecord | undefined;
            const inboundThreadId = asString(params?.threadId);
            const inboundTurnId = asString(params?.turnId);
            if (inboundThreadId === threadId && (!turnId || inboundTurnId === turnId)) {
              usage = normalizeTokenUsage(params?.tokenUsage);
            }
            break;
          }

          case "turn/completed": {
            const params = inbound.params as JsonRecord | undefined;
            const completedThreadId = asString(params?.threadId);
            const completedTurn = asRecord(params?.turn);
            const completedTurnId = extractTurnId(completedTurn);
            if (completedThreadId !== threadId) {
              break;
            }

            const status = asString(completedTurn?.status) ?? "completed";
            if (status === "failed") {
              throw new Error(extractTurnErrorMessage(completedTurn) || "Codex app-server turn failed.");
            }
            if (streamContext.latestCompletedAgentMessage && !streamContext.sawVisibleAssistantOutput) {
              yield {
                type: "text_delta",
                text: streamContext.latestCompletedAgentMessage,
                transcriptVisibility: "visible",
                streamKind: "assistant_output",
              };
              streamContext.noteVisibleAssistantOutput();
            }
            yield {
              type: "finish",
              finishReason: status === "interrupted" ? "other" : "stop",
              ...(usage ? { usage } : {}),
              providerSessionHandle,
            };
            if (!turnId || completedTurnId === turnId) {
              return;
            }
            break;
          }

          default:
            break;
        }
      }
    } finally {
      abortListener?.();
      unsubscribe();
      streamContext.close();
    }
  }

  private async ensureAuthenticated(
    authMode: CodexAppServerAuthMode,
    apiKey?: string,
  ): Promise<void> {
    await this.ensureInitialized();
    if (authMode !== "api_key" || !apiKey) {
      return;
    }
    if (this.loggedInApiKey === apiKey) {
      return;
    }
    await this.sendRequest("account/login/start", {
      type: "apiKey",
      apiKey,
    });
    this.loggedInApiKey = apiKey;
  }

  private async prepareThread(input: CodexAppServerTurnInput): Promise<{ threadId: string }> {
    const providerSessionHandle = input.options.providerSessionHandle;
    const developerInstructions = extractDeveloperInstructions(input.options.messages);
    if (providerSessionHandle?.type === "codex_app_server_thread") {
      const resumed = await this.sendRequest("thread/resume", {
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

    const started = await this.sendRequest("thread/start", {
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
      await this.sendRequest("thread/name/set", {
        threadId,
        name: sessionTitle,
      }).catch(() => {});
    }
    return { threadId };
  }

  private async readAllModels(providerId: string): Promise<CodexAppServerDiscoveredModel[]> {
    const models: CodexAppServerDiscoveredModel[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;

    while (true) {
      const response = await this.sendRequest("model/list", {
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

  private subscribe(listener: (message: AppServerInboundMessage) => void): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  private publish(message: AppServerInboundMessage): void {
    for (const listener of this.subscribers) {
      listener(message);
    }
  }

  private async respond(id: JsonRpcId, result: unknown): Promise<void> {
    this.writeMessage({
      jsonrpc: "2.0",
      id,
      result,
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (this.initializationPromise) {
      return await this.initializationPromise;
    }
    this.initializationPromise = (async () => {
      this.ensureChild();
      await this.sendRequest("initialize", {
        clientInfo: DEFAULT_CLIENT_INFO,
        capabilities: {
          experimentalApi: true,
        },
      });
      this.writeMessage({
        jsonrpc: "2.0",
        method: "initialized",
      });
      this.initialized = true;
    })();
    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  private ensureChild(): void {
    if (this.child) {
      return;
    }

    const child = this.spawnImpl(this.executablePath, ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...(this.env ?? {}),
      },
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string | Buffer) => {
      this.stdoutBuffer += chunk.toString();
      let newlineIndex = this.stdoutBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
        this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
        if (line) {
          this.parseLine(line);
        }
        newlineIndex = this.stdoutBuffer.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk: string | Buffer) => {
      this.stderrBuffer += chunk.toString();
    });
    child.on("error", (error) => {
      this.failPendingRequests(error instanceof Error ? error : new Error(String(error)));
    });
    child.on("exit", (code, signal) => {
      this.child = null;
      const suffix = this.stderrBuffer.trim();
      this.failPendingRequests(new Error(
        suffix || `Codex app-server exited (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
      ));
    });
    this.child = child;
  }

  private parseLine(line: string): void {
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
      const pending = this.pendingRequests.get(String(id));
      if (!pending) {
        return;
      }
      this.pendingRequests.delete(String(id));
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
      this.publish({
        kind: "request",
        id,
        method,
        params: record.params,
      });
      return;
    }

    this.publish({
      kind: "notification",
      method,
      params: record.params,
    });
  }

  private failPendingRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private async sendRequest(method: string, params?: unknown): Promise<unknown> {
    await this.ensureInitializedIfNeeded(method);
    const id = this.requestCounter++;
    const response = new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(String(id), { resolve, reject });
    });
    this.writeMessage({
      jsonrpc: "2.0",
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    });
    return await response;
  }

  private async ensureInitializedIfNeeded(method: string): Promise<void> {
    if (method === "initialize") {
      this.ensureChild();
      return;
    }
    await this.ensureInitialized();
  }

  private writeMessage(payload: JsonRecord): void {
    this.ensureChild();
    if (!this.child?.stdin.writable) {
      throw new Error("Codex app-server stdin is not writable.");
    }
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }
}

async function executeGatewayToolCall(
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

function normalizeAuthAccount(account: unknown): CodexAppServerAuthAccount | undefined {
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

function inferAuthStatus(
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

function inferProbeErrorStatus(
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

function extractThreadId(thread: unknown): string | undefined {
  return asString(asRecord(thread)?.id);
}

function extractTurnId(turn: unknown): string | undefined {
  return asString(asRecord(turn)?.id);
}

function extractTurnErrorMessage(turn: JsonRecord | null): string | undefined {
  return asString(asRecord(turn?.error)?.message);
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
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

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
