import type {
  SpaceParticipantRow,
  SpaceRepository,
  SpaceShareInviteRow,
} from "@spaceskit/persistence";
import { deterministicUuid, normalizeUuid } from "../utils/uuid.js";
import {
  normalizeAccessMode,
  normalizeInviteStatus,
  normalizeParticipantStatus,
  stripTrailingSlash,
} from "./space-sharing-service-helpers.js";
import type {
  SpaceInviteLink,
  SpaceParticipant,
  SpaceShareInvite,
} from "./space-sharing-service-types.js";

export function mapInvite(row: SpaceShareInviteRow, spaces: SpaceRepository): SpaceShareInvite {
  const spaceUid = resolveSpaceUid(spaces, row.space_id);
  return {
    inviteId: row.invite_id,
    spaceId: row.space_id,
    spaceUid,
    issuedByPrincipalId: row.issued_by_principal_id,
    mode: normalizeAccessMode(row.mode),
    status: normalizeInviteStatus(row.status),
    expiresAt: row.expires_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapParticipant(row: SpaceParticipantRow, spaces: SpaceRepository): SpaceParticipant {
  const spaceUid = resolveSpaceUid(spaces, row.space_id);
  return {
    participantId: row.participant_id,
    spaceId: row.space_id,
    spaceUid,
    principalId: row.principal_id,
    principalType: row.principal_type,
    mode: normalizeAccessMode(row.mode),
    status: normalizeParticipantStatus(row.status),
    joinedViaInviteId: row.joined_via_invite_id ?? undefined,
    deviceId: row.device_id ?? undefined,
    devicePublicKey: row.device_public_key ?? undefined,
    joinedAt: row.joined_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at ?? undefined,
  };
}

export function buildInviteLink(input: {
  relayBaseUrl?: string;
  fallbackGatewayUrl?: string;
  spaceId: string;
  spaceUid: string;
  inviteId: string;
}): SpaceInviteLink | undefined {
  if (!input.relayBaseUrl) return undefined;

  const relayInviteId = deterministicUuid(input.inviteId, "spaces.share.relay");
  return {
    version: "v2",
    relayInviteId,
    relayUrl: `${stripTrailingSlash(input.relayBaseUrl)}/invite/${relayInviteId}`,
    spaceIdHint: input.spaceId,
    spaceUidHint: input.spaceUid,
    ...(input.fallbackGatewayUrl ? { fallbackGatewayUrl: input.fallbackGatewayUrl } : {}),
  };
}

function resolveSpaceUid(spaces: SpaceRepository, spaceId: string): string {
  const fallback = deterministicUuid(spaceId, "spaceskit.space.uuid");
  const row = spaces.getById(spaceId);
  if (!row?.space_config_json) return fallback;
  try {
    const parsed = JSON.parse(row.space_config_json) as Record<string, unknown>;
    const direct = normalizeUuid(parsed.spaceUid);
    if (direct) return direct;
  } catch {
    // Ignore malformed config payload and fall back to deterministic UUID.
  }
  return fallback;
}
