import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  initDatabase,
  WorkbenchArtifactRepository,
  WorkbenchBatchRepository,
  WorkbenchPolicyRepository,
  WorkbenchRunRepository,
} from "@spaceskit/persistence";
import { WorkbenchService, auditWorkbenchOpenBacklog, auditWorkbenchPlanningRepo } from "../src/services/workbench-service.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function writePlanningTask(
  repoRoot: string,
  fileName: string,
  {
    status = "Planned",
    delegation = "supervised",
    parallel = "gateway",
    aiShippable = "no",
    products = "gateway",
    verificationCommands = [
      `cd gateway && bun test -- --grep "workbench"`,
      "cd gateway && bun run typecheck",
    ],
    malformedVerification = false,
    goalContract = "valid",
    includeDelegationMetadata = true,
    includeAiShippableMetadata = true,
  }: {
    status?: string;
    delegation?: string;
    parallel?: string;
    aiShippable?: string;
    products?: string;
    verificationCommands?: string[] | null;
    malformedVerification?: boolean;
    goalContract?: "valid" | "missing" | "draft" | "drifted";
    includeDelegationMetadata?: boolean;
    includeAiShippableMetadata?: boolean;
  } = {},
) {
  const taskPath = join(repoRoot, "_planning", "backlog", "tasks", fileName);
  const goalId = fileName.replace(/\.md$/i, "");
  const verificationSection = verificationCommands === null
    ? ""
    : malformedVerification
    ? `
## Verification Commands (Machine-Readable)
- describe the validation here
`
    : `
## Verification Commands (Machine-Readable)
${verificationCommands.map((command, index) => `${index + 1}. \`${command}\``).join("\n")}
`;
  const contractCommands = goalContract === "drifted"
    ? ["echo drifted-contract"]
    : verificationCommands ?? [];
  const goalContractSection = goalContract === "missing"
    ? ""
    : `
\`\`\`yaml goal_contract
schemaVersion: 1
goalId: ${goalId}
contractState: ${goalContract === "draft" ? "draft" : "reviewed"}
owner: gateway
status: ${status}
delegation: ${delegation}
aiShippable: ${aiShippable === "yes" ? "true" : "false"}
products:
${products.split(",").map((product) => `  - ${product.trim()}`).join("\n")}
outcome: Do the thing.
scope:
  in:
    - Do the thing.
  out:
    - No out-of-scope work declared.
successCriteria:
  - Do the thing.
verification:
${contractCommands.length > 0 ? `  commands:\n${contractCommands.map((command) => `    - ${command}`).join("\n")}` : "  commands: []"}
blockers: []
\`\`\`
`;
  writeFileSync(taskPath, `<!-- planning_classification: canonical -->
<!-- planning_last_reviewed: 2026-04-10 -->

# Task: ${fileName.replace(/\.md$/i, "")}

## Metadata
- Priority: P1
- Complexity: M(3)
- Status: ${status}
- Owner: gateway
${includeDelegationMetadata ? `- Delegation: ${delegation}\n` : ""}- Parallel: ${parallel}
${includeAiShippableMetadata ? `- AI-Shippable: ${aiShippable}\n` : ""}- Type: code

${goalContractSection}
## Cross-Product / Cross-Platform
- Products: ${products}
- Platforms: macOS

## Goal
- Do the thing.
${verificationSection}
`);
}

function writeUserStory(
  repoRoot: string,
  fileName: string,
  {
    status = "In Progress",
    scope = "gateway, spaces-mac-ios",
  }: {
    status?: string;
    scope?: string;
  } = {},
) {
  const storyDir = join(repoRoot, "_planning", "backlog", "user-stories");
  mkdirSync(storyDir, { recursive: true });
  const storyPath = join(storyDir, fileName);
  writeFileSync(storyPath, `<!-- planning_classification: canonical -->
<!-- planning_last_reviewed: 2026-04-10 -->

# ${fileName.replace(/\.md$/i, "")}

## Metadata
- Priority: P1
- Complexity: L(5)
- Status: ${status}
- Cross-Product Scope: ${scope}

## Story
- Story umbrella row for linked tasks.
`);
}

