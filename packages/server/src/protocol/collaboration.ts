export interface SpaceLinkPayload {
  apiVersion?: string;
  sourceSpaceId: string;
  targetSpaceId: string;
  mode?: string;
}

export interface SpaceUnlinkPayload {
  apiVersion?: string;
  sourceSpaceId: string;
  targetSpaceId: string;
}

export interface SpaceLinkResponsePayload {
  link: {
    sourceSpaceId: string;
    targetSpaceId: string;
    mode: string;
    createdAt: string;
    updatedAt: string;
  };
}

export interface SpaceUnlinkResponsePayload {
  removed: boolean;
  sourceSpaceId: string;
  targetSpaceId: string;
}

export interface SpaceShareContextPayload {
  apiVersion?: string;
  sourceSpaceId: string;
  targetSpaceId: string;
  artifactId: string;
}

export type SpaceShareAccessMode = "read_only" | "collaborator";
export type SpaceShareJoinRoute = "direct" | "relay_proxy";

export interface SpaceInviteLinkPayload {
  version: "v2";
  relayInviteId: string;
  relayUrl: string;
  spaceIdHint?: string;
  spaceUidHint?: string;
  fallbackGatewayUrl?: string;
}

export interface SpaceShareInvitePayload {
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
  inviteLink?: SpaceInviteLinkPayload;
}

export interface SpaceParticipantPayload {
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

export interface SpaceShareCreateInvitePayload {
  apiVersion?: string;
  spaceId: string;
  mode: SpaceShareAccessMode;
  expiresInSeconds?: number;
}

export interface SpaceShareCreateInviteResponsePayload {
  invite: SpaceShareInvitePayload;
}

export interface SpaceShareJoinPayload {
  apiVersion?: string;
  spaceId: string;
  inviteToken: string;
  deviceId?: string;
  devicePublicKey?: string;
  identityModeHint?: "device_key" | "strict_apple_id";
  appleIdAssertion?: string;
  joinRoute?: SpaceShareJoinRoute;
  relaySessionToken?: string;
}

export interface SpaceShareJoinResponsePayload {
  participant: SpaceParticipantPayload;
}

export interface SpaceShareRevokePayload {
  apiVersion?: string;
  spaceId: string;
  inviteId?: string;
  participantId?: string;
}

export interface SpaceShareRevokeResponsePayload {
  spaceId: string;
  spaceUid: string;
  inviteId?: string;
  participantId?: string;
  revokedInvite: boolean;
  revokedParticipant: boolean;
}

export interface SpaceShareListParticipantsPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceShareListParticipantsResponsePayload {
  spaceId: string;
  spaceUid: string;
  participants: SpaceParticipantPayload[];
}

export interface SpaceShareContextResponsePayload {
  transfer: {
    transferId: string;
    sourceSpaceId: string;
    targetSpaceId: string;
    artifactId: string;
    status: "shared" | "imported" | "denied";
    denialReason?: string;
    createdAt: string;
    appliedAt?: string;
  };
}

export interface SpacePullSharedContextPayload {
  apiVersion?: string;
  sourceSpaceId: string;
  targetSpaceId: string;
  limit?: number;
}

export interface SpacePullSharedContextResponsePayload {
  importedArtifacts: Array<{
    sourceArtifactId: string;
    importedArtifactId: string;
  }>;
  denied: Array<{
    transferId: string;
    reason: string;
  }>;
}
