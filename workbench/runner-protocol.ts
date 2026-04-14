import type {
  LayerResult,
  ProviderParityRow,
  ScenarioResult,
  WorkbenchComparisonRow,
  WorkbenchEvalRunRecord,
  WorkbenchReport,
} from "./report.js";

export type WorkbenchJobRunStatus =
  | "queued"
  | "starting"
  | "running"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "failed"
  | "interrupted";

export type WorkbenchJobSource = "preset" | "ad_hoc" | "retry" | "cli";

export type WorkbenchAnalystSessionStatus =
  | "queued"
  | "starting"
  | "running"
  | "input_required"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "failed"
  | "interrupted";

export type WorkbenchAnalystPhase =
  | "gathering_context"
  | "reproducing"
  | "analyzing"
  | "drafting_fix"
  | "waiting_for_user";

export type WorkbenchAnalystAuthority = "proposal_only";
export type WorkbenchAnalystSourceType = "run" | "space";

export interface WorkbenchFixEvidence {
  title: string;
  detail: string;
}

export interface WorkbenchVerificationCommand {
  command: string;
  status: "passed" | "failed" | "skipped";
  summary?: string;
  outputPreview?: string;
}

export interface WorkbenchProposedEdit {
  filePath: string;
  summary: string;
  rationale?: string;
}

export interface WorkbenchFixProposal {
  summary: string;
  rootCause: string;
  evidence: WorkbenchFixEvidence[];
  reproductionCommands: string[];
  proposedEdits: WorkbenchProposedEdit[];
  verificationCommands: WorkbenchVerificationCommand[];
  draftPatch?: string;
}

export interface WorkbenchJobConfig {
  name?: string;
  layers: string[];
  providers: string[];
}

export interface WorkbenchJobPreset {
  id: string;
  name: string;
  layers: string[];
  providers: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkbenchLiveScenarioState {
  name: string;
  status: "pending" | ScenarioResult["status"];
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
}

export interface WorkbenchLiveLayerState {
  name: string;
  status: "pending" | LayerResult["status"];
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  scenarios: WorkbenchLiveScenarioState[];
}

export interface WorkbenchRunSnapshotData {
  layers: WorkbenchLiveLayerState[];
  providerParity: ProviderParityRow[];
  schedulerEvalRuns: WorkbenchEvalRunRecord[];
  comparisons: WorkbenchComparisonRow[];
  activeLayerName?: string;
  activeScenarioName?: string;
  message?: string;
}

export interface WorkbenchJobRun {
  id: string;
  presetId?: string;
  name: string;
  source: WorkbenchJobSource;
  status: WorkbenchJobRunStatus;
  config: WorkbenchJobConfig;
  queueRank?: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  reportFilename?: string;
  reportPath?: string;
  exitSummary?: string;
  overallStatus?: WorkbenchReport["overall"];
}

export interface WorkbenchJobEvent {
  eventId: string;
  runId: string;
  seq: number;
  stream: "runner" | "gateway";
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface WorkbenchAnalystSnapshotData {
  message?: string;
  verificationCommands: WorkbenchVerificationCommand[];
  evidence: WorkbenchFixEvidence[];
}

export interface WorkbenchAnalystSession {
  id: string;
  sourceType: WorkbenchAnalystSourceType;
  sourceRunId?: string;
  sourceSpaceId: string;
  sourceRootTurnId?: string;
  taskId?: string;
  analysisSpaceId?: string;
  analysisRootTurnId?: string;
  status: WorkbenchAnalystSessionStatus;
  phase: WorkbenchAnalystPhase;
  authority: WorkbenchAnalystAuthority;
  queueRank?: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  exitSummary?: string;
}

export interface WorkbenchAnalystEvent {
  eventId: string;
  sessionId: string;
  seq: number;
  stream: "service" | "gateway";
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface WorkbenchAnalystSessionDetail extends WorkbenchAnalystSession {
  snapshot: WorkbenchAnalystSnapshotData;
  proposal?: WorkbenchFixProposal;
  events: WorkbenchAnalystEvent[];
  gatewayEvents: WorkbenchAnalystEvent[];
}

export interface WorkbenchAnalystQueueSnapshot {
  activeSession?: WorkbenchAnalystSession;
  queuedSessions: WorkbenchAnalystSession[];
  recentSessions: WorkbenchAnalystSession[];
}

export interface WorkbenchJobRunDetail extends WorkbenchJobRun {
  snapshot: WorkbenchRunSnapshotData;
  runnerEvents: WorkbenchJobEvent[];
  gatewayEvents: WorkbenchJobEvent[];
}

export interface WorkbenchQueueSnapshot {
  presets: WorkbenchJobPreset[];
  activeRun?: WorkbenchJobRun;
  queuedRuns: WorkbenchJobRun[];
  recentRuns: WorkbenchJobRun[];
}

export type WorkbenchLiveMessage =
  | { type: "snapshot"; snapshot: WorkbenchQueueSnapshot }
  | { type: "preset.created" | "preset.updated"; preset: WorkbenchJobPreset }
  | { type: "preset.deleted"; presetId: string }
  | { type: "run.updated"; run: WorkbenchJobRun }
  | { type: "run.event"; event: WorkbenchJobEvent }
  | { type: "report.saved"; runId: string; reportPath: string; reportFilename: string }
  | { type: "analyst.snapshot"; snapshot: WorkbenchAnalystQueueSnapshot }
  | { type: "analyst.session.updated"; session: WorkbenchAnalystSession }
  | { type: "analyst.session.event"; event: WorkbenchAnalystEvent }
  | { type: "analyst.proposal.saved"; sessionId: string };
