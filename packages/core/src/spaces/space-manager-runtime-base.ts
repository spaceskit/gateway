import type { EventBus } from "../events/event-bus.js";
import type {
  AgentRuntime,
  RuntimeApprovalSelection,
  TurnContext,
  TurnEvent,
  CliLaunchSnapshot,
} from "../agents/agent-runtime.js";
import type {
  ModelMessage,
  ProviderSessionHandle,
} from "../agents/model-provider.js";
import type {
  SpaceAgentAssignment,
  TurnModelStrategy,
} from "./types.js";
import type { OrchestratorSummaryTrace } from "./space-summary-trace.js";
import {
  normalizeOptionalString,
  type TurnExecutionIdentity,
} from "./space-manager-normalizers.js";
import {
  resolvePeerReviewEnabled,
  resolvePeerReviewTopology,
} from "./space-manager-master-mode-helpers.js";
import {
  appendRedactedOrchestrationJournalEntry,
  type OrchestrationJournalEntry,
} from "./space-manager-orchestration-journal.js";
import {
  createSpaceManagerSummaryTrace,
  emitSpaceManagerSummaryEvent,
  recordSpaceManagerSummaryEvent,
} from "./space-manager-summary-events.js";
import {
  buildLaunchSnapshots as buildAgentLaunchSnapshots,
  ensureActiveSpace,
  getActiveSpaceState as getAgentSessionStateSnapshot,
  getOrCreateAgentSession as getOrCreateAgentSessionState,
  getRuntimeForAgent,
  restoreActiveSpaceFromCheckpoint,
  resolveCommittedSessionFields as resolveAgentCommittedSessionFields,
  updateAgentSession as updateAgentSessionState,
  type ActiveSpace,
  type AgentSessionState,
  type RestoreAgentSessionCheckpointInput,
  type SaveAgentSessionRuntimeMetadataInput,
} from "./space-manager-agent-sessions.js";
import type { TurnStrategyContext } from "./space-manager-turn-strategies.js";
import type { MasterModeContext } from "./space-manager-master-mode.js";
import { startPausedFeedbackTimeout } from "./space-manager-feedback.js";
import type { SpaceManagerOptions } from "./space-manager-types.js";

export abstract class SpaceManagerRuntimeBase {
  protected activeSpaces = new Map<string, ActiveSpace>();
  protected eventBus: EventBus;
  protected options: SpaceManagerOptions;
  protected turnLocks = new Map<string, Promise<void>>();

  constructor(options: SpaceManagerOptions) {
    this.eventBus = options.eventBus;
    this.options = options;
  }

  abstract resumeFeedback(
    spaceId: string,
    turnId: string,
    response: "approve" | "reject" | "revise" | "defer",
    revision?: string,
    options?: {
      approvalGrant?: RuntimeApprovalSelection;
      principalId?: string;
      deviceId?: string;
    },
  ): Promise<void>;

  getActiveSpaceState(spaceId: string): {
    agentStates: Record<string, { status: string; lastTurnId?: string; messages: ModelMessage[] }>;
    turnIds: string[];
  } | null {
    return getAgentSessionStateSnapshot(this.activeSpaces, spaceId);
  }

  async restoreFromCheckpoint(
    spaceId: string,
    checkpoint: RestoreAgentSessionCheckpointInput,
  ): Promise<boolean> {
    return restoreActiveSpaceFromCheckpoint({
      activeSpaces: this.activeSpaces,
      spaceId,
      checkpoint,
      loadSpaceConfig: this.options.loadSpaceConfig,
    });
  }

