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
  A2ATask,
  A2ATaskRequest,
  A2ATaskResponse,
} from "./types.js";
import {
  applyOrchestratorEvent,
  applyTaskCompletedEvent,
  applyTaskFailedEvent,
  applyTaskInputRequiredEvent,
  applyTaskProgressEvent,
  applyTurnEvent,
  streamA2ATaskEvents,
} from "./a2a-task-events.js";
import {
  buildTaskMetadata,
  hydrateTaskFromProgress,
  normalizeOptional,
  normalizeRequired,
  normalizeTaskState,
  parseTaskMetadata,
  summarizeTaskName,
  type A2ASpaceAdminService,
  type A2ATaskOrchestrationService,
  type A2ATopology,
  type PrincipalContext,
  type TrackedTask,
} from "./a2a-task-state.js";

const AGENT_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const MAX_TEXT_BYTES = 100 * 1024;
const DEFAULT_REQUESTED_BY = "a2a";

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
    return streamA2ATaskEvents({
      taskId,
      tasks: this.tasks,
      eventBus: this.options.eventBus,
      serializeTask: this.serializeTask.bind(this),
    });
  }

  private handleTurnEvent(event: GatewayEvent): void {
    applyTurnEvent(this.tasks.values(), event);
  }

  private handleOrchestratorEvent(event: GatewayEvent): void {
    applyOrchestratorEvent(this.tasks.values(), event);
  }

  private handleTaskProgressEvent(event: GatewayEvent): void {
    applyTaskProgressEvent(this.tasks, event);
  }

  private handleTaskCompletedEvent(event: GatewayEvent): void {
    applyTaskCompletedEvent(this.tasks, event);
  }

  private handleTaskFailedEvent(event: GatewayEvent): void {
    applyTaskFailedEvent(this.tasks, event);
  }

  private handleTaskInputRequiredEvent(event: GatewayEvent): void {
    applyTaskInputRequiredEvent(this.tasks, event);
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
