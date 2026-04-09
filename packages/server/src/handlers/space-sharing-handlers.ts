import type { ErrorPayload } from "../protocol.js";
import {
  MessageTypes,
  type GatewayMessage,
  type SpaceLinkPayload,
  type SpaceLinkResponsePayload,
  type SpacePullSharedContextPayload,
  type SpacePullSharedContextResponsePayload,
  type SpaceShareContextPayload,
  type SpaceShareContextResponsePayload,
  type SpaceShareCreateInvitePayload,
  type SpaceShareCreateInviteResponsePayload,
  type SpaceShareJoinPayload,
  type SpaceShareJoinResponsePayload,
  type SpaceShareListParticipantsPayload,
  type SpaceShareListParticipantsResponsePayload,
  type SpaceShareRevokePayload,
  type SpaceShareRevokeResponsePayload,
  type SpaceUnlinkPayload,
  type SpaceUnlinkResponsePayload,
} from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type { SpaceContextService, SpaceSharingService } from "../message-router-space-services.js";
import { normalizeString } from "../message-router-utils.js";

export interface SpaceSharingHandlerContext {
  spaceContextService: SpaceContextService | null;
  spaceSharingService: SpaceSharingService | null;
  resolveSpaceUid: (spaceIdRaw: string) => Promise<string>;
  response: (correlationId: string, type: string, payload?: unknown) => GatewayMessage;
  errorResponse: (
    correlationId: string,
    code: ErrorPayload["code"],
    message: string,
    errDetails?: unknown,
  ) => GatewayMessage;
}

export async function handleSpaceLink(
  context: SpaceSharingHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceContextService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space context service unavailable");
  }
  const payload = msg.payload as SpaceLinkPayload;
  if (!payload?.sourceSpaceId || !payload?.targetSpaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "sourceSpaceId and targetSpaceId are required");
  }

  const link = context.spaceContextService.linkSpaces(
    payload.sourceSpaceId,
    payload.targetSpaceId,
    payload.mode,
  );
  return context.response(msg.id, MessageTypes.SPACE_LINK, {
    link,
  } satisfies SpaceLinkResponsePayload);
}

export async function handleSpaceUnlink(
  context: SpaceSharingHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceContextService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space context service unavailable");
  }
  const payload = msg.payload as SpaceUnlinkPayload;
  if (!payload?.sourceSpaceId || !payload?.targetSpaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "sourceSpaceId and targetSpaceId are required");
  }

  const removed = context.spaceContextService.unlinkSpaces(
    payload.sourceSpaceId,
    payload.targetSpaceId,
  );
  return context.response(msg.id, MessageTypes.SPACE_UNLINK, {
    removed,
    sourceSpaceId: payload.sourceSpaceId,
    targetSpaceId: payload.targetSpaceId,
  } satisfies SpaceUnlinkResponsePayload);
}

export async function handleSpaceShareContext(
  context: SpaceSharingHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceContextService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space context service unavailable");
  }
  const payload = msg.payload as SpaceShareContextPayload;
  if (!payload?.sourceSpaceId || !payload?.targetSpaceId || !payload?.artifactId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "sourceSpaceId, targetSpaceId, and artifactId are required");
  }

  const transfer = context.spaceContextService.shareContext(
    payload.sourceSpaceId,
    payload.targetSpaceId,
    payload.artifactId,
  );
  return context.response(msg.id, MessageTypes.SPACE_SHARE_CONTEXT, {
    transfer,
  } satisfies SpaceShareContextResponsePayload);
}

export async function handleSpacePullSharedContext(
  context: SpaceSharingHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceContextService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space context service unavailable");
  }
  const payload = msg.payload as SpacePullSharedContextPayload;
  if (!payload?.sourceSpaceId || !payload?.targetSpaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "sourceSpaceId and targetSpaceId are required");
  }

  const result = context.spaceContextService.pullSharedContext(
    payload.sourceSpaceId,
    payload.targetSpaceId,
    payload.limit,
  );
  return context.response(msg.id, MessageTypes.SPACE_PULL_SHARED_CONTEXT, result satisfies SpacePullSharedContextResponsePayload);
}

