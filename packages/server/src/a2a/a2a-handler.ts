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
 *
 * Stolen patterns:
 * - CrewAI: A2A with JSONRPC/HTTP+JSON + streaming
 * - Microsoft AF: A2A with HTTP/REST + SSE
 * - Spaceskit original: profiles as identity, spaces as execution
 */

import { randomUUID } from "node:crypto";
import type { SpaceManager } from "@spaceskit/core";
import type { EventBus, GatewayEvent } from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import type {
  A2AAgentCard,
  A2ATask,
  A2ATaskRequest,
  A2ATaskResponse,
  A2ATaskState,
  A2AMessage,
  A2AStreamEvent,
} from "./types.js";

/** Regex for validating agentId / profileId values. */
const AGENT_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

/** Maximum total text size across all message parts (100 KB). */
const MAX_TEXT_BYTES = 100 * 1024;

export interface A2AHandlerOptions {
  spaceManager: SpaceManager;
  eventBus: EventBus;
  logger: Logger;
  /** Gateway base URL (for agent card URL field). */
  baseUrl: string;
  /** Load a profile by ID for agent card generation. */
  loadProfile: (profileId: string) => Promise<{
    name: string;
    description?: string;
    personalityPrompt?: string;
    defaultSkillIds: string[];
    activeRevision: number;
  } | null>;
  /** List all active (non-archived) profiles. */
  listProfiles: () => Promise<Array<{ profileId: string; name: string; description?: string }>>;
  /**
   * If true, POST /a2a/tasks and GET /a2a/tasks/:taskId require
   * a valid Authorization: Bearer <token> header.
   * Discovery endpoints stay public. Default: true.
   */
  authRequired?: boolean;
  /** Maximum number of tracked tasks. Tasks beyond this limit (after eviction) return 429. Default: 1000. */
  maxTasks?: number;
  /** Task TTL in milliseconds. Tasks older than this are evicted. Default: 3600000 (1 hour). */
  taskTtlMs?: number;
}

// Task tracking: taskId → space execution state
interface TrackedTask {
  taskId: string;
  spaceId: string;
  turnId: string;
  state: A2ATaskState;
  messages: A2AMessage[];
  createdAt: Date;
}

export class A2AHandler {
  private options: A2AHandlerOptions;
  private tasks = new Map<string, TrackedTask>();

  constructor(options: A2AHandlerOptions) {
    this.options = options;

    // Listen for turn events to update task state
    this.options.eventBus.on("space.turn_event", (event: GatewayEvent) => {
      this.handleTurnEvent(event);
    });
  }

  /**
   * Update the public base URL exposed in A2A agent cards.
   * Useful when the server binds to a fallback port at runtime.
   */
  setBaseUrl(baseUrl: string): void {
    this.options.baseUrl = baseUrl;
  }

