/**
 * Master-mode orchestration flow extracted from SpaceManager.
 *
 * Implements the coordinator-led "master mode" three-phase flow:
 *   1. Planner phase: master agent (or slash directives) produces guest instructions.
 *   2. Guest execution + peer-review convergence loop, up to maxIterations.
 *   3. Synthesis phase: master agent merges guest reports into a final answer.
 *
 * The orchestrator passes a narrow context exposing the SpaceManager capabilities
 * the master flow needs (runtimes, sessions, journal entries, metrics, etc.).
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
  SpaceState,
} from "./types.js";
import type { OrchestratorSummaryTrace } from "./space-summary-trace.js";
import { buildCompletedSaveTurnInput } from "./space-manager-turn-records.js";
import type {
  ActiveSpace,
  AgentSessionState,
} from "./space-manager-agent-sessions.js";
import type { TurnExecutionIdentity } from "./space-manager-normalizers.js";
import {
  renderTemplate,
  type MasterModePromptTemplates,
} from "./master-mode-prompts.js";
import {
  buildFallbackGuestInstruction,
  buildFallbackPlannerInstructions,
  buildRevisionFeedback,
  buildRingPeerReviewAssignments,
  checkMasterModeConvergence,
  formatGuestList,
  formatGuestReports,
  formatPeerReviewResults,
  parsePeerReviewResult,
  parsePlannerInstructions,
  parseSlashPlannerDirectives,
  resolveMasterModePromptTemplates,
  resolvePeerReviewEnabled,
  resolvePeerReviewTopology,
  type GuestReport,
  type MasterFlowAssignments,
  type PeerReviewResult,
  type PlannerInstructions,
  type PlannerPhaseResult,
} from "./space-manager-master-mode-helpers.js";
import type { OrchestrationJournalEntry } from "./space-manager-orchestration-journal.js";

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

export async function executeMasterModeFlow(
  ctx: MasterModeContext,
  space: ActiveSpace,
  turnId: string,
  userMessage: ModelMessage,
  assignments: MasterFlowAssignments,
  executionIdentity?: TurnExecutionIdentity,
  summaryTrace?: OrchestratorSummaryTrace | null,
): Promise<void> {
  const promptTemplates = resolveMasterModePromptTemplates(space, {
    masterPlannerPromptTemplate: ctx.masterPlannerPromptTemplate,
    guestAgentPromptTemplate: ctx.guestAgentPromptTemplate,
    peerReviewPromptTemplate: ctx.peerReviewPromptTemplate,
    masterSynthesisPromptTemplate: ctx.masterSynthesisPromptTemplate,
  });
  await ctx.appendOrchestrationJournalEntry({
    spaceId: space.config.id,
    turnId,
    eventType: "planner.input",
    actorId: assignments.master.agentId,
    payload: {
      userInput: userMessage.content,
      guestAgentIds: assignments.guests.map((guest) => guest.agentId),
    },
  });

  const plannerPhase = await runMasterPlannerPhase(
    ctx,
    space,
    turnId,
    userMessage,
    assignments,
    promptTemplates,
    executionIdentity,
  );
  const plannerInstructions = plannerPhase.instructions;
  await ctx.appendOrchestrationJournalEntry({
    spaceId: space.config.id,
    turnId,
    eventType: "planner.output",
    actorId: assignments.master.agentId,
    payload: {
      source: plannerPhase.source,
      fallbackReason: plannerPhase.fallbackReason,
      globalInstruction: plannerInstructions.globalInstruction,
      guestInstructions: Object.fromEntries(plannerInstructions.guestInstructions.entries()),
    },
  });
  if (plannerPhase.source === "fallback") {
    ctx.recordOrchestrationMetric("planner_fallback_total", 1, {
      spaceId: space.config.id,
    });
  }

  // ---------------------------------------------------------------------------
  // Convergence loop: guest execution + peer review, up to maxIterations.
  // Each iteration re-runs guests with revision feedback if peer review
  // did not converge. Converges when all reviews approve with average
  // confidence >= threshold, or when iterations are exhausted.
  // ---------------------------------------------------------------------------
  const maxIterations = space.config.turnModelConfig?.masterModeMaxIterations ?? 1;
  const convergenceThreshold = space.config.turnModelConfig?.masterModeConvergenceThreshold ?? 0.8;
  const tokenBudget = space.config.turnModelConfig?.maxTokenBudget ?? 0;
  let totalTokensUsed = 0;

  let guestReports: GuestReport[] = [];
  let peerReviewResults: PeerReviewRingResult = {
    results: [],
    assignments: 0,
    completed: 0,
    failed: 0,
    status: "skipped",
  };
  let revisionFeedback: string | undefined;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    guestReports = [];

    for (const guest of assignments.guests) {
      const runtime = await ctx.getRuntime(space, guest.agentId);
      const session = await ctx.getOrCreateAgentSession(space, guest.agentId);
      const delegatedInstruction = plannerInstructions.guestInstructions.get(guest.agentId)
        ?? buildFallbackGuestInstruction(guest.agentId);
      const guestPrompt = renderTemplate(
        promptTemplates.guest,
        {
          user_input: userMessage.content,
          guest_agent_id: guest.agentId,
          guest_list: formatGuestList(assignments.guests),
          guest_reports: "",
          global_instruction: plannerInstructions.globalInstruction,
          guest_instruction: delegatedInstruction,
        },
      );
      await ctx.appendOrchestrationJournalEntry({
        spaceId: space.config.id,
        turnId,
        eventType: "guest.dispatch",
        actorId: guest.agentId,
        payload: {
          iteration,
          delegatedInstruction,
          globalInstruction: plannerInstructions.globalInstruction,
          revisionFeedback: revisionFeedback ?? null,
        },
      });

      // Build messages: include revision feedback from prior iteration if available (Layer 4 turn context).
      const guestMessages: ModelMessage[] = [
        ...session.messages,
        userMessage,
      ];
      if (revisionFeedback) {
        guestMessages.push({
          role: "system",
          content: `Revision feedback from peer review (iteration ${iteration}):\n${revisionFeedback}`,
        });
      }
      guestMessages.push({ role: "user", content: guestPrompt });

      const context: TurnContext = {
        spaceId: space.config.id,
        turnId,
        messages: guestMessages,
        lineageId: randomUUID(),
        hopCount: 0,
        maxHops: ctx.maxHops,
        principalId: executionIdentity?.principalId,
        deviceId: executionIdentity?.deviceId,
        executionOrigin: executionIdentity?.executionOrigin,
        accessMode: executionIdentity?.accessMode,
        mode: executionIdentity?.mode,
        effort: executionIdentity?.effort,
        ...(await ctx.resolveCommittedSessionFields(space, session, userMessage)),
      };

      let result: TurnResult | null = null;
      let guestFailed = false;

      try {
        for await (const event of runtime.executeTurn(context)) {
          ctx.recordSummaryEvent(summaryTrace, guest.agentId, event);
          ctx.forwardEvent(space.config.id, turnId, event, guest.agentId);

          if (event.type === "feedback_requested") {
            space.pausedRuntimes.set(turnId, runtime);
            space.pausedRuntimeAgentIds.set(turnId, guest.agentId);
            space.pausedFeedbackRequests.set(turnId, event.request);
            ctx.startFeedbackTimeout(space.config.id, turnId);
            await ctx.updateSpaceStatus(space.config.id, "paused");
            return; // Execution paused
          }

          if (event.type === "turn_completed") {
            result = event.result;
          }
        }
      } catch (error) {
        guestFailed = true;
        const normalized = error instanceof Error ? error : new Error(String(error));
        const errorEvent: TurnEvent = { type: "error", error: normalized };
        ctx.recordSummaryEvent(summaryTrace, guest.agentId, errorEvent);
        ctx.forwardEvent(space.config.id, turnId, errorEvent, guest.agentId);
        guestReports.push({
          agentId: guest.agentId,
          status: "failed",
          report: normalized.message,
        });
        await ctx.appendOrchestrationJournalEntry({
          spaceId: space.config.id,
          turnId,
          eventType: "failure",
          actorId: guest.agentId,
          payload: {
            phase: "guest_execution",
            iteration,
            error: normalized.message,
          },
        });
      }

      if (result) {
        totalTokensUsed += result.usage.totalTokens;
        ctx.updateAgentSession(session, turnId, userMessage, result.finalMessage, {
          spaceId: space.config.id,
          providerSessionHandle: result.metadata?.providerSessionHandle,
        });
        ctx.saveTurn(buildCompletedSaveTurnInput({
          turnId,
          spaceId: space.config.id,
          agentId: guest.agentId,
          userMessage,
          result,
        })).catch((saveErr) => {
          ctx.handleTurnError(space.config.id, turnId, userMessage.content, saveErr);
        });
        guestReports.push({
          agentId: guest.agentId,
          status: "completed",
          report: result.finalMessage.content,
        });
        await ctx.appendOrchestrationJournalEntry({
          spaceId: space.config.id,
          turnId,
          eventType: "guest.report",
          actorId: guest.agentId,
          payload: {
            status: "completed",
            iteration,
            report: result.finalMessage.content,
          },
        });
      } else if (!guestFailed) {
        const noResultError = new Error(`Guest agent ${guest.agentId} did not return a completion result.`);
        const errorEvent: TurnEvent = { type: "error", error: noResultError };
        ctx.recordSummaryEvent(summaryTrace, guest.agentId, errorEvent);
        ctx.forwardEvent(space.config.id, turnId, errorEvent, guest.agentId);
        guestReports.push({
          agentId: guest.agentId,
          status: "failed",
          report: noResultError.message,
        });
        await ctx.appendOrchestrationJournalEntry({
          spaceId: space.config.id,
          turnId,
          eventType: "guest.report",
          actorId: guest.agentId,
          payload: {
            status: "failed",
            iteration,
            report: noResultError.message,
          },
        });
      }
    }

    // Run peer review
    peerReviewResults = await runPeerReviewRing(
      ctx,
      space,
      turnId,
      userMessage,
      assignments,
      guestReports,
      plannerInstructions,
      promptTemplates,
      executionIdentity,
    );
    // Check convergence
    const converged = checkMasterModeConvergence(peerReviewResults.results, convergenceThreshold);
    const budgetExhausted = tokenBudget > 0 && totalTokensUsed >= tokenBudget * 0.8;

    await ctx.appendOrchestrationJournalEntry({
      spaceId: space.config.id,
      turnId,
      eventType: "convergence.check",
      actorId: assignments.master.agentId,
      payload: {
        iteration,
        converged,
        budgetExhausted,
        totalTokensUsed,
        tokenBudget: tokenBudget || "unlimited",
      },
    });

    if (converged || budgetExhausted || iteration >= maxIterations - 1) {
      break;
    }

    // Build revision feedback for next iteration from peer review issues
    revisionFeedback = buildRevisionFeedback(peerReviewResults.results);
  }

  const peerReviewEnabled = resolvePeerReviewEnabled(space);
  const peerReviewTopology = resolvePeerReviewTopology(space);
  if (summaryTrace) {
    summaryTrace.peerReview.enabled = peerReviewEnabled;
    summaryTrace.peerReview.topology = peerReviewTopology;
    summaryTrace.peerReview.assignments = peerReviewResults.assignments;
    summaryTrace.peerReview.completed = peerReviewResults.completed;
    summaryTrace.peerReview.failed = peerReviewResults.failed;
    summaryTrace.peerReview.status = peerReviewResults.status;
    summaryTrace.peerReview.failureReason = peerReviewResults.failureReason;
  }
  ctx.recordOrchestrationMetric("peer_review_completion_total", peerReviewResults.completed, {
    spaceId: space.config.id,
  });
  if (peerReviewResults.failed > 0) {
    ctx.recordOrchestrationMetric("peer_review_failure_total", peerReviewResults.failed, {
      spaceId: space.config.id,
    });
  }

  const masterRuntime = await ctx.getRuntime(space, assignments.master.agentId);
  const masterSession = await ctx.getOrCreateAgentSession(space, assignments.master.agentId);
  const synthesisPrompt = renderTemplate(
    promptTemplates.synthesis,
    {
      user_input: userMessage.content,
      guest_agent_id: assignments.master.agentId,
      guest_list: formatGuestList(assignments.guests),
      guest_reports: formatGuestReports(guestReports),
      peer_review_results: formatPeerReviewResults(peerReviewResults.results),
      global_instruction: plannerInstructions.globalInstruction,
      guest_instruction: "",
    },
  );
  await ctx.appendOrchestrationJournalEntry({
    spaceId: space.config.id,
    turnId,
    eventType: "synthesis.dispatch",
    actorId: assignments.master.agentId,
    payload: {
      globalInstruction: plannerInstructions.globalInstruction,
      guestReports: formatGuestReports(guestReports),
      peerReviewResults: formatPeerReviewResults(peerReviewResults.results),
    },
  });
  const synthesisContext: TurnContext = {
    spaceId: space.config.id,
    turnId,
    messages: [
      ...masterSession.messages,
      userMessage,
      { role: "user", content: synthesisPrompt },
    ],
    lineageId: randomUUID(),
    hopCount: 0,
    maxHops: ctx.maxHops,
    principalId: executionIdentity?.principalId,
    deviceId: executionIdentity?.deviceId,
    executionOrigin: executionIdentity?.executionOrigin,
    accessMode: executionIdentity?.accessMode,
    mode: executionIdentity?.mode,
    effort: executionIdentity?.effort,
    ...(await ctx.resolveCommittedSessionFields(space, masterSession, userMessage)),
  };

  let synthesisResult: TurnResult | null = null;
  for await (const event of masterRuntime.executeTurn(synthesisContext)) {
    ctx.recordSummaryEvent(summaryTrace, assignments.master.agentId, event);
    ctx.forwardEvent(space.config.id, turnId, event, assignments.master.agentId);

    if (event.type === "feedback_requested") {
      space.pausedRuntimes.set(turnId, masterRuntime);
      space.pausedRuntimeAgentIds.set(turnId, assignments.master.agentId);
      space.pausedFeedbackRequests.set(turnId, event.request);
      ctx.startFeedbackTimeout(space.config.id, turnId);
      await ctx.updateSpaceStatus(space.config.id, "paused");
      return; // Execution paused
    }

    if (event.type === "turn_completed") {
      synthesisResult = event.result;
    }
  }

  if (!synthesisResult) {
    await ctx.appendOrchestrationJournalEntry({
      spaceId: space.config.id,
      turnId,
      eventType: "failure",
      actorId: assignments.master.agentId,
      payload: {
        phase: "synthesis_execution",
        error: "Master synthesis phase completed without a final result.",
      },
    });
    throw new Error("Master synthesis phase completed without a final result.");
  }

  ctx.updateAgentSession(masterSession, turnId, userMessage, synthesisResult.finalMessage, {
    spaceId: space.config.id,
    providerSessionHandle: synthesisResult.metadata?.providerSessionHandle,
  });
  ctx.saveTurn(buildCompletedSaveTurnInput({
    turnId,
    spaceId: space.config.id,
    agentId: assignments.master.agentId,
    userMessage,
    result: synthesisResult,
  })).catch((saveErr) => {
    ctx.handleTurnError(space.config.id, turnId, userMessage.content, saveErr);
  });
  await ctx.appendOrchestrationJournalEntry({
    spaceId: space.config.id,
    turnId,
    eventType: "synthesis.result",
    actorId: assignments.master.agentId,
    payload: {
      output: synthesisResult.finalMessage.content,
    },
  });
}

async function runMasterPlannerPhase(
  ctx: MasterModeContext,
  space: ActiveSpace,
  turnId: string,
  userMessage: ModelMessage,
  assignments: MasterFlowAssignments,
  promptTemplates: MasterModePromptTemplates,
  executionIdentity?: TurnExecutionIdentity,
): Promise<PlannerPhaseResult> {
  const fallback = buildFallbackPlannerInstructions(assignments.guests, userMessage.content);
  const slashInstructions = parseSlashPlannerDirectives(userMessage.content, assignments.guests);
  if (slashInstructions) {
    return {
      instructions: slashInstructions,
      source: "slash",
    };
  }

  const runtime = await ctx.getRuntime(space, assignments.master.agentId);
  const session = await ctx.getOrCreateAgentSession(space, assignments.master.agentId);
  const plannerPrompt = renderTemplate(
    promptTemplates.planner,
    {
      user_input: userMessage.content,
      guest_agent_id: assignments.master.agentId,
      guest_list: formatGuestList(assignments.guests),
      guest_reports: "",
      global_instruction: "",
      guest_instruction: "",
    },
  );
  const plannerContext: TurnContext = {
    spaceId: space.config.id,
    turnId,
    messages: [
      ...session.messages,
      userMessage,
      { role: "user", content: plannerPrompt },
    ],
    lineageId: randomUUID(),
    hopCount: 0,
    maxHops: ctx.maxHops,
    principalId: executionIdentity?.principalId,
    deviceId: executionIdentity?.deviceId,
    executionOrigin: executionIdentity?.executionOrigin,
    accessMode: executionIdentity?.accessMode,
    mode: executionIdentity?.mode,
    effort: executionIdentity?.effort,
  };

  let plannerResult: TurnResult | null = null;
  try {
    for await (const event of runtime.executeTurn(plannerContext)) {
      if (event.type === "turn_completed") {
        plannerResult = event.result;
      }
    }
  } catch {
    return {
      instructions: fallback,
      source: "fallback",
      fallbackReason: "planner_execution_error",
    };
  }

  if (!plannerResult) {
    return {
      instructions: fallback,
      source: "fallback",
      fallbackReason: "planner_missing_completion",
    };
  }
  const parsed = parsePlannerInstructions(plannerResult.finalMessage.content, assignments.guests);
  if (parsed) {
    return {
      instructions: parsed,
      source: "planner",
      rawOutput: plannerResult.finalMessage.content,
    };
  }
  return {
    instructions: fallback,
    source: "fallback",
    rawOutput: plannerResult.finalMessage.content,
    fallbackReason: "planner_invalid_json",
  };
}

async function runPeerReviewRing(
  ctx: MasterModeContext,
  space: ActiveSpace,
  turnId: string,
  userMessage: ModelMessage,
  assignments: MasterFlowAssignments,
  guestReports: GuestReport[],
  plannerInstructions: PlannerInstructions,
  promptTemplates: MasterModePromptTemplates,
  executionIdentity?: TurnExecutionIdentity,
): Promise<PeerReviewRingResult> {
  const peerReviewEnabled = resolvePeerReviewEnabled(space);
  if (!peerReviewEnabled) {
    return { results: [], assignments: 0, completed: 0, failed: 0, status: "skipped" };
  }

  const peerReviewAssignments = buildRingPeerReviewAssignments(assignments.guests, guestReports);
  if (peerReviewAssignments.length === 0) {
    return { results: [], assignments: 0, completed: 0, failed: 0, status: "skipped" };
  }

  const results: PeerReviewResult[] = [];
  let completed = 0;
  let failed = 0;
  for (const assignment of peerReviewAssignments) {
    await ctx.appendOrchestrationJournalEntry({
      spaceId: space.config.id,
      turnId,
      eventType: "peer_review.assignment",
      actorId: assignment.reviewerAgentId,
      payload: {
        reviewerAgentId: assignment.reviewerAgentId,
        targetAgentId: assignment.targetAgentId,
      },
    });

    const runtime = await ctx.getRuntime(space, assignment.reviewerAgentId);
    const session = await ctx.getOrCreateAgentSession(space, assignment.reviewerAgentId);
    const reviewPrompt = renderTemplate(
      promptTemplates.peerReview,
      {
        user_input: userMessage.content,
        global_instruction: plannerInstructions.globalInstruction,
        reviewer_agent_id: assignment.reviewerAgentId,
        target_agent_id: assignment.targetAgentId,
        target_report: assignment.targetReport,
        guest_list: formatGuestList(assignments.guests),
        guest_reports: formatGuestReports(guestReports),
        guest_agent_id: assignment.reviewerAgentId,
        guest_instruction: "",
        peer_review_results: "",
      },
    );
    const context: TurnContext = {
      spaceId: space.config.id,
      turnId,
      messages: [
        ...session.messages,
        userMessage,
        { role: "user", content: reviewPrompt },
      ],
      lineageId: randomUUID(),
      hopCount: 0,
      maxHops: ctx.maxHops,
      principalId: executionIdentity?.principalId,
      deviceId: executionIdentity?.deviceId,
      executionOrigin: executionIdentity?.executionOrigin,
      accessMode: executionIdentity?.accessMode,
      mode: executionIdentity?.mode,
      effort: executionIdentity?.effort,
      ...(await ctx.resolveCommittedSessionFields(space, session, userMessage)),
    };

    let reviewResult: TurnResult | null = null;
    try {
      for await (const event of runtime.executeTurn(context)) {
        if (event.type === "turn_completed") {
          reviewResult = event.result;
        }
      }
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      failed += 1;
      const failedResult: PeerReviewResult = {
        reviewerAgentId: assignment.reviewerAgentId,
        targetAgentId: assignment.targetAgentId,
        status: "failed",
        verdict: "error",
        issues: [normalized.message],
        raw: normalized.message,
      };
      results.push(failedResult);
      await ctx.appendOrchestrationJournalEntry({
        spaceId: space.config.id,
        turnId,
        eventType: "peer_review.result",
        actorId: assignment.reviewerAgentId,
        payload: failedResult as unknown as Record<string, unknown>,
      });
      continue;
    }

    if (!reviewResult) {
      failed += 1;
      const failedResult: PeerReviewResult = {
        reviewerAgentId: assignment.reviewerAgentId,
        targetAgentId: assignment.targetAgentId,
        status: "failed",
        verdict: "error",
        issues: ["Reviewer did not return a completion result."],
        raw: "",
      };
      results.push(failedResult);
      await ctx.appendOrchestrationJournalEntry({
        spaceId: space.config.id,
        turnId,
        eventType: "peer_review.result",
        actorId: assignment.reviewerAgentId,
        payload: failedResult as unknown as Record<string, unknown>,
      });
      continue;
    }

    ctx.updateAgentSession(session, turnId, userMessage, reviewResult.finalMessage);
    const parsed = parsePeerReviewResult(
      assignment.reviewerAgentId,
      assignment.targetAgentId,
      reviewResult.finalMessage.content,
    );
    const normalizedResult = parsed ?? {
      reviewerAgentId: assignment.reviewerAgentId,
      targetAgentId: assignment.targetAgentId,
      status: "failed" as const,
      verdict: "error" as const,
      issues: ["Peer-review output invalid; expected strict JSON."],
      raw: reviewResult.finalMessage.content,
    };
    if (normalizedResult.status === "completed") {
      completed += 1;
    } else {
      failed += 1;
    }
    results.push(normalizedResult);
    await ctx.appendOrchestrationJournalEntry({
      spaceId: space.config.id,
      turnId,
      eventType: "peer_review.result",
      actorId: assignment.reviewerAgentId,
      payload: normalizedResult as unknown as Record<string, unknown>,
    });
  }

  return {
    results,
    assignments: peerReviewAssignments.length,
    completed,
    failed,
    status: failed > 0 ? "degraded" : "completed",
    failureReason: failed > 0 ? "One or more peer reviews failed." : undefined,
  };
}
