import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import {
  ParticipantQuotaPolicyRepository,
  ParticipantUsageCounterRepository,
  SpaceChangeSetFileRepository,
  SpaceChangeSetRepository,
  SpaceChangeSetReviewRepository,
  SpaceParticipantRepository,
  SpaceQuotaPolicyRepository,
  SpaceRepository,
  SpaceShareInviteRepository,
  SpaceResourceRepository,
  RunRepository,
  RunStepRepository,
  SpaceUsageCounterRepository,
  SpaceWorkspaceRepository,
  UsageRecordRepository,
  UsageAnalyticsRepository,
  AgentUsageSessionRepository,
  initDatabase,
} from "@spaceskit/persistence";
import { SpaceChangeSetService } from "../src/services/space-changeset-service.js";
import { SpaceQuotaService } from "../src/services/space-quota-service.js";
import { SpaceWorkspaceService } from "../src/services/space-workspace-service.js";

function createContext() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-space-changeset-${crypto.randomUUID()}`,
  });
  const spaces = new SpaceRepository(db.db);
  spaces.create({
    spaceId: "space-main",
    resourceId: "resource-main",
    spaceType: "space",
    name: "Main Space",
    goal: "",
    turnModel: "sequential_all",
    configJson: JSON.stringify({
      spaceUid: "22222222-2222-4222-8222-222222222222",
    }),
  });

  return {
    db,
    spaces,
    resources: new SpaceResourceRepository(db.db),
    workspaces: new SpaceWorkspaceRepository(db.db),
    invites: new SpaceShareInviteRepository(db.db),
    participants: new SpaceParticipantRepository(db.db),
    changeSets: new SpaceChangeSetRepository(db.db),
    changeSetFiles: new SpaceChangeSetFileRepository(db.db),
    changeSetReviews: new SpaceChangeSetReviewRepository(db.db),
    spaceQuotaPolicies: new SpaceQuotaPolicyRepository(db.db),
    participantQuotaPolicies: new ParticipantQuotaPolicyRepository(db.db),
    spaceUsageCounters: new SpaceUsageCounterRepository(db.db),
    participantUsageCounters: new ParticipantUsageCounterRepository(db.db),
    runs: new RunRepository(db.db),
    runSteps: new RunStepRepository(db.db),
    usageRecords: new UsageRecordRepository(db.db),
    usageAnalytics: new UsageAnalyticsRepository(db.db),
    agentUsageSessions: new AgentUsageSessionRepository(db.db),
  };
}

function createQuotaService(context: ReturnType<typeof createContext>): SpaceQuotaService {
  return new SpaceQuotaService({
    spaces: context.spaces,
    spaceQuotaPolicies: context.spaceQuotaPolicies,
    participantQuotaPolicies: context.participantQuotaPolicies,
    spaceUsageCounters: context.spaceUsageCounters,
    participantUsageCounters: context.participantUsageCounters,
    changeSets: context.changeSets,
    changeSetFiles: context.changeSetFiles,
    usageAnalytics: context.usageAnalytics,
    agentUsageSessions: context.agentUsageSessions,
  });
}

function recordAgentUsage(
  context: ReturnType<typeof createContext>,
  input: {
    runId: string;
    stepId: string;
    usageRecordId: string;
    agentId: string;
    createdAt: string;
    promptTokens: number;
    completionTokens: number;
  },
): void {
  context.runs.create({
    runId: input.runId,
    spaceId: "space-main",
    targetAgentId: input.agentId,
    createdAt: input.createdAt,
  });
  context.runSteps.create({
    stepId: input.stepId,
    runId: input.runId,
    spaceId: "space-main",
    agentId: input.agentId,
    kind: "model_invocation",
    status: "completed",
    providerId: "codex",
    modelId: "codex/gpt-5.1-codex",
    createdAt: input.createdAt,
  });
  context.usageRecords.create({
    usageRecordId: input.usageRecordId,
    runId: input.runId,
    stepId: input.stepId,
    spaceId: "space-main",
    providerId: "codex",
    modelId: "codex/gpt-5.1-codex",
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    totalTokens: input.promptTokens + input.completionTokens,
    tokenAccuracy: "reported",
    createdAt: input.createdAt,
  });
}

describe("SpaceChangeSetService", () => {
  test("supports create/upload/submit/review/apply lifecycle", async () => {
    const context = createContext();
    const tempRoot = await mkdtemp(join(tmpdir(), "spaceskit-changeset-lifecycle-"));
    try {
      const workspaceService = new SpaceWorkspaceService({
        spaces: context.spaces,
        resources: context.resources,
        workspaces: context.workspaces,
        spacesRoot: tempRoot,
      });
      const quotaService = new SpaceQuotaService({
        spaces: context.spaces,
        spaceQuotaPolicies: context.spaceQuotaPolicies,
        participantQuotaPolicies: context.participantQuotaPolicies,
        spaceUsageCounters: context.spaceUsageCounters,
        participantUsageCounters: context.participantUsageCounters,
        changeSets: context.changeSets,
        changeSetFiles: context.changeSetFiles,
        usageAnalytics: context.usageAnalytics,
        agentUsageSessions: context.agentUsageSessions,
      });
      const service = new SpaceChangeSetService({
        spaces: context.spaces,
        participants: context.participants,
        changeSets: context.changeSets,
        changeSetFiles: context.changeSetFiles,
        changeSetReviews: context.changeSetReviews,
        workspaceResolver: workspaceService,
        quotaService,
      });

      const changeSet = await service.createChangeSet({
        spaceId: "space-main",
        principalId: "principal-owner",
        title: "Draft docs update",
      });
      expect(changeSet.status).toBe("draft");

      const init = await service.uploadFileInit({
        spaceId: "space-main",
        changeSetId: changeSet.changeSetId,
        principalId: "principal-owner",
        relativePath: "docs/hello.txt",
      });
      expect(init.uploadId).toContain("upload-");

      const uploaded = await service.uploadFileComplete({
        spaceId: "space-main",
        changeSetId: changeSet.changeSetId,
        principalId: "principal-owner",
        uploadId: init.uploadId,
        contentBase64: Buffer.from("hello from staged file\n", "utf8").toString("base64"),
      });
      expect(uploaded.file.relativePath).toBe("docs/hello.txt");
      expect(uploaded.changeSet.status).toBe("uploaded");

      const submitted = service.submitChangeSet({
        spaceId: "space-main",
        changeSetId: changeSet.changeSetId,
        principalId: "principal-owner",
      });
      expect(submitted.status).toBe("pending_review");

      const diff = await service.getChangeSetDiff("space-main", changeSet.changeSetId);
      expect(diff.unifiedDiff).toContain("docs/hello.txt");

      const reviewed = await service.reviewChangeSet({
        spaceId: "space-main",
        changeSetId: changeSet.changeSetId,
        principalId: "principal-reviewer",
        decision: "approved",
      });
      expect(reviewed.changeSet.status).toBe("approved");
      expect(reviewed.review.decision).toBe("approved");

      const applied = await service.applyChangeSet({
        spaceId: "space-main",
        changeSetId: changeSet.changeSetId,
        principalId: "principal-reviewer",
      });
      expect(applied.changeSet.status).toBe("applied");
      expect(applied.result.appliedPaths).toContain("docs/hello.txt");

      const workspace = await workspaceService.ensureWorkspace("space-main");
      const content = await readFile(
        join(workspace.effectiveWorkspaceRoot, "docs", "hello.txt"),
        "utf8",
      );
      expect(content).toBe("hello from staged file\n");

      const usage = quotaService.getUsage("space-main", "principal-owner");
      expect(usage.spaceUsage.openChangeSets).toBe(0);
    } finally {
      context.db.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("reports agent usage only after the active usage-session boundary", () => {
    const context = createContext();
    try {
      const quotaService = createQuotaService(context);
      recordAgentUsage(context, {
        runId: "run-before-reset",
        stepId: "step-before-reset",
        usageRecordId: "usage-before-reset",
        agentId: "agent-main",
        createdAt: "2026-02-28T08:00:00.000Z",
        promptTokens: 100,
        completionTokens: 40,
      });

      context.agentUsageSessions.resetActive({
        spaceId: "space-main",
        agentId: "agent-main",
        resetBy: "principal-owner",
        nowIso: "2026-02-28T09:00:00.000Z",
      });

      recordAgentUsage(context, {
        runId: "run-after-reset",
        stepId: "step-after-reset",
        usageRecordId: "usage-after-reset",
        agentId: "agent-main",
        createdAt: "2026-02-28T09:05:00.000Z",
        promptTokens: 7,
        completionTokens: 3,
      });

      const usage = quotaService.getUsage("space-main", "principal-owner", {
        includeAgentSessions: true,
      });
      expect(usage.agentSessions?.length).toBe(1);
      expect(usage.agentSessions?.[0]?.agentId).toBe("agent-main");
      expect(usage.agentSessions?.[0]?.startedAt).toBe("2026-02-28T09:00:00.000Z");
      expect(usage.agentSessions?.[0]?.turnCount).toBe(1);
      expect(usage.agentSessions?.[0]?.inputTokens).toBe(7);
      expect(usage.agentSessions?.[0]?.outputTokens).toBe(3);
      expect(usage.agentSessions?.[0]?.totalTokens).toBe(10);
    } finally {
      context.db.close();
    }
  });

  test("keeps existing ledger usage when first creating an active agent session", () => {
    const context = createContext();
    try {
      const quotaService = createQuotaService(context);
      recordAgentUsage(context, {
        runId: "run-before-session-row",
        stepId: "step-before-session-row",
        usageRecordId: "usage-before-session-row",
        agentId: "agent-main",
        createdAt: "2026-02-28T08:00:00.000Z",
        promptTokens: 11,
        completionTokens: 4,
      });

      const usage = quotaService.getUsage("space-main", "principal-owner", {
        includeAgentSessions: true,
      });
      expect(usage.agentSessions?.length).toBe(1);
      expect(usage.agentSessions?.[0]?.startedAt).toBe("2026-02-28T08:00:00.000Z");
      expect(usage.agentSessions?.[0]?.turnCount).toBe(1);
      expect(usage.agentSessions?.[0]?.inputTokens).toBe(11);
      expect(usage.agentSessions?.[0]?.outputTokens).toBe(4);
      expect(usage.agentSessions?.[0]?.totalTokens).toBe(15);
    } finally {
      context.db.close();
    }
  });

  test("returns a zero-usage active agent session after reset before the next turn", () => {
    const context = createContext();
    try {
      const quotaService = createQuotaService(context);
      recordAgentUsage(context, {
        runId: "run-before-zero-reset",
        stepId: "step-before-zero-reset",
        usageRecordId: "usage-before-zero-reset",
        agentId: "agent-main",
        createdAt: "2026-02-28T08:00:00.000Z",
        promptTokens: 50,
        completionTokens: 20,
      });

      context.agentUsageSessions.resetActive({
        spaceId: "space-main",
        agentId: "agent-main",
        resetBy: "principal-owner",
        nowIso: "2026-02-28T09:00:00.000Z",
      });

      const usage = quotaService.getUsage("space-main", "principal-owner", {
        includeAgentSessions: true,
      });
      expect(usage.agentSessions?.length).toBe(1);
      expect(usage.agentSessions?.[0]?.agentId).toBe("agent-main");
      expect(usage.agentSessions?.[0]?.turnCount).toBe(0);
      expect(usage.agentSessions?.[0]?.inputTokens).toBe(0);
      expect(usage.agentSessions?.[0]?.outputTokens).toBe(0);
      expect(usage.agentSessions?.[0]?.totalTokens).toBe(0);
      expect(usage.agentSessions?.[0]?.lastActivityAt).toBe("2026-02-28T09:00:00.000Z");
    } finally {
      context.db.close();
    }
  });

  test("enforces open changeset quota", async () => {
    const context = createContext();
    const tempRoot = await mkdtemp(join(tmpdir(), "spaceskit-changeset-quota-"));
    try {
      const workspaceService = new SpaceWorkspaceService({
        spaces: context.spaces,
        resources: context.resources,
        workspaces: context.workspaces,
        spacesRoot: tempRoot,
      });
      const quotaService = new SpaceQuotaService({
        spaces: context.spaces,
        spaceQuotaPolicies: context.spaceQuotaPolicies,
        participantQuotaPolicies: context.participantQuotaPolicies,
        spaceUsageCounters: context.spaceUsageCounters,
        participantUsageCounters: context.participantUsageCounters,
        changeSets: context.changeSets,
        changeSetFiles: context.changeSetFiles,
        usageAnalytics: context.usageAnalytics,
        agentUsageSessions: context.agentUsageSessions,
      });
      quotaService.updateQuotaPolicy({
        spaceId: "space-main",
        updatedBy: "principal-owner",
        maxOpenChangeSets: 1,
      });

      const service = new SpaceChangeSetService({
        spaces: context.spaces,
        participants: context.participants,
        changeSets: context.changeSets,
        changeSetFiles: context.changeSetFiles,
        changeSetReviews: context.changeSetReviews,
        workspaceResolver: workspaceService,
        quotaService,
      });

      await service.createChangeSet({
        spaceId: "space-main",
        principalId: "principal-owner",
      });

      await expect(service.createChangeSet({
        spaceId: "space-main",
        principalId: "principal-owner",
      })).rejects.toThrow("quota exceeded");
    } finally {
      context.db.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("enforces shared-space role rules for review/apply and read-only restrictions", async () => {
    const context = createContext();
    const tempRoot = await mkdtemp(join(tmpdir(), "spaceskit-changeset-roles-"));
    try {
      const workspaceService = new SpaceWorkspaceService({
        spaces: context.spaces,
        resources: context.resources,
        workspaces: context.workspaces,
        spacesRoot: tempRoot,
      });
      const quotaService = new SpaceQuotaService({
        spaces: context.spaces,
        spaceQuotaPolicies: context.spaceQuotaPolicies,
        participantQuotaPolicies: context.participantQuotaPolicies,
        spaceUsageCounters: context.spaceUsageCounters,
        participantUsageCounters: context.participantUsageCounters,
        changeSets: context.changeSets,
        changeSetFiles: context.changeSetFiles,
        usageAnalytics: context.usageAnalytics,
        agentUsageSessions: context.agentUsageSessions,
      });
      const service = new SpaceChangeSetService({
        spaces: context.spaces,
        participants: context.participants,
        changeSets: context.changeSets,
        changeSetFiles: context.changeSetFiles,
        changeSetReviews: context.changeSetReviews,
        workspaceResolver: workspaceService,
        quotaService,
      });

      context.participants.upsert({
        participantId: "participant-owner",
        spaceId: "space-main",
        principalId: "principal-owner",
        mode: "collaborator",
      });
      context.invites.create({
        inviteId: "invite-collab-creator",
        spaceId: "space-main",
        issuedByPrincipalId: "principal-owner",
        mode: "collaborator",
        tokenHash: "hash-collab-creator",
      });
      context.invites.create({
        inviteId: "invite-collab-peer",
        spaceId: "space-main",
        issuedByPrincipalId: "principal-owner",
        mode: "collaborator",
        tokenHash: "hash-collab-peer",
      });
      context.invites.create({
        inviteId: "invite-readonly",
        spaceId: "space-main",
        issuedByPrincipalId: "principal-owner",
        mode: "read_only",
        tokenHash: "hash-readonly",
      });
      context.participants.upsert({
        participantId: "participant-collab-creator",
        spaceId: "space-main",
        principalId: "principal-collab-creator",
        mode: "collaborator",
        joinedViaInviteId: "invite-collab-creator",
      });
      context.participants.upsert({
        participantId: "participant-collab-peer",
        spaceId: "space-main",
        principalId: "principal-collab-peer",
        mode: "collaborator",
        joinedViaInviteId: "invite-collab-peer",
      });
      context.participants.upsert({
        participantId: "participant-readonly",
        spaceId: "space-main",
        principalId: "principal-readonly",
        mode: "read_only",
        joinedViaInviteId: "invite-readonly",
      });

      await expect(service.createChangeSet({
        spaceId: "space-main",
        principalId: "principal-readonly",
      })).rejects.toThrow("required: owner or moderator or collaborator");

      const changeSet = await service.createChangeSet({
        spaceId: "space-main",
        principalId: "principal-collab-creator",
        title: "Role checks",
      });
      const init = await service.uploadFileInit({
        spaceId: "space-main",
        changeSetId: changeSet.changeSetId,
        principalId: "principal-collab-creator",
        relativePath: "docs/roles.txt",
      });
      await service.uploadFileComplete({
        spaceId: "space-main",
        changeSetId: changeSet.changeSetId,
        principalId: "principal-collab-creator",
        uploadId: init.uploadId,
        contentBase64: Buffer.from("role-test\n", "utf8").toString("base64"),
      });
      service.submitChangeSet({
        spaceId: "space-main",
        changeSetId: changeSet.changeSetId,
        principalId: "principal-collab-creator",
      });

      await expect(service.reviewChangeSet({
        spaceId: "space-main",
        changeSetId: changeSet.changeSetId,
        principalId: "principal-collab-peer",
        decision: "approved",
      })).rejects.toThrow("required: owner or moderator");

      const reviewed = await service.reviewChangeSet({
        spaceId: "space-main",
        changeSetId: changeSet.changeSetId,
        principalId: "principal-owner",
        decision: "approved",
      });
      expect(reviewed.changeSet.status).toBe("approved");

      await expect(service.applyChangeSet({
        spaceId: "space-main",
        changeSetId: changeSet.changeSetId,
        principalId: "principal-collab-peer",
      })).rejects.toThrow("required: owner or moderator");

      const applied = await service.applyChangeSet({
        spaceId: "space-main",
        changeSetId: changeSet.changeSetId,
        principalId: "principal-owner",
      });
      expect(applied.changeSet.status).toBe("applied");

      context.spaces.updateConfig("space-main", JSON.stringify({
        spaceUid: "22222222-2222-4222-8222-222222222222",
        changeSetModerators: ["principal-collab-peer"],
      }));

      const moderatorChangeSet = await service.createChangeSet({
        spaceId: "space-main",
        principalId: "principal-collab-creator",
      });
      const moderatorInit = await service.uploadFileInit({
        spaceId: "space-main",
        changeSetId: moderatorChangeSet.changeSetId,
        principalId: "principal-collab-creator",
        relativePath: "docs/moderator.txt",
      });
      await service.uploadFileComplete({
        spaceId: "space-main",
        changeSetId: moderatorChangeSet.changeSetId,
        principalId: "principal-collab-creator",
        uploadId: moderatorInit.uploadId,
        contentBase64: Buffer.from("moderator\n", "utf8").toString("base64"),
      });
      service.submitChangeSet({
        spaceId: "space-main",
        changeSetId: moderatorChangeSet.changeSetId,
        principalId: "principal-collab-creator",
      });

      const moderatorReview = await service.reviewChangeSet({
        spaceId: "space-main",
        changeSetId: moderatorChangeSet.changeSetId,
        principalId: "principal-collab-peer",
        decision: "approved",
      });
      expect(moderatorReview.changeSet.status).toBe("approved");
    } finally {
      context.db.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
