/**
 * Turn execution strategy implementations extracted from SpaceManager.
 *
 * Strategies covered:
 * - executeSequential (sequential_all, primary_only, first_success, round_robin)
 * - executeParallelRace (parallel_race)
 * - executeDebateSynthesis (debate_synthesis)
 *
 * Each strategy is implemented as a free function that receives a narrow
 * context object exposing the orchestrator capabilities it needs. This keeps
 * the SpaceManager class small while preserving exact runtime behavior.
 */

import { randomUUID } from "node:crypto";
import type {
  AgentRuntime,
  TurnContext,
  TurnEvent,
  TurnResult,
} from "../agents/agent-runtime.js";
import type {
  ModelMessage,
  ProviderSessionHandle,
} from "../agents/model-provider.js";
import type {
  SaveTurnInput,
} from "./space-manager.js";
import type {
  SpaceAgentAssignment,
  SpaceState,
  TurnModelStrategy,
} from "./types.js";
import type { OrchestratorSummaryTrace } from "./space-summary-trace.js";
import { buildCompletedSaveTurnInput } from "./space-manager-turn-records.js";
import type {
  ActiveSpace,
  AgentSessionState,
  SaveAgentSessionRuntimeMetadataInput,
} from "./space-manager-agent-sessions.js";
import type { TurnExecutionIdentity } from "./space-manager-normalizers.js";

export interface TurnStrategyContext {
  maxHops: number;
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
  saveTurn: (input: SaveTurnInput) => Promise<void>;
  updateSpaceStatus: (spaceId: string, status: SpaceState) => Promise<void>;
}

function buildTurnContext(
  space: ActiveSpace,
  turnId: string,
  messages: ModelMessage[],
  maxHops: number,
  executionIdentity: TurnExecutionIdentity | undefined,
  committedFields: Pick<TurnContext, "providerSessionHandle" | "sessionTitle"> | undefined,
): TurnContext {
  const base: TurnContext = {
    spaceId: space.config.id,
    turnId,
    messages,
    lineageId: randomUUID(),
    hopCount: 0,
    maxHops,
    principalId: executionIdentity?.principalId,
    deviceId: executionIdentity?.deviceId,
    executionOrigin: executionIdentity?.executionOrigin,
    accessMode: executionIdentity?.accessMode,
    mode: executionIdentity?.mode,
    effort: executionIdentity?.effort,
  };
  if (committedFields) {
    return { ...base, ...committedFields };
  }
  return base;
}

/**
 * Sequential execution: run agents one at a time.
 * Covers: sequential_all, primary_only, first_success, round_robin.
 */
export async function executeSequentialStrategy(
  ctx: TurnStrategyContext,
  space: ActiveSpace,
  turnId: string,
  agents: SpaceAgentAssignment[],
  userMessage: ModelMessage,
  strategy: TurnModelStrategy,
  executionIdentity?: TurnExecutionIdentity,
  summaryTrace?: OrchestratorSummaryTrace | null,
): Promise<void> {
  const turnHistory: ModelMessage[] = [userMessage];

  for (const assignment of agents) {
    const runtime = await ctx.getRuntime(space, assignment.agentId);
    const session = await ctx.getOrCreateAgentSession(space, assignment.agentId);

    const committed = await ctx.resolveCommittedSessionFields(space, session, userMessage);
    const context: TurnContext = buildTurnContext(
      space,
      turnId,
      [...session.messages, ...turnHistory],
      ctx.maxHops,
      executionIdentity,
      committed,
    );

    let result: TurnResult | null = null;
    space.activeTurnRuntimes.set(turnId, runtime);

    try {
      for await (const event of runtime.executeTurn(context)) {
        ctx.recordSummaryEvent(summaryTrace, assignment.agentId, event);
        ctx.forwardEvent(space.config.id, turnId, event, assignment.agentId);

        if (event.type === "feedback_requested") {
          space.activeTurnRuntimes.delete(turnId);
          space.pausedRuntimes.set(turnId, runtime);
          space.pausedRuntimeAgentIds.set(turnId, assignment.agentId);
          space.pausedFeedbackRequests.set(turnId, event.request);
          ctx.startFeedbackTimeout(space.config.id, turnId);
          await ctx.updateSpaceStatus(space.config.id, "paused");
          return; // Execution paused
        }

        if (event.type === "turn_completed") {
          result = event.result;
        }
      }
    } finally {
      space.activeTurnRuntimes.delete(turnId);
    }

    if (result) {
      // Save turn — fire-and-forget with dead letter queue fallback
      ctx.updateAgentSession(session, turnId, userMessage, result.finalMessage, {
        spaceId: space.config.id,
        providerSessionHandle: result.metadata?.providerSessionHandle,
      });
      ctx.saveTurn(buildCompletedSaveTurnInput({
        turnId,
        spaceId: space.config.id,
        agentId: assignment.agentId,
        userMessage,
        result,
      })).catch((saveErr) => {
        ctx.handleTurnError(space.config.id, turnId, userMessage.content, saveErr);
      });

      // For first_success, stop after first successful completion
      if (strategy === "first_success") break;

      // Append result to history for next agent in sequence
      turnHistory.push(result.finalMessage);
    }
  }
}