  protected masterModeContext(): MasterModeContext {
    return {
      maxHops: this.options.maxHops ?? 5,
      masterPlannerPromptTemplate: this.options.masterPlannerPromptTemplate,
      guestAgentPromptTemplate: this.options.guestAgentPromptTemplate,
      peerReviewPromptTemplate: this.options.peerReviewPromptTemplate,
      masterSynthesisPromptTemplate: this.options.masterSynthesisPromptTemplate,
      getRuntime: this.getRuntime.bind(this),
      getOrCreateAgentSession: this.getOrCreateAgentSession.bind(this),
      resolveCommittedSessionFields: this.resolveCommittedSessionFields.bind(this),
      updateAgentSession: this.updateAgentSession.bind(this),
      forwardEvent: this.forwardEvent.bind(this),
      recordSummaryEvent: this.recordSummaryEvent.bind(this),
      startFeedbackTimeout: this.startFeedbackTimeout.bind(this),
      handleTurnError: this.handleTurnError.bind(this),
      appendOrchestrationJournalEntry: this.appendOrchestrationJournalEntry.bind(this),
      recordOrchestrationMetric: this.recordOrchestrationMetric.bind(this),
      saveTurn: this.options.saveTurn,
      updateSpaceStatus: this.options.updateSpaceStatus,
    };
  }

  protected turnStrategyContext(): TurnStrategyContext {
    return {
      maxHops: this.options.maxHops ?? 5,
      getRuntime: this.getRuntime.bind(this),
      getOrCreateAgentSession: this.getOrCreateAgentSession.bind(this),
      resolveCommittedSessionFields: this.resolveCommittedSessionFields.bind(this),
      updateAgentSession: this.updateAgentSession.bind(this),
      forwardEvent: this.forwardEvent.bind(this),
      recordSummaryEvent: this.recordSummaryEvent.bind(this),
      startFeedbackTimeout: this.startFeedbackTimeout.bind(this),
      handleTurnError: this.handleTurnError.bind(this),
      saveTurn: this.options.saveTurn,
      updateSpaceStatus: this.options.updateSpaceStatus,
    };
  }

  protected createSummaryTrace(
    space: ActiveSpace,
    turnId: string,
    input: string,
    strategy: TurnModelStrategy,
    agents: SpaceAgentAssignment[],
  ): OrchestratorSummaryTrace | null {
    return createSpaceManagerSummaryTrace({
      spaceId: space.config.id,
      turnId,
      userInput: input,
      strategy,
      agents,
      peerReview: {
        enabled: resolvePeerReviewEnabled(space),
        topology: resolvePeerReviewTopology(space),
      },
    });
  }

  protected recordSummaryEvent(
    trace: OrchestratorSummaryTrace | null | undefined,
    agentId: string,
    event: TurnEvent,
  ): void {
    recordSpaceManagerSummaryEvent(trace, agentId, event);
  }

  protected emitSummaryEvent(
    spaceId: string,
    turnId: string,
    trace: OrchestratorSummaryTrace | null | undefined,
    executionError?: unknown,
  ): void {
    emitSpaceManagerSummaryEvent({
      eventBus: this.eventBus,
      reflectionService: this.options.reflectionService,
      spaceId,
      turnId,
      trace,
      executionError,
    });
  }

  protected async appendOrchestrationJournalEntry(entry: OrchestrationJournalEntry): Promise<void> {
    await appendRedactedOrchestrationJournalEntry({
      entry,
      append: this.options.appendOrchestrationJournalEntry,
      recordMetric: (name, value, tags) => this.recordOrchestrationMetric(name, value, tags),
    });
  }

  protected recordOrchestrationMetric(
    name: string,
    value: number,
    tags?: Record<string, string>,
  ): void {
    this.options.recordOrchestrationMetric?.({ name, value, tags });
  }

  protected async ensureActive(spaceId: string): Promise<ActiveSpace> {
    return ensureActiveSpace({
      activeSpaces: this.activeSpaces,
      spaceId,
      loadSpaceConfig: this.options.loadSpaceConfig,
    });
  }

  protected async getRuntime(space: ActiveSpace, agentId: string): Promise<AgentRuntime> {
    return getRuntimeForAgent({
      space,
      agentId,
      resolveRuntime: this.options.resolveRuntime,
    });
  }

