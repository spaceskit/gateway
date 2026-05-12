import type { CreateSpaceInput } from "@spaceskit/core";
import type {
  WorkbenchApprovalState,
  WorkbenchExecutionMode,
  WorkbenchRunStage,
  WorkbenchRunStatus,
} from "@spaceskit/persistence";
import type { WorkbenchExecutionContextStagePayload } from "@spaceskit/server";

export type WorkbenchServiceErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "FAILED_PRECONDITION"
  | "PERMISSION_DENIED";

export class WorkbenchServiceError extends Error {
  readonly code: WorkbenchServiceErrorCode;

  constructor(code: WorkbenchServiceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

type WorkbenchExecutionAgent = NonNullable<CreateSpaceInput["initialAgents"]>[number];

export interface WorkbenchAgentTurnPaused {
  kind: "paused";
  stage: Extract<WorkbenchExecutionContextStagePayload, "planning" | "implementation">;
  turnId: string;
  reason: string;
}

export const WORKBENCH_PLANNING_AGENTS: WorkbenchExecutionAgent[] = [
  { agentId: "plan-coordinator", profileId: "plan-coordinator-opus", role: "global_coordinator", isPrimary: true, turnOrder: 0 },
  { agentId: "plan-codex-architect", profileId: "plan-codex-architect", role: "participant", isPrimary: false, turnOrder: 1 },
  { agentId: "plan-opus-reviewer", profileId: "plan-opus-reviewer", role: "participant", isPrimary: false, turnOrder: 2 },
  { agentId: "plan-gemini-constraints", profileId: "plan-gemini-constraints", role: "participant", isPrimary: false, turnOrder: 3 },
  { agentId: "plan-lmstudio-maintainer", profileId: "plan-lmstudio-maintainer", role: "participant", isPrimary: false, turnOrder: 4 },
  { agentId: "plan-apple-continuity", profileId: "plan-apple-continuity", role: "participant", isPrimary: false, turnOrder: 5 },
];

export const WORKBENCH_IMPLEMENTATION_AGENTS: WorkbenchExecutionAgent[] = [
  { agentId: "code-lead", profileId: "code-lead-codex", role: "global_coordinator", isPrimary: true, turnOrder: 6 },
  { agentId: "code-opus-reviewer", profileId: "code-opus-reviewer", role: "participant", isPrimary: false, turnOrder: 7 },
  { agentId: "code-gemini-integrator", profileId: "code-gemini-integrator", role: "participant", isPrimary: false, turnOrder: 8 },
  { agentId: "code-lmstudio-maintainer", profileId: "code-lmstudio-maintainer", role: "participant", isPrimary: false, turnOrder: 9 },
  { agentId: "code-apple-continuity", profileId: "code-apple-continuity", role: "participant", isPrimary: false, turnOrder: 10 },
];

export const WORKBENCH_PLANNING_AGENT_IDS = WORKBENCH_PLANNING_AGENTS.map((agent) => agent.agentId);
export const WORKBENCH_IMPLEMENTATION_AGENT_IDS = WORKBENCH_IMPLEMENTATION_AGENTS.map((agent) => agent.agentId);

export function isWorkbenchAgentTurnPaused(value: unknown): value is WorkbenchAgentTurnPaused {
  if (!value || typeof value !== "object") return false;
  const candidate = value as WorkbenchAgentTurnPaused;
  return candidate.kind === "paused"
    && (candidate.stage === "planning" || candidate.stage === "implementation")
    && typeof candidate.turnId === "string"
    && typeof candidate.reason === "string";
}

export function modePatchForRun(executionMode: WorkbenchExecutionMode) {
  if (executionMode === "supervised") {
    return {
      executionMode,
      status: "awaiting_review" as WorkbenchRunStatus,
      currentStage: "review_gate" as WorkbenchRunStage,
      approvalState: "pending" as WorkbenchApprovalState,
    };
  }
  return {
    executionMode,
    status: "queued" as WorkbenchRunStatus,
    currentStage: "execute" as WorkbenchRunStage,
    approvalState: "not_required" as WorkbenchApprovalState,
  };
}

export function initialRunStateForMode(executionMode: WorkbenchExecutionMode): {
  status: WorkbenchRunStatus;
  currentStage: WorkbenchRunStage;
  approvalState: WorkbenchApprovalState;
} {
  return modePatchForRun(executionMode);
}

export function normalizeRequired(value: string | undefined | null, fieldName: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new WorkbenchServiceError("INVALID_ARGUMENT", `${fieldName} is required`);
  }
  return normalized;
}

export function normalizeQueueItemIds(values: string[] | undefined): string[] {
  if (!values || values.length === 0) {
    throw new WorkbenchServiceError("INVALID_ARGUMENT", "queueItemIds is required");
  }
  return Array.from(new Set(values.map((value) => normalizeRequired(value, "queueItemId"))));
}

export function normalizeExecutionMode(value: string): WorkbenchExecutionMode {
  const normalized = value.trim().toLowerCase();
  if (normalized === "supervised" || normalized === "autonomous") {
    return normalized;
  }
  throw new WorkbenchServiceError("INVALID_ARGUMENT", `Unsupported executionMode: ${value}`);
}

export function normalizeLimit(limit: number, fallback = 100): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(500, Math.floor(limit)));
}

export function sanitizeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function parseJsonArray(raw: string): string[] {
  const value = parseJson<unknown>(raw);
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
