import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  SpaceParticipantRepository,
  SpaceShareInviteRepository,
  SpaceRepository,
  type SpaceParticipantRow,
  type SpaceShareAccessMode,
  type SpaceShareInviteRow,
} from "@spaceskit/persistence";
import { deterministicUuid, normalizeUuid } from "../utils/uuid.js";

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
type SharingPolicyDenialReason = "identity_assertion_missing" | "identity_assertion_invalid";

export interface SharingIdentityPolicy {
  mode: SharingIdentityMode;
  allowDeviceKeyFallback: boolean;
}

const DEFAULT_SHARING_IDENTITY_POLICY: SharingIdentityPolicy = {
  mode: "device_key",
  allowDeviceKeyFallback: true,
};
const DEFAULT_RELAY_SESSION_TTL_SECONDS = 5 * 60;

interface RelaySessionRecord {
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

export class SpaceSharingService {
  private readonly now: () => Date;
  private readonly defaultInviteTtlSeconds: number;
  private readonly defaultSharingIdentityPolicy: SharingIdentityPolicy;
  private readonly relaySessionTtlSeconds: number;
  private readonly relayBaseUrl?: string;
  private readonly fallbackGatewayUrl?: string;
  private readonly relaySessions = new Map<string, RelaySessionRecord>();

  constructor(private readonly options: SpaceSharingServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.defaultInviteTtlSeconds = clampInviteTtlSeconds(options.defaultInviteTtlSeconds ?? 24 * 60 * 60);
    this.relaySessionTtlSeconds = clampInviteTtlSeconds(
      options.relaySessionTtlSeconds ?? DEFAULT_RELAY_SESSION_TTL_SECONDS,
    );
    this.defaultSharingIdentityPolicy = normalizeSharingIdentityPolicy(
      options.sharingIdentityPolicy ?? DEFAULT_SHARING_IDENTITY_POLICY,
    );
    this.relayBaseUrl = sanitizeOptional(options.relayBaseUrl);
    this.fallbackGatewayUrl = sanitizeOptional(options.fallbackGatewayUrl);
  }

  createInvite(input: CreateSpaceShareInviteInput): SpaceShareInvite {
    const spaceId = normalizeNonEmpty(input.spaceId, "spaceId");
    const issuedBy = normalizeNonEmpty(input.issuedByPrincipalId, "issuedByPrincipalId");
    const mode = normalizeAccessMode(input.mode);

    this.assertSpaceExists(spaceId);
    this.assertCollaboratorAccess(spaceId, issuedBy);

    const inviteId = `invite-${randomUUID()}`;
    const inviteToken = generateInviteToken();
    const tokenHash = hashInviteToken(inviteToken);
    const expiresInSeconds = clampInviteTtlSeconds(input.expiresInSeconds ?? this.defaultInviteTtlSeconds);
    const expiresAt = new Date(this.now().getTime() + expiresInSeconds * 1000).toISOString();

    const row = this.options.invites.create({
      inviteId,
      spaceId,
      issuedByPrincipalId: issuedBy,
      mode,
      tokenHash,
      relayInviteId: deterministicUuid(inviteId, "spaces.share.relay"),
      relayUrl: this.relayBaseUrl
        ? `${stripTrailingSlash(this.relayBaseUrl)}/invite/${deterministicUuid(inviteId, "spaces.share.relay")}`
        : "",
      relaySessionScopeJson: "{}",
      expiresAt,
    });

    const mapped = this.mapInvite(row);
    return {
      ...mapped,
      inviteToken,
      inviteLink: this.buildInviteLink(mapped.spaceId, mapped.spaceUid, mapped.inviteId),
    };
  }

