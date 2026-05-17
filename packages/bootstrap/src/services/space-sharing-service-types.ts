import type {
  SpaceParticipantRepository,
  SpaceShareAccessMode,
  SpaceShareInviteRepository,
  SpaceRepository,
} from "@spaceskit/persistence";

export type SpaceSharingErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "PERMISSION_DENIED"
  | "FAILED_PRECONDITION";

export class SpaceSharingError extends Error {
  readonly code: SpaceSharingErrorCode;

  constructor(code: SpaceSharingErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface SpaceShareInvite {
  inviteId: string;
  spaceId: string;
  spaceUid: string;
  issuedByPrincipalId: string;
  mode: SpaceShareAccessMode;
  status: "active" | "used" | "revoked" | "expired";
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
  inviteToken?: string;
  inviteLink?: SpaceInviteLink;
}

export interface SpaceParticipant {
  participantId: string;
  spaceId: string;
  spaceUid: string;
  principalId: string;
  principalType: string;
  mode: SpaceShareAccessMode;
  status: "active" | "revoked";
  joinedViaInviteId?: string;
  deviceId?: string;
  devicePublicKey?: string;
  joinedAt: string;
  updatedAt: string;
  revokedAt?: string;
}

export interface SpaceSharingAccessDecision {
  allowed: boolean;
  enforced: boolean;
  mode?: SpaceShareAccessMode;
  reason?: string;
}

export interface SpaceSharingServiceOptions {
  invites: SpaceShareInviteRepository;
  participants: SpaceParticipantRepository;
  spaces: SpaceRepository;
  now?: () => Date;
  defaultInviteTtlSeconds?: number;
  relaySessionTtlSeconds?: number;
  sharingIdentityPolicy?: SharingIdentityPolicy;
  resolveSpaceSharingIdentityPolicy?: (spaceId: string) => SharingIdentityPolicy | null | undefined;
  relayBaseUrl?: string;
  fallbackGatewayUrl?: string;
}

export interface CreateSpaceShareInviteInput {
  spaceId: string;
  issuedByPrincipalId: string;
  mode: SpaceShareAccessMode;
  expiresInSeconds?: number;
}

export interface JoinSpaceShareInviteInput {
  spaceId: string;
  inviteToken: string;
  principalId: string;
  principalType?: string;
  deviceId?: string;
  devicePublicKey?: string;
  identityModeHint?: string;
  appleIdAssertion?: string;
  joinRoute?: "direct" | "relay_proxy";
  relaySessionToken?: string;
}

export interface ResolveShareRelayInviteInput {
  relayInviteId: string;
  directReachable?: boolean;
  principalId?: string;
}

export interface ShareRelayResolveResult {
  gatewayRoute: "direct" | "relay_proxy";
  gatewayUrl?: string;
  relaySessionToken: string;
  invitePreview?: {
    inviterDisplayName?: string;
    spaceName?: string;
    mode?: SpaceShareAccessMode;
  };
  sharingIdentityPolicy?: {
    mode: SharingIdentityMode;
    allowDeviceKeyFallback: boolean;
  };
}

export interface ProxyJoinShareRelayInviteInput {
  relaySessionToken: string;
  principalId: string;
  principalType?: string;
  deviceId?: string;
  devicePublicKey?: string;
  identityModeHint?: string;
  appleIdAssertion?: string;
}

export interface SpaceInviteLink {
  version: "v2";
  relayInviteId: string;
  relayUrl: string;
  spaceIdHint?: string;
  spaceUidHint?: string;
  fallbackGatewayUrl?: string;
}

export type SharingIdentityMode = "device_key" | "strict_apple_id";
export type SharingPolicyDenialReason = "identity_assertion_missing" | "identity_assertion_invalid";

export interface SharingIdentityPolicy {
  mode: SharingIdentityMode;
  allowDeviceKeyFallback: boolean;
}

export const DEFAULT_SHARING_IDENTITY_POLICY: SharingIdentityPolicy = {
  mode: "device_key",
  allowDeviceKeyFallback: true,
};
export const DEFAULT_RELAY_SESSION_TTL_SECONDS = 5 * 60;

export interface RelaySessionRecord {
  token: string;
  inviteId: string;
  spaceId: string;
  boundPrincipalId?: string;
  expiresAtIso: string;
  consumedAtIso?: string;
}

export interface RevokeSpaceShareInviteInput {
  spaceId: string;
  inviteId: string;
  requestedByPrincipalId: string;
}

export interface RevokeSpaceParticipantInput {
  spaceId: string;
  participantId: string;
  requestedByPrincipalId: string;
}

export interface ListSpaceParticipantsInput {
  spaceId: string;
  requestedByPrincipalId: string;
}
