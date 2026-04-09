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
  spaceChangeSetService?: Record<string, unknown>;
  spaceQuotaService?: Record<string, unknown>;
  gatewayResetService?: Record<string, unknown>;
  spaceTurnTraceService?: Record<string, unknown>;
  spaceArtifactService?: Record<string, unknown>;
  memoryLifecycleService?: Record<string, unknown>;
  spaceToolPolicyService?: Record<string, unknown>;
  toolAccessPolicyService?: Record<string, unknown>;
  spaceSharingService?: Record<string, unknown>;
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
    capabilities: {
      invoke: async () => ({ ok: true }),
      register: () => {},
      deregister: () => {},
      getAvailableCapabilities: () => [],
      getProvidersForSpace: () => [],
    } as any,
    logger,
    spaceChangeSetService: options.spaceChangeSetService as any,
    spaceQuotaService: options.spaceQuotaService as any,
    gatewayResetService: options.gatewayResetService as any,
    spaceTurnTraceService: options.spaceTurnTraceService as any,
    spaceArtifactService: options.spaceArtifactService as any,
    memoryLifecycleService: options.memoryLifecycleService as any,
    spaceToolPolicyService: options.spaceToolPolicyService as any,
    toolAccessPolicyService: options.toolAccessPolicyService as any,
    spaceSharingService: options.spaceSharingService as any,
  });
}

