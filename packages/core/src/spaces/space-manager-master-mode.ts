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
  TurnContext,
  TurnEvent,
  TurnResult,
} from "../agents/agent-runtime.js";
import type { ModelMessage } from "../agents/model-provider.js";
import type { OrchestratorSummaryTrace } from "./space-summary-trace.js";
import { buildCompletedSaveTurnInput } from "./space-manager-turn-records.js";
import type {
  ActiveSpace,
} from "./space-manager-agent-sessions.js";
import type { TurnExecutionIdentity } from "./space-manager-normalizers.js";
import {
  renderTemplate,
} from "./master-mode-prompts.js";
import {
  buildFallbackGuestInstruction,
  buildRevisionFeedback,
  checkMasterModeConvergence,
  formatGuestList,
  formatGuestReports,
  formatPeerReviewResults,
  resolveMasterModePromptTemplates,
  resolvePeerReviewEnabled,
  resolvePeerReviewTopology,
  type GuestReport,
  type MasterFlowAssignments,
} from "./space-manager-master-mode-helpers.js";
import { runMasterPlannerPhase } from "./space-manager-master-mode-planner.js";
import { runPeerReviewRing } from "./space-manager-master-mode-peer-review.js";
import type {
  MasterModeContext,
  PeerReviewRingResult,
} from "./space-manager-master-mode-types.js";

export type {
  MasterModeContext,
  PeerReviewRingResult,
} from "./space-manager-master-mode-types.js";

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
