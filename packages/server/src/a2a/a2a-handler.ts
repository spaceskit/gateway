/**
 * A2AHandler — HTTP handler for A2A protocol endpoints.
 *
 * Serves agent cards (profile → A2A card), accepts tasks (A2A message → space turn),
 * and streams results via SSE. This is the bridge that proves Spaceskit's
 * interoperability thesis: any A2A-compliant agent framework can send work to
 * Spaceskit and get results back.
 *
 * Endpoints:
 *   GET  /.well-known/agent.json    — Gateway-level agent card
 *   GET  /a2a/agents/:profileId     — Per-agent card
 *   POST /a2a/tasks                 — Create/continue a task
 *   GET  /a2a/tasks/:taskId         — Get task status
 */

import { randomUUID } from "node:crypto";
import type { EventBus, GatewayEvent, SpaceManager } from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import type {
  A2AAgentCard,
  A2AMessage,
  A2AStreamEvent,
  A2ATask,
  A2ATaskRequest,
  A2ATaskResponse,
  A2ATaskState,
} from "./types.js";

const AGENT_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const MAX_TEXT_BYTES = 100 * 1024;
const DEFAULT_REQUESTED_BY = "a2a";

type A2ATopology = "direct" | "shared_team_chat" | "broadcast_team";

interface PrincipalContext {
  principalId?: string;
  deviceId?: string;
}

interface TrackedTask {
  taskId: string;
  spaceId: string;
  turnId?: string;
  state: A2ATaskState;
  messages: A2AMessage[];
  createdAt: Date;
  topology?: A2ATopology;
  requestedBy?: string;
  deviceId?: string;
}

interface DurableTaskProgress {
  taskId: string;
  state: string;
  spaceId: string;
  progress?: {
    rootTurnId?: string;
    latestMessage?: string;
    finalSummaryText?: string;
  };
  taskDescription: string;
  topology?: string;
  createdAt: string;
  completedAt: string | null;
  errorMessage?: string;
}

interface OrchestrationTaskResult {
  taskId: string;
  spaceId: string;
  state: string;
  rootTurnId?: string;
}

interface A2ATaskOrchestrationService {
  orchestrate: (input: {
    taskDescription: string;
    requestedBy: string;
    deviceId?: string;
    templateId?: string;
    templateHint?: string;
    agentCount?: number;
    agentTier?: string;
    topology?: A2ATopology;
    spaceId?: string;
    maxTurns?: number;
  }) => Promise<OrchestrationTaskResult>;
  getTaskProgress?: (taskId: string, requestedBy?: string) => DurableTaskProgress | undefined;
}

interface A2ASpaceAdminService {
  createSpace: (input: Record<string, unknown>) => Promise<{ id: string }>;
  addAgent: (input: {
    spaceId: string;
    agentId: string;
    profileId: string;
    role: string;
    isPrimary: boolean;
    spawnContext?: string;
  }) => Promise<unknown>;
}

interface ParsedTaskMetadata {
  templateId?: string;
  templateHint?: string;
  agentCount?: number;
  agentTier?: string;
  topology?: A2ATopology;
  maxTurns?: number;
  spaceId?: string;
}

export interface A2AHandlerOptions {
  spaceManager: SpaceManager;
  eventBus: EventBus;
  logger: Logger;
  baseUrl: string;
  loadProfile: (profileId: string) => Promise<{
    name: string;
    description?: string;
    personalityPrompt?: string;
    defaultSkillIds: string[];
    activeRevision: number;
  } | null>;
  listProfiles: () => Promise<Array<{ profileId: string; name: string; description?: string }>>;
  authRequired?: boolean;
  maxTasks?: number;
  taskTtlMs?: number;
  resolvePrincipalContext?: (req: Request) => PrincipalContext | null | undefined;
  taskOrchestrationService?: A2ATaskOrchestrationService;
  spaceAdminService?: A2ASpaceAdminService;
}

export class A2AHandler {
  private readonly options: A2AHandlerOptions;
  private readonly tasks = new Map<string, TrackedTask>();