describe("MessageRouter changeset/quota/tool handlers", () => {
  test("routes new collaboration and policy endpoints", async () => {
    let createInput: any = null;
    let uploadCompleteInput: any = null;
    let updateQuotaInput: any = null;
    let getDebugArtifactInput: any = null;

    const router = makeRouter({
      spaceSharingService: {
        evaluateAccess: () => ({ allowed: true, enforced: true, mode: "collaborator" }),
      },
      spaceChangeSetService: {
        createChangeSet: (input: unknown) => {
          createInput = input;
          return {
            changeSetId: "changeset-1",
            spaceId: "space-main",
            createdByPrincipalId: "principal-owner",
            status: "draft",
            adapter: "filesystem",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        },
        listChangeSets: () => [{
          changeSetId: "changeset-1",
          spaceId: "space-main",
          createdByPrincipalId: "principal-owner",
          status: "draft",
          adapter: "filesystem",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
        uploadFileInit: () => ({
          uploadId: "upload-1",
          changeSet: {
            changeSetId: "changeset-1",
            spaceId: "space-main",
            createdByPrincipalId: "principal-owner",
            status: "draft",
            adapter: "filesystem",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          relativePath: "docs/readme.md",
        }),
        uploadFileComplete: (input: unknown) => {
          uploadCompleteInput = input;
          return {
            changeSet: {
              changeSetId: "changeset-1",
              spaceId: "space-main",
              createdByPrincipalId: "principal-owner",
              status: "uploaded",
              adapter: "filesystem",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            file: {
              relativePath: "docs/readme.md",
              stagedPath: "/tmp/readme.md",
              sha256: "abc123",
              sizeBytes: 7,
              changeType: "added",
              createdAt: new Date().toISOString(),
            },
          };
        },
        submitChangeSet: () => ({
          changeSetId: "changeset-1",
          spaceId: "space-main",
          createdByPrincipalId: "principal-owner",
          status: "pending_review",
          adapter: "filesystem",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        reviewChangeSet: () => ({
          changeSet: {
            changeSetId: "changeset-1",
            spaceId: "space-main",
            createdByPrincipalId: "principal-owner",
            status: "approved",
            adapter: "filesystem",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          review: {
            reviewId: "review-1",
            changeSetId: "changeset-1",
            reviewerPrincipalId: "principal-reviewer",
            decision: "approved",
            createdAt: new Date().toISOString(),
          },
        }),
        applyChangeSet: () => ({
          changeSet: {
            changeSetId: "changeset-1",
            spaceId: "space-main",
            createdByPrincipalId: "principal-owner",
            status: "applied",
            adapter: "filesystem",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          result: {
            changeSetId: "changeset-1",
            adapter: "filesystem",
            appliedPaths: ["docs/readme.md"],
            rollbackPath: "/tmp/rollback",
          },
        }),
        getChangeSetDiff: () => ({
          changeSetId: "changeset-1",
          unifiedDiff: "diff --git",
          files: [],
          generatedAt: new Date().toISOString(),
        }),
      },
      spaceQuotaService: {
        getQuota: () => ({
          spacePolicy: {
            spaceId: "space-main",
            maxStagingBytes: 1,
            maxOpenChangeSets: 1,
            maxAppliedChangeSetsPerMonth: 1,
            tokenBudget: 0,
            maxParticipantStagingBytes: 1,
            maxUploadsPerDay: 1,
            maxOpenChangeSetsPerParticipant: 1,
            maxToolCallsPerHour: 1,
            updatedBy: "principal-owner",
            updatedAt: new Date().toISOString(),
          },
        }),
        updateQuotaPolicy: (input: unknown) => {
          updateQuotaInput = input;
          return {
            spaceId: "space-main",
            maxStagingBytes: 2,
            maxOpenChangeSets: 2,
            maxAppliedChangeSetsPerMonth: 2,
            tokenBudget: 0,
            maxParticipantStagingBytes: 2,
            maxUploadsPerDay: 2,
            maxOpenChangeSetsPerParticipant: 2,
            maxToolCallsPerHour: 2,
            updatedBy: "principal-owner",
            updatedAt: new Date().toISOString(),
          };
        },
        getUsage: () => ({
          spaceUsage: {
            spaceId: "space-main",
            stagingBytes: 0,
            openChangeSets: 0,
            appliedChangeSetsPerMonth: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            tokenSpendUsd: 0,
            updatedAt: new Date().toISOString(),
          },
        }),
        resetAgentUsageSession: () => ({
          activeSession: {
            sessionId: "aus-1",
            spaceId: "space-main",
            agentId: "agent-1",
            agentRole: "agent",
            status: "active",
            startedAt: new Date().toISOString(),
            lastActivityAt: new Date().toISOString(),
            turnCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            spentUsd: 0,
          },
        }),
      },
      toolAccessPolicyService: {
        getEffectiveToolAccess: () => ({
          spaceId: "space-main",
          policyVersion: "v1",
          dangerousCapabilities: [],
          operations: [],
          generatedAt: new Date().toISOString(),
        }),
      },
      spaceTurnTraceService: {
        listActivityLog: () => ({
          entries: [],
          total: 0,
        }),
        getTurnTrace: () => ({
          spaceId: "space-main",
          turnId: "turn-1",
          total: 0,
          events: [],
          toolCalls: [],
          activities: [],
          artifactIds: [],
        }),
      },
      memoryLifecycleService: {
        listExperiences: () => ({ experiences: [], total: 0 }),
        getExperience: () => ({ observations: [] }),
        listInsights: () => ({ insights: [], total: 0 }),
        getInsight: () => undefined,
        acceptInsight: () => undefined,
        rejectInsight: () => undefined,
        dismissInsight: () => undefined,
        getSpaceAgentNotes: () => ({ notes: [] }),
        updateSpaceAgentNotes: () => undefined,
        getUserProfile: () => ({
          principalId: "principal-owner",
          profile: {},
          updatedAt: new Date().toISOString(),
          source: "empty",
        }),
        updateUserProfile: () => ({
          principalId: "principal-owner",
          profile: {},
          updatedAt: new Date().toISOString(),
          source: "user_profiles",
        }),
        listMemories: async () => ({ memories: [], total: 0 }),
        deleteMemory: async () => ({ deleted: true }),
        updateMemoryImportance: async () => undefined,
      },
      spaceArtifactService: {
        listArtifacts: () => ({
          artifacts: [],
          total: 0,
        }),
        getArtifact: () => ({
          artifactId: "artifact-1",
          spaceId: "space-main",
          type: "summary",
          title: "Summary",
          sizeBytes: 0,
          tags: [],
          visibility: "shared",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          content: "x",
        }),
        getDebugArtifact: (input: unknown) => {
          getDebugArtifactInput = input;
          return {
            artifactId: "artifact-debug-1",
            spaceId: "space-main",
            type: "cli_execution_transcript",
            title: "CLI transcript",
            sizeBytes: 64,
            tags: ["debug", "cli_execution", "transcript"],
            visibility: "private",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            content: "{\"event\":\"started\"}\n",
          };
        },
      },
    });

    const create = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_CREATE_CHANGESET, {
        spaceId: "space-main",
        title: "hello",
      }),
    );
    expect(create?.type).toBe(MessageTypes.SPACE_CREATE_CHANGESET);
    expect(createInput.spaceId).toBe("space-main");
    expect(createInput.principalId).toBe("principal-owner");

    const list = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_LIST_CHANGESETS, {
        spaceId: "space-main",
      }),
    );
    expect(list?.type).toBe(MessageTypes.SPACE_LIST_CHANGESETS);

    const uploadComplete = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_UPLOAD_CHANGESET_FILE_COMPLETE, {
        spaceId: "space-main",
        changeSetId: "changeset-1",
        uploadId: "upload-1",
        contentBase64: "aGVsbG8=",
      }),
    );
    expect(uploadComplete?.type).toBe(MessageTypes.SPACE_UPLOAD_CHANGESET_FILE_COMPLETE);
    expect(uploadCompleteInput.uploadId).toBe("upload-1");

    const updateQuota = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_UPDATE_QUOTA_POLICY, {
        spaceId: "space-main",
        maxOpenChangeSets: 2,
      }),
    );
    expect(updateQuota?.type).toBe(MessageTypes.SPACE_UPDATE_QUOTA_POLICY);
    expect(updateQuotaInput.spaceId).toBe("space-main");
    expect(updateQuotaInput.updatedBy).toBe("principal-owner");

    const tools = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_GET_EFFECTIVE_TOOLS, {
        spaceId: "space-main",
      }),
    );
    expect(tools?.type).toBe(MessageTypes.SPACE_GET_EFFECTIVE_TOOLS);

    const toolAccess = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_GET_EFFECTIVE_TOOL_ACCESS, {
        spaceId: "space-main",
      }),
    );
    expect(toolAccess?.type).toBe(MessageTypes.SPACE_GET_EFFECTIVE_TOOL_ACCESS);

    const trace = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_GET_TURN_TRACE, {
        spaceId: "space-main",
        turnId: "turn-1",
      }),
    );
    expect(trace?.type).toBe(MessageTypes.SPACE_GET_TURN_TRACE);

    const activity = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_LIST_ACTIVITY_LOG, {
        spaceId: "space-main",
      }),
    );
    expect(activity?.type).toBe(MessageTypes.SPACE_LIST_ACTIVITY_LOG);
    expect((activity?.payload as any).spaceId).toBe("space-main");

    const listExperiences = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_LIST_EXPERIENCES, {
        spaceId: "space-main",
      }),
    );
    expect(listExperiences?.type).toBe(MessageTypes.SPACE_LIST_EXPERIENCES);

    const profile = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_GET_USER_PROFILE, {}),
    );
    expect(profile?.type).toBe(MessageTypes.SPACE_GET_USER_PROFILE);

    const listArtifacts = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_LIST_ARTIFACTS, {
        spaceId: "space-main",
      }),
    );
    expect(listArtifacts?.type).toBe(MessageTypes.SPACE_LIST_ARTIFACTS);

    const debugArtifact = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_GET_DEBUG_ARTIFACT, {
        spaceId: "space-main",
        artifactId: "artifact-debug-1",
      }),
    );
    expect(debugArtifact?.type).toBe(MessageTypes.SPACE_GET_DEBUG_ARTIFACT);
    expect(getDebugArtifactInput).toEqual({
      spaceId: "space-main",
      artifactId: "artifact-debug-1",
    });

    const resetUsage = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_RESET_AGENT_USAGE_SESSION, {
        spaceId: "space-main",
        agentId: "agent-1",
      }),
    );
    expect(resetUsage?.type).toBe(MessageTypes.SPACE_RESET_AGENT_USAGE_SESSION);
  });

  test("requires auth principal for write changeset actions", async () => {
    const router = makeRouter({
      spaceSharingService: {
        evaluateAccess: () => ({ allowed: true, enforced: true, mode: "collaborator" }),
      },
      spaceChangeSetService: {
        createChangeSet: () => ({}),
      },
    });

    const response = await router.handle(
      makeClient({ publicKey: undefined }),
      makeMessage(MessageTypes.SPACE_CREATE_CHANGESET, {
        spaceId: "space-main",
      }),
    );
    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("UNAUTHENTICATED");
  });

  test("routes space.reset with normalized payload and caller identity", async () => {
    let resetInput: any = null;

    const router = makeRouter({
      spaceSharingService: {
        evaluateAccess: () => ({ allowed: true, enforced: true, mode: "collaborator" }),
      },
      gatewayResetService: {
        resetSpace: (input: unknown) => {
          resetInput = input;
          return {
            spaceId: "space-main",
            resetAt: new Date().toISOString(),
            tablesCleared: 3,
            rowsDeleted: 9,
          };
        },
      },
    });

    const response = await router.handle(
      makeClient({ publicKey: "principal-owner", deviceId: "device-main" }),
      makeMessage(MessageTypes.SPACE_RESET, {
        spaceId: "  space-main  ",
        apiVersion: " 2026-03-02 ",
      }),
    );

    expect(response?.type).toBe(MessageTypes.SPACE_RESET);
    expect((response?.payload as any).spaceId).toBe("space-main");
    expect((response?.payload as any).rowsDeleted).toBe(9);
    expect(resetInput).toEqual({
      apiVersion: "2026-03-02",
      spaceId: "space-main",
      requestedBy: "principal-owner",
      requestedDeviceId: "device-main",
    });
  });

  test("denies space.reset when shared-space write access is rejected", async () => {
    let resetCalled = false;
    const router = makeRouter({
      spaceSharingService: {
        evaluateAccess: () => ({
          allowed: false,
          enforced: true,
          mode: "read_only",
          reason: "Read-only participant cannot reset this space",
        }),
      },
      gatewayResetService: {
        resetSpace: () => {
          resetCalled = true;
          return {
            spaceId: "space-main",
            resetAt: new Date().toISOString(),
            tablesCleared: 0,
            rowsDeleted: 0,
          };
        },
      },
    });

    const response = await router.handle(
      makeClient({ publicKey: "principal-read-only" }),
      makeMessage(MessageTypes.SPACE_RESET, {
        spaceId: "space-main",
      }),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("PERMISSION_DENIED");
    expect((response?.payload as any).message).toContain("Read-only participant");
    expect(resetCalled).toBe(false);
  });

  test("validates required spaceId for space.reset", async () => {
    let resetCalled = false;
    const router = makeRouter({
      gatewayResetService: {
        resetSpace: () => {
          resetCalled = true;
          return {
            spaceId: "space-main",
            resetAt: new Date().toISOString(),
            tablesCleared: 0,
            rowsDeleted: 0,
          };
        },
      },
    });

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_RESET, {
        spaceId: "   ",
      }),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
    expect((response?.payload as any).message).toContain("spaceId is required");
    expect(resetCalled).toBe(false);
  });

  test("requires an authenticated principal for space.reset", async () => {
    let resetCalled = false;
    const router = makeRouter({
      gatewayResetService: {
        resetSpace: () => {
          resetCalled = true;
          return {
            spaceId: "space-main",
            resetAt: new Date().toISOString(),
            tablesCleared: 0,
            rowsDeleted: 0,
          };
        },
      },
    });

    const response = await router.handle(
      makeClient({ publicKey: undefined }),
      makeMessage(MessageTypes.SPACE_RESET, {
        spaceId: "space-main",
      }),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("UNAUTHENTICATED");
    expect(resetCalled).toBe(false);
  });
});
