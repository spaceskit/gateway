/**
 * Feedback / cancellation lifecycle helpers extracted from SpaceManager.
 *
 * Covers:
 *  - resumeFeedback: resolve a paused turn (approve/reject/revise/defer).
 *  - cancelTurn: cancel an active or paused turn.
 *  - startFeedbackTimeout: schedule auto-reject when human feedback stalls.
 *
 * Implementation lives outside SpaceManager so the class stays focused on the
 * turn-execution orchestration core.
 */

import type { EventBus } from "../events/event-bus.js";
import type {
  RuntimeApprovalSelection,
  RuntimeFeedbackCheckpoint,
  TurnEvent,
} from "../agents/agent-runtime.js";
import type { ActiveSpace } from "./space-manager-agent-sessions.js";

export interface FeedbackResolutionInput {
  spaceId: string;
  turnId: string;
  request?: RuntimeFeedbackCheckpoint;
  response: "approve" | "reject" | "revise" | "defer";
  revision?: string;
  approvalGrant?: RuntimeApprovalSelection;
  principalId?: string;
  deviceId?: string;
}

export interface ResumeFeedbackInput {
  activeSpaces: Map<string, ActiveSpace>;
  spaceId: string;
  turnId: string;
  response: "approve" | "reject" | "revise" | "defer";
  revision?: string;
  options?: {
    approvalGrant?: RuntimeApprovalSelection;
    principalId?: string;
    deviceId?: string;
  };
  handleFeedbackResolution?: (input: FeedbackResolutionInput) => Promise<void> | void;
  forwardEvent: (
    spaceId: string,
    turnId: string,
    event: TurnEvent,
    agentId?: string,
  ) => void;
}

export async function resumePausedTurnFeedback(input: ResumeFeedbackInput): Promise<void> {
  const {
    activeSpaces,
    spaceId,
    turnId,
    response,
    revision,
    options,
    handleFeedbackResolution,
    forwardEvent,
  } = input;

  const space = activeSpaces.get(spaceId);
  if (!space) throw new Error(`Space ${spaceId} not active`);

  const runtime = space.pausedRuntimes.get(turnId);
  if (!runtime) throw new Error(`No paused turn ${turnId} in space ${spaceId}`);
  const pausedAgentId = space.pausedRuntimeAgentIds.get(turnId);
  const pausedRequest = space.pausedFeedbackRequests.get(turnId);

  space.pausedRuntimes.delete(turnId);
  space.pausedRuntimeAgentIds.delete(turnId);
  space.pausedFeedbackRequests.delete(turnId);

  // Clear feedback timeout timer
  const timer = space.feedbackTimers.get(turnId);
  if (timer) {
    clearTimeout(timer);
    space.feedbackTimers.delete(turnId);
  }

  await handleFeedbackResolution?.({
    spaceId,
    turnId,
    request: pausedRequest,
    response,
    revision,
    approvalGrant: options?.approvalGrant,
    principalId: options?.principalId,
    deviceId: options?.deviceId,
  });

  // Resume — events will flow through the original generator
  for await (const event of runtime.resumeWithFeedback(turnId, response, revision)) {
    forwardEvent(spaceId, turnId, event, pausedAgentId);
  }
}

export interface CancelTurnInput {
  activeSpaces: Map<string, ActiveSpace>;
  eventBus: EventBus;
  spaceId: string;
  turnId: string;
}

export async function cancelActiveOrPausedTurn(input: CancelTurnInput): Promise<boolean> {
  const { activeSpaces, eventBus, spaceId, turnId } = input;
  const space = activeSpaces.get(spaceId);
  if (!space) return false;

  // Check active (executing) turns first
  const activeRuntime = space.activeTurnRuntimes.get(turnId);
  if (activeRuntime) {
    await activeRuntime.cancel();
    space.activeTurnRuntimes.delete(turnId);
    eventBus.emit({
      type: "space.turn_event",
      spaceId,
      turnId,
      event: { type: "turn_cancelled" },
      timestamp: new Date(),
    });
    return true;
  }

  // Check paused (awaiting feedback) turns
  const pausedRuntime = space.pausedRuntimes.get(turnId);
  if (pausedRuntime) {
    await pausedRuntime.cancel();
    space.pausedRuntimes.delete(turnId);
    space.pausedRuntimeAgentIds.delete(turnId);
    space.pausedFeedbackRequests.delete(turnId);
    const timer = space.feedbackTimers.get(turnId);
    if (timer) {
      clearTimeout(timer);
      space.feedbackTimers.delete(turnId);
    }
    eventBus.emit({
      type: "space.turn_event",
      spaceId,
      turnId,
      event: { type: "turn_cancelled" },
      timestamp: new Date(),
    });
    return true;
  }

  return false;
}

export interface StartFeedbackTimeoutInput {
  activeSpaces: Map<string, ActiveSpace>;
  eventBus: EventBus;
  spaceId: string;
  turnId: string;
  timeoutMs: number;
  /** Called when the timer fires and the paused runtime is still present. */
  onTimeout: (spaceId: string, turnId: string) => void;
}

export function startPausedFeedbackTimeout(input: StartFeedbackTimeoutInput): void {
  const { activeSpaces, eventBus, spaceId, turnId, timeoutMs, onTimeout } = input;
  const space = activeSpaces.get(spaceId);
  if (!space) return;

  const timer = setTimeout(() => {
    space.feedbackTimers.delete(turnId);
    const runtime = space.pausedRuntimes.get(turnId);
    if (!runtime) {
      space.pausedRuntimeAgentIds.delete(turnId);
      space.pausedFeedbackRequests.delete(turnId);
      return; // Already resumed
    }

    // Auto-reject the paused turn
    eventBus.emit({
      type: "space.feedback_timeout",
      spaceId,
      turnId,
      timeoutMs,
      timestamp: new Date(),
    });

    onTimeout(spaceId, turnId);
  }, timeoutMs);

  space.feedbackTimers.set(turnId, timer);
}
