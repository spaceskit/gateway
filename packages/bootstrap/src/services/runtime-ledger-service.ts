import { randomUUID } from "node:crypto";
import type {
  ApprovalRequestRepository,
  ApprovalRequestStatus,
  IntegrationClass,
  InvocationRecordRepository,
  RunRepository,
  RunRow,
  RunStepKind,
  RunStepRepository,
  UsageRecordRepository,
} from "@spaceskit/persistence";

type TurnEventLike =
  | { type: "state_changed"; state: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; toolCall: { id: string; name: string; arguments?: Record<string, unknown> } }
  | { type: "tool_result"; result: { toolCallId: string; result: unknown; isError?: boolean } }
  | { type: "feedback_requested"; request: { id: string; agentId?: string; triggerClass?: string; description: string; options?: string[] } }
  | {
    type: "turn_completed";
    result: {
      agentId?: string;
      finalMessage?: { content?: string };
      usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        tokenAccuracy?: "reported" | "estimated" | "mixed";
        usageSource?: "ledger" | "local_scanner";
        usageDetails?: Record<string, unknown>;
      };
      metadata?: { providerId?: string; modelId?: string; durationMs?: number; finishReason?: string };
    };
  }
  | { type: "error"; error: Error | { message?: string } };

export interface RuntimeLedgerServiceOptions {
  runs: RunRepository;
  runSteps: RunStepRepository;
  invocationRecords: InvocationRecordRepository;
  approvalRequests: ApprovalRequestRepository;
  usageRecords: UsageRecordRepository;
  classifyIntegrationClass: (providerId?: string) => IntegrationClass;
}

export class RuntimeLedgerService {
  private readonly runs: RunRepository;
  private readonly runSteps: RunStepRepository;
  private readonly invocationRecords: InvocationRecordRepository;
  private readonly approvalRequests: ApprovalRequestRepository;
  private readonly usageRecords: UsageRecordRepository;
  private readonly classifyIntegrationClass: (providerId?: string) => IntegrationClass;
  private readonly runIdByTurnId = new Map<string, string>();
  private readonly sequenceByRunId = new Map<string, number>();
  private readonly outputStepByTurnAgent = new Map<string, string>();
  private readonly toolStepByKey = new Map<string, string>();
  private readonly approvalByTurnId = new Map<string, string>();

  constructor(options: RuntimeLedgerServiceOptions) {
    this.runs = options.runs;
    this.runSteps = options.runSteps;
    this.invocationRecords = options.invocationRecords;
    this.approvalRequests = options.approvalRequests;
    this.usageRecords = options.usageRecords;
    this.classifyIntegrationClass = options.classifyIntegrationClass;
  }

  recordTurnStarted(input: {
    spaceId: string;
    turnId: string;
    inputText: string;
    requestedByPrincipalId?: string;
    requestedByDeviceId?: string;
    targetAgentId?: string;
  }): RunRow | null {
    const existing = this.runs.getByTurnId(input.turnId);
    if (existing) {
      this.runIdByTurnId.set(input.turnId, existing.run_id);
      return existing;
    }

    let run: RunRow;
    try {
      run = this.runs.create({
        runId: randomUUID(),
        spaceId: input.spaceId,
        turnId: input.turnId,
        status: "running",
        triggerSource: "space_input",
        requestedByPrincipalId: input.requestedByPrincipalId,
        requestedByDeviceId: input.requestedByDeviceId,
        targetAgentId: input.targetAgentId,
        inputText: input.inputText,
      });
    } catch (error) {
      if (isMissingSpaceForeignKeyError(error)) {
        return null;
      }
      throw error;
    }
    this.runIdByTurnId.set(input.turnId, run.run_id);
    return run;
  }

