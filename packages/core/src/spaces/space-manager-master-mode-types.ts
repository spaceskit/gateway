import type {
  AgentRuntime,
  TurnContext,
  TurnEvent,
} from "../agents/agent-runtime.js";
import type {
  ModelMessage,
  ProviderSessionHandle,
} from "../agents/model-provider.js";
import type { OrchestratorSummaryTrace } from "./space-summary-trace.js";
import type {
  ActiveSpace,
  AgentSessionState,
} from "./space-manager-agent-sessions.js";
import type { OrchestrationJournalEntry } from "./space-manager-orchestration-journal.js";
import type { SaveTurnInput } from "./space-manager.js";
import type { SpaceState } from "./types.js";
import type { PeerReviewResult } from "./space-manager-master-mode-helpers.js";

export interface MasterModeContext {
  maxHops: number;
  masterPlannerPromptTemplate?: string;
  guestAgentPromptTemplate?: string;
  peerReviewPromptTemplate?: string;
  masterSynthesisPromptTemplate?: string;
  getRuntime: (space: ActiveSpace, agentId: string) => Promise<AgentRuntime>;
  getOrCreateAgentSession: (
    space: ActiveSpace,
    agentId: string,
  ) => Promise<AgentSessionState>;
  resolveCommittedSessionFields: (
    space: ActiveSpace,
    session: AgentSessionState,
    userMessage: ModelMessage,
  ) => Promise<Pick<TurnContext, "providerSessionHandle" | "sessionTitle">>;
  updateAgentSession: (
    session: AgentSessionState,
    turnId: string,
    userMessage: ModelMessage,
    assistantMessage: ModelMessage,
    options?: {
      spaceId: string;
      providerSessionHandle?: ProviderSessionHandle;
    },
  ) => void;
  forwardEvent: (
    spaceId: string,
    turnId: string,
    event: TurnEvent,
    agentId?: string,
  ) => void;
  recordSummaryEvent: (
    trace: OrchestratorSummaryTrace | null | undefined,
    agentId: string,
    event: TurnEvent,
  ) => void;
  startFeedbackTimeout: (spaceId: string, turnId: string) => void;
  handleTurnError: (
    spaceId: string,
    turnId: string,
    input: string,
    err: unknown,
  ) => void;
  appendOrchestrationJournalEntry: (entry: OrchestrationJournalEntry) => Promise<void>;
  recordOrchestrationMetric: (
    name: string,
    value: number,
    tags?: Record<string, string>,
  ) => void;
  saveTurn: (input: SaveTurnInput) => Promise<void>;
  updateSpaceStatus: (spaceId: string, status: SpaceState) => Promise<void>;
}

export interface PeerReviewRingResult {
  results: PeerReviewResult[];
  assignments: number;
  completed: number;
  failed: number;
  status: "not_run" | "skipped" | "completed" | "degraded";
  failureReason?: string;
}