  constructor(options: A2AHandlerOptions) {
    this.options = options;

    this.options.eventBus.on("space.turn_event", (event) => {
      this.handleTurnEvent(event);
    });
    this.options.eventBus.on("space.orchestrator_event", (event) => {
      this.handleOrchestratorEvent(event);
    });
    this.options.eventBus.on("task.progress", (event) => {
      this.handleTaskProgressEvent(event);
    });
    this.options.eventBus.on("task.completed", (event) => {
      this.handleTaskCompletedEvent(event);
    });
    this.options.eventBus.on("task.failed", (event) => {
      this.handleTaskFailedEvent(event);
    });
    this.options.eventBus.on("task.input-required", (event) => {
      this.handleTaskInputRequiredEvent(event);
    });
  }

  setBaseUrl(baseUrl: string): void {
    this.options.baseUrl = baseUrl;
  }

  async handleRequest(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const method = req.method;

    if (method === "GET" && url.pathname === "/.well-known/agent.json") {
      return this.handleGatewayCard();
    }

    const agentCardMatch = url.pathname.match(/^\/a2a\/agents\/(.+)$/);
    if (method === "GET" && agentCardMatch) {
      return this.handleAgentCard(agentCardMatch[1]);
    }

    if (method === "POST" && url.pathname === "/a2a/tasks") {
      const authDenied = this.checkAuth(req);
      if (authDenied) return authDenied;
      const wantsStream = req.headers.get("Accept")?.includes("text/event-stream");
      return this.handleCreateTask(req, wantsStream ?? false);
    }

    const taskMatch = url.pathname.match(/^\/a2a\/tasks\/(.+)$/);
    if (method === "GET" && taskMatch) {
      const authDenied = this.checkAuth(req);
      if (authDenied) return authDenied;
      return this.handleGetTask(taskMatch[1], req);
    }

    return null;
  }

  private checkAuth(req: Request): Response | null {
    if (this.options.authRequired === false) return null;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer" || !parts[1].trim()) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    return null;
  }

  private evictExpiredTasks(): void {
    const ttlMs = this.options.taskTtlMs ?? 3_600_000;
    const now = Date.now();
    for (const [taskId, task] of this.tasks) {
      if (now - task.createdAt.getTime() > ttlMs) {
        this.tasks.delete(taskId);
      }
    }
  }