/**
 * Parallel race: all agents execute concurrently, first to complete wins.
 * Stolen from: Microsoft AF's superstep model.
 */
export async function executeParallelRaceStrategy(
  ctx: TurnStrategyContext,
  space: ActiveSpace,
  turnId: string,
  agents: SpaceAgentAssignment[],
  userMessage: ModelMessage,
  executionIdentity?: TurnExecutionIdentity,
  summaryTrace?: OrchestratorSummaryTrace | null,
): Promise<void> {
  const raceTimeout = space.config.turnModelConfig?.raceTimeoutSeconds ?? 120;

  // Resolve all runtimes up-front so we can cancel the actual instances later
  const runtimeMap = new Map<string, AgentRuntime>();
  for (const assignment of agents) {
    const runtime = await ctx.getRuntime(space, assignment.agentId);
    runtimeMap.set(assignment.agentId, runtime);
  }

  const racePromises = agents.map(async (assignment) => {
    const runtime = runtimeMap.get(assignment.agentId)!;
    const session = await ctx.getOrCreateAgentSession(space, assignment.agentId);

    const context: TurnContext = buildTurnContext(
      space,
      turnId,
      [...session.messages, userMessage],
      ctx.maxHops,
      executionIdentity,
      undefined,
    );

    let result: TurnResult | null = null;

    for await (const event of runtime.executeTurn(context)) {
      ctx.recordSummaryEvent(summaryTrace, assignment.agentId, event);
      ctx.forwardEvent(space.config.id, turnId, event, assignment.agentId);
      if (event.type === "turn_completed") {
        result = event.result;
        ctx.updateAgentSession(session, turnId, userMessage, event.result.finalMessage, {
          spaceId: space.config.id,
          providerSessionHandle: event.result.metadata?.providerSessionHandle,
        });
      }
    }

    return { agentId: assignment.agentId, result };
  });

  // Race with timeout
  const timeoutPromise = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), raceTimeout * 1000),
  );

  let winner: { agentId: string; result: TurnResult | null } | null = null;
  try {
    const raceResult = await Promise.race([
      Promise.any(racePromises),
      timeoutPromise,
    ]);
    if (raceResult && typeof raceResult === "object" && "result" in raceResult) {
      winner = raceResult;
    }
  } catch {
    // All agents failed — winner stays null
  }

  if (winner?.result) {
    ctx.saveTurn(buildCompletedSaveTurnInput({
      turnId,
      spaceId: space.config.id,
      agentId: winner.agentId,
      userMessage,
      result: winner.result,
    })).catch((saveErr) => {
      ctx.handleTurnError(space.config.id, turnId, userMessage.content, saveErr);
    });
  }

  // Cancel all runtimes (the winner's cancel is a no-op since it already completed)
  for (const runtime of runtimeMap.values()) {
    await runtime.cancel().catch(() => {});
  }
}

