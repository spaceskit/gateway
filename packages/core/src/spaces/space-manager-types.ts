import type {
  RuntimeApprovalSelection,
  RuntimeFeedbackCheckpoint,
} from "../agents/agent-runtime.js";
import type { AgentRuntime } from "../agents/agent-runtime.js";
import type { ModelMessage } from "../agents/model-provider.js";
import type { EventBus } from "../events/event-bus.js";
import type { ReflectionService } from "../reflection/reflection-service.js";
import type { CheckpointManager } from "./checkpoint.js";
import type { DeadLetterQueue } from "./dead-letter.js";
import type {
  ConversationTopology,
  SpaceConfig,
  SpaceState,
} from "./types.js";
import type {
  AgentSessionRuntimeMetadata,
  SaveAgentSessionRuntimeMetadataInput,
} from "./space-manager-agent-sessions.js";

export interface SpaceManagerOptions {
  eventBus: EventBus;
  loadSpaceConfig: (spaceId: string) => Promise<SpaceConfig | null>;
  updateSpaceStatus: (spaceId: string, status: SpaceState) => Promise<void>;
  saveTurn: (turn: SaveTurnInput) => Promise<void>;
  loadHistory: (spaceId: string, limit?: number) => Promise<ModelMessage[]>;
  loadAgentHistory?: (spaceId: string, agentId: string, limit?: number) => Promise<ModelMessage[]>;
  loadAgentSessionMetadata?: (
    spaceId: string,
    agentId: string,
  ) => Promise<AgentSessionRuntimeMetadata | undefined> | AgentSessionRuntimeMetadata | undefined;
  saveAgentSessionMetadata?: (metadata: SaveAgentSessionRuntimeMetadataInput) => Promise<void> | void;
  resolveRuntime: (spaceId: string, agentId: string) => Promise<AgentRuntime>;
  checkpointManager?: CheckpointManager;
  deadLetterQueue?: DeadLetterQueue;
  feedbackTimeoutMs?: number;
  masterModeEnabled?: boolean;
  masterPlannerPromptTemplate?: string;
  guestAgentPromptTemplate?: string;
  peerReviewPromptTemplate?: string;
  masterSynthesisPromptTemplate?: string;
  maxHops?: number;
  appendOrchestrationJournalEntry?: (entry: {
    spaceId: string;
    turnId: string;
    eventType: string;
    actorId: string;
    lineageId?: string;
    hopCount?: number;
    payload: Record<string, unknown>;
  }) => Promise<void>;
  recordOrchestrationMetric?: (metric: {
    name: string;
    value: number;
    tags?: Record<string, string>;
  }) => void;
  handleFeedbackResolution?: (input: {
    spaceId: string;
    turnId: string;
    request?: RuntimeFeedbackCheckpoint;
    response: "approve" | "reject" | "revise" | "defer";
    revision?: string;
    approvalGrant?: RuntimeApprovalSelection;
    principalId?: string;
    deviceId?: string;
  }) => Promise<void> | void;
  reflectionService?: Pick<ReflectionService, "runSummaryJob">;
}

export interface SaveTurnInput {
  turnId: string;
  userTurnId?: string;
  replyToTurnId?: string;
  conversationTopology?: ConversationTopology;
  spaceId: string;
  agentId: string;
  input: string;
  output: string;
  status: "completed" | "failed";
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