  joinInvite(input: JoinSpaceShareInviteInput): SpaceParticipant {
    const spaceId = normalizeNonEmpty(input.spaceId, "spaceId");
    const principalId = normalizeNonEmpty(input.principalId, "principalId");
    const inviteToken = normalizeNonEmpty(input.inviteToken, "inviteToken");
    const nowIso = this.now().toISOString();

    this.assertSpaceExists(spaceId);

    const tokenHash = hashInviteToken(inviteToken);
    const invite = this.options.invites.getActiveByTokenHash(spaceId, tokenHash, nowIso);
    if (!invite) {
      throw new SpaceSharingError("PERMISSION_DENIED", "Invalid or expired invite token");
    }

    this.requireRelaySessionForJoin({
      joinRoute: input.joinRoute,
      relaySessionToken: input.relaySessionToken,
      spaceId,
      inviteToken,
      principalId,
    });

    return this.joinFromInviteRow({
      invite,
      spaceId,
      principalId,
      principalType: input.principalType,
      deviceId: input.deviceId,
      devicePublicKey: input.devicePublicKey,
      identityModeHint: input.identityModeHint,
      appleIdAssertion: input.appleIdAssertion,
    });
  }

  resolveRelayInvite(input: ResolveShareRelayInviteInput): ShareRelayResolveResult {
    const relayInviteId = normalizeNonEmpty(input.relayInviteId, "relayInviteId");
    const nowIso = this.now().toISOString();
    const invite = this.options.invites.getActiveByRelayInviteId(relayInviteId, nowIso);
    if (!invite) {
      throw new SpaceSharingError("PERMISSION_DENIED", "Invalid or expired relay invite");
    }

    const sessionToken = randomBytes(24).toString("base64url");
    const expiresAtIso = new Date(
      this.now().getTime() + this.relaySessionTtlSeconds * 1000,
    ).toISOString();
    this.relaySessions.set(sessionToken, {
      token: sessionToken,
      inviteId: invite.invite_id,
      spaceId: invite.space_id,
      boundPrincipalId: sanitizeOptional(input.principalId),
      expiresAtIso,
    });

    const mode = normalizeAccessMode(invite.mode);
    const space = this.options.spaces.getById(invite.space_id);
    const sharingIdentityPolicy = this.resolveSharingIdentityPolicy(invite.space_id);
    const relayUrl = sanitizeOptional(invite.relay_url);
    const canRouteDirect = input.directReachable === true && Boolean(this.fallbackGatewayUrl);
    const gatewayRoute: "direct" | "relay_proxy" = relayUrl && !canRouteDirect
      ? "relay_proxy"
      : "direct";
    const gatewayUrl = this.fallbackGatewayUrl ?? undefined;

    return {
      gatewayRoute,
      gatewayUrl,
      relaySessionToken: sessionToken,
      invitePreview: {
        inviterDisplayName: invite.issued_by_principal_id,
        spaceName: space?.name ?? undefined,
        mode,
      },
      sharingIdentityPolicy: {
        mode: sharingIdentityPolicy.mode,
        allowDeviceKeyFallback: sharingIdentityPolicy.allowDeviceKeyFallback,
      },
    };
  }

  proxyJoinRelayInvite(input: ProxyJoinShareRelayInviteInput): SpaceParticipant {
    const principalId = normalizeNonEmpty(input.principalId, "principalId");
    const session = this.consumeRelaySessionToken(
      normalizeNonEmpty(input.relaySessionToken, "relaySessionToken"),
      principalId,
    );
    const invite = this.options.invites.getById(session.inviteId);
    if (!invite || invite.space_id !== session.spaceId) {
      throw new SpaceSharingError("PERMISSION_DENIED", "Relay session does not resolve to an active invite");
    }
    if (invite.status !== "active") {
      throw new SpaceSharingError("PERMISSION_DENIED", "Relay invite is no longer active");
    }
    if (invite.expires_at && invite.expires_at <= this.now().toISOString()) {
      this.options.invites.markExpired(invite.invite_id);
      throw new SpaceSharingError("PERMISSION_DENIED", "Relay invite has expired");
    }

    return this.joinFromInviteRow({
      invite,
      spaceId: invite.space_id,
      principalId,
      principalType: input.principalType,
      deviceId: input.deviceId,
      devicePublicKey: input.devicePublicKey,
      identityModeHint: input.identityModeHint,
      appleIdAssertion: input.appleIdAssertion,
    });
  }