  private async handleGatewayCard(): Promise<Response> {
    const profiles = await this.options.listProfiles();

    const card: A2AAgentCard = {
      name: "Spaceskit",
      description:
        "A coordination protocol for multi-agent environments. Send tasks and Spaceskit will orchestrate agents to complete them.",
      url: this.options.baseUrl,
      version: "2.0.0",
      capabilities: {
        streaming: true,
        pushNotifications: false,
        stateTransitionHistory: true,
      },
      defaultInputModes: ["text/plain", "application/json"],
      defaultOutputModes: ["text/plain", "application/json"],
      skills: profiles.map((profile) => ({
        id: profile.profileId,
        name: profile.name,
        description: profile.description,
      })),
      authentication: { type: "none" },
    };

    return Response.json(card, {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleAgentCard(profileId: string): Promise<Response> {
    const profile = await this.options.loadProfile(profileId);
    if (!profile) {
      return Response.json({ error: `Profile ${profileId} not found` }, { status: 404 });
    }

    const card: A2AAgentCard = {
      name: profile.name,
      description: profile.description ?? "",
      url: `${this.options.baseUrl}/a2a`,
      version: `r${profile.activeRevision}`,
      capabilities: {
        streaming: true,
        pushNotifications: false,
        stateTransitionHistory: true,
      },
      defaultInputModes: ["text/plain", "application/json"],
      defaultOutputModes: ["text/plain", "application/json"],
      skills: profile.defaultSkillIds.map((id) => ({ id, name: id })),
      authentication: { type: "none" },
    };

    return Response.json(card, {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleCreateTask(req: Request, wantsStream: boolean): Promise<Response> {
    let body: A2ATaskRequest;
    try {
      body = (await req.json()) as A2ATaskRequest;
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (body.agentId !== undefined && body.agentId !== null && !AGENT_ID_RE.test(body.agentId)) {
      return Response.json(
        { error: "Invalid agentId: must match /^[a-zA-Z0-9_-]{1,128}$/" },
        { status: 400 },
      );
    }

    if (!body.message?.parts?.length) {
      return Response.json({ error: "message with at least one part is required" }, { status: 400 });
    }

    const totalTextBytes = body.message.parts
      .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
      .reduce((acc, part) => acc + Buffer.byteLength(part.text, "utf8"), 0);

    if (totalTextBytes > MAX_TEXT_BYTES) {
      return Response.json({ error: "Message text exceeds maximum allowed size of 100KB" }, { status: 400 });
    }

    const inputText = body.message.parts
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    if (!inputText) {
      return Response.json({ error: "At least one text part is required" }, { status: 400 });
    }

    this.evictExpiredTasks();
    if (this.tasks.size >= (this.options.maxTasks ?? 1000)) {
      return Response.json({ error: "Task limit reached" }, { status: 429 });
    }

    const principalContext = this.resolvePrincipalContext(req);
    if (this.options.taskOrchestrationService) {
      return this.handleOrchestratedTask(body, inputText, wantsStream, principalContext);
    }

    const taskId = randomUUID();
    const spaceId = `a2a-${taskId}`;
    const task: TrackedTask = {
      taskId,
      spaceId,
      state: "working",
      messages: [body.message],
      createdAt: new Date(),
    };

    try {
      const { turnId } = await this.options.spaceManager.executeTurn(spaceId, inputText, body.agentId);
      task.turnId = turnId;
      this.tasks.set(taskId, task);
    } catch (error) {
      task.state = "failed";
      this.tasks.set(taskId, task);
      const message = error instanceof Error ? error.message : "Task execution failed";
      return Response.json({
        task: {
          id: taskId,
          state: "failed",
          messages: task.messages,
          metadata: { error: message },
        },
      } satisfies A2ATaskResponse, { status: 500 });
    }

    if (wantsStream) {
      return this.streamTaskEvents(taskId);
    }

    return Response.json({
      task: this.serializeTask(this.tasks.get(taskId)!),
    } satisfies A2ATaskResponse);
  }

  private async handleOrchestratedTask(
    body: A2ATaskRequest,
    inputText: string,
    wantsStream: boolean,
    principalContext: PrincipalContext,
  ): Promise<Response> {
    const metadata = parseTaskMetadata(body.metadata);
    let spaceId = metadata.spaceId;
    let topology = metadata.topology;
    let agentCount = metadata.agentCount;
    let maxTurns = metadata.maxTurns;

    if (body.agentId) {
      topology = "direct";
      agentCount = 1;
      maxTurns = 1;
      if (!spaceId && this.options.spaceAdminService) {
        const created = await this.options.spaceAdminService.createSpace({
          name: summarizeTaskName(inputText),
          goal: inputText,
          resourceId: `a2a:${randomUUID()}`,
          conversationTopology: "direct",
          turnModel: "primary_only",
        });
        spaceId = created.id;
        await this.options.spaceAdminService.addAgent({
          spaceId,
          agentId: "agent-1",
          profileId: body.agentId,
          role: "participant",
          isPrimary: true,
          spawnContext: inputText,
        });
      }
    }

    const requestedBy = principalContext.principalId ?? DEFAULT_REQUESTED_BY;
    const result = await this.options.taskOrchestrationService!.orchestrate({
      taskDescription: inputText,
      requestedBy,
      deviceId: principalContext.deviceId,
      templateId: metadata.templateId,
      templateHint: metadata.templateHint,
      agentCount,
      agentTier: metadata.agentTier,
      topology,
      spaceId,
      maxTurns,
    });

    const task: TrackedTask = {
      taskId: result.taskId,
      spaceId: result.spaceId,
      turnId: normalizeOptional(result.rootTurnId),
      state: normalizeTaskState(result.state),
      messages: [body.message],
      createdAt: new Date(),
      topology,
      requestedBy,
      deviceId: principalContext.deviceId,
    };
    this.tasks.set(task.taskId, task);

    if (wantsStream) {
      return this.streamTaskEvents(task.taskId);
    }

    return Response.json({
      task: this.serializeTask(task),
    } satisfies A2ATaskResponse);
  }

  private async handleGetTask(taskIdRaw: string, req: Request): Promise<Response> {
    const taskId = normalizeRequired(taskIdRaw, "taskId");
    const tracked = this.tasks.get(taskId);
    if (tracked) {
      return Response.json({
        task: this.serializeTask(tracked),
      } satisfies A2ATaskResponse);
    }

    const requestedBy = this.resolvePrincipalContext(req).principalId;
    const progress = this.options.taskOrchestrationService?.getTaskProgress?.(taskId, requestedBy);
    if (!progress) {
      return Response.json({ error: `Task ${taskId} not found` }, { status: 404 });
    }

    const hydrated = hydrateTaskFromProgress(progress);
    this.tasks.set(taskId, hydrated);
    return Response.json({
      task: this.serializeTask(hydrated),
    } satisfies A2ATaskResponse);
  }

  private streamTaskEvents(taskId: string): Response {
    const task = this.tasks.get(taskId);
    if (!task) {
      return Response.json({ error: `Task ${taskId} not found` }, { status: 404 });
    }

    const encoder = new TextEncoder();
    let closed = false;
    const unsubscribers: Array<() => void> = [];

    const cleanup = () => {
      if (closed) return;
      closed = true;
      while (unsubscribers.length > 0) {
        const unsubscribe = unsubscribers.pop();
        try {
          unsubscribe?.();
        } catch {
          // Ignore unsubscribe failures.
        }
      }
    };

    const safeEnqueue = (controller: ReadableStreamDefaultController, payload: A2AStreamEvent) => {
      if (closed) return;
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      } catch {
        cleanup();
      }
    };

    const safeClose = (controller: ReadableStreamDefaultController) => {
      if (closed) return;
      cleanup();
      try {
        controller.close();
      } catch {
        // Ignore duplicate close.
      }
    };

    const stream = new ReadableStream({
      start: (controller) => {
        safeEnqueue(controller, { type: "task.started", taskId });

        unsubscribers.push(this.options.eventBus.on("task.progress", (event) => {
          const current = this.tasks.get(taskId);
          if (!current || taskIdFromEvent(event) !== taskId) return;
          const message = messageFromTaskProgressEvent(event);
          if (!message) return;
          safeEnqueue(controller, {
            type: "task.progress",
            taskId,
            message,
          });
        }));

        unsubscribers.push(this.options.eventBus.on("task.completed", (event) => {
          const current = this.tasks.get(taskId);
          if (!current || taskIdFromEvent(event) !== taskId) return;
          safeEnqueue(controller, {
            type: "task.completed",
            task: this.serializeTask(current),
          });
          safeClose(controller);
        }));

        unsubscribers.push(this.options.eventBus.on("task.failed", (event) => {
          const current = this.tasks.get(taskId);
          if (!current || taskIdFromEvent(event) !== taskId) return;
          safeEnqueue(controller, {
            type: "task.failed",
            taskId,
            error: errorFromTaskFailedEvent(event) ?? "Task failed",
          });
          safeClose(controller);
        }));

        unsubscribers.push(this.options.eventBus.on("task.input-required", (event) => {
          const current = this.tasks.get(taskId);
          if (!current || taskIdFromEvent(event) !== taskId) return;
          const message = messageFromTaskInputRequiredEvent(event) ?? current.messages.at(-1);
          if (!message) return;
          safeEnqueue(controller, {
            type: "task.input-required",
            taskId,
            message,
          });
        }));

        unsubscribers.push(this.options.eventBus.on("space.turn_event", (event) => {
          const current = this.tasks.get(taskId);
          if (!current || !matchesTurnEvent(current, event)) return;
          const turnEventType = eventTypeFromTurnEvent(event);
          if (turnEventType === "text_delta") {
            const text = textFromTurnEvent(event);
            if (!text) return;
            safeEnqueue(controller, {
              type: "task.progress",
              taskId,
              message: agentTextMessage(text),
            });
            return;
          }
          if (turnEventType === "feedback_requested" && current.state === "input-required") {
            const message = current.messages.at(-1);
            if (!message) return;
            safeEnqueue(controller, {
              type: "task.input-required",
              taskId,
              message,
            });
            return;
          }
          if (turnEventType === "error" && current.state === "failed") {
            safeEnqueue(controller, {
              type: "task.failed",
              taskId,
              error: errorFromTurnEvent(event) ?? "Task failed",
            });
            safeClose(controller);
            return;
          }
          if (turnEventType === "turn_completed" && current.state === "completed") {
            safeEnqueue(controller, {
              type: "task.completed",
              task: this.serializeTask(current),
            });
            safeClose(controller);
          }
        }));

        unsubscribers.push(this.options.eventBus.on("space.orchestrator_event", (event) => {
          const current = this.tasks.get(taskId);
          if (!current || !matchesOrchestratorEvent(current, event)) return;
          const eventType = orchestratorEventType(event);
          if (eventType === "summary.completed" && current.state === "completed") {
            safeEnqueue(controller, {
              type: "task.completed",
              task: this.serializeTask(current),
            });
            safeClose(controller);
            return;
          }
          if (eventType === "summary.failed" && current.state === "failed") {
            safeEnqueue(controller, {
              type: "task.failed",
              taskId,
              error: errorFromOrchestratorEvent(event) ?? "Task failed",
            });
            safeClose(controller);
          }
        }));
      },
      cancel: () => {
        cleanup();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  private handleTurnEvent(event: GatewayEvent): void {
    for (const task of this.tasks.values()) {
      if (!matchesTurnEvent(task, event)) continue;
      const turnEventType = eventTypeFromTurnEvent(event);
      if (turnEventType === "feedback_requested") {
        task.state = "input-required";
        appendAgentMessage(task, feedbackDescriptionFromTurnEvent(event) ?? "Input required");
        continue;
      }
      if (turnEventType === "error") {
        task.state = "failed";
        appendAgentMessage(task, errorFromTurnEvent(event) ?? "Task execution failed");
        continue;
      }
      if (turnEventType !== "turn_completed") {
        continue;
      }

      const topology = topologyFromTurnEvent(event) ?? task.topology;
      if (topology) {
        task.topology = topology;
      }
      if (topology && topology !== "direct") {
        task.state = "working";
        continue;
      }

      task.state = "completed";
      appendAgentMessage(task, finalTextFromTurnEvent(event));
    }
  }

  private handleOrchestratorEvent(event: GatewayEvent): void {
    for (const task of this.tasks.values()) {
      if (!matchesOrchestratorEvent(task, event)) continue;
      const eventType = orchestratorEventType(event);
      if (eventType === "summary.completed") {
        task.state = "completed";
        if (!task.turnId) {
          task.turnId = normalizeOptional(orchestratorCorrelationId(event));
        }
        appendAgentMessage(task, summaryTextFromOrchestratorEvent(event));
        continue;
      }
      if (eventType === "summary.failed") {
        task.state = "failed";
        if (!task.turnId) {
          task.turnId = normalizeOptional(orchestratorCorrelationId(event));
        }
        appendAgentMessage(task, errorFromOrchestratorEvent(event) ?? "Task orchestration failed");
      }
    }
  }

  private handleTaskProgressEvent(event: GatewayEvent): void {
    const taskId = taskIdFromEvent(event);
    if (!taskId) return;
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.state = "working";
  }

  private handleTaskCompletedEvent(event: GatewayEvent): void {
    const taskId = taskIdFromEvent(event);
    if (!taskId) return;
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.state = "completed";
    appendAgentMessage(task, summaryTextFromTaskCompletedEvent(event));
  }

  private handleTaskFailedEvent(event: GatewayEvent): void {
    const taskId = taskIdFromEvent(event);
    if (!taskId) return;
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.state = "failed";
    appendAgentMessage(task, errorFromTaskFailedEvent(event) ?? "Task failed");
  }

  private handleTaskInputRequiredEvent(event: GatewayEvent): void {
    const taskId = taskIdFromEvent(event);
    if (!taskId) return;
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.state = "input-required";
    appendAgentMessage(task, textFromTaskInputRequiredEvent(event) ?? "Input required");
  }

  private serializeTask(task: TrackedTask): A2ATask {
    const metadata = buildTaskMetadata(task);
    return {
      id: task.taskId,
      state: task.state,
      messages: task.messages,
      metadata: metadata ?? undefined,
    };
  }

  private resolvePrincipalContext(req: Request): PrincipalContext {
    const resolved = this.options.resolvePrincipalContext?.(req) ?? {};
    return {
      principalId: normalizeOptional(resolved.principalId),
      deviceId: normalizeOptional(resolved.deviceId),
    };
  }
}

function parseTaskMetadata(metadata: Record<string, unknown> | undefined): ParsedTaskMetadata {
  if (!metadata) return {};
  return {
    templateId: normalizeOptional(asString(metadata.templateId)),
    templateHint: normalizeOptional(asString(metadata.templateHint)),
    agentCount: normalizePositiveInteger(metadata.agentCount),
    agentTier: normalizeOptional(asString(metadata.agentTier)),
    topology: normalizeTopology(asString(metadata.topology)),
    maxTurns: normalizePositiveInteger(metadata.maxTurns),
    spaceId: normalizeOptional(asString(metadata.spaceId)),
  };
}

function hydrateTaskFromProgress(progress: DurableTaskProgress): TrackedTask {
  const state = normalizeTaskState(progress.state);
  const detail = state === "completed"
    ? normalizeOptional(progress.progress?.finalSummaryText)
    : state === "failed"
      ? normalizeOptional(progress.errorMessage) ?? normalizeOptional(progress.progress?.latestMessage)
      : normalizeOptional(progress.progress?.latestMessage);
  const messages: A2AMessage[] = [
    {
      role: "user",
      parts: [{ type: "text", text: progress.taskDescription }],
    },
  ];
  if (detail) {
    messages.push(agentTextMessage(detail));
  }
  return {
    taskId: progress.taskId,
    spaceId: progress.spaceId,
    turnId: normalizeOptional(progress.progress?.rootTurnId),
    state,
    messages,
    createdAt: new Date(progress.createdAt),
    topology: normalizeTopology(progress.topology),
  };
}

function buildTaskMetadata(task: TrackedTask): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {};
  if (task.spaceId) {
    metadata.spaceId = task.spaceId;
  }
  if (task.turnId) {
    metadata.rootTurnId = task.turnId;
  }
  if (task.topology) {
    metadata.conversationTopology = task.topology;
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function normalizeTaskState(value: string): A2ATaskState {
  switch (value) {
    case "submitted":
      return "submitted";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    case "input_required":
    case "input-required":
      return "input-required";
    default:
      return "working";
  }
}

function appendAgentMessage(task: TrackedTask, text: string | undefined): void {
  const normalized = normalizeOptional(text);
  if (!normalized) return;
  const last = task.messages.at(-1);
  if (
    last?.role === "agent"
    && last.parts.length === 1
    && last.parts[0]?.type === "text"
    && last.parts[0].text === normalized
  ) {
    return;
  }
  task.messages.push(agentTextMessage(normalized));
}

function agentTextMessage(text: string): A2AMessage {
  return {
    role: "agent",
    parts: [{ type: "text", text }],
  };
}

function matchesTurnEvent(task: TrackedTask, event: GatewayEvent): boolean {
  if (eventSpaceId(event) !== task.spaceId) return false;
  const eventTurnId = normalizeOptional(asString((event as { turnId?: unknown }).turnId));
  return !task.turnId || !eventTurnId || task.turnId === eventTurnId;
}

function matchesOrchestratorEvent(task: TrackedTask, event: GatewayEvent): boolean {
  if (eventSpaceId(event) !== task.spaceId) return false;
  const correlationId = normalizeOptional(orchestratorCorrelationId(event));
  return !task.turnId || !correlationId || task.turnId === correlationId;
}

function eventSpaceId(event: GatewayEvent): string | undefined {
  return normalizeOptional(asString((event as { spaceId?: unknown }).spaceId));
}

function taskIdFromEvent(event: GatewayEvent): string | undefined {
  const data = (event as { data?: { taskId?: unknown } }).data;
  return normalizeOptional(asString(data?.taskId));
}

function messageFromTaskProgressEvent(event: GatewayEvent): A2AMessage | undefined {
  const data = (event as { data?: { message?: unknown } }).data;
  const text = normalizeOptional(asString(data?.message));
  return text ? agentTextMessage(text) : undefined;
}

function summaryTextFromTaskCompletedEvent(event: GatewayEvent): string | undefined {
  const data = (event as { data?: { finalSummaryText?: unknown } }).data;
  return normalizeOptional(asString(data?.finalSummaryText));
}

function messageFromTaskInputRequiredEvent(event: GatewayEvent): A2AMessage | undefined {
  const text = textFromTaskInputRequiredEvent(event);
  return text ? agentTextMessage(text) : undefined;
}

function textFromTaskInputRequiredEvent(event: GatewayEvent): string | undefined {
  const data = (event as { data?: { message?: unknown } }).data;
  return normalizeOptional(asString(data?.message));
}

function errorFromTaskFailedEvent(event: GatewayEvent): string | undefined {
  const data = (event as { data?: { error?: unknown } }).data;
  return normalizeOptional(asString(data?.error));
}

function eventTypeFromTurnEvent(event: GatewayEvent): string | undefined {
  const turnEvent = (event as { event?: { type?: unknown } }).event;
  return normalizeOptional(asString(turnEvent?.type));
}

function textFromTurnEvent(event: GatewayEvent): string | undefined {
  const turnEvent = (event as { event?: { text?: unknown } }).event;
  return normalizeOptional(asString(turnEvent?.text));
}

function feedbackDescriptionFromTurnEvent(event: GatewayEvent): string | undefined {
  const turnEvent = (event as { event?: { request?: { description?: unknown } } }).event;
  return normalizeOptional(asString(turnEvent?.request?.description));
}

function errorFromTurnEvent(event: GatewayEvent): string | undefined {
  const turnEvent = (event as { event?: { error?: { message?: unknown } } }).event;
  return normalizeOptional(asString(turnEvent?.error?.message));
}

function finalTextFromTurnEvent(event: GatewayEvent): string | undefined {
  const turnEvent = (event as { event?: { result?: { finalMessage?: { content?: unknown } } } }).event;
  return normalizeOptional(asString(turnEvent?.result?.finalMessage?.content));
}

function topologyFromTurnEvent(event: GatewayEvent): A2ATopology | undefined {
  return normalizeTopology(asString((event as { conversationTopology?: unknown }).conversationTopology));
}

function orchestratorEventType(event: GatewayEvent): string | undefined {
  return normalizeOptional(asString((event as { eventType?: unknown }).eventType));
}

function orchestratorCorrelationId(event: GatewayEvent): string | undefined {
  return normalizeOptional(asString((event as { correlationId?: unknown }).correlationId));
}

function summaryTextFromOrchestratorEvent(event: GatewayEvent): string | undefined {
  const orchestratorEvent = (event as { event?: { summary?: { finalSummaryText?: unknown } } }).event;
  return normalizeOptional(asString(orchestratorEvent?.summary?.finalSummaryText));
}

function errorFromOrchestratorEvent(event: GatewayEvent): string | undefined {
  const orchestratorEvent = (event as { event?: { summary?: { failureReason?: unknown } } }).event;
  return normalizeOptional(asString(orchestratorEvent?.summary?.failureReason));
}

function summarizeTaskName(inputText: string): string {
  const compact = inputText.trim().replace(/\s+/g, " ");
  if (compact.length <= 60) return compact;
  return `${compact.slice(0, 57)}...`;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function normalizeTopology(value: string | undefined): A2ATopology | undefined {
  if (value === "direct" || value === "shared_team_chat" || value === "broadcast_team") {
    return value;
  }
  return undefined;
}

function normalizeRequired(value: string | undefined, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
