import { describe, expect, test } from "bun:test";
import {
  initDatabase,
  SpaceRepository,
  SpaceShareInviteRepository,
  SpaceParticipantRepository,
} from "@spaceskit/persistence";
import { SpaceSharingService } from "../src/services/space-sharing-service.js";

function createContext() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-space-sharing-${crypto.randomUUID()}`,
  });

  return {
    db,
    spaces: new SpaceRepository(db.db),
    invites: new SpaceShareInviteRepository(db.db),
    participants: new SpaceParticipantRepository(db.db),
  };
}

function ensureSpace(context: ReturnType<typeof createContext>, spaceId: string): void {
  context.spaces.create({
    spaceId,
    resourceId: `resource:${spaceId}`,
    spaceType: "room",
    name: spaceId,
    goal: "test",
  });
}

describe("SpaceSharingService", () => {
  test("creates invite and auto-bootstraps first collaborator", () => {
    const context = createContext();
    try {
      ensureSpace(context, "space-a");
      const service = new SpaceSharingService({
        spaces: context.spaces,
        invites: context.invites,
        participants: context.participants,
      });

      const invite = service.createInvite({
        spaceId: "space-a",
        issuedByPrincipalId: "principal-owner",
        mode: "read_only",
      });

      expect(invite.inviteId.startsWith("invite-")).toBe(true);
      expect(typeof invite.inviteToken).toBe("string");
      expect(invite.mode).toBe("read_only");
      expect(invite.spaceUid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

      const owner = context.participants.getActiveByPrincipal("space-a", "principal-owner");
      expect(owner).toBeDefined();
      expect(owner?.mode).toBe("collaborator");
    } finally {
      context.db.close();
    }
  });

  test("joins invite and enforces read-only mode for writes", () => {
    const context = createContext();
    try {
      ensureSpace(context, "space-a");
      const service = new SpaceSharingService({
        spaces: context.spaces,
        invites: context.invites,
        participants: context.participants,
      });

      const invite = service.createInvite({
        spaceId: "space-a",
        issuedByPrincipalId: "principal-owner",
        mode: "read_only",
      });

      const participant = service.joinInvite({
        spaceId: "space-a",
        inviteToken: invite.inviteToken!,
        principalId: "principal-reader",
        deviceId: "device-1",
        devicePublicKey: "device-public-key-1",
      });

      expect(participant.mode).toBe("read_only");
      expect(participant.deviceId).toBe("device-1");

      const readDecision = service.evaluateAccess({
        spaceId: "space-a",
        principalId: "principal-reader",
        action: "read",
      });
      expect(readDecision.allowed).toBe(true);
      expect(readDecision.mode).toBe("read_only");

      const writeDecision = service.evaluateAccess({
        spaceId: "space-a",
        principalId: "principal-reader",
        action: "write",
      });
      expect(writeDecision.allowed).toBe(false);
      expect(writeDecision.reason?.toLowerCase()).toContain("read-only");
    } finally {
      context.db.close();
    }
  });

  test("denies join when device-key policy is active but device key material is missing", () => {
    const context = createContext();
    try {
      ensureSpace(context, "space-a");
      const service = new SpaceSharingService({
        spaces: context.spaces,
        invites: context.invites,
        participants: context.participants,
      });

      const invite = service.createInvite({
        spaceId: "space-a",
        issuedByPrincipalId: "principal-owner",
        mode: "read_only",
      });

      expect(() => {
        service.joinInvite({
          spaceId: "space-a",
          inviteToken: invite.inviteToken!,
          principalId: "principal-reader",
          deviceId: "device-1",
        });
      }).toThrow("Sharing identity policy denied join");
    } finally {
      context.db.close();
    }
  });

  test("allows strict_apple_id join when assertion is present", () => {
    const context = createContext();
    try {
      ensureSpace(context, "space-a");
      const service = new SpaceSharingService({
        spaces: context.spaces,
        invites: context.invites,
        participants: context.participants,
        sharingIdentityPolicy: {
          mode: "strict_apple_id",
          allowDeviceKeyFallback: false,
        },
      });

      const invite = service.createInvite({
        spaceId: "space-a",
        issuedByPrincipalId: "principal-owner",
        mode: "collaborator",
      });

      const joined = service.joinInvite({
        spaceId: "space-a",
        inviteToken: invite.inviteToken!,
        principalId: "principal-apple",
        appleIdAssertion: "apple.assertion.token",
      });

      expect(joined.participantId.startsWith("participant-")).toBe(true);
      expect(joined.principalId).toBe("principal-apple");
    } finally {
      context.db.close();
    }
  });

  test("allows strict_apple_id fallback when space policy enables device key fallback", () => {
    const context = createContext();
    try {
      ensureSpace(context, "space-a");
      const service = new SpaceSharingService({
        spaces: context.spaces,
        invites: context.invites,
        participants: context.participants,
        sharingIdentityPolicy: {
          mode: "strict_apple_id",
          allowDeviceKeyFallback: true,
        },
      });

      const invite = service.createInvite({
        spaceId: "space-a",
        issuedByPrincipalId: "principal-owner",
        mode: "collaborator",
      });

      const joined = service.joinInvite({
        spaceId: "space-a",
        inviteToken: invite.inviteToken!,
        principalId: "principal-fallback",
        deviceId: "device-fallback",
        devicePublicKey: "device-fallback-key",
      });

      expect(joined.principalId).toBe("principal-fallback");
      expect(joined.deviceId).toBe("device-fallback");
    } finally {
      context.db.close();
    }
  });

  test("returns actionable strict identity denial messaging when Apple assertion is required", () => {
    const context = createContext();
    try {
      ensureSpace(context, "space-a");
      const service = new SpaceSharingService({
        spaces: context.spaces,
        invites: context.invites,
        participants: context.participants,
        sharingIdentityPolicy: {
          mode: "strict_apple_id",
          allowDeviceKeyFallback: false,
        },
      });

      const invite = service.createInvite({
        spaceId: "space-a",
        issuedByPrincipalId: "principal-owner",
        mode: "collaborator",
      });

      expect(() => {
        service.joinInvite({
          spaceId: "space-a",
          inviteToken: invite.inviteToken!,
          principalId: "principal-strict-denied",
          deviceId: "device-1",
          devicePublicKey: "device-public-key-1",
        });
      }).toThrow("identity_assertion_missing");
      expect(() => {
        service.joinInvite({
          spaceId: "space-a",
          inviteToken: invite.inviteToken!,
          principalId: "principal-strict-denied",
          deviceId: "device-1",
          devicePublicKey: "device-public-key-1",
        });
      }).toThrow("Provide an Apple ID assertion or enable device-key fallback for this space.");
    } finally {
      context.db.close();
    }
  });

  test("rejects unsupported identity mode hints with INVALID_ARGUMENT", () => {
    const context = createContext();
    try {
      ensureSpace(context, "space-a");
      const service = new SpaceSharingService({
        spaces: context.spaces,
        invites: context.invites,
        participants: context.participants,
      });

      const invite = service.createInvite({
        spaceId: "space-a",
        issuedByPrincipalId: "principal-owner",
        mode: "collaborator",
      });

      expect(() => {
        service.joinInvite({
          spaceId: "space-a",
          inviteToken: invite.inviteToken!,
          principalId: "principal-reader",
          deviceId: "device-1",
          devicePublicKey: "device-public-key-1",
          identityModeHint: "legacy_mode" as unknown as "device_key",
        });
      }).toThrow("identityModeHint must be one of: device_key, strict_apple_id");
    } finally {
      context.db.close();
    }
  });

  test("includes relay invite envelope when relay URL is configured", () => {
    const context = createContext();
    try {
      ensureSpace(context, "space-a");
      const service = new SpaceSharingService({
        spaces: context.spaces,
        invites: context.invites,
        participants: context.participants,
        relayBaseUrl: "https://relay.example.com",
        fallbackGatewayUrl: "wss://gateway.example.com",
      });

      const invite = service.createInvite({
        spaceId: "space-a",
        issuedByPrincipalId: "principal-owner",
        mode: "read_only",
      });

      expect(invite.inviteLink?.version).toBe("v2");
      expect(invite.inviteLink?.relayUrl).toContain("https://relay.example.com/invite/");
      expect(invite.inviteLink?.spaceIdHint).toBe("space-a");
      expect(invite.inviteLink?.fallbackGatewayUrl).toBe("wss://gateway.example.com");
    } finally {
      context.db.close();
    }
  });

  test("resolves relay invite and allows a single proxy join", () => {
    const context = createContext();
    try {
      ensureSpace(context, "space-a");
      const service = new SpaceSharingService({
        spaces: context.spaces,
        invites: context.invites,
        participants: context.participants,
        relayBaseUrl: "https://relay.example.com",
        fallbackGatewayUrl: "wss://gateway.example.com",
      });

      const invite = service.createInvite({
        spaceId: "space-a",
        issuedByPrincipalId: "principal-owner",
        mode: "collaborator",
      });
      const resolved = service.resolveRelayInvite({
        relayInviteId: invite.inviteLink!.relayInviteId,
        directReachable: false,
        principalId: "principal-guest",
      });

      expect(resolved.gatewayRoute).toBe("relay_proxy");
      expect(typeof resolved.relaySessionToken).toBe("string");
      expect(resolved.sharingIdentityPolicy).toEqual({
        mode: "device_key",
        allowDeviceKeyFallback: true,
      });

      const joined = service.proxyJoinRelayInvite({
        relaySessionToken: resolved.relaySessionToken,
        principalId: "principal-guest",
        deviceId: "device-guest",
        devicePublicKey: "device-public-key-guest",
      });
      expect(joined.principalId).toBe("principal-guest");

      expect(() => {
        service.proxyJoinRelayInvite({
          relaySessionToken: resolved.relaySessionToken,
          principalId: "principal-guest",
          deviceId: "device-guest",
          devicePublicKey: "device-public-key-guest",
        });
      }).toThrow("Invalid relay session token");
    } finally {
      context.db.close();
    }
  });

  test("exposes strict sharing identity policy in relay resolve preview", () => {
    const context = createContext();
    try {
      ensureSpace(context, "space-strict");
      const service = new SpaceSharingService({
        spaces: context.spaces,
        invites: context.invites,
        participants: context.participants,
        relayBaseUrl: "https://relay.example.com",
        resolveSpaceSharingIdentityPolicy: (spaceId) => {
          if (spaceId !== "space-strict") return null;
          return {
            mode: "strict_apple_id",
            allowDeviceKeyFallback: false,
          };
        },
      });

      const invite = service.createInvite({
        spaceId: "space-strict",
        issuedByPrincipalId: "principal-owner",
        mode: "collaborator",
      });
      const resolved = service.resolveRelayInvite({
        relayInviteId: invite.inviteLink!.relayInviteId,
        principalId: "principal-guest",
      });

      expect(resolved.sharingIdentityPolicy).toEqual({
        mode: "strict_apple_id",
        allowDeviceKeyFallback: false,
      });
    } finally {
      context.db.close();
    }
  });

  test("requires relaySessionToken when joinRoute=relay_proxy", () => {
    const context = createContext();
    try {
      ensureSpace(context, "space-a");
      const service = new SpaceSharingService({
        spaces: context.spaces,
        invites: context.invites,
        participants: context.participants,
        relayBaseUrl: "https://relay.example.com",
      });

      const invite = service.createInvite({
        spaceId: "space-a",
        issuedByPrincipalId: "principal-owner",
        mode: "collaborator",
      });

      expect(() => {
        service.joinInvite({
          spaceId: "space-a",
          inviteToken: invite.inviteToken!,
          principalId: "principal-guest",
          joinRoute: "relay_proxy",
          deviceId: "device-guest",
          devicePublicKey: "device-public-key-guest",
        });
      }).toThrow("relaySessionToken is required");
    } finally {
      context.db.close();
    }
  });

  test("rejects relay join when relay session does not match invite token", () => {
    const context = createContext();
    try {
      ensureSpace(context, "space-a");
      const service = new SpaceSharingService({
        spaces: context.spaces,
        invites: context.invites,
        participants: context.participants,
        relayBaseUrl: "https://relay.example.com",
        fallbackGatewayUrl: "wss://gateway.example.com",
      });

      const inviteA = service.createInvite({
        spaceId: "space-a",
        issuedByPrincipalId: "principal-owner",
        mode: "collaborator",
      });
      const inviteB = service.createInvite({
        spaceId: "space-a",
        issuedByPrincipalId: "principal-owner",
        mode: "collaborator",
      });
      const resolved = service.resolveRelayInvite({
        relayInviteId: inviteA.inviteLink!.relayInviteId,
        principalId: "principal-guest",
      });

      expect(() => {
        service.joinInvite({
          spaceId: "space-a",
          inviteToken: inviteB.inviteToken!,
          principalId: "principal-guest",
          joinRoute: "relay_proxy",
          relaySessionToken: resolved.relaySessionToken,
          deviceId: "device-guest",
          devicePublicKey: "device-public-key-guest",
        });
      }).toThrow("does not match invite token");
    } finally {
      context.db.close();
    }
  });

  test("prefers direct route when gateway is reachable and fallback URL exists", () => {
    const context = createContext();
    try {
      ensureSpace(context, "space-a");
      const service = new SpaceSharingService({
        spaces: context.spaces,
        invites: context.invites,
        participants: context.participants,
        relayBaseUrl: "https://relay.example.com",
        fallbackGatewayUrl: "wss://gateway.example.com",
      });
      const invite = service.createInvite({
        spaceId: "space-a",
        issuedByPrincipalId: "principal-owner",
        mode: "collaborator",
      });

      const resolved = service.resolveRelayInvite({
        relayInviteId: invite.inviteLink!.relayInviteId,
        directReachable: true,
      });
      expect(resolved.gatewayRoute).toBe("direct");
      expect(resolved.gatewayUrl).toBe("wss://gateway.example.com");
    } finally {
      context.db.close();
    }
  });

  test("returns active participant records for execution-origin classification", () => {
    const context = createContext();
    try {
      ensureSpace(context, "space-a");
      const service = new SpaceSharingService({
        spaces: context.spaces,
        invites: context.invites,
        participants: context.participants,
      });

      const invite = service.createInvite({
        spaceId: "space-a",
        issuedByPrincipalId: "principal-owner",
        mode: "collaborator",
      });
      service.joinInvite({
        spaceId: "space-a",
        inviteToken: invite.inviteToken!,
        principalId: "principal-guest",
        deviceId: "device-guest",
        devicePublicKey: "device-guest-pubkey",
      });

      const owner = service.getActiveParticipant("space-a", "principal-owner");
      const guest = service.getActiveParticipant("space-a", "principal-guest");
      const missing = service.getActiveParticipant("space-a", "missing");

      expect(owner?.joinedViaInviteId).toBeUndefined();
      expect(guest?.joinedViaInviteId).toBeDefined();
      expect(guest?.deviceId).toBe("device-guest");
      expect(missing).toBeNull();
    } finally {
      context.db.close();
    }
  });

  test("collaborator can revoke participant", () => {
    const context = createContext();
    try {
      ensureSpace(context, "space-a");
      const service = new SpaceSharingService({
        spaces: context.spaces,
        invites: context.invites,
        participants: context.participants,
      });

      const invite = service.createInvite({
        spaceId: "space-a",
        issuedByPrincipalId: "principal-owner",
        mode: "collaborator",
      });
      const joined = service.joinInvite({
        spaceId: "space-a",
        inviteToken: invite.inviteToken!,
        principalId: "principal-peer",
        deviceId: "device-peer",
        devicePublicKey: "device-peer-public-key",
      });

      const revoked = service.revokeParticipant({
        spaceId: "space-a",
        participantId: joined.participantId,
        requestedByPrincipalId: "principal-owner",
      });
      expect(revoked).toBe(true);

      const decision = service.evaluateAccess({
        spaceId: "space-a",
        principalId: "principal-peer",
        action: "read",
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason?.toLowerCase()).toContain("not authorized");
    } finally {
      context.db.close();
    }
  });
});