  protected async getOrCreateAgentSession(
    space: ActiveSpace,
    agentId: string,
  ): Promise<AgentSessionState> {
    return getOrCreateAgentSessionState({
      space,
      agentId,
      loadHistory: this.options.loadHistory,
      ...(this.options.loadAgentHistory ? { loadAgentHistory: this.options.loadAgentHistory } : {}),
      ...(this.options.loadAgentSessionMetadata
        ? { loadAgentSessionMetadata: this.options.loadAgentSessionMetadata }
        : {}),
    });
  }

  protected async resolveCommittedSessionFields(
    space: ActiveSpace,
    session: AgentSessionState,
    userMessage: ModelMessage,
  ): Promise<Pick<TurnContext, "providerSessionHandle" | "sessionTitle">> {
    return resolveAgentCommittedSessionFields({
      space,
      session,
      userMessage,
      persistAgentSessionMetadata: this.persistAgentSessionMetadata.bind(this),
    });
  }

  protected async persistAgentSessionMetadata(
    spaceId: string,
    session: AgentSessionState,
    metadata: Omit<SaveAgentSessionRuntimeMetadataInput, "spaceId" | "agentId">,
  ): Promise<void> {
    if (!this.options.saveAgentSessionMetadata) {
      return;
    }
    await this.options.saveAgentSessionMetadata({
      spaceId,
      agentId: session.agentId,
      ...metadata,
    });
  }

  protected async buildLaunchSnapshots(
    space: ActiveSpace,
    turnId: string,
    agents: SpaceAgentAssignment[],
    userMessage: ModelMessage,
    executionIdentity?: TurnExecutionIdentity,
  ): Promise<CliLaunchSnapshot[]> {
    return buildAgentLaunchSnapshots({
      space,
      turnId,
      agents,
      userMessage,
      maxHops: this.options.maxHops ?? 5,
      getRuntime: this.getRuntime.bind(this),
      getSession: this.getOrCreateAgentSession.bind(this),
      ...(executionIdentity ? { executionIdentity } : {}),
    });
  }

  protected updateAgentSession(
    session: AgentSessionState,
    turnId: string,
    userMessage: ModelMessage,
    assistantMessage: ModelMessage,
    options?: {
      spaceId: string;
      providerSessionHandle?: ProviderSessionHandle;
    },
  ): void {
    updateAgentSessionState({
      session,
      turnId,
      userMessage,
      assistantMessage,
      persistAgentSessionMetadata: this.persistAgentSessionMetadata.bind(this),
      ...(options ? { options } : {}),
    });
  }

  protected startFeedbackTimeout(spaceId: string, turnId: string): void {
    startPausedFeedbackTimeout({
      activeSpaces: this.activeSpaces,
      eventBus: this.eventBus,
      spaceId,
      turnId,
      timeoutMs: this.options.feedbackTimeoutMs ?? 300_000,
      onTimeout: (sId, tId) => {
        this.resumeFeedback(sId, tId, "reject").catch((err) => {
          console.error(`Failed to auto-reject timed-out feedback for turn ${tId}:`, err);
        });
      },
    });
  }

  protected forwardEvent(spaceId: string, turnId: string, event: TurnEvent, agentId?: string): void {
    const resolvedAgentId = normalizeOptionalString(agentId) ?? this.resolveEventAgentId(event);
    const eventWithAgent = resolvedAgentId
      ? { ...event, agentId: resolvedAgentId } as TurnEvent & { agentId: string }
      : event;
    this.eventBus.emit({
      type: "space.turn_event",
      spaceId,
      turnId,
      agentId: resolvedAgentId,
      event: eventWithAgent,
      timestamp: new Date(),
    });
  }

  private resolveEventAgentId(event: TurnEvent): string | undefined {
    if (event.type === "turn_completed") {
      return normalizeOptionalString(event.result.agentId);
    }
    if (event.type === "feedback_requested") {
      return normalizeOptionalString(event.request.agentId);
    }
    return undefined;
  }

  protected abstract handleTurnError(
    spaceId: string,
    turnId: string,
    input: string,
    err: unknown,
  ): void;
}
