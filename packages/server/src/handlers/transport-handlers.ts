import { randomUUID } from "node:crypto";
import type { ErrorPayload } from "../protocol.js";
import {
  MessageTypes,
  type AuthIssueHttpPrincipalTokenPayload,
  type AuthIssueHttpPrincipalTokenResponsePayload,
  type AuthListDevicesPayload,
  type AuthListDevicesResponsePayload,
  type AuthRegisterDevicePayload,
  type AuthRegisterDeviceResponsePayload,
  type AuthRevokeDevicePayload,
  type AuthRevokeDeviceResponsePayload,
  type AuthRotateDeviceKeyPayload,
  type AuthRotateDeviceKeyResponsePayload,
  type GatewayMessage,
  type SpeechAudioChunkPayload,
  type SpeechControlPayload,
  type SpeechEventPayload,
  type SpeechStartPayload,
  type SyncAnnouncePayload,
  type SyncAnnounceResponsePayload,
  type SyncPullResourcesPayload,
  type SyncPullResourcesResponsePayload,
  type SyncQueryResourcesPayload,
  type SyncQueryResourcesResponsePayload,
} from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type {
  ConciergeCallRuntimeService,
  DeviceIdentityService,
  GatewaySyncService,
  SpeechSessionService,
} from "../message-router.js";
import {
  mapSpeechEventTypeForPayload,
  normalizeString,
  parseOptionalIssuedTokenTtlSeconds,
} from "../message-router-utils.js";

export interface TransportHandlerContext {
  deviceIdentityService: DeviceIdentityService | null;
  gatewaySyncService: GatewaySyncService | null;
  speechSessionService: SpeechSessionService | null;
  conciergeCallRuntimeService: ConciergeCallRuntimeService | null;
  issueHttpPrincipalToken:
    | ((input: {
      principalId: string;
      deviceId?: string;
      ttlSeconds?: number;
    }) => Promise<AuthIssueHttpPrincipalTokenResponsePayload> | AuthIssueHttpPrincipalTokenResponsePayload)
    | null;
  resolveSpaceUid: (spaceIdRaw: string) => Promise<string>;
  response: (correlationId: string, type: string, payload?: unknown) => GatewayMessage;
  errorResponse: (
    correlationId: string,
    code: ErrorPayload["code"],
    message: string,
    errDetails?: unknown,
  ) => GatewayMessage;
  broadcastToSpace: (spaceUid: string, msg: GatewayMessage) => void;
}

export async function handleAuthRegisterDevice(
  context: TransportHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.deviceIdentityService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Device identity service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }

  const payload = msg.payload as AuthRegisterDevicePayload;
  if (!payload?.deviceId || !payload?.publicKey) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "deviceId and publicKey are required");
  }

  const result = context.deviceIdentityService.registerDevice({
    ...payload,
    principalId: client.publicKey,
  });
  return context.response(msg.id, MessageTypes.AUTH_REGISTER_DEVICE, result satisfies AuthRegisterDeviceResponsePayload);
}

export async function handleAuthRotateDeviceKey(
  context: TransportHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.deviceIdentityService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Device identity service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }

  const payload = msg.payload as AuthRotateDeviceKeyPayload;
  if (!payload?.deviceId || !payload?.nextPublicKey) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "deviceId and nextPublicKey are required");
  }

  const device = context.deviceIdentityService.rotateDeviceKey({
    ...payload,
    principalId: client.publicKey,
  });
  return context.response(msg.id, MessageTypes.AUTH_ROTATE_DEVICE_KEY, {
    device,
  } satisfies AuthRotateDeviceKeyResponsePayload);
}

export async function handleAuthRevokeDevice(
  context: TransportHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.deviceIdentityService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Device identity service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }

  const payload = msg.payload as AuthRevokeDevicePayload;
  if (!payload?.deviceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "deviceId is required");
  }

  const result = context.deviceIdentityService.revokeDevice({
    ...payload,
    principalId: client.publicKey,
  });
  return context.response(msg.id, MessageTypes.AUTH_REVOKE_DEVICE, {
    deviceId: payload.deviceId,
    revoked: result.revoked,
    device: result.device,
  } satisfies AuthRevokeDeviceResponsePayload);
}

export async function handleAuthListDevices(
  context: TransportHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.deviceIdentityService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Device identity service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }

  const payload = (msg.payload ?? {}) as AuthListDevicesPayload;
  const devices = context.deviceIdentityService.listDevices(
    client.publicKey,
    payload.includeRevoked ?? true,
  );
  return context.response(msg.id, MessageTypes.AUTH_LIST_DEVICES, {
    devices,
  } satisfies AuthListDevicesResponsePayload);
}

export async function handleAuthIssueHttpPrincipalToken(
  context: TransportHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.issueHttpPrincipalToken) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "HTTP principal token issuer unavailable");
  }

  const principalId = normalizeString(client.publicKey);
  if (!principalId) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }

  const payload = (msg.payload ?? {}) as AuthIssueHttpPrincipalTokenPayload;
  const ttlSeconds = parseOptionalIssuedTokenTtlSeconds(payload.ttlSeconds);
  if (ttlSeconds === null) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "ttlSeconds must be a positive integer");
  }

  const issued = await context.issueHttpPrincipalToken({
    principalId,
    deviceId: normalizeString(client.deviceId),
    ...(ttlSeconds !== undefined ? { ttlSeconds } : {}),
  });
  return context.response(
    msg.id,
    MessageTypes.AUTH_ISSUE_HTTP_PRINCIPAL_TOKEN,
    issued satisfies AuthIssueHttpPrincipalTokenResponsePayload,
  );
}