  recordTurnEvent(input: {
    spaceId: string;
    turnId: string;
    agentId?: string;
    event: TurnEventLike;
  }): void {
    const run = this.ensureRun(input.spaceId, input.turnId);
    if (!run) {
      return;
    }
    const agentId = normalizeString(input.agentId) ?? this.resolveEventAgentId(input.event);

    switch (input.event.type) {
      case "state_changed":
        this.runs.setStatus(run.run_id, { status: "running", completedAt: null });
        return;
      case "text_delta": {
        this.runs.setStatus(run.run_id, { status: "running", completedAt: null });
        return;
      }
      case "tool_call_start": {
        this.runs.setStatus(run.run_id, { status: "running", completedAt: null });
        const key = this.toolKey(run.run_id, agentId, input.event.toolCall.id);
        const stepId = randomUUID();
        this.toolStepByKey.set(key, stepId);
        this.runSteps.create({
          stepId,
          runId: run.run_id,
          spaceId: input.spaceId,
          agentId,
          sequenceNo: this.nextSequence(run.run_id),
          kind: "tool_invocation",
          status: "running",
          title: input.event.toolCall.name,
          toolName: input.event.toolCall.name,
          payloadJson: safeJson(input.event.toolCall.arguments ?? {}),
        });
        return;
      }
      case "tool_result": {
        const key = this.toolKey(run.run_id, agentId, input.event.result.toolCallId);
        const stepId = this.toolStepByKey.get(key);
        if (stepId) {
          this.runSteps.setStatus(stepId, {
            status: input.event.result.isError ? "failed" : "completed",
            outputJson: safeJson(input.event.result.result),
            errorMessage: input.event.result.isError ? stringifyError(input.event.result.result) : undefined,
          });
          this.toolStepByKey.delete(key);
        }
        return;
      }
      case "feedback_requested": {
        const stepId = randomUUID();
        this.runSteps.create({
          stepId,
          runId: run.run_id,
          spaceId: input.spaceId,
          agentId,
          sequenceNo: this.nextSequence(run.run_id),
          kind: "approval_wait",
          status: "waiting_approval",
          title: "Approval required",
          detailText: input.event.request.description,
          payloadJson: safeJson({ triggerClass: input.event.request.triggerClass ?? "" }),
        });
        this.approvalRequests.create({
          approvalRequestId: input.event.request.id || randomUUID(),
          runId: run.run_id,
          stepId,
          spaceId: input.spaceId,
          turnId: input.turnId,
          agentId,
          category: input.event.request.triggerClass ?? "",
          description: input.event.request.description,
          optionsJson: safeJson(input.event.request.options ?? []),
        });
        this.approvalByTurnId.set(input.turnId, input.event.request.id || "");
        this.runs.setStatus(run.run_id, { status: "waiting_approval", completedAt: null });
        return;
      }
      case "turn_completed": {
        const outputStepId = this.outputStepId(run.run_id, input.turnId, agentId);
        if (this.runSteps.getById(outputStepId)) {
          this.runSteps.setStatus(outputStepId, {
            status: "completed",
            outputJson: safeJson({
              content: input.event.result.finalMessage?.content ?? "",
            }),
          });
          this.outputStepByTurnAgent.delete(this.outputStepKey(input.turnId, agentId));
        }

        const providerId = normalizeProviderId(
          input.event.result.metadata?.providerId,
          input.event.result.metadata?.modelId,
        );
        const modelId = input.event.result.metadata?.modelId ?? "";
        const integrationClass = this.classifyIntegrationClass(providerId);
        const kind: RunStepKind = integrationClass === "executor"
          ? "executor_invocation"
          : integrationClass === "local_runtime"
            ? "local_runtime_invocation"
            : "model_invocation";
        const stepId = randomUUID();
        this.runSteps.create({
          stepId,
          runId: run.run_id,
          spaceId: input.spaceId,
          agentId,
          sequenceNo: this.nextSequence(run.run_id),
          kind,
          status: "completed",
          title: modelId || providerId || "Run step",
          detailText: truncate(input.event.result.finalMessage?.content ?? "", 220),
          providerId: providerId ?? "",
          modelId,
          outputJson: safeJson({
            content: input.event.result.finalMessage?.content ?? "",
            finishReason: input.event.result.metadata?.finishReason ?? "",
          }),
        });
        const invocationId = randomUUID();
        this.invocationRecords.create({
          invocationId,
          runId: run.run_id,
          stepId,
          spaceId: input.spaceId,
          integrationId: providerId ?? "",
          integrationClass,
          status: "completed",
          providerId: providerId ?? "",
          modelId,
          responseJson: safeJson({
            content: input.event.result.finalMessage?.content ?? "",
            durationMs: input.event.result.metadata?.durationMs ?? 0,
          }),
          usageJson: safeJson(input.event.result.usage ?? {}),
        });
        this.usageRecords.create({
          usageRecordId: randomUUID(),
          runId: run.run_id,
          stepId,
          invocationId,
          spaceId: input.spaceId,
          providerId: providerId ?? "",
          modelId,
          promptTokens: input.event.result.usage?.promptTokens ?? 0,
          completionTokens: input.event.result.usage?.completionTokens ?? 0,
          totalTokens: input.event.result.usage?.totalTokens ?? 0,
          tokenAccuracy: input.event.result.usage?.tokenAccuracy ?? "reported",
          metadataJson: safeJson(input.event.result.usage?.usageDetails ?? {}),
        });
        this.runs.setStatus(run.run_id, { status: "completed" });
        return;
      }
      case "error": {
        const outputStepId = this.outputStepId(run.run_id, input.turnId, agentId);
        if (this.runSteps.getById(outputStepId)) {
          this.runSteps.setStatus(outputStepId, {
            status: "failed",
            errorMessage: stringifyError(input.event.error),
          });
        }
        this.runs.setStatus(run.run_id, {
          status: "failed",
          errorMessage: stringifyError(input.event.error),
        });
      }
    }
  }