  private joinFromInviteRow(input: {
    invite: SpaceShareInviteRow;
    spaceId: string;
    principalId: string;
    principalType?: string;
    deviceId?: string;
    devicePublicKey?: string;
    identityModeHint?: string;
    appleIdAssertion?: string;
  }): SpaceParticipant {
    const { invite, spaceId, principalId } = input;
    const sharingIdentityPolicy = this.resolveSharingIdentityPolicy(spaceId);
    const deviceId = sanitizeOptional(input.deviceId);
    const devicePublicKey = sanitizeOptional(input.devicePublicKey);
    const appleIdAssertion = sanitizeOptional(input.appleIdAssertion);
    const rawIdentityModeHint = sanitizeOptional(input.identityModeHint);
    const identityModeHint = normalizeIdentityModeHint(rawIdentityModeHint);
    if (rawIdentityModeHint && !identityModeHint) {
      throw new SpaceSharingError(
        "INVALID_ARGUMENT",
        "identityModeHint must be one of: device_key, strict_apple_id",
      );
    }

    const identityEvaluation = evaluateSharingIdentity({
      policy: sharingIdentityPolicy,
      hasDeviceKey: Boolean(deviceId && devicePublicKey),
      hasAppleIdAssertion: Boolean(appleIdAssertion),
      appleIdAssertion,
    });
    if (!identityEvaluation.allowed) {
      throw new SpaceSharingError(
        "PERMISSION_DENIED",
        buildIdentityDenialMessage(identityEvaluation),
      );
    }
    if (identityModeHint && identityModeHint !== identityEvaluation.identityMode) {
      throw new SpaceSharingError(
        "PERMISSION_DENIED",
        `Identity mode hint mismatch: requested=${identityModeHint}, resolved=${identityEvaluation.identityMode}. ` +
          "Retry with the resolved mode or remove identityModeHint.",
      );
    }

    const mode = normalizeAccessMode(invite.mode);
    const participant = this.options.participants.upsert({
      participantId: `participant-${randomUUID()}`,
      spaceId,
      principalId,
      principalType: input.principalType ?? "public_key",
      mode,
      joinedViaInviteId: invite.invite_id,
      deviceId,
      devicePublicKey,
    });

    this.options.invites.markUsed(invite.invite_id);
    return this.mapParticipant(participant);
  }

  private requireRelaySessionForJoin(input: {
    joinRoute?: "direct" | "relay_proxy";
    relaySessionToken?: string;
    spaceId: string;
    inviteToken: string;
    principalId: string;
  }): void {
    if (input.joinRoute !== "relay_proxy") {
      return;
    }
    const relaySessionToken = sanitizeOptional(input.relaySessionToken);
    if (!relaySessionToken) {
      throw new SpaceSharingError(
        "PERMISSION_DENIED",
        "relaySessionToken is required when joinRoute=relay_proxy",
      );
    }
    const session = this.consumeRelaySessionToken(relaySessionToken, input.principalId);
    if (session.spaceId !== input.spaceId) {
      throw new SpaceSharingError("PERMISSION_DENIED", "Relay session target space mismatch");
    }

    const tokenHash = hashInviteToken(input.inviteToken);
    const invite = this.options.invites.getActiveByTokenHash(input.spaceId, tokenHash, this.now().toISOString());
    if (!invite || invite.invite_id !== session.inviteId) {
      throw new SpaceSharingError("PERMISSION_DENIED", "Relay session does not match invite token");
    }
  }

