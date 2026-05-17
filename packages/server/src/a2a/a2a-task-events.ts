import type { EventBus, GatewayEvent } from "@spaceskit/core";
import type { A2AStreamEvent, A2ATask } from "./types.js";
import {
  agentTextMessage,
  appendAgentMessage,
  errorFromOrchestratorEvent,
  errorFromTaskFailedEvent,
  errorFromTurnEvent,
  eventTypeFromTurnEvent,
  feedbackDescriptionFromTurnEvent,
  finalTextFromTurnEvent,
  matchesOrchestratorEvent,
  matchesTurnEvent,
  messageFromTaskInputRequiredEvent,
  messageFromTaskProgressEvent,
  normalizeOptional,
  orchestratorCorrelationId,
  orchestratorEventType,
  summaryTextFromOrchestratorEvent,
  summaryTextFromTaskCompletedEvent,
  taskIdFromEvent,
  textFromTaskInputRequiredEvent,
  textFromTurnEvent,
  topologyFromTurnEvent,
  type TrackedTask,
} from "./a2a-task-state.js";

export function streamA2ATaskEvents(input: {
  taskId: string;
  tasks: Map<string, TrackedTask>;
  eventBus: EventBus;
  serializeTask: (task: TrackedTask) => A2ATask;
}): Response {
  const task = input.tasks.get(input.taskId);
  if (!task) {
    return Response.json({ error: `Task ${input.taskId} not found` }, { status: 404 });
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
      safeEnqueue(controller, { type: "task.started", taskId: input.taskId });

      unsubscribers.push(input.eventBus.on("task.progress", (event) => {
        const current = input.tasks.get(input.taskId);
        if (!current || taskIdFromEvent(event) !== input.taskId) return;
        const message = messageFromTaskProgressEvent(event);
        if (!message) return;
        safeEnqueue(controller, {
          type: "task.progress",
          taskId: input.taskId,
          message,
        });
      }));

      unsubscribers.push(input.eventBus.on("task.completed", (event) => {
        const current = input.tasks.get(input.taskId);
        if (!current || taskIdFromEvent(event) !== input.taskId) return;
        safeEnqueue(controller, {
          type: "task.completed",
          task: input.serializeTask(current),
        });
        safeClose(controller);
      }));

      unsubscribers.push(input.eventBus.on("task.failed", (event) => {
        const current = input.tasks.get(input.taskId);
        if (!current || taskIdFromEvent(event) !== input.taskId) return;
        safeEnqueue(controller, {
          type: "task.failed",
          taskId: input.taskId,
          error: errorFromTaskFailedEvent(event) ?? "Task failed",
        });
        safeClose(controller);
      }));

      unsubscribers.push(input.eventBus.on("task.input-required", (event) => {
        const current = input.tasks.get(input.taskId);
        if (!current || taskIdFromEvent(event) !== input.taskId) return;
        const message = messageFromTaskInputRequiredEvent(event) ?? current.messages.at(-1);
        if (!message) return;
        safeEnqueue(controller, {
          type: "task.input-required",
          taskId: input.taskId,
          message,
        });
      }));

      unsubscribers.push(input.eventBus.on("space.turn_event", (event) => {
        const current = input.tasks.get(input.taskId);
        if (!current || !matchesTurnEvent(current, event)) return;
        const turnEventType = eventTypeFromTurnEvent(event);
        if (turnEventType === "text_delta") {
          const text = textFromTurnEvent(event);
          if (!text) return;
          safeEnqueue(controller, {
            type: "task.progress",
            taskId: input.taskId,
            message: agentTextMessage(text),
          });
          return;
        }
        if (turnEventType === "feedback_requested" && current.state === "input-required") {
          const message = current.messages.at(-1);
          if (!message) return;
          safeEnqueue(controller, {
            type: "task.input-required",
            taskId: input.taskId,
            message,
          });
          return;
        }
        if (turnEventType === "error" && current.state === "failed") {
          safeEnqueue(controller, {
            type: "task.failed",
            taskId: input.taskId,
            error: errorFromTurnEvent(event) ?? "Task failed",
          });
          safeClose(controller);
          return;
        }
        if (turnEventType === "turn_completed" && current.state === "completed") {
          safeEnqueue(controller, {
            type: "task.completed",
            task: input.serializeTask(current),
          });
          safeClose(controller);
        }
      }));

      unsubscribers.push(input.eventBus.on("space.orchestrator_event", (event) => {
        const current = input.tasks.get(input.taskId);
        if (!current || !matchesOrchestratorEvent(current, event)) return;
        const eventType = orchestratorEventType(event);
        if (eventType === "summary.completed" && current.state === "completed") {
          safeEnqueue(controller, {
            type: "task.completed",
            task: input.serializeTask(current),
          });
          safeClose(controller);
          return;
        }
        if (eventType === "summary.failed" && current.state === "failed") {
          safeEnqueue(controller, {
            type: "task.failed",
            taskId: input.taskId,
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

export function applyTurnEvent(tasks: Iterable<TrackedTask>, event: GatewayEvent): void {
  for (const task of tasks) {
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

export function applyOrchestratorEvent(tasks: Iterable<TrackedTask>, event: GatewayEvent): void {
  for (const task of tasks) {
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

export function applyTaskProgressEvent(tasks: Map<string, TrackedTask>, event: GatewayEvent): void {
  const task = taskFromEvent(tasks, event);
  if (task) {
    task.state = "working";
  }
}

export function applyTaskCompletedEvent(tasks: Map<string, TrackedTask>, event: GatewayEvent): void {
  const task = taskFromEvent(tasks, event);
  if (!task) return;
  task.state = "completed";
  appendAgentMessage(task, summaryTextFromTaskCompletedEvent(event));
}

export function applyTaskFailedEvent(tasks: Map<string, TrackedTask>, event: GatewayEvent): void {
  const task = taskFromEvent(tasks, event);
  if (!task) return;
  task.state = "failed";
  appendAgentMessage(task, errorFromTaskFailedEvent(event) ?? "Task failed");
}

export function applyTaskInputRequiredEvent(tasks: Map<string, TrackedTask>, event: GatewayEvent): void {
  const task = taskFromEvent(tasks, event);
  if (!task) return;
  task.state = "input-required";
  appendAgentMessage(task, textFromTaskInputRequiredEvent(event) ?? "Input required");
}

function taskFromEvent(tasks: Map<string, TrackedTask>, event: GatewayEvent): TrackedTask | undefined {
  const taskId = taskIdFromEvent(event);
  return taskId ? tasks.get(taskId) : undefined;
}
