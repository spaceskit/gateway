export type ConciergeWorkbenchSignalKind =
  | "run_awaiting_review"
  | "run_failed"
  | "run_stale"
  | "run_completed"
  | "safe_next_task";

export interface ConciergeWorkbenchSignal {
  kind: ConciergeWorkbenchSignalKind;
  key: string;
  question: string;
  reason: string;
  urgency: "passive" | "important" | "urgent";
  allowedResponses: Array<"approve" | "reject" | "defer" | "revise" | "open_app">;
  context: Record<string, unknown>;
}

export interface ConciergeWorkbenchMonitorRunInput {
  spaceId: string;
  requestingAgentId: string;
  requestingTurnId?: string;
  principalId?: string;
  deviceId?: string;
}

export interface ConciergeWorkbenchMonitorServiceOptions {
  workbenchService: {
    listQueue(input?: Record<string, unknown>): Promise<unknown[]>;
    listRuns(input?: Record<string, unknown>): Promise<unknown[]>;
    getPolicy(input?: Record<string, unknown>): Promise<unknown>;
    startRun?(input: ConciergeWorkbenchStartRunInput): Promise<unknown>;
    retryRun?(input: ConciergeWorkbenchRunControlInput): Promise<unknown>;
    cancelRun?(input: ConciergeWorkbenchRunControlInput): Promise<unknown>;
    approveStage?(input: ConciergeWorkbenchReviewStageInput): Promise<unknown>;
    rejectStage?(input: ConciergeWorkbenchReviewStageInput): Promise<unknown>;
  };
  escalationService: {
    requestUserInput(input: Record<string, unknown>): Promise<unknown>;
    findRecentRequestByContext?(input: {
      spaceId: string;
      context: Record<string, unknown>;
      now?: Date;
      cooldownMs?: number;
    }): Promise<{ requestId: string; status: string } | undefined>;
  };
  now?: () => Date;
  cooldownMs?: number;
  staleRunMs?: number;
  logger?: {
    warn(message: string, details?: Record<string, unknown>): void;
    info?(message: string, details?: Record<string, unknown>): void;
  } | null;
}

export interface ConciergeWorkbenchStartRunInput {
  principalId: string;
  queueItemId: string;
  executionMode?: "supervised" | "autonomous";
  confirmationRequestId?: string;
  idempotencyKey?: string;
}

export interface ConciergeWorkbenchReviewStageInput {
  principalId: string;
  runId: string;
  stage?: string;
  reason?: string;
  confirmationRequestId?: string;
  idempotencyKey?: string;
}

export interface ConciergeWorkbenchRunControlInput {
  principalId: string;
  runId: string;
  confirmationRequestId?: string;
  idempotencyKey?: string;
}

export interface ConciergeWorkbenchResolvedRequest {
  requestId: string;
  status: string;
  principalId?: string;
  response?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const DEFAULT_STALE_RUN_MS = 30 * 60 * 1000;

export class ConciergeWorkbenchMonitorService {
  private readonly now: () => Date;
  private readonly cooldownMs: number;
  private readonly staleRunMs: number;
  private readonly promptedAtByKey = new Map<string, number>();
  private readonly dispatchedRequestIds = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: ConciergeWorkbenchMonitorServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.staleRunMs = options.staleRunMs ?? DEFAULT_STALE_RUN_MS;
  }

