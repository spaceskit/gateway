import { describe, expect, test } from "bun:test";
import { MessageRouter } from "../src/message-router.js";
import { MessageTypes, type GatewayMessage } from "../src/protocol.js";

function makeClient(overrides: Record<string, unknown> = {}): any {
  return {
    id: "client-1",
    authenticated: true,
    clientType: "sdk",
    publicKey: "principal-owner",
    subscribedSpaces: new Set<string>(),
    connectedAt: new Date(),
    ...overrides,
  };
}

function makeMessage<T>(type: string, payload: T): GatewayMessage<T> {
  return {
    type,
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    payload,
  };
}

function makeRouter(options: {
  spaceSharingService?: Record<string, unknown>;
  spaceAdminService?: Record<string, unknown>;
  turnHistoryService?: Record<string, unknown>;
} = {}): MessageRouter {
  const logger: any = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };

  return new MessageRouter({
    spaceManager: {
      executeTurn: async () => ({ turnId: "turn-1" }),
      resumeFeedback: async () => {},
    } as any,
    spaceAdminService: options.spaceAdminService as any,
    capabilities: {
      invoke: async () => ({ ok: true }),
      register: () => {},
      deregister: () => {},
    } as any,
    logger,
    spaceSharingService: options.spaceSharingService as any,
    turnHistoryService: options.turnHistoryService as any,
  });
}