  private consumeRelaySessionToken(token: string, principalId: string): RelaySessionRecord {
    const session = this.relaySessions.get(token);
    if (!session) {
      throw new SpaceSharingError("PERMISSION_DENIED", "Invalid relay session token");
    }
    if (session.boundPrincipalId && session.boundPrincipalId !== principalId) {
      throw new SpaceSharingError("PERMISSION_DENIED", "Relay session token is bound to another principal");
    }
    if (session.consumedAtIso) {
      throw new SpaceSharingError("PERMISSION_DENIED", "Relay session token already used");
    }
    if (session.expiresAtIso <= this.now().toISOString()) {
      this.relaySessions.delete(token);
      throw new SpaceSharingError("PERMISSION_DENIED", "Relay session token expired");
    }
    session.consumedAtIso = this.now().toISOString();
    this.relaySessions.set(token, session);
    this.pruneRelaySessions();
    return session;
  }

  private pruneRelaySessions(): void {
    const nowIso = this.now().toISOString();
    for (const [token, session] of this.relaySessions.entries()) {
      if (session.expiresAtIso <= nowIso || session.consumedAtIso) {
        this.relaySessions.delete(token);
      }
    }
  }

  revokeInvite(input: RevokeSpaceShareInviteInput): boolean {
    const spaceId = normalizeNonEmpty(input.spaceId, "spaceId");
    const inviteId = normalizeNonEmpty(input.inviteId, "inviteId");
    const requestedBy = normalizeNonEmpty(input.requestedByPrincipalId, "requestedByPrincipalId");

    this.assertSpaceExists(spaceId);
    this.assertCollaboratorAccess(spaceId, requestedBy);

    const invite = this.options.invites.getById(inviteId);
    if (!invite || invite.space_id !== spaceId) {
      throw new SpaceSharingError("NOT_FOUND", `Invite not found: ${inviteId}`);
    }

    return this.options.invites.revoke(inviteId);
  }

  revokeParticipant(input: RevokeSpaceParticipantInput): boolean {
    const spaceId = normalizeNonEmpty(input.spaceId, "spaceId");
    const participantId = normalizeNonEmpty(input.participantId, "participantId");
    const requestedBy = normalizeNonEmpty(input.requestedByPrincipalId, "requestedByPrincipalId");

    this.assertSpaceExists(spaceId);
    this.assertCollaboratorAccess(spaceId, requestedBy);

    const participant = this.options.participants.getById(participantId);
    if (!participant || participant.space_id !== spaceId) {
      throw new SpaceSharingError("NOT_FOUND", `Participant not found: ${participantId}`);
    }

    return this.options.participants.revoke(spaceId, participantId);
  }

  listParticipants(input: ListSpaceParticipantsInput): SpaceParticipant[] {
    const spaceId = normalizeNonEmpty(input.spaceId, "spaceId");
    const requestedBy = normalizeNonEmpty(input.requestedByPrincipalId, "requestedByPrincipalId");

    this.assertSpaceExists(spaceId);
    const decision = this.evaluateAccess({
      spaceId,
      principalId: requestedBy,
      action: "read",
    });
    if (!decision.allowed) {
      throw new SpaceSharingError(
        "PERMISSION_DENIED",
        decision.reason ?? "Access denied",
      );
    }

    return this.options.participants
      .listBySpace(spaceId)
      .map((row) => this.mapParticipant(row));
  }

  getActiveParticipant(spaceIdRaw: string, principalIdRaw: string): SpaceParticipant | null {
    const spaceId = spaceIdRaw.trim();
    const principalId = principalIdRaw.trim();
    if (!spaceId || !principalId) return null;
    const participant = this.options.participants.getActiveByPrincipal(spaceId, principalId);
    return participant ? this.mapParticipant(participant) : null;
  }

