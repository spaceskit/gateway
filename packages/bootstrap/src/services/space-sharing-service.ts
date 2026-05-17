import { randomBytes, randomUUID } from "node:crypto";
import type { SpaceShareInviteRow } from "@spaceskit/persistence";
import { deterministicUuid } from "../utils/uuid.js";
import { assertCollaboratorAccess } from "./space-sharing-service-access.js";
import {
  buildIdentityDenialMessage,
  clampInviteTtlSeconds,
  evaluateSharingIdentity,
  generateInviteToken,
  hashInviteToken,
  normalizeAccessMode,
  normalizeIdentityModeHint,
  normalizeNonEmpty,
  normalizeSharingIdentityPolicy,
  sanitizeOptional,
  stripTrailingSlash,
} from "./space-sharing-service-helpers.js";
import {
  buildInviteLink,
  mapInvite,
  mapParticipant,
} from "./space-sharing-service-mappers.js";
import {
  DEFAULT_RELAY_SESSION_TTL_SECONDS,
  DEFAULT_SHARING_IDENTITY_POLICY,
  SpaceSharingError,
  type CreateSpaceShareInviteInput,
  type JoinSpaceShareInviteInput,
  type ListSpaceParticipantsInput,
  type ProxyJoinShareRelayInviteInput,
  type RelaySessionRecord,
  type ResolveShareRelayInviteInput,
  type RevokeSpaceParticipantInput,
  type RevokeSpaceShareInviteInput,
  type ShareRelayResolveResult,
  type SharingIdentityPolicy,
  type SpaceParticipant,
  type SpaceShareInvite,
  type SpaceSharingAccessDecision,
  type SpaceSharingServiceOptions,
} from "./space-sharing-service-types.js";

export {
  SpaceSharingError,
  type CreateSpaceShareInviteInput,
  type JoinSpaceShareInviteInput,
  type ListSpaceParticipantsInput,
  type ProxyJoinShareRelayInviteInput,
  type ResolveShareRelayInviteInput,
  type RevokeSpaceParticipantInput,
  type RevokeSpaceShareInviteInput,
  type ShareRelayResolveResult,
  type SharingIdentityMode,
  type SharingIdentityPolicy,
  type SpaceInviteLink,
  type SpaceParticipant,
  type SpaceShareInvite,
  type SpaceSharingAccessDecision,
  type SpaceSharingErrorCode,
  type SpaceSharingServiceOptions,
} from "./space-sharing-service-types.js";

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
    assertCollaboratorAccess(this.options.participants, spaceId, issuedBy);

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

    const mapped = mapInvite(row, this.options.spaces);
    return {
      ...mapped,
      inviteToken,
      inviteLink: buildInviteLink({
        relayBaseUrl: this.relayBaseUrl,
        fallbackGatewayUrl: this.fallbackGatewayUrl,
        spaceId: mapped.spaceId,
        spaceUid: mapped.spaceUid,
        inviteId: mapped.inviteId,
      }),
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
    return mapParticipant(participant, this.options.spaces);
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
    assertCollaboratorAccess(this.options.participants, spaceId, requestedBy);

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
    assertCollaboratorAccess(this.options.participants, spaceId, requestedBy);

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
      .map((row) => mapParticipant(row, this.options.spaces));
  }

  getActiveParticipant(spaceIdRaw: string, principalIdRaw: string): SpaceParticipant | null {
    const spaceId = spaceIdRaw.trim();
    const principalId = principalIdRaw.trim();
    if (!spaceId || !principalId) return null;
    const participant = this.options.participants.getActiveByPrincipal(spaceId, principalId);
    return participant ? mapParticipant(participant, this.options.spaces) : null;
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

  private assertSpaceExists(spaceId: string): void {
    const space = this.options.spaces.getById(spaceId);
    if (!space) {
      throw new SpaceSharingError("NOT_FOUND", `Space not found: ${spaceId}`);
    }
  }

  private resolveSharingIdentityPolicy(spaceId: string): SharingIdentityPolicy {
    const resolved = this.options.resolveSpaceSharingIdentityPolicy?.(spaceId) ?? null;
    if (resolved) {
      return normalizeSharingIdentityPolicy(resolved);
    }
    return this.defaultSharingIdentityPolicy;
  }
}
