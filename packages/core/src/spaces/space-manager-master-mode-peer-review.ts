import { randomUUID } from "node:crypto";
import type { TurnContext, TurnResult } from "../agents/agent-runtime.js";
import type { ModelMessage } from "../agents/model-provider.js";
import { renderTemplate, type MasterModePromptTemplates } from "./master-mode-prompts.js";
import type { ActiveSpace } from "./space-manager-agent-sessions.js";
import {
  buildRingPeerReviewAssignments,
  formatGuestList,
  formatGuestReports,
  parsePeerReviewResult,
  resolvePeerReviewEnabled,
  type GuestReport,
  type MasterFlowAssignments,
  type PeerReviewResult,
  type PlannerInstructions,
} from "./space-manager-master-mode-helpers.js";
import type { TurnExecutionIdentity } from "./space-manager-normalizers.js";
import type {
  MasterModeContext,
  PeerReviewRingResult,
} from "./space-manager-master-mode-types.js";

export async function runPeerReviewRing(
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
      await recordPeerReviewResult(ctx, space, turnId, assignment.reviewerAgentId, failedResult);
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
      await recordPeerReviewResult(ctx, space, turnId, assignment.reviewerAgentId, failedResult);
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
    await recordPeerReviewResult(ctx, space, turnId, assignment.reviewerAgentId, normalizedResult);
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

async function recordPeerReviewResult(
  ctx: MasterModeContext,
  space: ActiveSpace,
  turnId: string,
  reviewerAgentId: string,
  result: PeerReviewResult,
): Promise<void> {
  await ctx.appendOrchestrationJournalEntry({
    spaceId: space.config.id,
    turnId,
    eventType: "peer_review.result",
    actorId: reviewerAgentId,
    payload: result as unknown as Record<string, unknown>,
  });
}