  evaluateAccess(input: {
    spaceId: string;
    principalId?: string;
    action: "read" | "write";
  }): SpaceSharingAccessDecision {
    const spaceId = input.spaceId.trim();
    if (!spaceId) {
      return { allowed: false, enforced: false, reason: "spaceId is required" };
    }

    const nowIso = this.now().toISOString();
    const activeParticipants = this.options.participants.countActiveBySpace(spaceId);
    const activeInvites = this.options.invites.countActiveBySpace(spaceId, nowIso);
    const enforceAccess = activeParticipants > 0 || activeInvites > 0;

    if (!enforceAccess) {
      return { allowed: true, enforced: false, mode: "collaborator" };
    }

    const principalId = input.principalId?.trim();
    if (!principalId) {
      return {
        allowed: false,
        enforced: true,
        reason: "Authenticated principal identity is required for shared spaces",
      };
    }

    const participant = this.options.participants.getActiveByPrincipal(spaceId, principalId);
    if (!participant) {
      return {
        allowed: false,
        enforced: true,
        reason: "Principal is not authorized for this shared space",
      };
    }

    const mode = normalizeAccessMode(participant.mode);
    if (input.action === "write" && mode === "read_only") {
      return {
        allowed: false,
        enforced: true,
        mode,
        reason: "Read-only access does not permit this operation",
      };
    }

    return {
      allowed: true,
      enforced: true,
      mode,
    };
  }

  private assertCollaboratorAccess(spaceId: string, principalId: string): void {
    const activeCount = this.options.participants.countActiveBySpace(spaceId);
    if (activeCount === 0) {
      this.options.participants.upsert({
        participantId: `participant-${randomUUID()}`,
        spaceId,
        principalId,
        principalType: "public_key",
        mode: "collaborator",
      });
      return;
    }

    const participant = this.options.participants.getActiveByPrincipal(spaceId, principalId);
    if (!participant) {
      throw new SpaceSharingError(
        "PERMISSION_DENIED",
        "Only collaborators can manage sharing",
      );
    }

    if (normalizeAccessMode(participant.mode) !== "collaborator") {
      throw new SpaceSharingError(
        "PERMISSION_DENIED",
        "Read-only users cannot manage sharing",
      );
    }
  }

  private assertSpaceExists(spaceId: string): void {
    const space = this.options.spaces.getById(spaceId);
    if (!space) {
      throw new SpaceSharingError("NOT_FOUND", `Space not found: ${spaceId}`);
    }
  }