export async function handleSpaceShareCreateInvite(
  context: SpaceSharingHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceSharingService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space sharing service unavailable");
  }
  const payload = msg.payload as SpaceShareCreateInvitePayload;
  if (!payload?.spaceId || !payload?.mode) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and mode are required");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required for sharing operations");
  }

  const invite = context.spaceSharingService.createInvite({
    spaceId: payload.spaceId,
    issuedByPrincipalId: client.publicKey,
    mode: payload.mode,
    expiresInSeconds: payload.expiresInSeconds,
  });
  const spaceUid = await context.resolveSpaceUid(payload.spaceId);
  return context.response(msg.id, MessageTypes.SPACE_SHARE_CREATE_INVITE, {
    invite: { ...invite, spaceUid },
  } satisfies SpaceShareCreateInviteResponsePayload);
}

export async function handleSpaceShareJoin(
  context: SpaceSharingHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceSharingService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space sharing service unavailable");
  }
  const payload = msg.payload as SpaceShareJoinPayload;
  if (!payload?.spaceId || !payload?.inviteToken) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and inviteToken are required");
  }
  const normalizedIdentityModeHint = normalizeString(payload.identityModeHint);
  let identityModeHint: "device_key" | "strict_apple_id" | undefined;
  if (normalizedIdentityModeHint) {
    if (normalizedIdentityModeHint !== "device_key" && normalizedIdentityModeHint !== "strict_apple_id") {
      return context.errorResponse(msg.id, "INVALID_ARGUMENT", "identityModeHint must be one of: device_key, strict_apple_id");
    }
    identityModeHint = normalizedIdentityModeHint;
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required for sharing operations");
  }

  const participant = context.spaceSharingService.joinInvite({
    spaceId: payload.spaceId,
    inviteToken: payload.inviteToken,
    principalId: client.publicKey,
    principalType: "public_key",
    deviceId: payload.deviceId,
    devicePublicKey: payload.devicePublicKey,
    identityModeHint,
    appleIdAssertion: payload.appleIdAssertion,
    joinRoute: payload.joinRoute,
    relaySessionToken: payload.relaySessionToken,
  });
  const spaceUid = await context.resolveSpaceUid(payload.spaceId);
  return context.response(msg.id, MessageTypes.SPACE_SHARE_JOIN, {
    participant: { ...participant, spaceUid },
  } satisfies SpaceShareJoinResponsePayload);
}

export async function handleSpaceShareRevoke(
  context: SpaceSharingHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceSharingService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space sharing service unavailable");
  }
  const payload = msg.payload as SpaceShareRevokePayload;
  if (!payload?.spaceId || (!payload?.inviteId && !payload?.participantId)) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and either inviteId or participantId are required");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required for sharing operations");
  }

  let revokedInvite = false;
  let revokedParticipant = false;
  if (payload.inviteId) {
    revokedInvite = context.spaceSharingService.revokeInvite({
      spaceId: payload.spaceId,
      inviteId: payload.inviteId,
      requestedByPrincipalId: client.publicKey,
    });
  }
  if (payload.participantId) {
    revokedParticipant = context.spaceSharingService.revokeParticipant({
      spaceId: payload.spaceId,
      participantId: payload.participantId,
      requestedByPrincipalId: client.publicKey,
    });
  }
  const spaceUid = await context.resolveSpaceUid(payload.spaceId);
  return context.response(msg.id, MessageTypes.SPACE_SHARE_REVOKE, {
    spaceId: payload.spaceId,
    spaceUid,
    inviteId: payload.inviteId,
    participantId: payload.participantId,
    revokedInvite,
    revokedParticipant,
  } satisfies SpaceShareRevokeResponsePayload);
}

export async function handleSpaceShareListParticipants(
  context: SpaceSharingHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceSharingService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space sharing service unavailable");
  }
  const payload = msg.payload as SpaceShareListParticipantsPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required for sharing operations");
  }

  const participants = context.spaceSharingService.listParticipants({
    spaceId: payload.spaceId,
    requestedByPrincipalId: client.publicKey,
  });
  const spaceUid = await context.resolveSpaceUid(payload.spaceId);
  return context.response(msg.id, MessageTypes.SPACE_SHARE_LIST_PARTICIPANTS, {
    spaceId: payload.spaceId,
    spaceUid,
    participants: participants.map((participant) => ({ ...participant, spaceUid })),
  } satisfies SpaceShareListParticipantsResponsePayload);
}
