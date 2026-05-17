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
import {
  assertSpaceMatch,
  buildDeepLink,
  buildNotificationTargets,
  buildUserMessage,
  isRecord,
  normalizeAllowedResponses,
  normalizeFallbackPolicy,
  normalizeOptional,
  normalizeRequired,
  normalizeResponseAction,
  normalizeResponseMode,
  normalizeTimeoutSeconds,
  normalizeUnknownString,
  normalizeUrgency,
  parseAllowedResponses,
  parseDate,
  toRequestResult,
  toStatusResult,
} from "./concierge-escalation-service-helpers.js";

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
    const responseMode = normalizeResponseMode(input.responseMode, DEFAULT_RESPONSE_MODE);
    const allowedResponses = normalizeAllowedResponses(input.allowedResponses);
    const fallbackPolicy = normalizeFallbackPolicy(input.fallbackPolicy);
    if (fallbackPolicy === "urgent_call_after_timeout" && urgency !== "urgent") {
      throw new Error("fallbackPolicy urgent_call_after_timeout requires urgency=urgent");
    }
    const timeoutSeconds = normalizeTimeoutSeconds(input.timeoutSeconds, fallbackPolicy, DEFAULT_TIMEOUT_SECONDS, DEFAULT_URGENT_CALL_TIMEOUT_SECONDS);
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
