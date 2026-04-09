import { randomUUID } from "node:crypto";
import type {
  ConciergeEscalationAllowedResponse,
  ConciergeEscalationDeliveryChannel,
  ConciergeEscalationFallbackPolicy,
  ConciergeEscalationRequestInput,
  ConciergeEscalationRequestResult,
  ConciergeEscalationResponseMode,
  ConciergeEscalationStatus,
  ConciergeEscalationStatusResult,
  ConciergeEscalationUrgency,
  EventBus,
  Notification,
  NotificationService,
} from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import type {
  ConciergeEscalationRequestRepository,
  ConciergeEscalationRequestRow,
} from "@spaceskit/persistence";
import type { ConciergeCallRuntimeService } from "./concierge-call-runtime-service.js";

const DEFAULT_RESPONSE_MODE: ConciergeEscalationResponseMode = "structured";
const DEFAULT_TIMEOUT_SECONDS = 300;
const DEFAULT_URGENT_CALL_TIMEOUT_SECONDS = 5;
const FINAL_STATUSES = new Set<ConciergeEscalationStatus>([
  "actioned",
  "expired",
  "escalated_to_call",
  "cancelled",
]);

export interface ConciergeEscalationResolutionInput {
  requestId: string;
  status: "ok" | "error";
  payload?: Record<string, unknown>;
  error?: string;
}

export class ConciergeEscalationService {
  private readonly now: () => Date;
  private conciergeCallRuntimeService: Pick<ConciergeCallRuntimeService, "startCall"> | null;

  constructor(private readonly options: {
    repository: ConciergeEscalationRequestRepository;
    notificationService: NotificationService;
    eventBus: EventBus;
    logger: Logger;
    conciergeCallRuntimeService?: Pick<ConciergeCallRuntimeService, "startCall"> | null;
    now?: () => Date;
  }) {
    this.now = options.now ?? (() => new Date());
    this.conciergeCallRuntimeService = options.conciergeCallRuntimeService ?? null;
  }

  setConciergeCallRuntimeService(
    service: Pick<ConciergeCallRuntimeService, "startCall"> | null,
  ): void {
    this.conciergeCallRuntimeService = service;
  }

  async requestUserInput(input: ConciergeEscalationRequestInput & {
    spaceId: string;
    requestingAgentId: string;
    requestingTurnId: string;
    principalId?: string;
    deviceId?: string;
  }): Promise<ConciergeEscalationRequestResult> {
    const now = this.now();
    const question = normalizeRequired(input.question, "question");
    const reason = normalizeRequired(input.reason, "reason");
    const urgency = normalizeUrgency(input.urgency);
    const responseMode = normalizeResponseMode(input.responseMode);
    const allowedResponses = normalizeAllowedResponses(input.allowedResponses);
    const fallbackPolicy = normalizeFallbackPolicy(input.fallbackPolicy);
    if (fallbackPolicy === "urgent_call_after_timeout" && urgency !== "urgent") {
      throw new Error("fallbackPolicy urgent_call_after_timeout requires urgency=urgent");
    }
    const timeoutSeconds = normalizeTimeoutSeconds(input.timeoutSeconds, fallbackPolicy);
    const requestId = randomUUID();
    const expiresAt = new Date(now.getTime() + (timeoutSeconds * 1000));
    const deepLink = buildDeepLink(requestId, input.spaceId);
    const userMessage = buildUserMessage(question, reason, urgency);

    this.options.repository.create({
      requestId,
      spaceId: input.spaceId,
      requestingAgentId: input.requestingAgentId,
      targetAgentId: normalizeOptional(input.targetAgentId),
      requestingTurnId: input.requestingTurnId,
      principalId: normalizeOptional(input.principalId),
      deviceId: normalizeOptional(input.deviceId),
      reason,
      question,
      userMessage,
      urgency,
      responseMode,
      allowedResponses,
      fallbackPolicy,
      timeoutSeconds,
      status: "pending",
      deliveryChannel: "notification",
      deepLink,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    try {
      await this.options.notificationService.send(
        this.buildNotification({
          requestId,
          spaceId: input.spaceId,
          principalId: normalizeOptional(input.principalId),
          requestingAgentId: input.requestingAgentId,
          urgency,
          userMessage,
          deepLink,
          allowedResponses,
          fallbackPolicy,
          expiresAt,
          createdAt: now,
        }),
      );
    } catch (error) {
      this.options.repository.update({
        requestId,
        status: "cancelled",
        cancelledAt: now.toISOString(),
        responseJson: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          cancelledAt: now.toISOString(),
        }),
      });
      throw error;
    }

    const updated = this.options.repository.update({
      requestId,
      status: "notified",
      notifiedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      deepLink,
    });
    const row = updated ?? this.requireRequest(requestId);

    this.options.eventBus.emit({
      type: "concierge.request.created",
      timestamp: now,
      spaceId: row.space_id,
      requestId: row.request_id,
      data: {
        status: row.status,
        urgency: row.urgency,
        fallbackPolicy: row.fallback_policy,
      },
    });

    return toRequestResult(row);
  }

