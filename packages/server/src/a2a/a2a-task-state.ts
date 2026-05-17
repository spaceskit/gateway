import type { GatewayEvent } from "@spaceskit/core";
import type { A2AMessage, A2ATaskState } from "./types.js";

export type A2ATopology = "direct" | "shared_team_chat" | "broadcast_team";

export interface PrincipalContext {
  principalId?: string;
  deviceId?: string;
}

export interface TrackedTask {
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

export interface DurableTaskProgress {
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

export interface OrchestrationTaskResult {
  taskId: string;
  spaceId: string;
  state: string;
  rootTurnId?: string;
}

export interface A2ATaskOrchestrationService {
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

export interface A2ASpaceAdminService {
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

export interface ParsedTaskMetadata {
  templateId?: string;
  templateHint?: string;
  agentCount?: number;
  agentTier?: string;
  topology?: A2ATopology;
  maxTurns?: number;
  spaceId?: string;
}

export function parseTaskMetadata(metadata: Record<string, unknown> | undefined): ParsedTaskMetadata {
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

export function hydrateTaskFromProgress(progress: DurableTaskProgress): TrackedTask {
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

export function buildTaskMetadata(task: TrackedTask): Record<string, unknown> | undefined {
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

export function normalizeTaskState(value: string): A2ATaskState {
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

export function appendAgentMessage(task: TrackedTask, text: string | undefined): void {
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

export function agentTextMessage(text: string): A2AMessage {
  return {
    role: "agent",
    parts: [{ type: "text", text }],
  };
}

export function matchesTurnEvent(task: TrackedTask, event: GatewayEvent): boolean {
  if (eventSpaceId(event) !== task.spaceId) return false;
  const eventTurnId = normalizeOptional(asString((event as { turnId?: unknown }).turnId));
  return !task.turnId || !eventTurnId || task.turnId === eventTurnId;
}

export function matchesOrchestratorEvent(task: TrackedTask, event: GatewayEvent): boolean {
  if (eventSpaceId(event) !== task.spaceId) return false;
  const correlationId = normalizeOptional(orchestratorCorrelationId(event));
  return !task.turnId || !correlationId || task.turnId === correlationId;
}

export function taskIdFromEvent(event: GatewayEvent): string | undefined {
  const data = (event as { data?: { taskId?: unknown } }).data;
  return normalizeOptional(asString(data?.taskId));
}

export function messageFromTaskProgressEvent(event: GatewayEvent): A2AMessage | undefined {
  const data = (event as { data?: { message?: unknown } }).data;
  const text = normalizeOptional(asString(data?.message));
  return text ? agentTextMessage(text) : undefined;
}

export function summaryTextFromTaskCompletedEvent(event: GatewayEvent): string | undefined {
  const data = (event as { data?: { finalSummaryText?: unknown } }).data;
  return normalizeOptional(asString(data?.finalSummaryText));
}

export function messageFromTaskInputRequiredEvent(event: GatewayEvent): A2AMessage | undefined {
  const text = textFromTaskInputRequiredEvent(event);
  return text ? agentTextMessage(text) : undefined;
}

export function textFromTaskInputRequiredEvent(event: GatewayEvent): string | undefined {
  const data = (event as { data?: { message?: unknown } }).data;
  return normalizeOptional(asString(data?.message));
}

export function errorFromTaskFailedEvent(event: GatewayEvent): string | undefined {
  const data = (event as { data?: { error?: unknown } }).data;
  return normalizeOptional(asString(data?.error));
}

export function eventTypeFromTurnEvent(event: GatewayEvent): string | undefined {
  const turnEvent = (event as { event?: { type?: unknown } }).event;
  return normalizeOptional(asString(turnEvent?.type));
}

export function textFromTurnEvent(event: GatewayEvent): string | undefined {
  const turnEvent = (event as { event?: { text?: unknown } }).event;
  return normalizeOptional(asString(turnEvent?.text));
}

export function feedbackDescriptionFromTurnEvent(event: GatewayEvent): string | undefined {
  const turnEvent = (event as { event?: { request?: { description?: unknown } } }).event;
  return normalizeOptional(asString(turnEvent?.request?.description));
}

export function errorFromTurnEvent(event: GatewayEvent): string | undefined {
  const turnEvent = (event as { event?: { error?: { message?: unknown } } }).event;
  return normalizeOptional(asString(turnEvent?.error?.message));
}

export function finalTextFromTurnEvent(event: GatewayEvent): string | undefined {
  const turnEvent = (event as { event?: { result?: { finalMessage?: { content?: unknown } } } }).event;
  return normalizeOptional(asString(turnEvent?.result?.finalMessage?.content));
}

export function topologyFromTurnEvent(event: GatewayEvent): A2ATopology | undefined {
  return normalizeTopology(asString((event as { conversationTopology?: unknown }).conversationTopology));
}

export function orchestratorEventType(event: GatewayEvent): string | undefined {
  return normalizeOptional(asString((event as { eventType?: unknown }).eventType));
}

export function orchestratorCorrelationId(event: GatewayEvent): string | undefined {
  return normalizeOptional(asString((event as { correlationId?: unknown }).correlationId));
}

export function summaryTextFromOrchestratorEvent(event: GatewayEvent): string | undefined {
  const orchestratorEvent = (event as { event?: { summary?: { finalSummaryText?: unknown } } }).event;
  return normalizeOptional(asString(orchestratorEvent?.summary?.finalSummaryText));
}

export function errorFromOrchestratorEvent(event: GatewayEvent): string | undefined {
  const orchestratorEvent = (event as { event?: { summary?: { failureReason?: unknown } } }).event;
  return normalizeOptional(asString(orchestratorEvent?.summary?.failureReason));
}

export function summarizeTaskName(inputText: string): string {
  const compact = inputText.trim().replace(/\s+/g, " ");
  if (compact.length <= 60) return compact;
  return `${compact.slice(0, 57)}...`;
}

export function normalizeRequired(value: string | undefined, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

export function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function eventSpaceId(event: GatewayEvent): string | undefined {
  return normalizeOptional(asString((event as { spaceId?: unknown }).spaceId));
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

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
