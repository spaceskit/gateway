import type {
  ConciergeCallAnswerPayload,
  ConciergeCallAudioChunkPayload,
  ConciergeCallControlPayload,
  ConciergeCallEndPayload,
  ConciergeCallEventPayload,
  ConciergeCallEventsResponsePayload,
  ConciergeCallHandoffPreparePayload,
  ConciergeCallHandoffPrepareResponsePayload,
  ConciergeCallRegisterPushPayload,
  ConciergeCallSetMutedPayload,
  ConciergeCallStartPayload,
  ConciergeVoipPushRegistrationPayload,
  GatewayMessage,
} from "../protocol.js";
import { MessageTypes } from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type { TransportHandlerContext } from "./transport-handlers.js";

interface ConciergeCallEventResponsePayload {
  event: ConciergeCallEventPayload;
}

interface ConciergeCallRegisterPushResponsePayload {
  registration: ConciergeVoipPushRegistrationPayload;
}

function normalizeOptional(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function requireNormalized(value: string | undefined | null, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function missingServiceResponse(
  context: TransportHandlerContext,
  msg: GatewayMessage,
): GatewayMessage {
  return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Concierge call runtime service unavailable");
}

function handleConciergeCallError(
  context: TransportHandlerContext,
  msg: GatewayMessage,
  error: unknown,
): GatewayMessage {
  if (error && typeof error === "object") {
    const code = "code" in error ? error.code : undefined;
    const message = "message" in error ? error.message : undefined;
    if (typeof code === "string" && typeof message === "string") {
      return context.errorResponse(msg.id, code as any, message);
    }
  }
  const message = error instanceof Error ? error.message : "Internal error";
  return context.errorResponse(msg.id, "INTERNAL", message);
}

export async function handleConciergeCallStart(
  context: TransportHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.conciergeCallRuntimeService) {
    return missingServiceResponse(context, msg);
  }

  try {
    const payload = (msg.payload ?? {}) as ConciergeCallStartPayload;
    const event = await context.conciergeCallRuntimeService.startCall({
      ...payload,
      principalId: normalizeOptional(client.publicKey),
      deviceId: normalizeOptional(payload.deviceId) ?? normalizeOptional(client.deviceId),
    });
    return context.response(msg.id, MessageTypes.CONCIERGE_CALL_START, {
      event,
    } satisfies ConciergeCallEventResponsePayload);
  } catch (error) {
    return handleConciergeCallError(context, msg, error);
  }
}

export async function handleConciergeCallAnswer(
  context: TransportHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.conciergeCallRuntimeService) {
    return missingServiceResponse(context, msg);
  }

  try {
    const payload = (msg.payload ?? {}) as ConciergeCallAnswerPayload;
    const event = await context.conciergeCallRuntimeService.answerCall({
      ...payload,
      principalId: normalizeOptional(client.publicKey),
      deviceId: normalizeOptional(payload.deviceId) ?? normalizeOptional(client.deviceId),
    });
    return context.response(msg.id, MessageTypes.CONCIERGE_CALL_ANSWER, {
      event,
    } satisfies ConciergeCallEventResponsePayload);
  } catch (error) {
    return handleConciergeCallError(context, msg, error);
  }
}

export async function handleConciergeCallEnd(
  context: TransportHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.conciergeCallRuntimeService) {
    return missingServiceResponse(context, msg);
  }

  try {
    const payload = (msg.payload ?? {}) as ConciergeCallEndPayload;
    const event = await context.conciergeCallRuntimeService.endCall({
      ...payload,
      principalId: normalizeOptional(client.publicKey),
    });
    return context.response(msg.id, MessageTypes.CONCIERGE_CALL_END, {
      event,
    } satisfies ConciergeCallEventResponsePayload);
  } catch (error) {
    return handleConciergeCallError(context, msg, error);
  }
}

