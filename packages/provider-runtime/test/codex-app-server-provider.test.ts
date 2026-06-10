import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type {
  CodexAppServerClientLike,
  CodexAppServerProbeInput,
  CodexAppServerProbeResult,
  CodexAppServerTurnInput,
} from "../src/codex-app-server-provider.js";
import {
  CodexAppServerModelProvider,
  decodeDynamicToolName,
  encodeDynamicToolName,
} from "../src/codex-app-server-provider.js";
import type { StreamChunk } from "@spaceskit/core";

class FakeWritableStdin {
  writable = true;
  private buffer = "";

  constructor(private readonly onMessage: (message: Record<string, unknown>) => void) {}

  write(chunk: string | Buffer): boolean {
    this.buffer += chunk.toString();
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) {
        this.onMessage(JSON.parse(line) as Record<string, unknown>);
      }
      newlineIndex = this.buffer.indexOf("\n");
    }
    return true;
  }
}

class FakeAppServerProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: FakeWritableStdin;
  readonly requests: Array<{ method: string; params?: unknown }> = [];
  private turnCounter = 1;

  constructor(private readonly options: {
    emitAgentMessageDeltaBeforeCompleted?: boolean;
    emitStructuredWorkItems?: boolean;
  } = {}) {
    super();
    this.stdin = new FakeWritableStdin((message) => this.handleMessage(message));
  }

  private handleMessage(message: Record<string, unknown>): void {
    const id = message.id;
    const method = typeof message.method === "string" ? message.method : "";
    this.requests.push({
      method,
      params: message.params,
    });

    if (id === undefined || !method) {
      return;
    }

    const result = this.resultFor(method, message.params);
    queueMicrotask(() => {
      this.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
      if (method === "turn/start") {
        this.emitCompletedTurn(message.params);
      }
    });
  }

  private resultFor(method: string, params: unknown): unknown {
    const record = asTestRecord(params);
    switch (method) {
      case "thread/start":
        return { thread: { id: "thread-new" } };
      case "thread/resume":
        return { thread: { id: typeof record.threadId === "string" ? record.threadId : "thread-new" } };
      case "turn/start": {
        const turnId = `turn-${this.turnCounter}`;
        this.turnCounter += 1;
        return { turn: { id: turnId } };
      }
      default:
        return {};
    }
  }

  private emitCompletedTurn(params: unknown): void {
    const record = asTestRecord(params);
    const threadId = typeof record.threadId === "string" ? record.threadId : "thread-new";
    const turnId = `turn-${this.turnCounter - 1}`;
    const itemId = `item-${turnId}`;
    queueMicrotask(() => {
      this.stdout.write(`${JSON.stringify({
        jsonrpc: "2.0",
        method: "turn/started",
        params: { threadId, turn: { id: turnId } },
      })}\n`);
      if (this.options.emitStructuredWorkItems) {
        this.stdout.write(`${JSON.stringify({
          jsonrpc: "2.0",
          method: "turn/plan/updated",
          params: {
            threadId,
            turnId,
            explanation: "Use a two step plan.",
            plan: [
              { step: "Inspect workspace", status: "completed" },
              { step: "Apply focused changes", status: "inProgress" },
            ],
          },
        })}\n`);
        this.stdout.write(`${JSON.stringify({
          jsonrpc: "2.0",
          method: "item/plan/delta",
          params: {
            threadId,
            turnId,
            itemId: "plan-item-1",
            delta: "experimental partial plan text",
          },
        })}\n`);
        for (const item of [
          {
            id: "command-1",
            type: "commandExecution",
            command: "bun test packages/provider-runtime/test/codex-app-server-provider.test.ts",
            aggregatedOutput: "1 pass",
            exitCode: 0,
          },
          {
            id: "file-1",
            type: "fileChange",
            summary: "Updated chat renderer.",
            changes: [{ path: "Sources/Shared/Chat/WorkItemCard.swift", changeType: "modified" }],
          },
          {
            id: "tool-1",
            type: "mcpToolCall",
            toolName: "workspace.search",
            serverName: "gateway",
            arguments: { query: "workItem" },
            result: { matches: 2 },
          },
          {
            id: "collab-1",
            type: "collabAgentToolCall",
            agentId: "reviewer",
            task: "Review the work-item contract.",
          },
          {
            id: "web-1",
            type: "webSearch",
            query: "Codex app-server item types",
          },
          {
            id: "image-1",
            type: "imageGeneration",
            prompt: "diagram of work item cards",
          },
          {
            id: "reasoning-1",
            type: "reasoning",
            summary: ["Need a neutral contract."],
            content: ["Codex item names stay inside adapter metadata."],
          },
          {
            id: "plan-item-1",
            type: "plan",
            explanation: "Final plan snapshot wins.",
            plan: [
              { step: "Inspect workspace", status: "completed" },
              { step: "Apply focused changes", status: "completed" },
            ],
          },
          {
            id: "artifact-1",
            type: "artifact",
            title: "Rendered preview",
            path: "artifacts/preview.md",
            mimeType: "text/markdown",
            previewText: "Artifact body preview.",
          },
        ]) {
          this.stdout.write(`${JSON.stringify({
            jsonrpc: "2.0",
            method: "item/completed",
            params: {
              threadId,
              turnId,
              item,
            },
          })}\n`);
        }
      }
      if (this.options.emitAgentMessageDeltaBeforeCompleted) {
        this.stdout.write(`${JSON.stringify({
          jsonrpc: "2.0",
          method: "item/agentMessage/delta",
          params: {
            threadId,
            turnId,
            itemId,
            delta: `answer from ${turnId}`,
          },
        })}\n`);
      }
      this.stdout.write(`${JSON.stringify({
        jsonrpc: "2.0",
        method: "item/completed",
        params: {
          threadId,
          turnId,
          item: {
            id: itemId,
            type: "agentMessage",
            text: `answer from ${turnId}`,
          },
        },
      })}\n`);
      this.stdout.write(`${JSON.stringify({
        jsonrpc: "2.0",
        method: "turn/completed",
        params: {
          threadId,
          turn: {
            id: turnId,
            status: "completed",
          },
        },
      })}\n`);
    });
  }
}

function asTestRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

class FakeCodexAppServerClient implements CodexAppServerClientLike {
  readonly probeCalls: CodexAppServerProbeInput[] = [];
  readonly turnCalls: CodexAppServerTurnInput[] = [];

  constructor(
    private readonly probeResult: CodexAppServerProbeResult,
    private readonly chunks: StreamChunk[] = [],
  ) {}

  async probeMetadata(input: CodexAppServerProbeInput): Promise<CodexAppServerProbeResult> {
    this.probeCalls.push(input);
    return this.probeResult;
  }

  async *streamTurn(input: CodexAppServerTurnInput): AsyncIterable<StreamChunk> {
    this.turnCalls.push(input);
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}

async function collectChunks(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

describe("CodexAppServerModelProvider", () => {
  test("encodes invalid dynamic tool names for app-server and decodes them back", () => {
    const encoded = encodeDynamicToolName("lists.echo");
    expect(encoded).not.toBe("lists.echo");
    expect(encoded).toMatch(/^spaceskit_[0-9a-f]+$/);
    expect(decodeDynamicToolName(encoded)).toBe("lists.echo");
    expect(decodeDynamicToolName("lists_echo")).toBe("lists_echo");
  });

  test("sets Codex app-server thread names and resumes with only new messages", async () => {
    const fakeProcess = new FakeAppServerProcess();
    const provider = new CodexAppServerModelProvider({
      id: "codex-app-server",
      name: "Codex App Server",
      model: "codex-app-server/gpt-5.4",
      apiKey: "sk-test",
      authMode: "api_key",
      spawnImpl: (() => fakeProcess) as never,
    });

    const firstChunks = await collectChunks(provider.stream("codex-app-server/gpt-5.4", {
      messages: [{ role: "user", content: "First prompt should be the preview." }],
      sessionTitle: "First prompt should be the preview.",
    }));

    expect(firstChunks.find((chunk) => chunk.type === "finish")?.providerSessionHandle).toEqual({
      type: "codex_app_server_thread",
      threadId: "thread-new",
    });
    expect(fakeProcess.requests).toContainEqual({
      method: "thread/name/set",
      params: {
        threadId: "thread-new",
        name: "First prompt should be the preview.",
      },
    });

    await collectChunks(provider.stream("codex-app-server/gpt-5.4", {
      messages: [
        { role: "user", content: "First prompt should be the preview." },
        { role: "assistant", content: "Prior answer." },
        { role: "user", content: "Second prompt only." },
      ],
      sessionTitle: "First prompt should be the preview.",
      providerSessionHandle: {
        type: "codex_app_server_thread",
        threadId: "thread-new",
      },
    }));

    expect(fakeProcess.requests).toContainEqual({
      method: "thread/resume",
      params: expect.objectContaining({
        threadId: "thread-new",
      }),
    });
    const turnStartRequests = fakeProcess.requests
      .filter((request) => request.method === "turn/start")
      .map((request) => asTestRecord(request.params));
    const resumedInput = JSON.stringify(turnStartRequests[1]?.input ?? "");
    expect(resumedInput).toContain("Second prompt only.");
    expect(resumedInput).not.toContain("First prompt should be the preview.");
    expect(fakeProcess.requests.filter((request) => request.method === "thread/name/set")).toHaveLength(1);
  });

  test("starts a fresh Codex app-server thread when gateway tools lack a matching fingerprint", async () => {
    const fakeProcess = new FakeAppServerProcess();
    const provider = new CodexAppServerModelProvider({
      id: "codex-app-server",
      name: "Codex App Server",
      model: "codex-app-server/gpt-5.4",
      apiKey: "sk-test",
      authMode: "api_key",
      spawnImpl: (() => fakeProcess) as never,
    });

    await collectChunks(provider.stream("codex-app-server/gpt-5.4", {
      messages: [
        { role: "user", content: "First prompt." },
        { role: "assistant", content: "Prior answer." },
        { role: "user", content: "What should I do next?" },
      ],
      providerSessionHandle: {
        type: "codex_app_server_thread",
        threadId: "thread-existing",
      },
      gatewayToolBridgeConfig: {
        bridgeScriptPath: "/tmp/gateway-mcp-bridge.ts",
        toolDefsJson: JSON.stringify([
          {
            name: "workbench.list_queue",
            description: "List Workbench queue",
            inputSchema: { type: "object" },
          },
        ]),
        socketPath: "/tmp/spaceskit.sock",
      },
    }));

    const resumeRequest = fakeProcess.requests.find((request) => request.method === "thread/resume");
    expect(resumeRequest).toBeUndefined();
    const startRequest = fakeProcess.requests.find((request) => request.method === "thread/start");
    expect(startRequest).toBeDefined();
    expect(startRequest?.params).toMatchObject({
      dynamicTools: [
        {
          name: encodeDynamicToolName("workbench.list_queue"),
          description: "List Workbench queue",
          inputSchema: { type: "object" },
        },
      ],
    });
    const turnStartRequest = fakeProcess.requests.find((request) => request.method === "turn/start");
    const renderedInput = JSON.stringify(asTestRecord(turnStartRequest?.params).input ?? "");
    expect(renderedInput).toContain("First prompt.");
    expect(renderedInput).toContain("What should I do next?");
  });

  test("resumes Codex app-server threads when gateway tool fingerprints match", async () => {
    const fakeProcess = new FakeAppServerProcess();
    const provider = new CodexAppServerModelProvider({
      id: "codex-app-server",
      name: "Codex App Server",
      model: "codex-app-server/gpt-5.4",
      apiKey: "sk-test",
      authMode: "api_key",
      spawnImpl: (() => fakeProcess) as never,
    });
    const gatewayToolBridgeConfig = {
      bridgeScriptPath: "/tmp/gateway-mcp-bridge.ts",
      toolDefsJson: JSON.stringify([
        {
          name: "workbench.list_queue",
          description: "List Workbench queue",
          inputSchema: { type: "object" },
        },
      ]),
      socketPath: "/tmp/spaceskit.sock",
    };

    const firstChunks = await collectChunks(provider.stream("codex-app-server/gpt-5.4", {
      messages: [
        { role: "user", content: "First prompt." },
      ],
      gatewayToolBridgeConfig,
    }));
    const firstHandle = firstChunks.find((chunk) => chunk.type === "finish")?.providerSessionHandle;
    expect(firstHandle?.type).toBe("codex_app_server_thread");
    expect(firstHandle?.threadId).toBe("thread-new");
    expect(typeof firstHandle?.gatewayToolBridgeFingerprint).toBe("string");

    await collectChunks(provider.stream("codex-app-server/gpt-5.4", {
      messages: [
        { role: "user", content: "First prompt." },
        { role: "assistant", content: "Prior answer." },
        { role: "user", content: "Second prompt only." },
      ],
      providerSessionHandle: firstHandle,
      gatewayToolBridgeConfig,
    }));

    const resumeRequest = fakeProcess.requests.find((request) => request.method === "thread/resume");
    expect(resumeRequest).toBeDefined();
    expect(resumeRequest?.params).toMatchObject({
      threadId: "thread-new",
      dynamicTools: [
        {
          name: encodeDynamicToolName("workbench.list_queue"),
          description: "List Workbench queue",
          inputSchema: { type: "object" },
        },
      ],
    });
    const turnStartRequests = fakeProcess.requests
      .filter((request) => request.method === "turn/start")
      .map((request) => asTestRecord(request.params));
    const resumedInput = JSON.stringify(turnStartRequests[1]?.input ?? "");
    expect(resumedInput).toContain("Second prompt only.");
    expect(resumedInput).not.toContain("First prompt.");
  });

  test("synthesizes visible assistant output from completed agentMessage after activity delta", async () => {
    const fakeProcess = new FakeAppServerProcess({ emitAgentMessageDeltaBeforeCompleted: true });
    const provider = new CodexAppServerModelProvider({
      id: "codex-app-server",
      name: "Codex App Server",
      model: "codex-app-server/gpt-5.4",
      apiKey: "sk-test",
      authMode: "api_key",
      spawnImpl: (() => fakeProcess) as never,
    });

    const chunks = await collectChunks(provider.stream("codex-app-server/gpt-5.4", {
      messages: [{ role: "user", content: "Say hello." }],
    }));

    expect(chunks).toContainEqual({
      type: "text_delta",
      text: "answer from turn-1",
      transcriptVisibility: "activity_only",
      streamKind: "provider_client",
    });
    expect(chunks).toContainEqual({
      type: "text_delta",
      text: "answer from turn-1",
      transcriptVisibility: "visible",
      streamKind: "assistant_output",
    });

    const generateProcess = new FakeAppServerProcess({ emitAgentMessageDeltaBeforeCompleted: true });
    const generateProvider = new CodexAppServerModelProvider({
      id: "codex-app-server",
      name: "Codex App Server",
      model: "codex-app-server/gpt-5.4",
      apiKey: "sk-test",
      authMode: "api_key",
      spawnImpl: (() => generateProcess) as never,
    });

    const result = await generateProvider.generate("codex-app-server/gpt-5.4", {
      messages: [{ role: "user", content: "Say hello." }],
    });

    expect(result.message.content).toBe("answer from turn-1");
  });

  test("normalizes Codex app-server structured items into provider-neutral work item events", async () => {
    const fakeProcess = new FakeAppServerProcess({
      emitAgentMessageDeltaBeforeCompleted: true,
      emitStructuredWorkItems: true,
    });
    const provider = new CodexAppServerModelProvider({
      id: "codex-app-server",
      name: "Codex App Server",
      model: "codex-app-server/gpt-5.4",
      apiKey: "sk-test",
      authMode: "api_key",
      spawnImpl: (() => fakeProcess) as never,
    });

    const chunks = await collectChunks(provider.stream("codex-app-server/gpt-5.4", {
      messages: [{ role: "user", content: "Use structured app-server items." }],
    }));
    const workItemEvents = chunks
      .filter((chunk) => chunk.type === "work_item_event")
      .map((chunk) => chunk.workItemEvent);

    expect(workItemEvents.map((event) => event?.workItem.kind)).toEqual([
      "plan",
      "command",
      "fileChange",
      "toolCall",
      "collabAgent",
      "webSearch",
      "image",
      "reasoning",
      "plan",
      "artifact",
      "message",
    ]);

    const planEvents = workItemEvents.filter((event) => event?.workItem.kind === "plan");
    expect(planEvents[0]).toMatchObject({
      event: "updated",
      workItem: {
        id: "plan:turn-1",
        kind: "plan",
        status: "inProgress",
        plan: {
          explanation: "Use a two step plan.",
          steps: [
            { step: "Inspect workspace", status: "completed" },
            { step: "Apply focused changes", status: "inProgress" },
          ],
        },
      },
    });
    expect(planEvents.at(-1)).toMatchObject({
      event: "completed",
      workItem: {
        id: "plan-item-1",
        kind: "plan",
        status: "completed",
        plan: {
          explanation: "Final plan snapshot wins.",
          steps: [
            { step: "Inspect workspace", status: "completed" },
            { step: "Apply focused changes", status: "completed" },
          ],
        },
      },
    });
    expect(JSON.stringify(planEvents.at(-1))).not.toContain("experimental partial plan text");

    expect(workItemEvents.find((event) => event?.workItem.kind === "artifact")).toMatchObject({
      event: "completed",
      workItem: {
        id: "artifact-1",
        kind: "artifact",
        status: "completed",
        title: "Rendered preview",
        artifact: {
          id: "artifact-1",
          title: "Rendered preview",
          path: "artifacts/preview.md",
          mimeType: "text/markdown",
          previewText: "Artifact body preview.",
        },
      },
    });

    expect(workItemEvents.at(-1)).toMatchObject({
      event: "completed",
      workItem: {
        id: "item-turn-1",
        kind: "message",
        status: "completed",
        body: {
          mimeType: "text/plain",
          text: "answer from turn-1",
        },
      },
    });
    const publicFieldNames = workItemEvents.flatMap((event) => Object.keys(event?.workItem ?? {}));
    expect(publicFieldNames.some((key) => key.toLowerCase().includes("codex"))).toBe(false);
    expect(chunks).toContainEqual({
      type: "text_delta",
      text: "answer from turn-1",
      transcriptVisibility: "visible",
      streamKind: "assistant_output",
    });
  });

  test("probes ChatGPT host-login metadata and surfaces discovered models", async () => {
    const fakeClient = new FakeCodexAppServerClient({
      authMode: "host_login",
      authStatus: "authenticated",
      authAccount: {
        email: "developer@example.com",
        subscriptionType: "pro",
        tokenSource: "chatgpt",
        apiProvider: "openai",
      },
      models: [
        {
          id: "codex-app-server/gpt-5.4",
          displayName: "GPT-5.4",
          contextWindow: 1_048_576,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: ["low", "medium", "high"],
          isDefault: true,
        },
        {
          id: "codex-app-server/gpt-5.4-mini",
          displayName: "GPT-5.4 Mini",
          contextWindow: 1_048_576,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: ["low", "medium", "high"],
        },
      ],
    });

    const provider = new CodexAppServerModelProvider({
      id: "codex-app-server",
      name: "Codex App Server",
      model: "codex-app-server/gpt-5.4",
      authMode: "host_login",
      clientFactory: () => fakeClient,
    });

    const probe = await provider.probeMetadata();
    const models = await provider.listModels();
    const health = await provider.checkHealth();

    expect(probe).toMatchObject({
      authMode: "host_login",
      authStatus: "authenticated",
      authAccount: {
        email: "developer@example.com",
        subscriptionType: "pro",
      },
    });
    expect(models.map((entry) => entry.id)).toEqual([
      "codex-app-server/gpt-5.4",
      "codex-app-server/gpt-5.4-mini",
    ]);
    expect(models[0]?.contextWindow).toBe(1_048_576);
    expect(health.available).toBe(true);
    expect(fakeClient.probeCalls.every((call) => call.authMode === "host_login")).toBe(true);
    expect(fakeClient.probeCalls[0]?.apiKey).toBeUndefined();
  });

  test("streams activity, dynamic tools, finish usage, and thread session handles", async () => {
    const fakeClient = new FakeCodexAppServerClient(
      {
        authMode: "api_key",
        authStatus: "authenticated",
        models: [],
      },
      [
        { type: "state_changed", state: "thinking" },
        { type: "reasoning_delta", text: "Inspecting the workspace" },
        {
          type: "tool_call_start",
          toolCall: {
            id: "call-1",
            name: "lists.echo",
            arguments: { message: "marker-123" },
          },
        },
        {
          type: "tool_call_end",
          toolCall: {
            id: "call-1",
            name: "lists.echo",
            arguments: { message: "marker-123" },
          },
        },
        {
          type: "tool_result",
          toolResult: {
            toolCallId: "call-1",
            result: { echoed: "marker-123" },
          },
        },
        { type: "text_delta", text: "Done" },
        {
          type: "finish",
          finishReason: "stop",
          usage: {
            promptTokens: 11,
            completionTokens: 7,
            totalTokens: 18,
            tokenAccuracy: "reported",
            usageSource: "ledger",
            usageDetails: {
              inputNoCacheTokens: 9,
              inputCacheReadTokens: 2,
              outputTextTokens: 7,
              outputReasoningTokens: 3,
            },
          },
          providerSessionHandle: {
            type: "codex_app_server_thread",
            threadId: "thread-123",
          },
        },
      ],
    );

    const provider = new CodexAppServerModelProvider({
      id: "codex-app-server",
      name: "Codex App Server",
      model: "codex-app-server/gpt-5.4",
      apiKey: "sk-test",
      authMode: "api_key",
      clientFactory: () => fakeClient,
    });

    const chunks = await collectChunks(provider.stream("codex-app-server/gpt-5.4", {
      messages: [{ role: "user", content: "Use the echo tool and confirm the marker." }],
      workingDirectory: "/tmp/spaces-workspace",
      effort: "high",
      providerSessionHandle: {
        type: "codex_app_server_thread",
        threadId: "thread-123",
      },
      gatewayToolBridgeConfig: {
        bridgeScriptPath: "/tmp/gateway-mcp-bridge.ts",
        toolDefsJson: "[{\"name\":\"lists.echo\",\"description\":\"Echo\",\"inputSchema\":{\"type\":\"object\"}}]",
        socketPath: "/tmp/spaceskit.sock",
      },
    }));

    expect(chunks).toEqual([
      { type: "state_changed", state: "thinking" },
      { type: "reasoning_delta", text: "Inspecting the workspace" },
      {
        type: "tool_call_start",
        toolCall: {
          id: "call-1",
          name: "lists.echo",
          arguments: { message: "marker-123" },
        },
      },
      {
        type: "tool_call_end",
        toolCall: {
          id: "call-1",
          name: "lists.echo",
          arguments: { message: "marker-123" },
        },
      },
      {
        type: "tool_result",
        toolResult: {
          toolCallId: "call-1",
          result: { echoed: "marker-123" },
        },
      },
      { type: "text_delta", text: "Done" },
      {
        type: "finish",
        finishReason: "stop",
        usage: {
          promptTokens: 11,
          completionTokens: 7,
          totalTokens: 18,
          tokenAccuracy: "reported",
          usageSource: "ledger",
          usageDetails: {
            inputNoCacheTokens: 9,
            inputCacheReadTokens: 2,
            outputTextTokens: 7,
            outputReasoningTokens: 3,
          },
        },
        providerSessionHandle: {
          type: "codex_app_server_thread",
          threadId: "thread-123",
        },
      },
    ]);
    expect(fakeClient.turnCalls[0]?.authMode).toBe("api_key");
    expect(fakeClient.turnCalls[0]?.apiKey).toBe("sk-test");
    expect(fakeClient.turnCalls[0]?.options.gatewayToolBridgeConfig?.socketPath).toBe("/tmp/spaceskit.sock");
    expect(fakeClient.turnCalls[0]?.options.providerSessionHandle).toEqual({
      type: "codex_app_server_thread",
      threadId: "thread-123",
    });
  });

  test("generate collects final assistant text, usage, and provider feedback requests", async () => {
    const fakeClient = new FakeCodexAppServerClient(
      {
        authMode: "host_login",
        authStatus: "needs_auth",
        models: [],
      },
      [
        { type: "text_delta", text: "Approval needed." },
        {
          type: "feedback_request",
          feedbackRequest: {
            triggerClass: "permission_gate",
            description: "Command execution requires approval.",
            options: ["approve", "reject"],
            context: { providerApprovalType: "command_execution" },
          },
        },
      ],
    );

    const provider = new CodexAppServerModelProvider({
      id: "codex-app-server",
      name: "Codex App Server",
      model: "codex-app-server/gpt-5.4",
      authMode: "host_login",
      clientFactory: () => fakeClient,
    });

    const result = await provider.generate("codex-app-server/gpt-5.4", {
      messages: [{ role: "user", content: "Run the command." }],
    });

    expect(result).toEqual({
      message: {
        role: "assistant",
        content: "Approval needed.",
      },
      finishReason: "other",
      feedbackRequest: {
        triggerClass: "permission_gate",
        description: "Command execution requires approval.",
        options: ["approve", "reject"],
        context: { providerApprovalType: "command_execution" },
      },
    });
  });

  test("generate ignores provider-client activity text and keeps only visible assistant output", async () => {
    const fakeClient = new FakeCodexAppServerClient(
      {
        authMode: "host_login",
        authStatus: "authenticated",
        models: [],
      },
      [
        {
          type: "text_delta",
          text: "Checking the workspace guidance first...",
          transcriptVisibility: "activity_only",
          streamKind: "provider_client",
        },
        {
          type: "text_delta",
          text: "Final answer.",
          transcriptVisibility: "visible",
          streamKind: "assistant_output",
        },
        {
          type: "finish",
          finishReason: "stop",
        },
      ],
    );

    const provider = new CodexAppServerModelProvider({
      id: "codex-app-server",
      name: "Codex App Server",
      model: "codex-app-server/gpt-5.4",
      authMode: "host_login",
      clientFactory: () => fakeClient,
    });

    const result = await provider.generate("codex-app-server/gpt-5.4", {
      messages: [{ role: "user", content: "Say hello." }],
    });

    expect(result.message.content).toBe("Final answer.");
  });
});