  async getRequestStatus(input: {
    requestId: string;
    spaceId: string;
    agentId: string;
  }): Promise<ConciergeEscalationStatusResult> {
    const row = this.requireRequest(input.requestId);
    assertSpaceMatch(row, input.spaceId);
    return toStatusResult(row);
  }

  async cancelRequest(input: {
    requestId: string;
    reason?: string;
    spaceId: string;
    agentId: string;
  }): Promise<ConciergeEscalationRequestResult> {
    const row = this.requireRequest(input.requestId);
    assertSpaceMatch(row, input.spaceId);
    if (FINAL_STATUSES.has(row.status)) {
      return toRequestResult(row);
    }

    const nowIso = this.now().toISOString();
    const updated = this.options.repository.update({
      requestId: input.requestId,
      status: "cancelled",
      cancelledAt: nowIso,
      responseJson: JSON.stringify({
        action: "cancelled",
        reason: normalizeOptional(input.reason),
        respondedAt: nowIso,
      }),
    }) ?? this.requireRequest(input.requestId);

    this.options.eventBus.emit({
      type: "concierge.request.cancelled",
      timestamp: new Date(nowIso),
      spaceId: updated.space_id,
      requestId: updated.request_id,
      data: {
        status: updated.status,
        reason: normalizeOptional(input.reason),
      },
    });

    return toRequestResult(updated);
  }

  async resolveRequest(input: ConciergeEscalationResolutionInput): Promise<ConciergeEscalationStatusResult> {
    const row = this.requireRequest(input.requestId);
    if (FINAL_STATUSES.has(row.status)) {
      return toStatusResult(row);
    }

    const now = this.now();
    const payload = isRecord(input.payload) ? input.payload : {};
    if (input.status === "error" || payload.cancelled === true) {
      const cancelled = this.options.repository.update({
        requestId: row.request_id,
        status: "cancelled",
        cancelledAt: now.toISOString(),
        responseJson: JSON.stringify({
          action: "cancelled",
          error: normalizeOptional(input.error) ?? normalizeUnknownString(payload.error),
          respondedAt: now.toISOString(),
        }),
      }) ?? this.requireRequest(row.request_id);
      return toStatusResult(cancelled);
    }

    const action = normalizeResponseAction(
      payload.action ?? payload.response ?? payload.responseType,
      parseAllowedResponses(row),
    );
    if (!action) {
      throw new Error(`Invalid concierge action result for request ${row.request_id}`);
    }

    const updated = this.options.repository.update({
      requestId: row.request_id,
      status: "actioned",
      actionedAt: now.toISOString(),
      responseJson: JSON.stringify({
        action,
        message: normalizeUnknownString(payload.message),
        payload,
        respondedAt: now.toISOString(),
      }),
    }) ?? this.requireRequest(row.request_id);

    this.options.eventBus.emit({
      type: "concierge.request.resolved",
      timestamp: now,
      spaceId: updated.space_id,
      requestId: updated.request_id,
      data: {
        status: updated.status,
        responseAction: action,
      },
    });

    return toStatusResult(updated);
  }

  async runMaintenance(limit = 100): Promise<void> {
    const now = this.now();
    const rows = this.options.repository.listByStatuses(["pending", "notified"], limit);
    for (const row of rows) {
      const expiresAt = parseDate(row.expires_at);
      if (!expiresAt || expiresAt.getTime() > now.getTime()) {
        continue;
      }
      if (
        row.fallback_policy === "urgent_call_after_timeout"
        && row.urgency === "urgent"
        && !row.escalated_to_call_at
      ) {
        await this.escalateToCall(row, now);
        continue;
      }
      this.options.repository.update({
        requestId: row.request_id,
        status: "expired",
        responseJson: JSON.stringify({
          action: "expired",
          respondedAt: now.toISOString(),
        }),
      });
      this.options.eventBus.emit({
        type: "concierge.request.expired",
        timestamp: now,
        spaceId: row.space_id,
        requestId: row.request_id,
        data: {
          status: "expired",
        },
      });
    }
  }