function initializeGitRepository(repoRoot: string) {
  runOrThrow(["git", "init", "--initial-branch=main"], repoRoot);
  runOrThrow(["git", "config", "user.email", "workbench@example.com"], repoRoot);
  runOrThrow(["git", "config", "user.name", "Workbench Test"], repoRoot);
  runOrThrow(["git", "add", "."], repoRoot);
  runOrThrow(["git", "commit", "-m", "Initial planning state"], repoRoot);
}

function createHarness(
  nowIso = "2026-04-10T12:00:00.000Z",
  options: { includeDocsCheck?: boolean; serviceOverrides?: Record<string, unknown> } = {},
) {
  const repoRoot = mkdtempSync(join(tmpdir(), "spaces-workbench-repo-"));
  tempDirs.push(repoRoot);
  mkdirSync(join(repoRoot, "_planning", "backlog", "tasks"), { recursive: true });
  writeFileSync(join(repoRoot, "_planning", "WHAT-TO-DO-NEXT.md"), `<!-- planning_classification: canonical -->
<!-- planning_last_reviewed: 2026-04-10 -->

# What To Do Next

## Active Queue

| # | Item | Type | Status | Next Action |
|---|---|---|---|---|
| 1 | \`td-workbench-autonomous.md\` | TD | Planned | Let the gateway self-build this slice |
| 2 | \`td-workbench-independent.md\` | TD | Planned | Run in parallel with non-overlapping work |
| 3 | \`td-workbench-conflict.md\` | TD | Planned | Conflicts with the gateway subsystem |
| 4 | \`td-workbench-supervised.md\` | TD | Review | Needs review before shipping |
| 5 | \`td-workbench-review-only.md\` | TD | Planned | Missing machine-readable verification on purpose |
| 6 | \`td-workbench-failing.md\` | TD | Planned | Persist failing command evidence |
`);
  writePlanningTask(repoRoot, "td-workbench-autonomous.md", {
    delegation: "autonomous",
    parallel: "gateway",
    aiShippable: "yes",
    products: "gateway",
    verificationCommands: [
      "printf 'workbench-ok'",
      "test -f _planning/WHAT-TO-DO-NEXT.md",
    ],
  });
  writePlanningTask(repoRoot, "td-workbench-independent.md", {
    delegation: "autonomous",
    parallel: "independent",
    aiShippable: "yes",
    products: "spaces-mac-ios",
  });
  writePlanningTask(repoRoot, "td-workbench-conflict.md", {
    delegation: "autonomous",
    parallel: "gateway",
    aiShippable: "yes",
    products: "gateway",
  });
  writePlanningTask(repoRoot, "td-workbench-supervised.md", {
    delegation: "supervised",
    parallel: "spaces-mac-ios",
    aiShippable: "no",
    products: "spaces-mac-ios",
    verificationCommands: null,
  });
  writePlanningTask(repoRoot, "td-workbench-review-only.md", {
    delegation: "autonomous",
    parallel: "independent",
    aiShippable: "yes",
    products: "gateway",
    verificationCommands: null,
  });
  writePlanningTask(repoRoot, "td-workbench-failing.md", {
    delegation: "autonomous",
    parallel: "independent",
    aiShippable: "yes",
    products: "gateway",
    verificationCommands: ["printf 'nope' >&2; exit 7"],
  });
  if (options.includeDocsCheck) {
    mkdirSync(join(repoRoot, "gateway"), { recursive: true });
    writeFileSync(
      join(repoRoot, "gateway", "package.json"),
      JSON.stringify({
        scripts: {
          "docs:check": "node -e \"process.stdout.write('docs-fresh')\"",
        },
      }),
    );
  }
  initializeGitRepository(repoRoot);

  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `workbench-service-${crypto.randomUUID()}`,
  });
  dbManagers.push(db);

  const service = new WorkbenchService({
    batches: new WorkbenchBatchRepository(db.db),
    runs: new WorkbenchRunRepository(db.db),
    artifacts: new WorkbenchArtifactRepository(db.db),
    policy: new WorkbenchPolicyRepository(db.db),
    repoRoot,
    now: () => new Date(nowIso),
    logger: makeLogger(),
    ...(options.serviceOverrides ?? {}),
  } as any);

  return {
    repoRoot,
    service,
  };
}

function makeLogger(): any {
  const logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
}

