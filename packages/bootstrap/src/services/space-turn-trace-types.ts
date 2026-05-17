import type {
  EventLogRepository,
  OrchestrationJournalRepository,
  TurnRepository,
} from "@spaceskit/persistence";

export interface SpaceTurnTraceEvent {
  eventId: string;
  seq: number;
  eventType: string;
  eventSubtype?: string;
  agentId?: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface SpaceTurnTraceToolCall {
  toolCallId: string;
  toolName?: string;
  status: "started" | "completed" | "error";
  agentId?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface SpaceTurnTraceActivity {
  activityId: string;
  seq: number;
  eventType: string;
  agentId?: string;
  title: string;
  detail?: string;
  status?: string;
  visibility: string;
  toolCallId?: string;
  toolName?: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface SpaceTurnTraceExecutionRun {
  executionId: string;
  stepIndex: number;
  agentId?: string;
  providerId?: string;
  modelId?: string;
  status: "running" | "completed" | "failed";
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  workingDirectory?: string;
  exitCode?: number;
  commandPreview?: string;
  transcriptArtifactId?: string;
  transcriptTruncated: boolean;
}

export interface SpaceActivityLogEntry {
  entryId: string;
  source: "event_log" | "orchestration_journal" | "turns";
  category: string;
  turnId?: string;
  rootTurnId?: string;
  summaryTurnId?: string;
  agentId?: string;
  actorId?: string;
  eventType: string;
  title: string;
  detail?: string;
  status?: string;
  visibility: string;
  toolCallId?: string;
  toolName?: string;
  createdAt: string;
  seq: number;
  payload: Record<string, unknown>;
}

export interface SpaceListActivityLogResult {
  entries: SpaceActivityLogEntry[];
  total: number;
  nextOffset?: number;
}

export interface SpaceTurnTrace {
  spaceId: string;
  turnId: string;
  total: number;
  events: SpaceTurnTraceEvent[];
  toolCalls: SpaceTurnTraceToolCall[];
  activities: SpaceTurnTraceActivity[];
  executionRuns: SpaceTurnTraceExecutionRun[];
  artifactIds: string[];
}

export interface SpaceTurnTraceServiceOptions {
  eventLog: EventLogRepository;
  orchestrationJournal?: OrchestrationJournalRepository;
  turns?: TurnRepository;
}