  private async escalateToCall(row: ConciergeEscalationRequestRow, now: Date): Promise<void> {
    if (!this.conciergeCallRuntimeService) {
      this.options.logger.warn("Concierge escalation call requested but runtime service is unavailable", {
        requestId: row.request_id,
        spaceId: row.space_id,
      });
      this.options.repository.update({
        requestId: row.request_id,
        status: "expired",
        responseJson: JSON.stringify({
          action: "expired",
          reason: "concierge_call_runtime_unavailable",
          respondedAt: now.toISOString(),
        }),
      });
      return;
    }

    this.conciergeCallRuntimeService.startCall({
      callId: randomUUID(),
      platform: "concierge-escalation",
      displayName: "Spaces Concierge",
      ttsMode: "apple_native",
      spaceId: row.space_id,
      spaceUid: row.space_id,
      targetAgentId: normalizeOptional(row.target_agent_id),
      principalId: normalizeOptional(row.principal_id),
      deviceId: normalizeOptional(row.device_id),
    });

    this.options.repository.update({
      requestId: row.request_id,
      status: "escalated_to_call",
      deliveryChannel: "call",
      escalatedToCallAt: now.toISOString(),
      responseJson: JSON.stringify({
        action: "urgent_call_after_timeout",
        respondedAt: now.toISOString(),
      }),
    });
    this.options.eventBus.emit({
      type: "concierge.request.escalated_to_call",
      timestamp: now,
      spaceId: row.space_id,
      requestId: row.request_id,
      data: {
        status: "escalated_to_call",
      },
    });
  }

  private buildNotification(input: {
    requestId: string;
    spaceId: string;
    principalId?: string;
    requestingAgentId: string;
    urgency: ConciergeEscalationUrgency;
    userMessage: string;
    deepLink: string;
    allowedResponses: ConciergeEscalationAllowedResponse[];
    fallbackPolicy: ConciergeEscalationFallbackPolicy;
    expiresAt: Date;
    createdAt: Date;
  }): Notification {
    return {
      notificationId: randomUUID(),
      category: "feedback.requested",
      title: input.urgency === "urgent" ? "Urgent input needed" : "Input requested",
      message: input.userMessage,
      severity: input.urgency === "passive" ? "info" : "warning",
      payload: {
        requestId: input.requestId,
        escalationType: "concierge_user_input",
        allowedResponses: input.allowedResponses,
        deepLink: input.deepLink,
        fallbackPolicy: input.fallbackPolicy,
        expiresAt: input.expiresAt.toISOString(),
        requestingAgentId: input.requestingAgentId,
      },
      targets: buildNotificationTargets(input.spaceId, input.principalId),
      actionUrl: input.deepLink,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
    };
  }

  private requireRequest(requestId: string): ConciergeEscalationRequestRow {
    const row = this.options.repository.getById(requestId);
    if (!row) {
      throw new Error(`Concierge escalation request not found: ${requestId}`);
    }
    return row;
  }
}

function assertSpaceMatch(row: ConciergeEscalationRequestRow, spaceId: string): void {
  if (row.space_id !== spaceId) {
    throw new Error(`Concierge escalation request ${row.request_id} does not belong to space ${spaceId}`);
  }
}

function toRequestResult(row: ConciergeEscalationRequestRow): ConciergeEscalationRequestResult {
  return {
    requestId: row.request_id,
    status: row.status,
    deliveryChannel: row.delivery_channel,
    expiresAt: row.expires_at ?? undefined,
    deepLink: row.deep_link || undefined,
    response: parseResponse(row),
  };
}

function toStatusResult(row: ConciergeEscalationRequestRow): ConciergeEscalationStatusResult {
  return {
    ...toRequestResult(row),
    question: row.question,
    reason: row.reason,
    urgency: row.urgency,
    allowedResponses: parseAllowedResponses(row),
    fallbackPolicy: row.fallback_policy,
  };
}