describe("MessageRouter space sharing handlers", () => {
  test("routes share invite/join/revoke/list participant flows", async () => {
    let createInviteInput: any = null;
    let joinInviteInput: any = null;
    let revokeInviteInput: any = null;
    let revokeParticipantInput: any = null;
    let listParticipantsInput: any = null;

    const participant = {
      participantId: "participant-1",
      spaceId: "space-main",
      principalId: "principal-collaborator",
      principalType: "public_key",
      mode: "collaborator",
      status: "active",
      joinedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const router = makeRouter({
      spaceSharingService: {
        evaluateAccess: () => ({ allowed: true, enforced: true, mode: "collaborator" }),
        createInvite: (input: unknown) => {
          createInviteInput = input;
          return {
            inviteId: "invite-1",
            spaceId: "space-main",
            issuedByPrincipalId: "principal-owner",
            mode: "collaborator",
            status: "active",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            inviteToken: "token-123",
          };
        },
        joinInvite: (input: unknown) => {
          joinInviteInput = input;
          return participant;
        },
        revokeInvite: (input: unknown) => {
          revokeInviteInput = input;
          return true;
        },
        revokeParticipant: (input: unknown) => {
          revokeParticipantInput = input;
          return true;
        },
        listParticipants: (input: unknown) => {
          listParticipantsInput = input;
          return [participant];
        },
      },
    });

    const createResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_SHARE_CREATE_INVITE, {
        spaceId: "space-main",
        mode: "collaborator",
        expiresInSeconds: 600,
      }),
    );

    expect(createResponse?.type).toBe(MessageTypes.SPACE_SHARE_CREATE_INVITE);
    expect((createResponse?.payload as any).invite.inviteId).toBe("invite-1");
    expect(createInviteInput).toEqual({
      spaceId: "space-main",
      issuedByPrincipalId: "principal-owner",
      mode: "collaborator",
      expiresInSeconds: 600,
    });

    const joinResponse = await router.handle(
      makeClient({ publicKey: "principal-collaborator" }),
      makeMessage(MessageTypes.SPACE_SHARE_JOIN, {
        spaceId: "space-main",
        inviteToken: "token-123",
        deviceId: "device-1",
        devicePublicKey: "device-public-key",
        identityModeHint: "device_key",
        joinRoute: "relay_proxy",
        relaySessionToken: "relay-session-token",
      }),
    );

    expect(joinResponse?.type).toBe(MessageTypes.SPACE_SHARE_JOIN);
    expect((joinResponse?.payload as any).participant.participantId).toBe("participant-1");
    expect(joinInviteInput).toEqual({
      spaceId: "space-main",
      inviteToken: "token-123",
      principalId: "principal-collaborator",
      principalType: "public_key",
      deviceId: "device-1",
      devicePublicKey: "device-public-key",
      identityModeHint: "device_key",
      appleIdAssertion: undefined,
      joinRoute: "relay_proxy",
      relaySessionToken: "relay-session-token",
    });

    const revokeResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_SHARE_REVOKE, {
        spaceId: "space-main",
        inviteId: "invite-1",
        participantId: "participant-1",
      }),
    );

    expect(revokeResponse?.type).toBe(MessageTypes.SPACE_SHARE_REVOKE);
    expect((revokeResponse?.payload as any).revokedInvite).toBe(true);
    expect((revokeResponse?.payload as any).revokedParticipant).toBe(true);
    expect(revokeInviteInput).toEqual({
      spaceId: "space-main",
      inviteId: "invite-1",
      requestedByPrincipalId: "principal-owner",
    });
    expect(revokeParticipantInput).toEqual({
      spaceId: "space-main",
      participantId: "participant-1",
      requestedByPrincipalId: "principal-owner",
    });

    const listResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_SHARE_LIST_PARTICIPANTS, {
        spaceId: "space-main",
      }),
    );

    expect(listResponse?.type).toBe(MessageTypes.SPACE_SHARE_LIST_PARTICIPANTS);
    expect((listResponse?.payload as any).participants.length).toBe(1);
    expect(listParticipantsInput).toEqual({
      spaceId: "space-main",
      requestedByPrincipalId: "principal-owner",
    });
  });

  test("returns actionable strict identity denial from share.join", async () => {
    const router = makeRouter({
      spaceSharingService: {
        evaluateAccess: () => ({ allowed: true, enforced: true, mode: "collaborator" }),
        joinInvite: () => {
          throw {
            code: "PERMISSION_DENIED",
            message:
              "Sharing identity policy denied join (identity_assertion_missing): " +
              "Apple ID assertion required for strict_apple_id mode. " +
              "Provide an Apple ID assertion or enable device-key fallback for this space.",
          };
        },
      },
    });

    const response = await router.handle(
      makeClient({ publicKey: "principal-collaborator" }),
      makeMessage(MessageTypes.SPACE_SHARE_JOIN, {
        spaceId: "space-main",
        inviteToken: "token-123",
        deviceId: "device-1",
        devicePublicKey: "device-public-key",
        identityModeHint: "device_key",
      }),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("PERMISSION_DENIED");
    expect((response?.payload as any).message).toContain("identity_assertion_missing");
    expect((response?.payload as any).message).toContain("strict_apple_id");
  });

  test("validates identityModeHint for share.join", async () => {
    let joinInviteCalled = false;
    const router = makeRouter({
      spaceSharingService: {
        evaluateAccess: () => ({ allowed: true, enforced: true, mode: "collaborator" }),
        joinInvite: () => {
          joinInviteCalled = true;
          return {
            participantId: "participant-1",
            spaceId: "space-main",
            principalId: "principal-collaborator",
            principalType: "public_key",
            mode: "collaborator",
            status: "active",
            joinedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        },
      },
    });

    const response = await router.handle(
      makeClient({ publicKey: "principal-collaborator" }),
      makeMessage(MessageTypes.SPACE_SHARE_JOIN, {
        spaceId: "space-main",
        inviteToken: "token-123",
        identityModeHint: "legacy_mode",
      }),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
    expect((response?.payload as any).message).toContain("identityModeHint must be one of");
    expect(joinInviteCalled).toBe(false);
  });

  test("denies write operation for read-only principal", async () => {
    let addSkillCalled = false;
    const router = makeRouter({
      spaceSharingService: {
        evaluateAccess: (input: { action: "read" | "write" }) => {
          if (input.action === "write") {
            return {
              allowed: false,
              enforced: true,
              mode: "read_only",
              reason: "Read-only participant cannot perform write actions",
            };
          }
          return { allowed: true, enforced: true, mode: "read_only" };
        },
      },
      spaceAdminService: {
        addSkillToSpace: async () => {
          addSkillCalled = true;
          return ["skill.blocked"];
        },
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_ADD_SKILL, {
      spaceId: "space-main",
      skillId: "skill.blocked",
    });

    const response = await router.handle(
      makeClient({ publicKey: "principal-read-only" }),
      msg,
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("PERMISSION_DENIED");
    expect((response?.payload as any).message).toContain("Read-only participant");
    expect(addSkillCalled).toBe(false);
  });

  test("allows read operation for read-only principal", async () => {
    const router = makeRouter({
      spaceSharingService: {
        evaluateAccess: (input: { action: "read" | "write" }) => {
          if (input.action === "write") {
            return {
              allowed: false,
              enforced: true,
              mode: "read_only",
              reason: "Read-only participant cannot perform write actions",
            };
          }
          return { allowed: true, enforced: true, mode: "read_only" };
        },
      },
      spaceAdminService: {
        listSpaceSkills: async () => ["skill.visible"],
      },
    });

    const response = await router.handle(
      makeClient({ publicKey: "principal-read-only" }),
      makeMessage(MessageTypes.SPACE_LIST_SKILLS, {
        spaceId: "space-main",
      }),
    );

    expect(response?.type).toBe(MessageTypes.SPACE_LIST_SKILLS);
    expect((response?.payload as any).skills).toEqual(["skill.visible"]);
  });

  test("allows space.list_turns for read-only principal", async () => {
    let historyCalled = false;
    const evaluateCalls: Array<{ spaceId: string; principalId?: string; action: "read" | "write" }> = [];
    const router = makeRouter({
      spaceSharingService: {
        evaluateAccess: (input: { spaceId: string; principalId?: string; action: "read" | "write" }) => {
          evaluateCalls.push(input);
          if (input.action === "write") {
            return {
              allowed: false,
              enforced: true,
              mode: "read_only",
              reason: "Read-only participant cannot perform write actions",
            };
          }
          return { allowed: true, enforced: true, mode: "read_only" };
        },
      },
      spaceAdminService: {
        getSpace: async () => ({
          id: "space-main",
          spaceUid: "space-uid-main",
          resourceId: "resource-main",
          name: "Main Space",
          turnModel: "sequential_all",
          agents: [],
          capabilities: [],
          capabilityOverrides: {},
          visibility: "shared",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      },
      turnHistoryService: {
        listSpaceTurns: async () => {
          historyCalled = true;
          return {
            turns: [],
            total: 0,
          };
        },
      },
    });

    const response = await router.handle(
      makeClient({ publicKey: "principal-read-only" }),
      makeMessage(MessageTypes.SPACE_LIST_TURNS, {
        spaceUid: "space-uid-main",
        limit: 100,
        offset: 0,
      }),
    );

    expect(response?.type).toBe(MessageTypes.SPACE_LIST_TURNS);
    expect(historyCalled).toBe(true);
    expect(evaluateCalls.some((call) => call.action === "read" && call.spaceId === "space-main")).toBe(true);
  });

  test("filters space.list results to spaces the principal can read", async () => {
    const evaluateCalls: Array<{ spaceId: string; principalId?: string; action: "read" | "write" }> = [];
    const router = makeRouter({
      spaceSharingService: {
        evaluateAccess: (input: { spaceId: string; principalId?: string; action: "read" | "write" }) => {
          evaluateCalls.push(input);
          return {
            allowed: input.spaceId !== "space-denied",
            enforced: true,
            mode: "collaborator",
            reason: input.spaceId === "space-denied" ? "Access denied" : undefined,
          };
        },
      },
      spaceAdminService: {
        listSpaces: async () => ([
          {
            id: "space-allowed",
            resourceId: "resource-main",
            name: "Allowed Space",
            turnModel: "sequential_all",
            agents: [],
            capabilities: [],
            capabilityOverrides: {},
            visibility: "shared",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: "space-denied",
            resourceId: "resource-main",
            name: "Denied Space",
            turnModel: "sequential_all",
            agents: [],
            capabilities: [],
            capabilityOverrides: {},
            visibility: "shared",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]),
      },
    });

    const response = await router.handle(
      makeClient({ publicKey: "principal-read-only" }),
      makeMessage(MessageTypes.SPACE_LIST, {}),
    );

    expect(response?.type).toBe(MessageTypes.SPACE_LIST);
    expect((response?.payload as any).spaces.map((space: any) => space.id)).toEqual(["space-allowed"]);
    expect(evaluateCalls).toEqual([
      { spaceId: "space-allowed", principalId: "principal-read-only", action: "read" },
      { spaceId: "space-denied", principalId: "principal-read-only", action: "read" },
    ]);
  });
});
