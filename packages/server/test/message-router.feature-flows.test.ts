import { describe, expect, test } from "bun:test";
import { MessageRouter } from "../src/message-router.js";
import { MessageTypes, type GatewayMessage, type SpeechEventPayload } from "../src/protocol.js";

function makeClient(overrides: Record<string, unknown> = {}): any {
  return {
    id: "client-1",
    authenticated: true,
    clientType: "sdk",
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

describe("MessageRouter feature handlers", () => {
  test("routes usage.get_snapshot", async () => {
    const router = makeRouter({
      usageSnapshotService: {
        getSnapshot: () => ({
          computedAt: new Date().toISOString(),
          currency: "USD",
          windows: {
            last5h: { inputTokens: 1, outputTokens: 2, totalTokens: 3, spentUsd: 0.01 },
            last7d: { inputTokens: 1, outputTokens: 2, totalTokens: 3, spentUsd: 0.01 },
            last30d: { inputTokens: 1, outputTokens: 2, totalTokens: 3, spentUsd: 0.01 },
            lifetime: { inputTokens: 1, outputTokens: 2, totalTokens: 3, spentUsd: 0.01 },
          },
          budget: {
            softCapUsd: 20,
            hardCapUsd: 50,
            warningThreshold: 0.8,
            spentUsd: 0.01,
            leftUsd: 49.99,
          },
          providerUsage: [],
        }),
      },
    });

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.USAGE_GET_SNAPSHOT, {}),
    );

    expect(response?.type).toBe(MessageTypes.USAGE_GET_SNAPSHOT);
    expect((response?.payload as any).snapshot.currency).toBe("USD");
  });

  test("routes execute_turn with authenticated principal/device context", async () => {
    const executeTurnCalls: Array<[string, string, string | undefined, any]> = [];
    const router = makeRouter({
      spaceManager: {
        executeTurn: async (
          spaceId: string,
          input: string,
          targetAgentId?: string,
          identity?: { principalId?: string; deviceId?: string },
        ) => {
          executeTurnCalls.push([spaceId, input, targetAgentId, identity]);
          return { turnId: "turn-context" };
        },
        resumeFeedback: async () => {},
      },
    });

    const response = await router.handle(
      makeClient({ publicKey: "principal-1", deviceId: "device-1" }),
      makeMessage(MessageTypes.EXECUTE_TURN, {
        spaceUid: "main-space",
        input: "hello",
      }),
    );

    expect(response?.type).toBe(MessageTypes.TURN_EVENT);
    expect(executeTurnCalls).toEqual([
      [
        "main-space",
        "hello",
        undefined,
        { principalId: "principal-1", deviceId: "device-1", executionOrigin: "unknown" },
      ],
    ]);
  });

  test("normalizes execute_turn identifiers before dispatch", async () => {
    const executeTurnCalls: Array<[string, string, string | undefined]> = [];
    const router = makeRouter({
      spaceManager: {
        executeTurn: async (
          spaceId: string,
          input: string,
          targetAgentId?: string,
        ) => {
          executeTurnCalls.push([spaceId, input, targetAgentId]);
          return { turnId: "turn-normalized" };
        },
        resumeFeedback: async () => {},
      },
    });

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.EXECUTE_TURN, {
        spaceUid: "  main-space  ",
        input: "hello",
        targetAgentId: "   ",
      }),
    );

    expect(response?.type).toBe(MessageTypes.TURN_EVENT);
    expect((response?.payload as any).spaceId).toBe("main-space");
    expect(executeTurnCalls).toEqual([
      ["main-space", "hello", undefined],
    ]);
  });

  test("marks execute_turn identity as guest for invite-joined participants", async () => {
    const executeTurnCalls: Array<[string, string, string | undefined, any]> = [];
    const router = makeRouter({
      spaceManager: {
        executeTurn: async (
          spaceId: string,
          input: string,
          targetAgentId?: string,
          identity?: { principalId?: string; deviceId?: string; executionOrigin?: string },
        ) => {
          executeTurnCalls.push([spaceId, input, targetAgentId, identity]);
          return { turnId: "turn-guest-origin" };
        },
        resumeFeedback: async () => {},
      },
      spaceSharingService: {
        evaluateAccess: () => ({ allowed: true, enforced: true, mode: "collaborator" }),
        getActiveParticipant: () => ({
          participantId: "participant-1",
          mode: "collaborator",
          joinedViaInviteId: "invite-123",
        }),
      },
    });

    const response = await router.handle(
      makeClient({ publicKey: "guest-principal", deviceId: "device-guest" }),
      makeMessage(MessageTypes.EXECUTE_TURN, {
        spaceUid: "main-space",
        input: "guest turn",
      }),
    );

    expect(response?.type).toBe(MessageTypes.TURN_EVENT);
    expect(executeTurnCalls).toEqual([
      [
        "main-space",
        "guest turn",
        undefined,
        { principalId: "guest-principal", deviceId: "device-guest", executionOrigin: "guest" },
      ],
    ]);
  });

  test("rejects execute_turn when spaceUid is blank after trimming", async () => {
    let called = false;
    const router = makeRouter({
      spaceManager: {
        executeTurn: async () => {
          called = true;
          return { turnId: "turn-should-not-run" };
        },
        resumeFeedback: async () => {},
      },
    });

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.EXECUTE_TURN, {
        spaceUid: "   ",
        input: "hello",
      }),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
    expect((response?.payload as any).message).toContain("spaceUid and input are required");
    expect(called).toBe(false);
  });

  test("normalizes resume_feedback identifiers before dispatch", async () => {
    const resumeFeedbackCalls: Array<[string, string, string, string | undefined]> = [];
    const router = makeRouter({
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-1" }),
        resumeFeedback: async (
          spaceId: string,
          turnId: string,
          response: string,
          revision?: string,
        ) => {
          resumeFeedbackCalls.push([spaceId, turnId, response, revision]);
        },
      },
    });

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.RESUME_FEEDBACK, {
        spaceUid: "  main-space  ",
        turnId: "  turn-1  ",
        response: "approve",
        revision: "  revise this  ",
      }),
    );

    expect(response?.type).toBe(MessageTypes.TURN_EVENT);
    expect((response?.payload as any).spaceId).toBe("main-space");
    expect((response?.payload as any).turnId).toBe("turn-1");
    expect(resumeFeedbackCalls).toEqual([
      ["main-space", "turn-1", "approve", "revise this"],
    ]);
  });

  test("rejects resume_feedback when spaceUid is blank after trimming", async () => {
    let called = false;
    const router = makeRouter({
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-1" }),
        resumeFeedback: async () => {
          called = true;
        },
      },
    });

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.RESUME_FEEDBACK, {
        spaceUid: "   ",
        turnId: "turn-1",
        response: "approve",
      }),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
    expect((response?.payload as any).message).toContain("spaceUid, turnId, and response are required");
    expect(called).toBe(false);
  });

  test("routes gateway.get_policy and gateway.update_policy", async () => {
    let updated = false;
    const router = makeRouter({
      gatewayPolicyService: {
        getPolicy: () => ({
          allowedCapabilityTypes: [],
          deniedCapabilityTypes: [],
          allowedSkillIds: [],
          deniedSkillIds: [],
          globalFlags: {},
          updatedAt: new Date().toISOString(),
        }),
        updatePolicy: (_patch: any) => {
          updated = true;
          return {
            allowedCapabilityTypes: ["calendar"],
            deniedCapabilityTypes: [],
            allowedSkillIds: [],
            deniedSkillIds: [],
            globalFlags: { crossSpaceRequiresApproval: true },
            updatedAt: new Date().toISOString(),
          };
        },
      },
    });

    const getResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.GATEWAY_GET_POLICY, {}),
    );
    expect(getResponse?.type).toBe(MessageTypes.GATEWAY_GET_POLICY);

    const updateResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.GATEWAY_UPDATE_POLICY, {
        globalFlags: { crossSpaceRequiresApproval: true },
      }),
    );

    expect(updateResponse?.type).toBe(MessageTypes.GATEWAY_UPDATE_POLICY);
    expect(updated).toBe(true);
  });

  test("routes gateway capability grant management for authenticated principal", async () => {
    const grants: any[] = [];
    const router = makeRouter({
      gatewayCapabilityAccessService: {
        listCapabilityGrants: () => grants,
        grantCapability: (input: any) => {
          const grant = {
            principalId: input.principalId,
            deviceId: input.deviceId ?? "device-1",
            capabilityId: "calendar.read",
            level: "read",
            source: "runtime_api",
            reason: input.reason ?? "",
            grantedBy: input.grantedBy,
            grantedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          grants.push(grant);
          return grant;
        },
        revokeCapability: () => ({
          revoked: true,
          capabilityId: "calendar.read",
          principalId: "principal-1",
          deviceId: "device-1",
        }),
      },
    });

    const listResponse = await router.handle(
      makeClient({ publicKey: "principal-1", deviceId: "device-1" }),
      makeMessage(MessageTypes.GATEWAY_LIST_CAPABILITY_GRANTS, {}),
    );
    expect(listResponse?.type).toBe(MessageTypes.GATEWAY_LIST_CAPABILITY_GRANTS);

    const grantResponse = await router.handle(
      makeClient({ publicKey: "principal-1", deviceId: "device-1" }),
      makeMessage(MessageTypes.GATEWAY_GRANT_CAPABILITY, {
        capabilityId: "calendar.read",
        reason: "Needed for agenda lookups.",
      }),
    );
    expect(grantResponse?.type).toBe(MessageTypes.GATEWAY_GRANT_CAPABILITY);
    expect((grantResponse?.payload as any).grant.capabilityId).toBe("calendar.read");

    const revokeResponse = await router.handle(
      makeClient({ publicKey: "principal-1", deviceId: "device-1" }),
      makeMessage(MessageTypes.GATEWAY_REVOKE_CAPABILITY, {
        capabilityId: "calendar.read",
      }),
    );
    expect(revokeResponse?.type).toBe(MessageTypes.GATEWAY_REVOKE_CAPABILITY);
    expect((revokeResponse?.payload as any).revoked).toBe(true);
  });

  test("rejects capability grant access for other principal", async () => {
    const router = makeRouter({
      gatewayCapabilityAccessService: {
        listCapabilityGrants: () => [],
        grantCapability: () => ({}),
        revokeCapability: () => ({
          revoked: false,
          capabilityId: "calendar.read",
          principalId: "other-principal",
          deviceId: "device-1",
        }),
      },
    });

    const response = await router.handle(
      makeClient({ publicKey: "principal-1", deviceId: "device-1" }),
      makeMessage(MessageTypes.GATEWAY_GRANT_CAPABILITY, {
        principalId: "other-principal",
        capabilityId: "calendar.read",
      }),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("PERMISSION_DENIED");
  });

  test("routes profile CRUD operations", async () => {
    const profile = {
      profileId: "profile-1",
      name: "Main Profile",
      description: "Test profile",
      personalityPrompt: "You are helpful.",
      defaultSkillIds: ["skill.one"],
      providerHint: "openai",
      modelHint: "openai/gpt-4.1",
      modelConfig: { preferredModels: ["openai/gpt-4.1"], fallbackModels: [] },
      canModerate: true,
      isDefault: false,
      status: "active",
      activeRevision: 2,
      source: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const router = makeRouter({
      profileAdminService: {
        createProfile: async () => ({ profile, created: true }),
        getProfile: async () => profile,
        listProfiles: async () => [profile],
        updateProfile: async () => ({ profile, newRevision: 2 }),
        archiveProfile: async () => ({ profile: { ...profile, status: "archived" }, archived: true }),
      },
    });

    const createResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.PROFILE_CREATE, {
        name: "Main Profile",
      }),
    );
    expect(createResponse?.type).toBe(MessageTypes.PROFILE_CREATE);

    const getResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.PROFILE_GET, {
        profileId: "profile-1",
      }),
    );
    expect(getResponse?.type).toBe(MessageTypes.PROFILE_GET);

    const listResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.PROFILE_LIST, {}),
    );
    expect(listResponse?.type).toBe(MessageTypes.PROFILE_LIST);
    expect((listResponse?.payload as any).profiles.length).toBe(1);

    const updateResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.PROFILE_UPDATE, {
        profileId: "profile-1",
        description: "Updated",
      }),
    );
    expect(updateResponse?.type).toBe(MessageTypes.PROFILE_UPDATE);
    expect((updateResponse?.payload as any).newRevision).toBe(2);

    const archiveResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.PROFILE_ARCHIVE, {
        profileId: "profile-1",
      }),
    );
    expect(archiveResponse?.type).toBe(MessageTypes.PROFILE_ARCHIVE);
    expect((archiveResponse?.payload as any).archived).toBe(true);
  });

  test("validates profile update model selection against merged existing profile state", async () => {
    const validations: Array<Record<string, unknown>> = [];
    const router = makeRouter({
      gatewayAdminService: {
        validateProfileModelSelection: (input: Record<string, unknown>) => {
          validations.push(input);
        },
      },
      profileAdminService: {
        getProfile: async () => ({
          profileId: "profile-1",
          providerHint: "openai",
          modelHint: "openai/gpt-4.1",
          modelConfig: { preferredModels: ["openai/gpt-4.1"], fallbackModels: [] },
        }),
        updateProfile: async () => ({
          profile: {
            profileId: "profile-1",
            name: "Main Profile",
            status: "active",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          newRevision: 2,
        }),
      },
    });

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.PROFILE_UPDATE, {
        profileId: "profile-1",
        providerHint: "anthropic",
      }),
    );

    expect(response?.type).toBe(MessageTypes.PROFILE_UPDATE);
    expect(validations).toEqual([{
      providerHint: "anthropic",
      modelHint: "openai/gpt-4.1",
      modelConfig: { preferredModels: ["openai/gpt-4.1"], fallbackModels: [] },
    }]);
  });

  test("routes orchestrator.command and orchestrator.get_command", async () => {
    const command = {
      commandId: "orch-1",
      correlationId: "corr-1",
      apiVersion: "v1",
      commandType: "create_room",
      targetSpaceId: "main-space",
      status: "completed",
      result: { created: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      events: [{
        status: "completed",
        event: { created: true },
        createdAt: new Date().toISOString(),
      }],
    };

    const broadcasts: GatewayMessage[] = [];
    const router = makeRouter({
      orchestratorCommandService: {
        submitCommand: async () => command,
        getCommand: () => command,
      },
      broadcastToSpace: (_spaceId: string, message: GatewayMessage) => {
        broadcasts.push(message);
      },
    });

    const submitResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.ORCHESTRATOR_COMMAND, {
        commandType: "create_room",
        targetSpaceId: "main-space",
      }),
    );
    expect(submitResponse?.type).toBe(MessageTypes.ORCHESTRATOR_COMMAND);
    expect(broadcasts.length).toBeGreaterThan(0);
    expect(broadcasts[0].type).toBe(MessageTypes.ORCHESTRATOR_EVENT);

    const getResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.ORCHESTRATOR_GET_COMMAND, {
        commandId: "orch-1",
      }),
    );
    expect(getResponse?.type).toBe(MessageTypes.ORCHESTRATOR_GET_COMMAND);
  });

  test("rejects orchestrator.command when targetSpaceId is missing", async () => {
    const router = makeRouter({
      orchestratorCommandService: {
        submitCommand: async () => {
          throw new Error("should not be reached");
        },
        getCommand: () => null,
      },
    });

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.ORCHESTRATOR_COMMAND, {
        commandType: "create_room",
      }),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
    expect((response?.payload as any).message).toContain("targetSpaceId");
  });

  test("rejects orchestrator.command when shared-space write access is denied", async () => {
    let submitCalled = false;
    const router = makeRouter({
      orchestratorCommandService: {
        submitCommand: async () => {
          submitCalled = true;
          return {
            commandId: "orch-denied",
            correlationId: "corr-denied",
            apiVersion: "v1",
            commandType: "create_room",
            targetSpaceId: "space-protected",
            status: "completed",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            events: [],
          };
        },
        getCommand: () => null,
      },
      spaceSharingService: {
        evaluateAccess: () => ({
          allowed: false,
          enforced: true,
          mode: "read_only",
          reason: "Read-only participant cannot perform write actions",
        }),
      },
    });

    const response = await router.handle(
      makeClient({ publicKey: "principal-read-only" }),
      makeMessage(MessageTypes.ORCHESTRATOR_COMMAND, {
        commandType: "create_room",
        targetSpaceId: "space-protected",
      }),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("PERMISSION_DENIED");
    expect((response?.payload as any).message).toContain("Read-only participant");
    expect(submitCalled).toBe(false);
  });

  test("routes cross-space context operations", async () => {
    const router = makeRouter({
      spaceContextService: {
        linkSpaces: () => ({
          sourceSpaceId: "s1",
          targetSpaceId: "s2",
          mode: "pull",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        unlinkSpaces: () => true,
        shareContext: () => ({
          transferId: "t1",
          sourceSpaceId: "s1",
          targetSpaceId: "s2",
          artifactId: "a1",
          status: "shared",
          createdAt: new Date().toISOString(),
        }),
        pullSharedContext: () => ({
          importedArtifacts: [{ sourceArtifactId: "a1", importedArtifactId: "a2" }],
          denied: [],
        }),
      },
    });

    const linkResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_LINK, {
        sourceSpaceId: "s1",
        targetSpaceId: "s2",
      }),
    );
    expect(linkResponse?.type).toBe(MessageTypes.SPACE_LINK);

    const shareResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_SHARE_CONTEXT, {
        sourceSpaceId: "s1",
        targetSpaceId: "s2",
        artifactId: "a1",
      }),
    );
    expect(shareResponse?.type).toBe(MessageTypes.SPACE_SHARE_CONTEXT);

    const pullResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_PULL_SHARED_CONTEXT, {
        sourceSpaceId: "s1",
        targetSpaceId: "s2",
      }),
    );
    expect(pullResponse?.type).toBe(MessageTypes.SPACE_PULL_SHARED_CONTEXT);
  });

  test("routes sync announce/query/pull", async () => {
    const router = makeRouter({
      gatewaySyncService: {
        announcePeer: () => ({
          peerId: "peer-1",
          resourceId: "resource-main",
          gatewayVersion: "v1",
          syncEnabled: true,
          announcedAt: new Date().toISOString(),
          apiVersion: "v2",
        }),
        queryResources: () => ({
          resources: [],
          nextCursor: undefined,
          apiVersion: "v2",
        }),
        pullResources: () => ({
          resources: [],
          denied: [],
          provenance: [],
          appliedCount: 0,
          skippedCount: 0,
          apiVersion: "v2",
        }),
      },
    });

    const announceResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SYNC_ANNOUNCE, {
        peerId: "peer-1",
        resourceId: "resource-main",
        gatewayVersion: "v1",
      }),
    );
    expect(announceResponse?.type).toBe(MessageTypes.SYNC_ANNOUNCE);

    const queryResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SYNC_QUERY_RESOURCES, {
        peerId: "peer-1",
      }),
    );
    expect(queryResponse?.type).toBe(MessageTypes.SYNC_QUERY_RESOURCES);

    const pullResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SYNC_PULL_RESOURCES, {
        peerId: "peer-1",
        idempotencyKey: "idem-1",
        refs: [],
      }),
    );
    expect(pullResponse?.type).toBe(MessageTypes.SYNC_PULL_RESOURCES);
  });

  test("routes speech session lifecycle and emits speech.event broadcast", async () => {
    const broadcasts: GatewayMessage[] = [];
    let startInput: any;
    const router = makeRouter({
      speechSessionService: {
        startSession: (input: any) => {
          startInput = input;
          return {
            sessionId: "speech-1",
            spaceId: "main-space",
            state: "running",
            eventType: "session_started",
            ts: new Date().toISOString(),
          };
        },
        appendAudioChunk: async () => [{
          sessionId: "speech-1",
          spaceId: "main-space",
          state: "running",
          eventType: "transcript_segment",
          transcript: "hello",
          sequence: 1,
          ts: new Date().toISOString(),
        }],
        control: () => ({
          sessionId: "speech-1",
          spaceId: "main-space",
          state: "ended",
          eventType: "session_control",
          reason: "done",
          ts: new Date().toISOString(),
        }),
      },
      broadcastToSpace: (_spaceId: string, message: GatewayMessage) => {
        broadcasts.push(message);
      },
    });

    const startResponse = await router.handle(
      makeClient({ publicKey: "principal-1", deviceId: "device-1" }),
      makeMessage(MessageTypes.SPEECH_START, {
        spaceId: "main-space",
      }),
    );
    expect(startResponse?.type).toBe(MessageTypes.SPEECH_START);
    expect(startInput.principalId).toBe("principal-1");
    expect(startInput.deviceId).toBe("device-1");

    const chunkResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPEECH_AUDIO_CHUNK, {
        sessionId: "speech-1",
        sequence: 1,
        audioBase64: "AAAA",
      }),
    );
    expect(chunkResponse?.type).toBe(MessageTypes.SPEECH_AUDIO_CHUNK);

    const controlResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPEECH_CONTROL, {
        sessionId: "speech-1",
        command: "end",
      }),
    );
    expect(controlResponse?.type).toBe(MessageTypes.SPEECH_CONTROL);
    expect(broadcasts.some((msg) => msg.type === MessageTypes.SPEECH_EVENT)).toBe(true);
    const speechBroadcast = broadcasts.find((msg) => {
      if (msg.type !== MessageTypes.SPEECH_EVENT) return false;
      const payload = msg.payload as SpeechEventPayload;
      return payload.eventType === "transcript_segment";
    });
    const payload = speechBroadcast?.payload as SpeechEventPayload | undefined;
    expect(payload?.emittedAt).toBeDefined();
    expect(payload?.sequenceNo).toBeDefined();
  });

  test("routes connector control-plane operations", async () => {
    const connector = {
      connectorId: "whatsapp-cloud:acct_deadbeef:support",
      familyId: "whatsapp-cloud",
      displayName: "Support",
      accountFingerprintHash: "deadbeef",
      labelSlug: "support",
      status: "active",
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const router = makeRouter({
      connectorAdminService: {
        listConnectorFamilies: () => [{
          familyId: "whatsapp-cloud",
          displayName: "WhatsApp",
          kind: "channel",
          runtime: "connector",
          trustClass: "external_only",
          embeddedEnabled: false,
          capabilityTypes: ["messaging", "notifications"],
          features: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
        listConnectors: () => [connector],
        upsertConnector: () => connector,
        removeConnector: () => ({ removed: true }),
        listConnectorBindings: () => [],
        upsertConnectorBinding: () => ({
          bindingId: "binding-1",
          connectorId: connector.connectorId,
          bindingType: "outbound_action",
          selector: {},
          targetType: "main_orchestrator",
          allowedActions: ["notify"],
          capabilityTypes: ["notifications"],
          priority: 100,
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        removeConnectorBinding: () => ({ removed: true }),
        getConnectorPolicy: () => ({
          scopeType: "global",
          scopeId: "*",
          requestsPerMinute: 60,
          burst: 60,
          disabled: false,
          updatedBy: "test",
          updatedAt: new Date().toISOString(),
        }),
        updateConnectorPolicy: () => ({
          scopeType: "global",
          scopeId: "*",
          requestsPerMinute: 60,
          burst: 60,
          disabled: false,
          updatedBy: "test",
          updatedAt: new Date().toISOString(),
        }),
        testConnector: () => ({
          ok: true,
          connector,
        }),
      },
    });

    const listFamilies = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.GATEWAY_LIST_CONNECTOR_FAMILIES, {}),
    );
    expect(listFamilies?.type).toBe(MessageTypes.GATEWAY_LIST_CONNECTOR_FAMILIES);

    const listConnectors = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.GATEWAY_LIST_CONNECTORS, {}),
    );
    expect(listConnectors?.type).toBe(MessageTypes.GATEWAY_LIST_CONNECTORS);

    const upsertConnector = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.GATEWAY_UPSERT_CONNECTOR, {
        familyId: "whatsapp-cloud",
        displayName: "Support",
        accountFingerprint: "acc",
        label: "Support",
      }),
    );
    expect(upsertConnector?.type).toBe(MessageTypes.GATEWAY_UPSERT_CONNECTOR);

    const testConnector = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.GATEWAY_TEST_CONNECTOR, {
        connectorId: connector.connectorId,
      }),
    );
    expect(testConnector?.type).toBe(MessageTypes.GATEWAY_TEST_CONNECTOR);
    expect((testConnector?.payload as any).ok).toBe(true);
  });

  test("rejects unknown capability types during adapter registration", async () => {
    const router = makeRouter();

    const response = await router.handle(
      makeClient({ clientType: "adapter" }),
      makeMessage(MessageTypes.CAPABILITIES_REGISTER, {
        providers: [{
          id: "provider-1",
          name: "Bad Provider",
          source: "adapter",
          capabilityType: "not_real",
          operations: ["ping"],
        }],
      }),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
    expect((response?.payload as any).message.toLowerCase()).toContain("unknown capability type");
  });

  test("preserves RATE_LIMITED error codes from routed services", async () => {
    const router = makeRouter({
      connectorAdminService: {
        listConnectors: () => {
          const error = new Error("Connector rate limit exceeded") as Error & { code?: string };
          error.code = "RATE_LIMITED";
          throw error;
        },
      },
    });

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.GATEWAY_LIST_CONNECTORS, {}),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("RATE_LIMITED");
    expect((response?.payload as any).message).toContain("rate limit");
  });

  test("preserves CIRCUIT_OPEN error codes from routed services", async () => {
    const router = makeRouter({
      connectorAdminService: {
        listConnectors: () => {
          const error = new Error("Connector circuit is open") as Error & { code?: string };
          error.code = "CIRCUIT_OPEN";
          throw error;
        },
      },
    });

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.GATEWAY_LIST_CONNECTORS, {}),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("CIRCUIT_OPEN");
    expect((response?.payload as any).message).toContain("circuit");
  });
});