  /**
   * Handle an HTTP request to an A2A endpoint.
   * Returns a Response or null if the path doesn't match.
   */
  async handleRequest(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const method = req.method;

    // GET /.well-known/agent.json — Gateway-level discovery
    if (method === "GET" && url.pathname === "/.well-known/agent.json") {
      return this.handleGatewayCard();
    }

    // GET /a2a/agents/:profileId — Per-agent card
    const agentCardMatch = url.pathname.match(/^\/a2a\/agents\/(.+)$/);
    if (method === "GET" && agentCardMatch) {
      return this.handleAgentCard(agentCardMatch[1]);
    }

    // POST /a2a/tasks — Create or continue a task
    if (method === "POST" && url.pathname === "/a2a/tasks") {
      const authDenied = this.checkAuth(req);
      if (authDenied) return authDenied;
      const wantsStream = req.headers.get("Accept")?.includes("text/event-stream");
      return this.handleCreateTask(req, wantsStream ?? false);
    }

    // GET /a2a/tasks/:taskId — Get task status
    const taskMatch = url.pathname.match(/^\/a2a\/tasks\/(.+)$/);
    if (method === "GET" && taskMatch) {
      const authDenied = this.checkAuth(req);
      if (authDenied) return authDenied;
      return this.handleGetTask(taskMatch[1]);
    }

    return null; // Not an A2A route
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  /**
   * Check whether the request carries a valid Bearer token when authRequired is enabled.
   * Returns a 401 Response when auth fails, null when auth passes or is disabled.
   */
  private checkAuth(req: Request): Response | null {
    // Default to requiring auth unless explicitly disabled.
    if (this.options.authRequired === false) return null;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return Response.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer" || !parts[1].trim()) {
      return Response.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Task map eviction
  // ---------------------------------------------------------------------------

  /**
   * Evict tasks that have exceeded their TTL from the task map.
   * Called before each new task creation to keep memory bounded.
   */
  private evictExpiredTasks(): void {
    const ttlMs = this.options.taskTtlMs ?? 3_600_000;
    const now = Date.now();
    for (const [id, task] of this.tasks) {
      if (now - task.createdAt.getTime() > ttlMs) {
        this.tasks.delete(id);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Agent Cards
  // ---------------------------------------------------------------------------

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
      skills: profiles.map((p) => ({
        id: p.profileId,
        name: p.name,
        description: p.description,
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
      return Response.json(
        { error: `Profile ${profileId} not found` },
        { status: 404 },
      );
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

  // ---------------------------------------------------------------------------
  // Task Execution
  // ---------------------------------------------------------------------------

  private async handleCreateTask(
    req: Request,
    wantsStream: boolean,
  ): Promise<Response> {
    let body: A2ATaskRequest;
    try {
      body = (await req.json()) as A2ATaskRequest;
    } catch {
      return Response.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    // Validate agentId format if provided
    if (body.agentId !== undefined && body.agentId !== null) {
      if (!AGENT_ID_RE.test(body.agentId)) {
        return Response.json(
          { error: "Invalid agentId: must match /^[a-zA-Z0-9_-]{1,128}$/" },
          { status: 400 },
        );
      }
    }

    if (!body.message?.parts?.length) {
      return Response.json(
        { error: "message with at least one part is required" },
        { status: 400 },
      );
    }

    // Validate total text size across all parts
    const totalTextBytes = body.message.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof p.text === "string")
      .reduce((acc, p) => acc + Buffer.byteLength(p.text, "utf8"), 0);

    if (totalTextBytes > MAX_TEXT_BYTES) {
      return Response.json(
        { error: "Message text exceeds maximum allowed size of 100KB" },
        { status: 400 },
      );
    }

    // Extract text from parts
    const inputText = body.message.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n");

    if (!inputText) {
      return Response.json(
        { error: "At least one text part is required" },
        { status: 400 },
      );
    }

    // Evict expired tasks before checking capacity
    this.evictExpiredTasks();

    const maxTasks = this.options.maxTasks ?? 1000;
    if (this.tasks.size >= maxTasks) {
      return Response.json(
        { error: "Task limit reached" },
        { status: 429 },
      );
    }

    // Always generate a server-side task ID — never trust client-supplied IDs
    const taskId = randomUUID();

    // Create a temporary space for this A2A task
    const spaceId = `a2a-${taskId}`;

    // Track the task
    const task: TrackedTask = {
      taskId,
      spaceId,
      turnId: "",
      state: "submitted",
      messages: [],
      createdAt: new Date(),
    };

    task.messages.push(body.message);
    task.state = "working";

    // Execute turn in space
    try {
      const { turnId } = await this.options.spaceManager.executeTurn(
        spaceId,
        inputText,
        body.agentId,
      );
      task.turnId = turnId;
      this.tasks.set(taskId, task);
    } catch (err) {
      task.state = "failed";
      this.tasks.set(taskId, task);

      // Do not expose stack traces or internal error details
      const errorMsg = err instanceof Error ? err.message : "Task execution failed";
      return Response.json(
        {
          task: {
            id: taskId,
            state: "failed",
            messages: task.messages,
            metadata: { error: errorMsg },
          },
        } satisfies A2ATaskResponse,
        { status: 500 },
      );
    }

    // If streaming requested, return SSE
    if (wantsStream) {
      return this.streamTaskEvents(taskId);
    }

    // Otherwise return the task in its current state
    return Response.json({
      task: {
        id: taskId,
        state: task.state,
        messages: task.messages,
      },
    } satisfies A2ATaskResponse);
  }

  private async handleGetTask(taskId: string): Promise<Response> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return Response.json(
        { error: `Task ${taskId} not found` },
        { status: 404 },
      );
    }

    return Response.json({
      task: {
        id: task.taskId,
        state: task.state,
        messages: task.messages,
      },
    } satisfies A2ATaskResponse);
  }

  // ---------------------------------------------------------------------------
  // SSE Streaming
  // ---------------------------------------------------------------------------

  private streamTaskEvents(taskId: string): Response {
    const task = this.tasks.get(taskId);
    if (!task) {
      return Response.json(
        { error: `Task ${taskId} not found` },
        { status: 404 },
      );
    }

    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    };

    const safeEnqueue = (controller: ReadableStreamDefaultController, data: string) => {
      if (closed) return;
      try {
        controller.enqueue(encoder.encode(data));
      } catch {
        // Stream already closed (client disconnected) — clean up
        cleanup();
      }
    };

    const safeClose = (controller: ReadableStreamDefaultController) => {
      if (closed) return;
      cleanup();
      try {
        controller.close();
      } catch {
        // Already closed
      }
    };

    const stream = new ReadableStream({
      start: (controller) => {
        // Send initial event
        const startEvent: A2AStreamEvent = {
          type: "task.started",
          taskId,
        };
        safeEnqueue(controller, `data: ${JSON.stringify(startEvent)}\n\n`);

        // Listen for events on this space
        unsubscribe = this.options.eventBus.on(
          "space.turn_event",
          (event: GatewayEvent) => {
            if (closed) return;

            const spaceEvent = event as Record<string, unknown>;
            if (spaceEvent.spaceId !== task.spaceId) return;

            const turnEvent = spaceEvent.event as Record<string, unknown>;

            if (turnEvent?.type === "text_delta") {
              const progressEvent: A2AStreamEvent = {
                type: "task.progress",
                taskId,
                message: {
                  role: "agent",
                  parts: [{ type: "text", text: turnEvent.text as string }],
                },
              };
              safeEnqueue(controller, `data: ${JSON.stringify(progressEvent)}\n\n`);
            }

            if (turnEvent?.type === "turn_completed") {
              const result = turnEvent.result as Record<string, unknown>;
              const finalMessage = result?.finalMessage as Record<string, unknown>;

              task.state = "completed";
              task.messages.push({
                role: "agent",
                parts: [
                  {
                    type: "text",
                    text: (finalMessage?.content as string) ?? "",
                  },
                ],
              });

              const completedEvent: A2AStreamEvent = {
                type: "task.completed",
                task: {
                  id: taskId,
                  state: "completed",
                  messages: task.messages,
                },
              };
              safeEnqueue(controller, `data: ${JSON.stringify(completedEvent)}\n\n`);
              safeClose(controller);
            }

            if (turnEvent?.type === "error") {
              task.state = "failed";
              const failedEvent: A2AStreamEvent = {
                type: "task.failed",
                taskId,
                error:
                  (turnEvent.error as Error)?.message ?? "Unknown error",
              };
              safeEnqueue(controller, `data: ${JSON.stringify(failedEvent)}\n\n`);
              safeClose(controller);
            }

            if (turnEvent?.type === "feedback_requested") {
              task.state = "input-required";
              const inputEvent: A2AStreamEvent = {
                type: "task.input-required",
                taskId,
                message: {
                  role: "agent",
                  parts: [
                    {
                      type: "text",
                      text: (turnEvent.request as any)?.description ?? "Input required",
                    },
                  ],
                },
              };
              safeEnqueue(controller, `data: ${JSON.stringify(inputEvent)}\n\n`);
            }
          },
        );
      },
      cancel: () => {
        // Called when the client disconnects — clean up the event listener
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

  // ---------------------------------------------------------------------------
  // Event handling
  // ---------------------------------------------------------------------------

  private handleTurnEvent(event: GatewayEvent): void {
    // Update tracked tasks when their underlying turns complete
    for (const task of this.tasks.values()) {
      const spaceEvent = event as Record<string, unknown>;
      if (spaceEvent.spaceId !== task.spaceId) continue;

      const turnEvent = spaceEvent.event as Record<string, unknown>;
      if (turnEvent?.type === "turn_completed") {
        task.state = "completed";
        const result = turnEvent.result as Record<string, unknown>;
        const finalMessage = result?.finalMessage as Record<string, unknown>;
        if (finalMessage?.content) {
          task.messages.push({
            role: "agent",
            parts: [{ type: "text", text: finalMessage.content as string }],
          });
        }
      }
    }
  }
}