  start(input: ConciergeWorkbenchMonitorRunInput, intervalMs: number): ReturnType<typeof setInterval> {
    this.stop();
    this.timer = setInterval(() => {
      void this.runOnce(input).catch((error) => {
        this.options.logger?.warn("Concierge Workbench monitor failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, Math.max(10_000, intervalMs));
    return this.timer;
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(input: ConciergeWorkbenchMonitorRunInput): Promise<ConciergeWorkbenchSignal[]> {
    const policy = await this.options.workbenchService.getPolicy({});
    if (isRecord(policy) && policy.runnerAvailable === false) return [];

    const [queue, runs] = await Promise.all([
      this.options.workbenchService.listQueue({ limit: 100 }),
      this.options.workbenchService.listRuns({ limit: 20 }),
    ]);

    const signals = this.selectSignals(queue, runs);
    const emitted: ConciergeWorkbenchSignal[] = [];
    for (const signal of signals) {
      if (this.isCoolingDown(signal.key)) continue;
      if (await this.hasRecentPersistedPrompt(input.spaceId, signal)) continue;
      await this.options.escalationService.requestUserInput({
        spaceId: input.spaceId,
        requestingAgentId: input.requestingAgentId,
        requestingTurnId: input.requestingTurnId ?? "concierge-workbench-monitor",
        principalId: input.principalId,
        deviceId: input.deviceId,
        question: signal.question,
        reason: signal.reason,
        urgency: signal.urgency,
        allowedResponses: signal.allowedResponses,
        context: signal.context,
        fallbackPolicy: "none",
        timeoutSeconds: this.promptTimeoutSeconds(),
      });
      this.promptedAtByKey.set(signal.key, this.now().getTime());
      emitted.push(signal);
    }
    return emitted;
  }

  async handleResolvedRequest(input: ConciergeWorkbenchResolvedRequest): Promise<unknown | null> {
    if (this.dispatchedRequestIds.has(input.requestId)) return null;
    if (input.status !== "actioned") return null;
    const action = optionalString(input.response?.action);
    if (action !== "approve" && action !== "reject") return null;
    if (!input.principalId?.trim()) return null;

    const context = isRecord(input.context) ? input.context : {};
    if (context.source !== "workbench") return null;

    if (context.signalKind === "safe_next_task") {
      if (action !== "approve") return null;
      if (context.requestedMutation !== "workbench.start_run") return null;
      return await this.dispatchStartRun(input, context);
    }

    if (context.signalKind === "run_awaiting_review") {
      return await this.dispatchReviewGateAction(input, context, action);
    }

    if (action !== "approve") return null;
    return await this.dispatchApprovedWorkbenchMutation(input, context);
  }

  private async dispatchStartRun(
    input: ConciergeWorkbenchResolvedRequest,
    context: Record<string, unknown>,
  ): Promise<unknown | null> {
    const queueItemId = optionalString(context.queueItemId);
    if (!queueItemId) return null;
    const principalId = input.principalId?.trim();
    if (!principalId) return null;

    this.dispatchedRequestIds.add(input.requestId);
    try {
      return await this.options.workbenchService.startRun?.({
        principalId,
        queueItemId,
        executionMode: resolvedExecutionMode(context.executionMode),
        confirmationRequestId: input.requestId,
        idempotencyKey: `concierge-workbench:${input.requestId}`,
      }) ?? null;
    } catch (error) {
      this.dispatchedRequestIds.delete(input.requestId);
      this.options.logger?.warn("Concierge Workbench approved dispatch failed", {
        requestId: input.requestId,
        queueItemId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async dispatchReviewGateAction(
    input: ConciergeWorkbenchResolvedRequest,
    context: Record<string, unknown>,
    action: "approve" | "reject",
  ): Promise<unknown | null> {
    const runId = optionalString(context.runId);
    if (!runId) return null;

    const stage = optionalString(context.stage);
    const principalId = input.principalId?.trim();
    if (!principalId) return null;

    if (action === "approve" && context.requestedMutation !== "workbench.approve_stage") return null;
    if (action === "reject" && context.rejectMutation !== "workbench.reject_stage") return null;

    this.dispatchedRequestIds.add(input.requestId);
    try {
      if (action === "approve") {
        return await this.options.workbenchService.approveStage?.({
          principalId,
          runId,
          ...(stage ? { stage } : {}),
          confirmationRequestId: input.requestId,
          idempotencyKey: `concierge-workbench:${input.requestId}`,
        }) ?? null;
      }

      return await this.options.workbenchService.rejectStage?.({
        principalId,
        runId,
        ...(stage ? { stage } : {}),
        reason: resolvedRejectReason(input.response),
        confirmationRequestId: input.requestId,
        idempotencyKey: `concierge-workbench:${input.requestId}`,
      }) ?? null;
    } catch (error) {
      this.dispatchedRequestIds.delete(input.requestId);
      this.options.logger?.warn("Concierge Workbench approved review action failed", {
        requestId: input.requestId,
        runId,
        action,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async dispatchApprovedWorkbenchMutation(
    input: ConciergeWorkbenchResolvedRequest,
    context: Record<string, unknown>,
  ): Promise<unknown | null> {
    const requestedMutation = optionalString(context.requestedMutation);
    switch (requestedMutation) {
      case "workbench.start_run":
        return await this.dispatchStartRun(input, context);
      case "workbench.retry_run":
        return await this.dispatchRunControl(input, context, "retry");
      case "workbench.cancel_run":
        return await this.dispatchRunControl(input, context, "cancel");
      case "workbench.approve_stage":
        return await this.dispatchReviewGateAction(input, context, "approve");
      case "workbench.reject_stage":
        return await this.dispatchReviewGateAction(input, {
          ...context,
          rejectMutation: "workbench.reject_stage",
        }, "reject");
      default:
        return null;
    }
  }

  private async dispatchRunControl(
    input: ConciergeWorkbenchResolvedRequest,
    context: Record<string, unknown>,
    action: "retry" | "cancel",
  ): Promise<unknown | null> {
    const runId = optionalString(context.runId);
    if (!runId) return null;
    const principalId = input.principalId?.trim();
    if (!principalId) return null;

    this.dispatchedRequestIds.add(input.requestId);
    try {
      const payload = {
        principalId,
        runId,
        confirmationRequestId: input.requestId,
        idempotencyKey: `concierge-workbench:${input.requestId}`,
      };
      if (action === "retry") {
        return await this.options.workbenchService.retryRun?.(payload) ?? null;
      }
      return await this.options.workbenchService.cancelRun?.(payload) ?? null;
    } catch (error) {
      this.dispatchedRequestIds.delete(input.requestId);
      this.options.logger?.warn("Concierge Workbench approved run control failed", {
        requestId: input.requestId,
        runId,
        action,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private selectSignals(queue: unknown[], runs: unknown[]): ConciergeWorkbenchSignal[] {
    const queueItems = queue.map(asQueueItem);
    const runItems = runs.map(asRun);

    const reviewRun = runItems.find((run) => run.status === "awaiting_review");
    if (reviewRun) {
      return [{
        kind: "run_awaiting_review",
        key: `run_awaiting_review:${reviewRun.runId}`,
        question: `Open Workbench run ${reviewRun.runId} for review`,
        reason: `Review evidence for ${reviewRun.queueItemId}`,
        urgency: "important",
        allowedResponses: ["approve", "reject", "open_app", "defer"],
        context: {
          source: "workbench",
          signalKind: "run_awaiting_review",
          action: "open_workbench_run",
          requestedMutation: "workbench.approve_stage",
          rejectMutation: "workbench.reject_stage",
          runId: reviewRun.runId,
          queueItemId: reviewRun.queueItemId,
          stage: reviewRun.currentStage,
        },
      }];
    }

    const failedRun = runItems.find((run) => run.status === "failed");
    if (failedRun) {
      return [{
        kind: "run_failed",
        key: `run_failed:${failedRun.runId}:${failedRun.lastErrorCode ?? ""}`,
        question: `Open failed Workbench run ${failedRun.runId}`,
        reason: failedRun.lastErrorMessage
          ? `Review failure for ${failedRun.queueItemId}: ${failedRun.lastErrorMessage}`
          : `Review failure evidence for ${failedRun.queueItemId}`,
        urgency: "important",
        allowedResponses: ["open_app", "defer"],
        context: {
          source: "workbench",
          signalKind: "run_failed",
          action: "open_workbench_run",
          runId: failedRun.runId,
          queueItemId: failedRun.queueItemId,
          lastErrorCode: failedRun.lastErrorCode,
        },
      }];
    }

    const staleRun = runItems.find((run) => {
      if (run.status !== "queued" && run.status !== "running") return false;
      const updatedAt = Date.parse(run.updatedAt);
      return Number.isFinite(updatedAt) && this.now().getTime() - updatedAt >= this.staleRunMs;
    });
    if (staleRun) {
      return [{
        kind: "run_stale",
        key: `run_stale:${staleRun.runId}:${staleRun.currentStage}`,
        question: `Open possibly stuck Workbench run ${staleRun.runId}`,
        reason: `It has stayed in ${staleRun.currentStage} for longer than the monitor threshold`,
        urgency: "important",
        allowedResponses: ["open_app", "defer"],
        context: {
          source: "workbench",
          signalKind: "run_stale",
          action: "open_workbench_run",
          runId: staleRun.runId,
          queueItemId: staleRun.queueItemId,
          currentStage: staleRun.currentStage,
        },
      }];
    }

    const completedRun = runItems.find((run) => {
      if (run.status !== "completed") return false;
      const queueItem = queueItems.find((item) => item.queueItemId === run.queueItemId);
      return !queueItem || !isAcceptedQueueStatus(queueItem.status);
    });
    if (completedRun) {
      const executionContext = completedRun.executionContext;
      const openExecutionSpace = executionContext?.spaceId;
      return [{
        kind: "run_completed",
        key: `run_completed:${completedRun.runId}:${completedRun.queueItemId}`,
        question: `Review completed Workbench run ${completedRun.runId} for acceptance`,
        reason: openExecutionSpace
          ? `Open the execution Space to review ${completedRun.queueItemId} before marking it accepted`
          : `Open the run detail to review ${completedRun.queueItemId} before marking it accepted`,
        urgency: "important",
        allowedResponses: ["open_app", "defer"],
        context: {
          source: "workbench",
          signalKind: "run_completed",
          action: openExecutionSpace ? "open_execution_space" : "open_workbench_run",
          runId: completedRun.runId,
          queueItemId: completedRun.queueItemId,
          verificationStatus: completedRun.verificationStatus,
          ...(executionContext?.spaceId ? { spaceId: executionContext.spaceId } : {}),
          ...(executionContext?.spaceUid ? { spaceUid: executionContext.spaceUid } : {}),
          ...(executionContext?.spaceName ? { spaceName: executionContext.spaceName } : {}),
        },
      }];
    }

    const hasActiveRun = runItems.some((run) => run.status === "queued" || run.status === "running");
    if (hasActiveRun) return [];

    const nextTask = queueItems.find((item) => isSafeSupervisedNextTask(item));
    if (!nextTask) return [];

    return [{
      kind: "safe_next_task",
      key: `safe_next_task:${nextTask.queueItemId}`,
      question: `Start the next safe Workbench task: ${nextTask.title}`,
      reason: `Confirm before starting ${nextTask.queueItemId}`,
      urgency: "passive",
      allowedResponses: ["approve", "open_app", "defer"],
      context: {
        source: "workbench",
        signalKind: "safe_next_task",
        action: "open_workbench_queue_item",
        requestedMutation: "workbench.start_run",
        executionMode: "supervised",
        queueItemId: nextTask.queueItemId,
      },
    }];
  }

  private isCoolingDown(key: string): boolean {
    const promptedAt = this.promptedAtByKey.get(key);
    if (!promptedAt) return false;
    return this.now().getTime() - promptedAt < this.cooldownMs;
  }

  private async hasRecentPersistedPrompt(
    spaceId: string,
    signal: ConciergeWorkbenchSignal,
  ): Promise<boolean> {
    const existing = await this.options.escalationService.findRecentRequestByContext?.({
      spaceId,
      context: signal.context,
      now: this.now(),
      cooldownMs: this.cooldownMs,
    });
    if (!existing) return false;
    if (existing.status === "expired" || existing.status === "cancelled") return false;
    this.promptedAtByKey.set(signal.key, this.now().getTime());
    return true;
  }

  private promptTimeoutSeconds(): number {
    return Math.max(1, Math.ceil(this.cooldownMs / 1000));
  }
}

function asRun(value: unknown): {
  runId: string;
  queueItemId: string;
  status: string;
  currentStage: string;
  updatedAt: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  verificationStatus?: string;
  executionContext?: {
    spaceId?: string;
    spaceUid?: string;
    spaceName?: string;
  };
} {
  const record = isRecord(value) ? value : {};
  const verificationResult = isRecord(record.verificationResult) ? record.verificationResult : {};
  const executionContext = isRecord(record.executionContext) ? record.executionContext : {};
  return {
    runId: asString(record.runId),
    queueItemId: asString(record.queueItemId),
    status: asString(record.status),
    currentStage: asString(record.currentStage),
    updatedAt: asString(record.updatedAt),
    lastErrorCode: optionalString(record.lastErrorCode),
    lastErrorMessage: optionalString(record.lastErrorMessage),
    verificationStatus: optionalString(verificationResult.status),
    executionContext: {
      spaceId: optionalString(executionContext.spaceId),
      spaceUid: optionalString(executionContext.spaceUid),
      spaceName: optionalString(executionContext.spaceName),
    },
  };
}

function asQueueItem(value: unknown): {
  queueItemId: string;
  title: string;
  status: string;
  executionModeEligibility: { supervised: boolean; autonomous: boolean };
  executionModeBlockers: string[];
} {
  const record = isRecord(value) ? value : {};
  const eligibility = isRecord(record.executionModeEligibility) ? record.executionModeEligibility : {};
  return {
    queueItemId: asString(record.queueItemId),
    title: asString(record.title),
    status: asString(record.status),
    executionModeEligibility: {
      supervised: eligibility.supervised === true,
      autonomous: eligibility.autonomous === true,
    },
    executionModeBlockers: Array.isArray(record.executionModeBlockers)
      ? record.executionModeBlockers.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown): string | undefined {
  const normalized = asString(value);
  return normalized || undefined;
}

function resolvedRejectReason(response: Record<string, unknown> | undefined): string {
  return optionalString(response?.comment)
    ?? optionalString(response?.reason)
    ?? optionalString(response?.message)
    ?? "Review gate rejected by operator.";
}

function resolvedExecutionMode(value: unknown): "supervised" | "autonomous" {
  return value === "autonomous" ? "autonomous" : "supervised";
}

function isAcceptedQueueStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === "done" || normalized === "dropped";
}

function isSafeSupervisedNextTask(item: {
  status: string;
  executionModeEligibility: { supervised: boolean };
}): boolean {
  const status = item.status.trim().toLowerCase();
  return status === "ready" && item.executionModeEligibility.supervised;
}