function parseAllowedResponses(row: ConciergeEscalationRequestRow): ConciergeEscalationAllowedResponse[] {
  try {
    const parsed = JSON.parse(row.allowed_responses_json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is ConciergeEscalationAllowedResponse =>
        entry === "approve"
        || entry === "reject"
        || entry === "defer"
        || entry === "revise"
        || entry === "open_app",
    );
  } catch {
    return [];
  }
}

function parseResponse(row: ConciergeEscalationRequestRow): Record<string, unknown> | undefined {
  if (!row.response_json?.trim()) return undefined;
  try {
    const parsed = JSON.parse(row.response_json);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function buildNotificationTargets(spaceId: string, principalId?: string): Notification["targets"] {
  const targets: Notification["targets"] = [{ type: "space", spaceId }];
  if (principalId) {
    targets.unshift({ type: "user", userId: principalId });
  }
  return targets;
}

function buildDeepLink(requestId: string, spaceId: string): string {
  return `spaces://concierge/request?requestId=${encodeURIComponent(requestId)}&spaceId=${encodeURIComponent(spaceId)}`;
}

function buildUserMessage(
  question: string,
  reason: string,
  urgency: ConciergeEscalationUrgency,
): string {
  const normalizedQuestion = ensureQuestion(question);
  const normalizedReason = normalizeOptional(reason);
  if (!normalizedReason) {
    return normalizedQuestion;
  }
  if (urgency === "urgent") {
    return `${normalizedQuestion} ${capitalize(normalizedReason)}.`;
  }
  return `${normalizedQuestion} ${normalizedReason}.`;
}

function ensureQuestion(value: string): string {
  const trimmed = normalizeRequired(value, "question");
  if (/[?]$/.test(trimmed)) return trimmed;
  return `${trimmed}?`;
}

function normalizeUrgency(value: ConciergeEscalationRequestInput["urgency"]): ConciergeEscalationUrgency {
  return value === "passive" || value === "important" || value === "urgent"
    ? value
    : "important";
}

function normalizeResponseMode(
  value: ConciergeEscalationRequestInput["responseMode"],
): ConciergeEscalationResponseMode {
  if (value && value !== "structured") {
    throw new Error("Only responseMode=structured is supported");
  }
  return DEFAULT_RESPONSE_MODE;
}

function normalizeAllowedResponses(
  value: ConciergeEscalationRequestInput["allowedResponses"],
): ConciergeEscalationAllowedResponse[] {
  const normalized = Array.isArray(value) && value.length > 0
    ? value.filter(
      (entry): entry is ConciergeEscalationAllowedResponse =>
        entry === "approve"
        || entry === "reject"
        || entry === "defer"
        || entry === "revise"
        || entry === "open_app",
    )
    : ["approve", "reject", "defer", "revise"] as ConciergeEscalationAllowedResponse[];
  if (normalized.length === 0) {
    throw new Error("allowedResponses must contain at least one structured response");
  }
  return Array.from(new Set(normalized)) as ConciergeEscalationAllowedResponse[];
}

function normalizeFallbackPolicy(
  value: ConciergeEscalationRequestInput["fallbackPolicy"],
): ConciergeEscalationFallbackPolicy {
  return value === "urgent_call_after_timeout" ? value : "none";
}

function normalizeTimeoutSeconds(
  value: ConciergeEscalationRequestInput["timeoutSeconds"],
  fallbackPolicy: ConciergeEscalationFallbackPolicy,
): number {
  const fallback = fallbackPolicy === "urgent_call_after_timeout"
    ? DEFAULT_URGENT_CALL_TIMEOUT_SECONDS
    : DEFAULT_TIMEOUT_SECONDS;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

function normalizeResponseAction(
  value: unknown,
  allowedResponses: ConciergeEscalationAllowedResponse[],
): ConciergeEscalationAllowedResponse | undefined {
  if (
    value !== "approve"
    && value !== "reject"
    && value !== "defer"
    && value !== "revise"
    && value !== "open_app"
  ) {
    return undefined;
  }
  return allowedResponses.includes(value) ? value : undefined;
}

function parseDate(value: string | null | undefined): Date | undefined {
  if (!value?.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function normalizeRequired(value: string | undefined | null, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function normalizeOptional(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeUnknownString(value: unknown): string | undefined {
  return typeof value === "string" ? normalizeOptional(value) : undefined;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