export async function handleSyncAnnounce(
  context: TransportHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewaySyncService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway sync service unavailable");
  }

  const payload = msg.payload as SyncAnnouncePayload;
  if (!payload?.peerId || !payload?.resourceId || !payload?.gatewayVersion) {
    return context.errorResponse(
      msg.id,
      "INVALID_ARGUMENT",
      "peerId, resourceId, and gatewayVersion are required",
    );
  }

  const responsePayload = context.gatewaySyncService.announcePeer(payload);
  return context.response(msg.id, MessageTypes.SYNC_ANNOUNCE, responsePayload satisfies SyncAnnounceResponsePayload);
}

export async function handleSyncQueryResources(
  context: TransportHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewaySyncService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway sync service unavailable");
  }

  const payload = msg.payload as SyncQueryResourcesPayload;
  if (!payload?.peerId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "peerId is required");
  }

  const result = context.gatewaySyncService.queryResources(payload);
  return context.response(msg.id, MessageTypes.SYNC_QUERY_RESOURCES, result satisfies SyncQueryResourcesResponsePayload);
}

export async function handleSyncPullResources(
  context: TransportHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewaySyncService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway sync service unavailable");
  }

  const payload = msg.payload as SyncPullResourcesPayload;
  if (!payload?.peerId || !payload?.idempotencyKey || !Array.isArray(payload?.refs)) {
    return context.errorResponse(
      msg.id,
      "INVALID_ARGUMENT",
      "peerId, idempotencyKey, and refs[] are required",
    );
  }

  const result = context.gatewaySyncService.pullResources(payload);
  return context.response(msg.id, MessageTypes.SYNC_PULL_RESOURCES, result satisfies SyncPullResourcesResponsePayload);
}

export async function handleSpeechStart(
  context: TransportHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.speechSessionService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Speech session service unavailable");
  }

  const payload = msg.payload as SpeechStartPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }
  const spaceUid = await context.resolveSpaceUid(payload.spaceId);

  const event = context.speechSessionService.startSession({
    ...payload,
    spaceUid,
    principalId: client.publicKey,
    deviceId: client.deviceId,
  });
  const normalizedEvent = await normalizeSpeechEventPayload(context, event);
  context.broadcastToSpace(normalizedEvent.spaceUid, {
    type: MessageTypes.SPEECH_EVENT,
    id: randomUUID(),
    ts: new Date().toISOString(),
    payload: normalizedEvent,
  });
  return context.response(msg.id, MessageTypes.SPEECH_START, { event: normalizedEvent });
}

export async function handleSpeechAudioChunk(
  context: TransportHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.speechSessionService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Speech session service unavailable");
  }

  const payload = msg.payload as SpeechAudioChunkPayload;
  const normalizedSequence = typeof payload?.sequence === "number"
    ? payload.sequence
    : typeof payload?.sequenceNo === "number"
      ? payload.sequenceNo
      : undefined;
  if (!payload?.sessionId || typeof normalizedSequence !== "number" || !payload?.audioBase64) {
    return context.errorResponse(
      msg.id,
      "INVALID_ARGUMENT",
      "sessionId, sequence/sequenceNo, and audioBase64 are required",
    );
  }

  const events = await context.speechSessionService.appendAudioChunk({
    ...payload,
    sequence: normalizedSequence,
  });
  const normalizedEvents: SpeechEventPayload[] = [];
  for (const event of events) {
    const normalizedEvent = await normalizeSpeechEventPayload(context, event);
    normalizedEvents.push(normalizedEvent);
    context.broadcastToSpace(normalizedEvent.spaceUid, {
      type: MessageTypes.SPEECH_EVENT,
      id: randomUUID(),
      ts: new Date().toISOString(),
      payload: normalizedEvent,
    });
  }

  return context.response(msg.id, MessageTypes.SPEECH_AUDIO_CHUNK, { events: normalizedEvents });
}

export async function handleSpeechControl(
  context: TransportHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.speechSessionService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Speech session service unavailable");
  }

  const payload = msg.payload as SpeechControlPayload;
  if (!payload?.sessionId || !payload?.command) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "sessionId and command are required");
  }

  const event = context.speechSessionService.control(payload);
  const normalizedEvent = await normalizeSpeechEventPayload(context, event);
  context.broadcastToSpace(normalizedEvent.spaceUid, {
    type: MessageTypes.SPEECH_EVENT,
    id: randomUUID(),
    ts: new Date().toISOString(),
    payload: normalizedEvent,
  });
  return context.response(msg.id, MessageTypes.SPEECH_CONTROL, { event: normalizedEvent });
}

async function normalizeSpeechEventPayload(
  context: Pick<TransportHandlerContext, "resolveSpaceUid">,
  event: SpeechEventPayload,
): Promise<SpeechEventPayload> {
  const emittedAt = event.emittedAt ?? event.ts;
  const spaceUid = event.spaceUid || await context.resolveSpaceUid(event.spaceId);
  return {
    ...event,
    spaceUid,
    ts: event.ts ?? emittedAt ?? new Date().toISOString(),
    emittedAt: emittedAt ?? event.ts,
    sequenceNo: event.sequenceNo ?? event.sequence,
    message: event.message ?? event.reason,
    type: event.type ?? mapSpeechEventTypeForPayload(event.eventType, event.state),
  };
}