  private mapInvite(row: SpaceShareInviteRow): SpaceShareInvite {
    const spaceUid = this.resolveSpaceUid(row.space_id);
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

  private mapParticipant(row: SpaceParticipantRow): SpaceParticipant {
    const spaceUid = this.resolveSpaceUid(row.space_id);
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

  private resolveSpaceUid(spaceId: string): string {
    const fallback = deterministicUuid(spaceId, "spaceskit.space.uuid");
    const row = this.options.spaces.getById(spaceId);
    if (!row?.space_config_json) return fallback;
    try {
      const parsed = JSON.parse(row.space_config_json) as Record<string, unknown>;
      const direct = normalizeUuid(parsed.spaceUid);
      if (direct) return direct;
      const legacy = normalizeUuid(parsed.space_uid);
      if (legacy) return legacy;
    } catch {
      // Ignore malformed legacy config payload and fall back to deterministic UUID.
    }
    return fallback;
  }

  private resolveSharingIdentityPolicy(spaceId: string): SharingIdentityPolicy {
    const resolved = this.options.resolveSpaceSharingIdentityPolicy?.(spaceId) ?? null;
    if (resolved) {
      return normalizeSharingIdentityPolicy(resolved);
    }
    return this.defaultSharingIdentityPolicy;
  }

  private buildInviteLink(spaceId: string, spaceUid: string, inviteId: string): SpaceInviteLink | undefined {
    if (!this.relayBaseUrl) return undefined;

    const relayInviteId = deterministicUuid(inviteId, "spaces.share.relay");
    return {
      version: "v2",
      relayInviteId,
      relayUrl: `${stripTrailingSlash(this.relayBaseUrl)}/invite/${relayInviteId}`,
      spaceIdHint: spaceId,
      spaceUidHint: spaceUid,
      ...(this.fallbackGatewayUrl ? { fallbackGatewayUrl: this.fallbackGatewayUrl } : {}),
    };
  }
}

function normalizeNonEmpty(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new SpaceSharingError("INVALID_ARGUMENT", `${field} is required`);
  }
  return normalized;
}

function sanitizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function normalizeSharingIdentityPolicy(policy: SharingIdentityPolicy): SharingIdentityPolicy {
  const mode = normalizeIdentityModeHint(policy.mode) ?? "device_key";
  return {
    mode,
    allowDeviceKeyFallback: policy.allowDeviceKeyFallback !== false,
  };
}

function normalizeIdentityModeHint(value: string | undefined): SharingIdentityMode | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (normalized === "device_key" || normalized === "strict_apple_id") {
    return normalized;
  }
  return undefined;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function evaluateSharingIdentity(input: {
  policy: SharingIdentityPolicy;
  hasDeviceKey: boolean;
  hasAppleIdAssertion: boolean;
  appleIdAssertion?: string;
}): (
  | { allowed: true; identityMode: SharingIdentityMode; details: string }
  | {
      allowed: false;
      identityMode: SharingIdentityMode;
      details: string;
      denialReason: SharingPolicyDenialReason;
    }
) {
  const { policy, hasDeviceKey, hasAppleIdAssertion } = input;
  if (policy.mode === "device_key") {
    if (hasDeviceKey) {
      return {
        allowed: true,
        identityMode: "device_key",
        details: "Device key present — identity requirement met",
      };
    }
    return {
      allowed: false,
      identityMode: "device_key",
      details: "Device key required but not provided",
      denialReason: "identity_assertion_missing",
    };
  }

  if (hasAppleIdAssertion) {
    return {
      allowed: true,
      identityMode: "strict_apple_id",
      details: "Apple ID assertion present — strict identity requirement met",
    };
  }

  if (policy.allowDeviceKeyFallback && hasDeviceKey) {
    return {
      allowed: true,
      identityMode: "device_key",
      details: "Apple ID assertion missing — device key fallback allowed",
    };
  }

  return {
    allowed: false,
    identityMode: "strict_apple_id",
    details: "Apple ID assertion required for strict_apple_id mode",
    denialReason: "identity_assertion_missing",
  };
}

function buildIdentityDenialMessage(input: {
  identityMode: SharingIdentityMode;
  details: string;
  denialReason: SharingPolicyDenialReason;
}): string {
  const remediation = input.identityMode === "strict_apple_id"
    ? "Provide an Apple ID assertion or enable device-key fallback for this space."
    : "Provide both deviceId and devicePublicKey and retry.";
  return `Sharing identity policy denied join (${input.denialReason}): ${input.details}. ${remediation}`;
}

function normalizeAccessMode(value: string): SpaceShareAccessMode {
  const normalized = value.trim().toLowerCase();
  if (normalized === "read_only" || normalized === "collaborator") {
    return normalized;
  }
  throw new SpaceSharingError(
    "INVALID_ARGUMENT",
    `Unsupported access mode: ${value}`,
  );
}

function normalizeInviteStatus(value: string): SpaceShareInvite["status"] {
  switch (value) {
    case "active":
    case "used":
    case "revoked":
    case "expired":
      return value;
    default:
      return "active";
  }
}

function normalizeParticipantStatus(value: string): SpaceParticipant["status"] {
  switch (value) {
    case "active":
    case "revoked":
      return value;
    default:
      return "active";
  }
}

function generateInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function clampInviteTtlSeconds(value: number): number {
  const min = 60;
  const max = 30 * 24 * 60 * 60;
  if (!Number.isFinite(value)) return 24 * 60 * 60;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