function runOrThrow(args: string[], cwd: string): void {
  const [command, ...rest] = args;
  const result = spawnSync(command, rest, {
    cwd,
    encoding: "utf8",
  });
  if (result.status === 0) return;
  throw new Error(`Command failed: ${args.join(" ")}\n${result.stderr}`);
}

function makeWorkbenchEvidence(command: string, status: "passed" | "failed" = "passed") {
  return {
    command,
    status,
    exitCode: status === "passed" ? 0 : 1,
    durationMs: 5,
    startedAt: "2026-04-10T12:00:00.000Z",
    completedAt: "2026-04-10T12:00:00.005Z",
    stdout: status === "passed" ? "ok" : "",
    stderr: status === "passed" ? "" : "nope",
    timedOut: false,
    summary: status === "passed" ? "Command exited with code 0." : "Command exited with code 1.",
  };
}

describe("WorkbenchService", () => {
  test("lists canonical planning queue items and extracts autonomy eligibility", async () => {
    const { service, repoRoot } = createHarness();

    const items = await service.listQueue();
    expect(items.map((item) => item.queueItemId)).toEqual([
      "td-workbench-autonomous.md",
      "td-workbench-independent.md",
      "td-workbench-conflict.md",
      "td-workbench-supervised.md",
      "td-workbench-review-only.md",
      "td-workbench-failing.md",
    ]);

    const autonomous = items[0]!;
    expect(autonomous.taskFilePath).toBe(join(repoRoot, "_planning", "backlog", "tasks", "td-workbench-autonomous.md"));
    expect(autonomous.executionModeEligibility.autonomous).toBe(true);
    expect(autonomous.verificationMode).toBe("machine_readable");
    expect(autonomous.executionModeBlockers).toEqual([]);
    expect(autonomous.parallelKeys).toEqual(["gateway"]);
    expect(autonomous.verificationCommands).toEqual([
      "printf 'workbench-ok'",
      "test -f _planning/WHAT-TO-DO-NEXT.md",
    ]);

    const supervised = items[3]!;
    expect(supervised.executionModeEligibility.autonomous).toBe(false);
    expect(supervised.delegation).toBe("supervised");

    const reviewOnly = items[4]!;
    expect(reviewOnly.executionModeEligibility.autonomous).toBe(false);
    expect(reviewOnly.delegation).toBe("autonomous");
    expect(reviewOnly.verificationMode).toBe("review_only");
    expect(reviewOnly.executionModeBlockers).toEqual([
      "No machine-readable verification declared.",
    ]);
  });

  test("rejects batch creation when selected queue items conflict on parallel keys", async () => {
    const { service } = createHarness();

    await expect(service.createBatch({
      principalId: "principal-owner",
      name: "Conflicting batch",
      queueItemIds: ["td-workbench-autonomous.md", "td-workbench-conflict.md"],
      executionMode: "autonomous",
    })).rejects.toMatchObject({
      code: "FAILED_PRECONDITION",
    });

    const batch = await service.createBatch({
      principalId: "principal-owner",
      name: "Parallel-safe batch",
      queueItemIds: ["td-workbench-autonomous.md", "td-workbench-independent.md"],
      executionMode: "autonomous",
    });
    expect(batch.queueItemIds).toEqual([
      "td-workbench-autonomous.md",
      "td-workbench-independent.md",
    ]);
  });

  test("creates supervised runs with a worktree allocation, artifacts, and pending approval", async () => {
    const { service, repoRoot } = createHarness();

    const run = await service.startRun({
      principalId: "principal-owner",
      queueItemId: "td-workbench-supervised.md",
      executionMode: "supervised",
    });

    expect(run.status).toBe("awaiting_review");
    expect(run.currentStage).toBe("review_gate");
    expect(run.approvalState).toBe("pending");
    expect(run.verificationMode).toBe("review_only");
    expect(run.executionModeBlockers).toContain("No machine-readable verification declared.");
    expect(run.worktree?.branchName).toContain("workbench/");
    expect(run.worktree?.path).toBeDefined();
    expect(existsSync(run.worktree!.path)).toBe(true);
    expect(run.worktree!.path.startsWith(repoRoot)).toBe(false);

    const artifacts = await service.listArtifacts({ runId: run.runId });
    expect(artifacts.map((artifact) => artifact.kind)).toEqual(["plan", "verification", "report"]);
    expect(artifacts[1]?.contentText).toContain("Mode: `review_only`");
  });

  test("executes machine-readable verification commands for autonomous runs", async () => {
    const { service } = createHarness();

    const run = await service.startRun({
      principalId: "principal-owner",
      queueItemId: "td-workbench-autonomous.md",
      executionMode: "autonomous",
    });

    expect(run.status).toBe("completed");
    expect(run.currentStage).toBe("report");
    expect(run.verificationResult?.status).toBe("passed");
    expect(run.verificationSuites.every((suite) => suite.status === "passed")).toBe(true);
    expect(run.verificationSuites.every((suite) => typeof suite.durationMs === "number")).toBe(true);
    expect(run.verificationSuites.every((suite) => suite.logArtifactId)).toBe(true);

    const artifacts = await service.listArtifacts({ runId: run.runId });
    const docsArtifact = artifacts.find((artifact) => artifact.kind === "docs");
    expect(docsArtifact?.contentText).toContain("Status: `not_available`");
    expect(artifacts.filter((artifact) => artifact.kind === "verification_log").length).toBe(run.verificationSuites.length);
    expect(artifacts.some((artifact) => artifact.contentText.includes("workbench-ok"))).toBe(true);
  });

  test("creates an execution space, runs planning and implementation turns, then verifies", async () => {
    const createdSpaces: any[] = [];
    const executeTurnCalls: any[] = [];
    const verificationCalls: any[] = [];
    const { service } = createHarness("2026-04-10T12:00:00.000Z", {
      serviceOverrides: {
        spaceAdminService: {
          createSpace: async (input: any) => {
            createdSpaces.push(input);
            return {
              id: "workbench-space-1",
              spaceUid: "11111111-1111-4111-8111-111111111111",
              name: input.name,
              resourceId: input.resourceId,
              turnModel: input.turnModel,
              turnModelConfig: input.turnModelConfig,
              conversationTopology: input.conversationTopology,
              agents: input.initialAgents ?? [],
              capabilities: [],
              capabilityOverrides: {},
              visibility: input.visibility ?? "shared",
              createdAt: new Date(),
              updatedAt: new Date(),
            };
          },
        },
        spaceManager: {
          executeTurn: async (
            spaceId: string,
            input: string,
            targetAgentId?: string,
            executionIdentity?: Record<string, unknown>,
          ) => {
            executeTurnCalls.push({ spaceId, input, targetAgentId, executionIdentity });
            return { turnId: executeTurnCalls.length === 1 ? "planning-turn-1" : "implementation-turn-1" };
          },
        },
        verificationExecutor: async (options: any) => {
          verificationCalls.push(options);
          return makeWorkbenchEvidence(options.command);
        },
      },
    });

    const run = await service.startRun({
      principalId: "principal-owner",
      queueItemId: "td-workbench-autonomous.md",
      executionMode: "autonomous",
    });

    expect(run.status).toBe("completed");
    expect(run.currentStage).toBe("report");
    expect(run.executionContext).toEqual({
      spaceId: "workbench-space-1",
      spaceUid: "11111111-1111-4111-8111-111111111111",
      spaceName: "Workbench: td-workbench-autonomous.md",
      planningTurnId: "planning-turn-1",
      implementationTurnId: "implementation-turn-1",
      stage: "completed",
    });
    expect(createdSpaces).toHaveLength(1);
    expect(createdSpaces[0].resourceId).toBe(run.worktree?.path);
    expect(createdSpaces[0].templateId).toBe("workbench/execution-loop");
    expect(createdSpaces[0].initialAgents.map((agent: any) => agent.agentId)).toEqual([
      "plan-coordinator",
      "plan-codex-architect",
      "plan-opus-reviewer",
      "plan-gemini-constraints",
      "plan-lmstudio-maintainer",
      "plan-apple-continuity",
      "code-lead",
      "code-opus-reviewer",
      "code-gemini-integrator",
      "code-lmstudio-maintainer",
      "code-apple-continuity",
    ]);
    expect(executeTurnCalls).toHaveLength(2);
    expect(executeTurnCalls[0].executionIdentity).toMatchObject({
      principalId: "principal-owner",
      executionOrigin: "system",
      mode: "plan",
      effort: "high",
      conversationTopology: "broadcast_team",
      targetAgentIds: [
        "plan-coordinator",
        "plan-codex-architect",
        "plan-opus-reviewer",
        "plan-gemini-constraints",
        "plan-lmstudio-maintainer",
        "plan-apple-continuity",
      ],
    });
    expect(executeTurnCalls[1].executionIdentity).toMatchObject({
      principalId: "principal-owner",
      executionOrigin: "system",
      mode: "execute",
      effort: "high",
      conversationTopology: "shared_team_chat",
      replyToTurnId: "planning-turn-1",
      targetAgentIds: [
        "code-lead",
        "code-opus-reviewer",
        "code-gemini-integrator",
        "code-lmstudio-maintainer",
        "code-apple-continuity",
      ],
    });
    expect(executeTurnCalls[1].input).toContain("Edit only the allocated Workbench worktree");
    expect(executeTurnCalls[1].input).toContain(run.worktree!.path);
    expect(executeTurnCalls[1].input).toContain("printf 'workbench-ok'");
    expect(verificationCalls.map((call) => call.command)).toEqual([
      "printf 'workbench-ok'",
      "test -f _planning/WHAT-TO-DO-NEXT.md",
    ]);

    const persisted = await service.getRun({ runId: run.runId });
    expect(persisted?.executionContext).toEqual(run.executionContext);
    const artifacts = await service.listArtifacts({ runId: run.runId });
    expect(artifacts.some((artifact) => artifact.title === "Agent Planning Turn" && artifact.contentText.includes("planning-turn-1"))).toBe(true);
  });

  test("fails the run when the planning turn fails before implementation", async () => {
    const executeTurnCalls: any[] = [];
    const verificationCalls: any[] = [];
    const { service } = createHarness("2026-04-10T12:00:00.000Z", {
      serviceOverrides: {
        spaceAdminService: {
          createSpace: async (input: any) => ({
            id: "workbench-space-failed-plan",
            spaceUid: "22222222-2222-4222-8222-222222222222",
            name: input.name,
            resourceId: input.resourceId,
            turnModel: input.turnModel,
            agents: input.initialAgents ?? [],
            capabilities: [],
            capabilityOverrides: {},
            visibility: "shared",
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        },
        spaceManager: {
          executeTurn: async (...args: any[]) => {
            executeTurnCalls.push(args);
            throw new Error("planning model unavailable");
          },
        },
        verificationExecutor: async (options: any) => {
          verificationCalls.push(options);
          return makeWorkbenchEvidence(options.command);
        },
      },
    });

    const run = await service.startRun({
      principalId: "principal-owner",
      queueItemId: "td-workbench-autonomous.md",
      executionMode: "autonomous",
    });

    expect(run.status).toBe("failed");
    expect(run.currentStage).toBe("report");
    expect(run.lastErrorCode).toBe("AGENT_TURN_FAILED");
    expect(run.executionContext).toMatchObject({
      spaceId: "workbench-space-failed-plan",
      stage: "failed",
    });
    expect(executeTurnCalls).toHaveLength(1);
    expect(verificationCalls).toHaveLength(0);
    const artifacts = await service.listArtifacts({ runId: run.runId });
    expect(artifacts.some((artifact) => artifact.title === "Agent Turn Failed" && artifact.contentText.includes("planning model unavailable"))).toBe(true);
  });

  test("persists failed verification evidence after implementation completes", async () => {
    const verificationCalls: any[] = [];
    const { service } = createHarness("2026-04-10T12:00:00.000Z", {
      serviceOverrides: {
        spaceAdminService: {
          createSpace: async (input: any) => ({
            id: "workbench-space-failed-verify",
            spaceUid: "33333333-3333-4333-8333-333333333333",
            name: input.name,
            resourceId: input.resourceId,
            turnModel: input.turnModel,
            agents: input.initialAgents ?? [],
            capabilities: [],
            capabilityOverrides: {},
            visibility: "shared",
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        },
        spaceManager: {
          executeTurn: async () => ({
            turnId: crypto.randomUUID(),
          }),
        },
        verificationExecutor: async (options: any) => {
          verificationCalls.push(options);
          return makeWorkbenchEvidence(options.command, verificationCalls.length === 2 ? "failed" : "passed");
        },
      },
    });

    const run = await service.startRun({
      principalId: "principal-owner",
      queueItemId: "td-workbench-autonomous.md",
      executionMode: "autonomous",
    });

    expect(run.status).toBe("failed");
    expect(run.currentStage).toBe("report");
    expect(run.lastErrorCode).toBe("VERIFICATION_FAILED");
    expect(run.verificationResult?.status).toBe("failed");
    expect(run.verificationSuites[0]?.status).toBe("passed");
    expect(run.verificationSuites[1]?.status).toBe("failed");
    expect(run.executionContext).toMatchObject({
      spaceId: "workbench-space-failed-verify",
      stage: "failed",
    });

    const artifacts = await service.listArtifacts({ runId: run.runId });
    expect(artifacts.filter((artifact) => artifact.kind === "verification_log")).toHaveLength(2);
    expect(artifacts.some((artifact) => artifact.kind === "verification_log" && artifact.contentText.includes("nope"))).toBe(true);
  });

  test("persists docs preflight evidence when a docs check is available", async () => {
    const { service } = createHarness("2026-04-10T12:00:00.000Z", { includeDocsCheck: true });

    const run = await service.startRun({
      principalId: "principal-owner",
      queueItemId: "td-workbench-autonomous.md",
      executionMode: "autonomous",
    });

    const artifacts = await service.listArtifacts({ runId: run.runId });
    const docsArtifact = artifacts.find((artifact) => artifact.kind === "docs");
    expect(docsArtifact?.contentText).toContain("Status: `fresh`");
    expect(docsArtifact?.contentText).toContain("docs-fresh");
    expect(docsArtifact?.contentText).toContain("Blocking: `false`");
  });

  test("persists failing verification evidence", async () => {
    const { service } = createHarness();

    const run = await service.startRun({
      principalId: "principal-owner",
      queueItemId: "td-workbench-failing.md",
      executionMode: "autonomous",
    });

    expect(run.status).toBe("failed");
    expect(run.currentStage).toBe("report");
    expect(run.lastErrorCode).toBe("VERIFICATION_FAILED");
    expect(run.verificationResult?.status).toBe("failed");
    expect(run.verificationSuites[0]?.status).toBe("failed");
    expect(run.verificationSuites[0]?.exitCode).toBe(7);

    const artifacts = await service.listArtifacts({ runId: run.runId });
    expect(artifacts.some((artifact) => artifact.kind === "verification_log" && artifact.contentText.includes("nope"))).toBe(true);
  });

  test("blocks autonomous runs when queue metadata is not autonomy-eligible", async () => {
    const { service } = createHarness();

    await expect(service.startRun({
      principalId: "principal-owner",
      queueItemId: "td-workbench-supervised.md",
      executionMode: "autonomous",
    })).rejects.toMatchObject({
      code: "FAILED_PRECONDITION",
      message: "Queue item is not AI-shippable: td-workbench-supervised.md",
    });

    await expect(service.startRun({
      principalId: "principal-owner",
      queueItemId: "td-workbench-review-only.md",
      executionMode: "autonomous",
    })).rejects.toMatchObject({
      code: "FAILED_PRECONDITION",
      message: "No machine-readable verification declared.",
    });
  });

  test("blocks autonomous batches and mode changes when any queue item is review-only", async () => {
    const { service } = createHarness();

    await expect(service.createBatch({
      principalId: "principal-owner",
      name: "Review only batch",
      queueItemIds: ["td-workbench-autonomous.md", "td-workbench-review-only.md"],
      executionMode: "autonomous",
    })).rejects.toMatchObject({
      code: "FAILED_PRECONDITION",
      message: "No machine-readable verification declared.",
    });

    const run = await service.startRun({
      principalId: "principal-owner",
      queueItemId: "td-workbench-review-only.md",
      executionMode: "supervised",
    });

    await expect(service.setMode({
      principalId: "principal-owner",
      runId: run.runId,
      executionMode: "autonomous",
    })).rejects.toMatchObject({
      code: "FAILED_PRECONDITION",
      message: "No machine-readable verification declared.",
    });
  });

  test("audits active planning queue for non-executable rows and missing machine-readable verification", () => {
    const { repoRoot } = createHarness();
    writeUserStory(repoRoot, "US-75-unified-rich-content-contract-and-rendering.md");
    writePlanningTask(repoRoot, "td-workbench-malformed.md", {
      delegation: "autonomous",
      aiShippable: "yes",
      malformedVerification: true,
    });
    writeFileSync(join(repoRoot, "_planning", "WHAT-TO-DO-NEXT.md"), `<!-- planning_classification: canonical -->
<!-- planning_last_reviewed: 2026-04-10 -->

# What To Do Next

## Active Queue

| # | Item | Type | Status | Next Action |
|---|---|---|---|---|
| 1 | \`US-75-unified-rich-content-contract-and-rendering.md\` | US-75 | In Progress | Track the umbrella row only |
| 2 | \`td-workbench-autonomous.md\` | TD | Planned | Let the gateway self-build this slice |
| 3 | \`td-workbench-supervised.md\` | TD | Review | Needs review before shipping |
| 4 | \`td-workbench-malformed.md\` | TD | Planned | Fix the malformed verification block |
| 5 | **UI polish batch** | Mixed | Planned | Group visual follow-up work |
`);

    const audit = auditWorkbenchPlanningRepo(repoRoot);

    expect(audit.executableQueueItemCount).toBe(3);
    expect(audit.nonExecutableRows.map((issue) => issue.queueItemId)).toEqual([
      "US-75-unified-rich-content-contract-and-rendering.md",
      "**UI polish batch**",
    ]);
    expect(audit.missingMachineReadableVerification.map((issue) => issue.taskFilePath)).toEqual([
      join(repoRoot, "_planning", "backlog", "tasks", "td-workbench-supervised.md"),
      join(repoRoot, "_planning", "backlog", "tasks", "td-workbench-malformed.md"),
    ]);
    expect(audit.malformedVerificationBlocks).toEqual([
      {
        queueIndex: 4,
        queueItemId: "td-workbench-malformed.md",
        taskFilePath: join(repoRoot, "_planning", "backlog", "tasks", "td-workbench-malformed.md"),
        message: "Machine-readable verification block is malformed.",
      },
    ]);
    expect(audit.goalContractErrors.map((issue) => issue.queueItemId)).toContain("td-workbench-malformed.md");
    expect(audit.goalContractWarnings).toEqual([]);
  });

  test("audits active planning queue for missing, drifted, and draft goal contracts", () => {
    const { repoRoot } = createHarness();
    writePlanningTask(repoRoot, "td-workbench-missing-contract.md", {
      delegation: "autonomous",
      aiShippable: "yes",
      goalContract: "missing",
    });
    writePlanningTask(repoRoot, "td-workbench-drifted-contract.md", {
      delegation: "autonomous",
      aiShippable: "yes",
      goalContract: "drifted",
    });
    writePlanningTask(repoRoot, "td-workbench-draft-contract.md", {
      delegation: "autonomous",
      aiShippable: "yes",
      goalContract: "draft",
    });
    writeFileSync(join(repoRoot, "_planning", "WHAT-TO-DO-NEXT.md"), `<!-- planning_classification: canonical -->
<!-- planning_last_reviewed: 2026-04-10 -->

# What To Do Next

## Active Queue

| # | Item | Type | Status | Next Action |
|---|---|---|---|---|
| 1 | \`td-workbench-missing-contract.md\` | TD | Planned | Add the contract |
| 2 | \`td-workbench-drifted-contract.md\` | TD | Planned | Fix drift |
| 3 | \`td-workbench-draft-contract.md\` | TD | Planned | Review draft |
`);

    const audit = auditWorkbenchPlanningRepo(repoRoot);

    expect(audit.goalContractErrors.map((issue) => issue.queueItemId)).toEqual([
      "td-workbench-missing-contract.md",
      "td-workbench-drifted-contract.md",
    ]);
    expect(audit.goalContractWarnings).toEqual([
      {
        queueIndex: 3,
        queueItemId: "td-workbench-draft-contract.md",
        taskFilePath: join(repoRoot, "_planning", "backlog", "tasks", "td-workbench-draft-contract.md"),
        message: "goal_contract is marked draft and needs human review.",
        code: "draft_contract",
      },
    ]);
  });

  test("audits open backlog tasks beyond the active queue", () => {
    const { repoRoot } = createHarness();
    writeUserStory(repoRoot, "US-75-unified-rich-content-contract-and-rendering.md");
    writePlanningTask(repoRoot, "td-open-unqueued.md");
    writePlanningTask(repoRoot, "td-open-missing-contract.md", {
      goalContract: "missing",
    });
    writePlanningTask(repoRoot, "td-open-missing-metadata.md", {
      includeDelegationMetadata: false,
      includeAiShippableMetadata: false,
    });
    writePlanningTask(repoRoot, "td-open-review-only.md", {
      verificationCommands: null,
    });
    mkdirSync(join(repoRoot, "_planning", "backlog", "tasks", "done"), { recursive: true });
    writeFileSync(join(repoRoot, "_planning", "backlog", "tasks", "README.md"), "# Tasks\n");
    writeFileSync(join(repoRoot, "_planning", "backlog", "tasks", "_TEMPLATE-task.md"), "# Template\n");
    writePlanningTask(repoRoot, "done/td-closed.md");
    writeFileSync(join(repoRoot, "_planning", "WHAT-TO-DO-NEXT.md"), `<!-- planning_classification: canonical -->
<!-- planning_last_reviewed: 2026-04-10 -->

# What To Do Next

## Active Queue

| # | Item | Type | Status | Next Action |
|---|---|---|---|---|
| 1 | \`td-workbench-autonomous.md\` | TD | Planned | Let the gateway self-build this slice |
| 2 | \`US-75-unified-rich-content-contract-and-rendering.md\` | US-75 | In Progress | Track the umbrella row only |
`);

    const audit = auditWorkbenchOpenBacklog(repoRoot);

    expect(audit.openTaskCount).toBe(10);
    expect(audit.unqueuedOpenTasks.map((issue) => issue.queueItemId)).toEqual([
      "td-open-missing-contract.md",
      "td-open-missing-metadata.md",
      "td-open-review-only.md",
      "td-open-unqueued.md",
      "td-workbench-conflict.md",
      "td-workbench-failing.md",
      "td-workbench-independent.md",
      "td-workbench-review-only.md",
      "td-workbench-supervised.md",
    ]);
    expect(audit.nonExecutableRows.map((issue) => issue.queueItemId)).toEqual([
      "US-75-unified-rich-content-contract-and-rendering.md",
    ]);
    expect(audit.goalContractErrors.map((issue) => issue.queueItemId)).toContain("td-open-missing-contract.md");
    expect(audit.missingExplicitDelegationMetadata.map((issue) => issue.queueItemId)).toEqual([
      "td-open-missing-metadata.md",
    ]);
    expect(audit.missingExplicitAiShippableMetadata.map((issue) => issue.queueItemId)).toEqual([
      "td-open-missing-metadata.md",
    ]);
    expect(audit.missingMachineReadableVerification.map((issue) => issue.queueItemId)).toContain("td-open-review-only.md");
  });

  test("skips story and grouping rows that are not executable task files", async () => {
    const { service, repoRoot } = createHarness();
    writeUserStory(repoRoot, "US-75-unified-rich-content-contract-and-rendering.md");
    writeFileSync(join(repoRoot, "_planning", "WHAT-TO-DO-NEXT.md"), `<!-- planning_classification: canonical -->
<!-- planning_last_reviewed: 2026-04-10 -->

# What To Do Next

## Active Queue

| # | Item | Type | Status | Next Action |
|---|---|---|---|---|
| 1 | \`US-75-unified-rich-content-contract-and-rendering.md\` | US-75 | In Progress | Track the umbrella row only |
| 2 | \`td-workbench-autonomous.md\` | TD | Planned | Let the gateway self-build this slice |
| 3 | **UI polish batch** | Mixed | Planned | Group visual follow-up work |
| 4 | \`td-workbench-supervised.md\` | TD | Review | Needs review before shipping |
`);

    const items = await service.listQueue();

    expect(items.map((item) => item.queueItemId)).toEqual([
      "td-workbench-autonomous.md",
      "td-workbench-supervised.md",
    ]);
  });

  test("repo-backed planning audit requires machine-readable verification for active executable queue items", () => {
    const repoRoot = resolve(import.meta.dir, "../../../..");

    const audit = auditWorkbenchPlanningRepo(repoRoot);

    expect(audit.executableQueueItemCount).toBeGreaterThan(0);
    expect(audit.missingMachineReadableVerification).toEqual([]);
    expect(audit.malformedVerificationBlocks).toEqual([]);
    expect(audit.goalContractErrors).toEqual([]);
  });
});