function makeRouter(options: {
  spaceManager?: Record<string, unknown>;
  gatewayPolicyService?: Record<string, unknown>;
  gatewayCapabilityAccessService?: Record<string, unknown>;
  gatewayAdminService?: Record<string, unknown>;
  profileAdminService?: Record<string, unknown>;
  usageSnapshotService?: Record<string, unknown>;
  connectorAdminService?: Record<string, unknown>;
  orchestratorCommandService?: Record<string, unknown>;
  spaceSharingService?: Record<string, unknown>;
  spaceContextService?: Record<string, unknown>;
  gatewaySyncService?: Record<string, unknown>;
  speechSessionService?: Record<string, unknown>;
  broadcastToSpace?: (spaceId: string, message: GatewayMessage) => void;
} = {}): MessageRouter {
  const logger: any = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  const defaultSpaceManager: any = {
    executeTurn: async () => ({ turnId: "turn-1" }),
    resumeFeedback: async () => {},
  };

  return new MessageRouter({
    spaceManager: (options.spaceManager as any) ?? defaultSpaceManager,
    capabilities: {
      invoke: async () => ({ ok: true }),
      register: () => {},
      deregister: () => {},
    } as any,
    logger,
    gatewayAdminService: options.gatewayAdminService as any,
    gatewayPolicyService: options.gatewayPolicyService as any,
    gatewayCapabilityAccessService: options.gatewayCapabilityAccessService as any,
    profileAdminService: options.profileAdminService as any,
    usageSnapshotService: options.usageSnapshotService as any,
    connectorAdminService: options.connectorAdminService as any,
    orchestratorCommandService: options.orchestratorCommandService as any,
    spaceSharingService: options.spaceSharingService as any,
    spaceContextService: options.spaceContextService as any,
    gatewaySyncService: options.gatewaySyncService as any,
    speechSessionService: options.speechSessionService as any,
    broadcastToSpace: options.broadcastToSpace,
  });
}