/**
 * Debate synthesis: all agents respond, then a synthesizer produces
 * the final answer. Spaceskit's unique orchestration pattern.
 */
export async function executeDebateSynthesisStrategy(
  ctx: TurnStrategyContext,
  space: ActiveSpace,
  turnId: string,
  agents: SpaceAgentAssignment[],
  userMessage: ModelMessage,
  executionIdentity?: TurnExecutionIdentity,
  summaryTrace?: OrchestratorSummaryTrace | null,
): Promise<void> {
  const rounds = space.config.turnModelConfig?.debateRounds ?? 1;
  const synthesizerAgentId = space.config.turnModelConfig?.synthesizerAgentId;

  // Separate debaters from synthesizer
  const debaters = agents.filter(
    (a) => a.agentId !== synthesizerAgentId,
  );

  const debateHistory: ModelMessage[] = [userMessage];

  for (let round = 0; round < rounds; round++) {
    // All debaters respond in parallel
    const debatePromises = debaters.map(async (assignment) => {
      const runtime = await ctx.getRuntime(space, assignment.agentId);
      const session = await ctx.getOrCreateAgentSession(space, assignment.agentId);

      const committed = await ctx.resolveCommittedSessionFields(space, session, userMessage);
      const context: TurnContext = buildTurnContext(
        space,
        turnId,
        [...session.messages, ...debateHistory],
        ctx.maxHops,
        executionIdentity,
        committed,
      );

      let result: TurnResult | null = null;
      for await (const event of runtime.executeTurn(context)) {
        ctx.recordSummaryEvent(summaryTrace, assignment.agentId, event);
        ctx.forwardEvent(space.config.id, turnId, event, assignment.agentId);
        if (event.type === "turn_completed") {
          result = event.result;
          ctx.updateAgentSession(session, turnId, userMessage, event.result.finalMessage, {
            spaceId: space.config.id,
            providerSessionHandle: event.result.metadata?.providerSessionHandle,
          });
        }
      }

      return { agentId: assignment.agentId, result };
    });

    const debateResults = await Promise.allSettled(debatePromises);

    // Collect responses into history for the next round
    for (const settled of debateResults) {
      if (settled.status === "fulfilled" && settled.value.result) {
        debateHistory.push({
          role: "assistant",
          content: `[${settled.value.agentId}]: ${settled.value.result.finalMessage.content}`,
        });
      }
    }
  }

  // Synthesizer produces the final answer
  if (synthesizerAgentId) {
    const synthRuntime = await ctx.getRuntime(space, synthesizerAgentId);
    const synthSession = await ctx.getOrCreateAgentSession(space, synthesizerAgentId);

    const synthCommitted = await ctx.resolveCommittedSessionFields(space, synthSession, userMessage);
    const synthContext: TurnContext = buildTurnContext(
      space,
      turnId,
      [
        ...synthSession.messages,
        ...debateHistory,
        {
          role: "user",
          content:
            "You are the synthesizer. Review all agent responses above and produce a unified, balanced answer.",
        },
      ],
      ctx.maxHops,
      executionIdentity,
      synthCommitted,
    );

    for await (const event of synthRuntime.executeTurn(synthContext)) {
      ctx.recordSummaryEvent(summaryTrace, synthesizerAgentId, event);
      ctx.forwardEvent(space.config.id, turnId, event, synthesizerAgentId);

      if (event.type === "turn_completed" && event.result) {
        ctx.updateAgentSession(synthSession, turnId, userMessage, event.result.finalMessage, {
          spaceId: space.config.id,
          providerSessionHandle: event.result.metadata?.providerSessionHandle,
        });
        ctx.saveTurn(buildCompletedSaveTurnInput({
          turnId,
          spaceId: space.config.id,
          agentId: synthesizerAgentId,
          userMessage,
          result: event.result,
        })).catch((saveErr) => {
          ctx.handleTurnError(space.config.id, turnId, userMessage.content, saveErr);
        });
      }
    }
  }
}