export async function handleConciergeCallSetMuted(
  context: TransportHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.conciergeCallRuntimeService) {
    return missingServiceResponse(context, msg);
  }

  try {
    const payload = (msg.payload ?? {}) as ConciergeCallSetMutedPayload;
    const event = await context.conciergeCallRuntimeService.setMuted({
      ...payload,
      principalId: normalizeOptional(client.publicKey),
    });
    return context.response(msg.id, MessageTypes.CONCIERGE_CALL_SET_MUTED, {
      event,
    } satisfies ConciergeCallEventResponsePayload);
  } catch (error) {
    return handleConciergeCallError(context, msg, error);
  }
}

export async function handleConciergeCallAudioChunk(
  context: TransportHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.conciergeCallRuntimeService) {
    return missingServiceResponse(context, msg);
  }

  try {
    const payload = (msg.payload ?? {}) as ConciergeCallAudioChunkPayload;
    const response = await context.conciergeCallRuntimeService.appendAudioChunk({
      ...payload,
      principalId: normalizeOptional(client.publicKey),
      deviceId: normalizeOptional(client.deviceId),
    });
    return context.response(
      msg.id,
      MessageTypes.CONCIERGE_CALL_AUDIO_CHUNK,
      response satisfies ConciergeCallEventsResponsePayload,
    );
  } catch (error) {
    return handleConciergeCallError(context, msg, error);
  }
}

export async function handleConciergeCallControl(
  context: TransportHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.conciergeCallRuntimeService) {
    return missingServiceResponse(context, msg);
  }

  try {
    const payload = (msg.payload ?? {}) as ConciergeCallControlPayload;
    const event = await context.conciergeCallRuntimeService.control({
      ...payload,
      principalId: normalizeOptional(client.publicKey),
      deviceId: normalizeOptional(client.deviceId),
    });
    return context.response(msg.id, MessageTypes.CONCIERGE_CALL_CONTROL, {
      event,
    } satisfies ConciergeCallEventResponsePayload);
  } catch (error) {
    return handleConciergeCallError(context, msg, error);
  }
}

export async function handleConciergeCallHandoffPrepare(
  context: TransportHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.conciergeCallRuntimeService) {
    return missingServiceResponse(context, msg);
  }

  try {
    const payload = (msg.payload ?? {}) as ConciergeCallHandoffPreparePayload;
    const response = await context.conciergeCallRuntimeService.prepareHandoff({
      ...payload,
      principalId: normalizeOptional(client.publicKey),
      deviceId: normalizeOptional(payload.sourceDeviceId) ?? normalizeOptional(client.deviceId),
    });
    return context.response(
      msg.id,
      MessageTypes.CONCIERGE_CALL_HANDOFF_PREPARE,
      response satisfies ConciergeCallHandoffPrepareResponsePayload,
    );
  } catch (error) {
    return handleConciergeCallError(context, msg, error);
  }
}

export async function handleConciergeCallHandoffAccept(
  context: TransportHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.conciergeCallRuntimeService) {
    return missingServiceResponse(context, msg);
  }

  try {
    const payload = (msg.payload ?? {}) as any;
    const event = await context.conciergeCallRuntimeService.acceptHandoff({
      ...payload,
      principalId: normalizeOptional(client.publicKey),
      deviceId: normalizeOptional(payload.deviceId) ?? normalizeOptional(client.deviceId),
    });
    return context.response(msg.id, MessageTypes.CONCIERGE_CALL_HANDOFF_ACCEPT, {
      event,
    } satisfies ConciergeCallEventResponsePayload);
  } catch (error) {
    return handleConciergeCallError(context, msg, error);
  }
}

export async function handleConciergeCallRegisterPush(
  context: TransportHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.conciergeCallRuntimeService) {
    return missingServiceResponse(context, msg);
  }

  try {
    const payload = (msg.payload ?? {}) as ConciergeCallRegisterPushPayload;
    const registration = await context.conciergeCallRuntimeService.registerPush({
      ...payload,
      principalId: normalizeOptional(client.publicKey),
      deviceId: requireNormalized(
        normalizeOptional(payload.deviceId) ?? normalizeOptional(client.deviceId),
        "deviceId",
      ),
    });
    return context.response(msg.id, MessageTypes.CONCIERGE_CALL_REGISTER_PUSH, {
      registration,
    } satisfies ConciergeCallRegisterPushResponsePayload);
  } catch (error) {
    return handleConciergeCallError(context, msg, error);
  }
}
