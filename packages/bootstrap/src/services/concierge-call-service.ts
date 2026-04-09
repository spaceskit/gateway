/**
 * Re-export ConciergeCallService from @spaceskit/core.
 * This file exists for backward compatibility — all logic lives in core.
 */
export {
  ConciergeCallService,
  ConciergeCallServiceError,
} from "@spaceskit/core";

export type {
  ConciergeCallServiceOptions,
  ConciergeCallTtsModePayload,
  ConciergeCallStartPayload,
  ConciergeCallAnswerPayload,
  ConciergeCallEndPayload,
  ConciergeCallSetMutedPayload,
  ConciergeCallHandoffPreparePayload,
  ConciergeCallHandoffTokenPayload,
  ConciergeCallHandoffPrepareResponsePayload,
  ConciergeCallHandoffAcceptPayload,
  ConciergeCallRegisterPushPayload,
  ConciergeVoipPushRegistrationPayload,
  ConciergeCallMetricsPayload,
  ConciergeCallEventPayload,
} from "@spaceskit/core";
