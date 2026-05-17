import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  ProviderSessionHandle,
  StreamChunk,
  TokenUsage,
} from "@spaceskit/core";
import {
  buildCommandApprovalRequest,
  buildFileApprovalRequest,
  mapCommandApprovalDecision,
  mapFileApprovalDecision,
  requestProviderFeedback,
} from "./codex-app-server-approvals.js";
import {
  mapReasoningEffort,
  mapReasoningSummary,
  toUserInputs,
} from "./codex-app-server-request-mapping.js";
import {
  CodexTurnStreamContext,
  mapCompletedItemToChunks,
  normalizeTokenUsage,
  type AppServerInboundMessage,
} from "./codex-app-server-stream-mapping.js";
import {
  normalizeDynamicToolCall,
  resolveGatewayToolBridgeConfig,
  toDynamicToolContentItems,
} from "./codex-app-server-tool-protocol.js";
import {
  asRecord,
  asString,
  executeGatewayToolCall,
  extractTurnErrorMessage,
  extractTurnId,
  inferAuthStatus,
  inferProbeErrorStatus,
  normalizeAuthAccount,
  parseCodexAppServerLine,
  prepareCodexAppServerThread,
  readAllCodexAppServerModels,
} from "./codex-app-server-stdio-helpers.js";
import type {
  CodexAppServerAuthMode,
  CodexAppServerClientLike,
  CodexAppServerProbeInput,
  CodexAppServerProbeResult,
  CodexAppServerProviderConfig,
  CodexAppServerTurnInput,
} from "./codex-app-server-provider.js";

const DEFAULT_CLIENT_INFO = {
  name: "spaces-gateway",
  version: "0.1.0",
} as const;

type JsonRpcId = number | string;
type JsonRecord = Record<string, unknown>;
type SpawnFn = typeof spawn;

export class StdioCodexAppServerClient implements CodexAppServerClientLike {
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
      const models = await readAllCodexAppServerModels(input.providerId, this.sendRequest.bind(this));

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

    const thread = await prepareCodexAppServerThread(input, this.sendRequest.bind(this));
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
          parseCodexAppServerLine(line, this.pendingRequests, this.publish.bind(this));
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