  recordApprovalResolution(
    turnId: string,
    status: ApprovalRequestStatus,
    resolution?: string,
  ): void {
    const approvalId = this.approvalByTurnId.get(turnId);
    if (approvalId) {
      this.approvalRequests.setStatus(approvalId, status, resolution);
    }
    const run = this.runs.getByTurnId(turnId);
    if (run && status !== "pending") {
      this.runs.setStatus(run.run_id, { status: "running", completedAt: null });
    }
  }

  private ensureRun(spaceId: string, turnId: string): RunRow | null {
    const mapped = this.runIdByTurnId.get(turnId);
    if (mapped) {
      const run = this.runs.getById(mapped);
      if (run) return run;
    }
    return this.recordTurnStarted({
      spaceId,
      turnId,
      inputText: "",
    });
  }

  private nextSequence(runId: string): number {
    const next = (this.sequenceByRunId.get(runId) ?? 0) + 1;
    this.sequenceByRunId.set(runId, next);
    return next;
  }

  private outputStepId(runId: string, turnId: string, agentId?: string): string {
    const key = this.outputStepKey(turnId, agentId);
    const existing = this.outputStepByTurnAgent.get(key);
    if (existing) {
      return existing;
    }
    const stepId = `stream-${runId}-${this.nextSequence(runId)}`;
    this.outputStepByTurnAgent.set(key, stepId);
    return stepId;
  }

  private outputStepKey(turnId: string, agentId?: string): string {
    return `${turnId}:${agentId ?? ""}:stream`;
  }

  private toolKey(runId: string, agentId: string | undefined, toolCallId: string): string {
    return `${runId}:${agentId ?? ""}:${toolCallId}`;
  }

  private resolveEventAgentId(event: TurnEventLike): string | undefined {
    if (event.type === "turn_completed") {
      return normalizeString(event.result.agentId);
    }
    if (event.type === "feedback_requested") {
      return normalizeString(event.request.agentId);
    }
    return undefined;
  }
}

function normalizeString(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeProviderId(providerId?: string, modelId?: string): string | undefined {
  const normalizedProviderId = normalizeString(providerId);
  if (normalizedProviderId) {
    return normalizedProviderId;
  }
  const normalizedModelId = normalizeString(modelId);
  if (!normalizedModelId) {
    return undefined;
  }
  const [prefix] = normalizedModelId.split("/");
  return normalizeString(prefix);
}

function isMissingSpaceForeignKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { code?: unknown; message?: unknown };
  if (record.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
    return true;
  }
  return typeof record.message === "string" && record.message.includes("FOREIGN KEY constraint failed");
}

function truncate(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}...`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function stringifyError(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
