import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  initDatabase,
  WorkbenchArtifactRepository,
  WorkbenchBatchRepository,
  WorkbenchPolicyRepository,
  WorkbenchRunRepository,
  WorkbenchScenarioRunRepository,
} from "@spaceskit/persistence";
import { WorkbenchService, auditWorkbenchOpenBacklog, auditWorkbenchPlanningRepo } from "../src/services/workbench-service.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];
const tempDirs: string[] = [];
const PROJECT_SLUG = "spaces";
const TASK_IDS: Record<string, string> = {
  "td-workbench-autonomous.md": "spaces/T-0001",
  "td-workbench-independent.md": "spaces/T-0002",
  "td-workbench-conflict.md": "spaces/T-0003",
  "td-workbench-supervised.md": "spaces/T-0004",
  "td-workbench-review-only.md": "spaces/T-0005",
  "td-workbench-failing.md": "spaces/T-0006",
  "td-workbench-malformed.md": "spaces/T-0007",
  "td-workbench-missing-contract.md": "spaces/T-0008",
  "td-workbench-drifted-contract.md": "spaces/T-0009",
  "td-workbench-draft-contract.md": "spaces/T-0010",
  "td-open-unqueued.md": "spaces/T-0011",
  "td-open-missing-contract.md": "spaces/T-0012",
  "td-open-missing-metadata.md": "spaces/T-0013",
  "td-open-review-only.md": "spaces/T-0014",
  "done/td-closed.md": "spaces/T-0015",
};

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
  const workProjectsRoot = join(repoRoot, "Documents", "work", "projects");
  const tasksRoot = join(workProjectsRoot, PROJECT_SLUG, "tasks");
  mkdirSync(tasksRoot, { recursive: true });
  const taskId = TASK_IDS[fileName] ?? `spaces/T-${String(Object.keys(TASK_IDS).length + 1).padStart(4, "0")}`;
  const taskPath = join(tasksRoot, `${taskId.split("/")[1]}.md`);
  const goalId = fileName.replace(/\.md$/i, "");
  const centralStatus = status.toLowerCase() === "planned" ? "ready" : status.toLowerCase().replace(/\s+/g, "-");
  const autonomous = delegation === "autonomous" && aiShippable === "yes";
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
  writeFileSync(taskPath, `---
id: ${taskId}
title: "${goalId}"
status: ${centralStatus}
owner: agent
autonomous: ${autonomous ? "true" : "false"}
priority: medium
created: 2026-04-10
updated: 2026-04-10
depends-on: []
source-file: ${join(repoRoot, "_planning", "backlog", "tasks", fileName)}
spaces-item-type: TD
products: [${products}]
parallel: [${parallel}]
---

# Task: ${fileName.replace(/\.md$/i, "")}

Next action: Do the thing.

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
  const workProjectsRoot = join(repoRoot, "Documents", "work", "projects");
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
      "pwd >/dev/null",
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

  const runsRepository = new WorkbenchRunRepository(db.db);
  const service = new WorkbenchService({
    batches: new WorkbenchBatchRepository(db.db),
    runs: runsRepository,
    scenarioRuns: new WorkbenchScenarioRunRepository(db.db),
    artifacts: new WorkbenchArtifactRepository(db.db),
    policy: new WorkbenchPolicyRepository(db.db),
    repoRoot,
    workProjectsRoot,
    workbenchProjectSlug: PROJECT_SLUG,
    now: () => new Date(nowIso),
    logger: makeLogger(),
    workbenchExecutorAutostart: false,
    ...(options.serviceOverrides ?? {}),
  } as any);

  return {
    repoRoot,
    workProjectsRoot,
    service,
    runsRepository,
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
      "spaces/T-0001",
      "spaces/T-0002",
      "spaces/T-0003",
      "spaces/T-0004",
      "spaces/T-0005",
      "spaces/T-0006",
    ]);

    const autonomous = items[0]!;
    expect(autonomous.taskFilePath).toBe(join(repoRoot, "Documents", "work", "projects", "spaces", "tasks", "T-0001.md"));
    expect(autonomous.executionModeEligibility.autonomous).toBe(true);
    expect(autonomous.verificationMode).toBe("machine_readable");
    expect(autonomous.executionModeBlockers).toEqual([]);
    expect(autonomous.parallelKeys).toEqual(["gateway"]);
    expect(autonomous.verificationCommands).toEqual([
      "printf 'workbench-ok'",
      "pwd >/dev/null",
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

  test("accepts verification commands from frontmatter", async () => {
    const { service, repoRoot } = createHarness();
    const taskPath = join(repoRoot, "Documents", "work", "projects", "spaces", "tasks", "T-0016.md");
    writeFileSync(taskPath, `---
id: spaces/T-0016
title: "frontmatter verification task"
status: ready
owner: agent
autonomous: true
priority: medium
created: 2026-05-19
updated: 2026-05-19
depends-on: []
verification-commands: ["pnpm test", "pnpm typecheck"]
products: [gateway]
parallel: [independent]
---

# Task: frontmatter verification task

Next action: Execute the verified change.

## Metadata
- Status: Planned
- Owner: gateway
- Delegation: autonomous
- Parallel: independent
- AI-Shippable: yes
- Type: code

\`\`\`yaml goal_contract
schemaVersion: 1
goalId: T-0016
contractState: reviewed
owner: gateway
status: Planned
delegation: autonomous
aiShippable: true
products:
  - gateway
outcome: Do the thing.
scope:
  in:
    - Do the thing.
  out:
    - No out-of-scope work declared.
successCriteria:
  - Do the thing.
verification:
  commands:
    - pnpm test
    - pnpm typecheck
blockers: []
\`\`\`
`);

    const item = (await service.listQueue()).find((queueItem) => queueItem.queueItemId === "spaces/T-0016");

    expect(item?.verificationMode).toBe("machine_readable");
    expect(item?.verificationCommands).toEqual(["pnpm test", "pnpm typecheck"]);
    expect(item?.executionModeEligibility.autonomous).toBe(true);
  });

  test("rejects batch creation when selected queue items conflict on parallel keys", async () => {
    const { service } = createHarness();

    await expect(service.createBatch({
      principalId: "principal-owner",
      name: "Conflicting batch",
      queueItemIds: ["spaces/T-0001", "spaces/T-0003"],
      executionMode: "autonomous",
    })).rejects.toMatchObject({
      code: "FAILED_PRECONDITION",
    });

    const batch = await service.createBatch({
      principalId: "principal-owner",
      name: "Parallel-safe batch",
      queueItemIds: ["spaces/T-0001", "spaces/T-0002"],
      executionMode: "autonomous",
    });
    expect(batch.queueItemIds).toEqual([
      "spaces/T-0001",
      "spaces/T-0002",
    ]);
  });

  test("creates supervised runs with a worktree allocation, artifacts, and pending approval", async () => {
    const { service, repoRoot } = createHarness();

    const run = await service.startRun({
      principalId: "principal-owner",
      queueItemId: "spaces/T-0004",
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

  test("deduplicates retried Workbench run mutations by idempotency key", async () => {
    const records = new Map<string, {
      requestHash: string;
      responseType: string;
      responsePayload: string;
    }>();
    const { service } = createHarness("2026-04-10T12:00:00.000Z", {
      serviceOverrides: {
        loadIdempotencyRecord: async (principalId: string, endpoint: string, idempotencyKey: string) =>
          records.get(`${principalId}:${endpoint}:${idempotencyKey}`) ?? null,
        saveIdempotencyRecord: async (record: {
          principalId: string;
          endpoint: string;
          idempotencyKey: string;
          requestHash: string;
          responseType: string;
          responsePayload: string;
        }) => {
          records.set(`${record.principalId}:${record.endpoint}:${record.idempotencyKey}`, {
            requestHash: record.requestHash,
            responseType: record.responseType,
            responsePayload: record.responsePayload,
          });
        },
      },
    });

    const first = await service.startRun({
      principalId: "principal-owner",
      queueItemId: "spaces/T-0004",
      executionMode: "supervised",
      idempotencyKey: "concierge-workbench:request-1",
    });
    const replay = await service.startRun({
      principalId: "principal-owner",
      queueItemId: "spaces/T-0004",
      executionMode: "supervised",
      idempotencyKey: "concierge-workbench:request-1",
    });

    expect(replay.runId).toBe(first.runId);
    expect(await service.listRuns({ queueItemId: "spaces/T-0004" })).toHaveLength(1);
    await expect(service.startRun({
      principalId: "principal-owner",
      queueItemId: "spaces/T-0005",
      executionMode: "supervised",
      idempotencyKey: "concierge-workbench:request-1",
    })).rejects.toMatchObject({
      code: "FAILED_PRECONDITION",
    });
  });

  test("executes machine-readable verification commands for autonomous runs", async () => {
    const { service, repoRoot } = createHarness();

    const run = await service.startRun({
      principalId: "principal-owner",
      queueItemId: "spaces/T-0001",
      executionMode: "autonomous",
    });
    expect(run.status).toBe("queued");
    expect(run.currentStage).toBe("execute");

    const [completed] = await service.processQueuedRuns();
    expect(completed?.status).toBe("completed");
    expect(completed?.currentStage).toBe("report");
    expect(completed?.verificationResult?.status).toBe("passed");
    expect(completed?.verificationSuites.every((suite) => suite.status === "passed")).toBe(true);
    expect(completed?.verificationSuites.every((suite) => typeof suite.durationMs === "number")).toBe(true);
    expect(completed?.verificationSuites.every((suite) => suite.logArtifactId)).toBe(true);

    const artifacts = await service.listArtifacts({ runId: completed!.runId });
    const docsArtifact = artifacts.find((artifact) => artifact.kind === "docs");
    expect(docsArtifact?.contentText).toContain("Status: `not_available`");
    expect(artifacts.filter((artifact) => artifact.kind === "verification_log").length).toBe(completed!.verificationSuites.length);
    expect(artifacts.some((artifact) => artifact.contentText.includes("workbench-ok"))).toBe(true);
    const taskMarkdown = readFileSync(join(repoRoot, "Documents", "work", "projects", "spaces", "tasks", "T-0001.md"), "utf8");
    expect(taskMarkdown).toContain("status: review");
    expect(taskMarkdown).toContain(`Workbench run ${completed!.runId} completed verification and is ready for review.`);
  });

  test("cancels queued runs before the executor starts", async () => {
    const { service } = createHarness();

    const run = await service.startRun({
      principalId: "principal-owner",
      queueItemId: "spaces/T-0001",
      executionMode: "autonomous",
    });
    const cancelled = await service.cancelRun({
      principalId: "principal-owner",
      runId: run.runId,
    });
    const processed = await service.processQueuedRuns();

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.currentStage).toBe("report");
    expect(processed).toEqual([]);
  });

  test("cancels autostart timer before the executor starts", async () => {
    const executedRuns: string[] = [];
    const { service } = createHarness("2026-04-10T12:00:00.000Z", {
      serviceOverrides: {
        workbenchExecutorAutostart: true,
        workbenchExecutorAdapter: {
          run: async ({ runId }: { runId: string }) => {
            executedRuns.push(runId);
            throw new Error("executor should not start after cancellation");
          },
        },
      },
    });

    const run = await service.startRun({
      principalId: "principal-owner",
      queueItemId: "spaces/T-0001",
      executionMode: "autonomous",
    });
    await service.cancelRun({
      principalId: "principal-owner",
      runId: run.runId,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(executedRuns).toEqual([]);
  });

  test("aborts an active verification command when a run is cancelled", async () => {
    let started: (() => void) | undefined;
    const verificationStarted = new Promise<void>((resolveStarted) => {
      started = resolveStarted;
    });
    const { service } = createHarness("2026-04-10T12:00:00.000Z", {
      serviceOverrides: {
        verificationExecutor: async (options: any) => {
          started?.();
          return await new Promise((resolve) => {
            options.signal?.addEventListener("abort", () => {
              resolve(makeWorkbenchEvidence(options.command, "failed"));
            }, { once: true });
          });
        },
      },
    });

    const run = await service.startRun({
      principalId: "principal-owner",
      queueItemId: "spaces/T-0001",
      executionMode: "autonomous",
    });
    const processing = service.processQueuedRuns();
    await verificationStarted;

    const cancelled = await service.cancelRun({
      principalId: "principal-owner",
      runId: run.runId,
    });
    await processing;
    const persisted = await service.getRun({ runId: run.runId });

    expect(cancelled.status).toBe("cancelled");
    expect(persisted?.status).toBe("cancelled");
    expect(persisted?.currentStage).toBe("report");
  });

  test("marks interrupted active runs as failed during restart recovery", async () => {
    const { service, runsRepository } = createHarness();
    const run = await service.startRun({
      principalId: "principal-owner",
      queueItemId: "spaces/T-0001",
      executionMode: "autonomous",
    });
    runsRepository.update(run.runId, {
      status: "running",
      currentStage: "verify",
    });

    await service.recoverInterruptedRuns();
    const recovered = await service.getRun({ runId: run.runId });

    expect(recovered?.status).toBe("failed");
    expect(recovered?.currentStage).toBe("report");
    expect(recovered?.lastErrorCode).toBe("WORKBENCH_RUN_INTERRUPTED");
    expect(recovered?.verificationResult?.status).toBe("failed");
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
      queueItemId: "spaces/T-0001",
      executionMode: "autonomous",
    });
    const [completed] = await service.processQueuedRuns();

    expect(run.status).toBe("queued");
    expect(run.currentStage).toBe("execute");
    expect(completed?.status).toBe("completed");
    expect(completed?.currentStage).toBe("report");
    expect(completed?.executionContext).toEqual({
      spaceId: "workbench-space-1",
      spaceUid: "11111111-1111-4111-8111-111111111111",
      spaceName: "Workbench: spaces/T-0001",
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
      "plan-opencode-constraints",
      "plan-lmstudio-maintainer",
      "plan-apple-continuity",
      "code-lead",
      "code-opus-reviewer",
      "code-opencode-integrator",
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
        "plan-opencode-constraints",
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
        "code-opencode-integrator",
        "code-lmstudio-maintainer",
        "code-apple-continuity",
      ],
    });
    expect(executeTurnCalls[1].input).toContain("Edit only the allocated Workbench worktree");
    expect(executeTurnCalls[1].input).toContain(run.worktree!.path);
    expect(executeTurnCalls[1].input).toContain("printf 'workbench-ok'");
    expect(verificationCalls.map((call) => call.command)).toEqual([
      "printf 'workbench-ok'",
      "pwd >/dev/null",
    ]);

    const persisted = await service.getRun({ runId: run.runId });
    expect(persisted?.executionContext).toEqual(completed?.executionContext);
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
      queueItemId: "spaces/T-0001",
      executionMode: "autonomous",
    });
    const [failed] = await service.processQueuedRuns();

    expect(run.status).toBe("queued");
    expect(run.currentStage).toBe("execute");
    expect(failed?.status).toBe("failed");
    expect(failed?.currentStage).toBe("report");
    expect(failed?.lastErrorCode).toBe("AGENT_TURN_FAILED");
    expect(failed?.executionContext).toMatchObject({
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
      queueItemId: "spaces/T-0001",
      executionMode: "autonomous",
    });
    const [failed] = await service.processQueuedRuns();

    expect(run.status).toBe("queued");
    expect(run.currentStage).toBe("execute");
    expect(failed?.status).toBe("failed");
    expect(failed?.currentStage).toBe("report");
    expect(failed?.lastErrorCode).toBe("VERIFICATION_FAILED");
    expect(failed?.verificationResult?.status).toBe("failed");
    expect(failed?.verificationSuites[0]?.status).toBe("passed");
    expect(failed?.verificationSuites[1]?.status).toBe("failed");
    expect(failed?.executionContext).toMatchObject({
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
      queueItemId: "spaces/T-0001",
      executionMode: "autonomous",
    });
    const [completed] = await service.processQueuedRuns();

    const artifacts = await service.listArtifacts({ runId: completed!.runId });
    const docsArtifact = artifacts.find((artifact) => artifact.kind === "docs");
    expect(docsArtifact?.contentText).toContain("Status: `fresh`");
    expect(docsArtifact?.contentText).toContain("docs-fresh");
    expect(docsArtifact?.contentText).toContain("Blocking: `false`");

    const knowledgeArtifact = artifacts.find((artifact) => artifact.kind === "knowledge");
    expect(knowledgeArtifact?.title).toBe("Attached Generated Docs Knowledge");
    expect(knowledgeArtifact?.contentText).toContain("kb-spaces-generated-doc-protocol-reference");
    expect(knowledgeArtifact?.contentText).toContain("kb-spaces-generated-doc-config-reference");
    expect(knowledgeArtifact?.contentText).toContain("generated-docs");
  });

  test("reports runner capabilities and exposes gateway-owned scenario catalog", async () => {
    const { service } = createHarness("2026-04-10T12:00:00.000Z", {
      serviceOverrides: {
        runnerApiEnabled: true,
      },
    });

    const policy = await service.getPolicy();
    const catalog = await service.listScenarios();

    expect(policy.runnerAvailable).toBe(true);
    expect(policy.scenarioDiscoveryAvailable).toBe(true);
    expect(policy.supportedExecutionModes).toEqual(["supervised", "autonomous"]);
    expect(policy.supportedVerificationModes).toEqual(["machine_readable", "review_only"]);
    expect(catalog.layers.map((layer) => layer.layerId)).toContain("harness-smoke");
    expect(catalog.scenarios.map((scenario) => scenario.scenarioId)).toContain("harness.smoke.noop");
  });

  test("persists a completed deterministic scenario run and blocks start when runner API is disabled", async () => {
    const { service } = createHarness("2026-04-10T12:00:00.000Z", {
      serviceOverrides: {
        runnerApiEnabled: true,
      },
    });

    const run = await service.startScenarioRun({
      principalId: "principal-owner",
      config: {
        scenarioIds: ["harness.smoke.noop"],
      },
    });

    expect(run.status).toBe("completed");
    expect(run.overallStatus).toBe("passed");
    expect(run.config.scenarioIds).toEqual(["harness.smoke.noop"]);
    expect(run.summary).toContain("1 scenario passed");

    const persisted = await service.getScenarioRun({ scenarioRunId: run.scenarioRunId });
    expect(persisted?.scenarioRunId).toBe(run.scenarioRunId);
    expect((await service.listScenarioRuns()).map((entry) => entry.scenarioRunId)).toContain(run.scenarioRunId);

    const disabled = createHarness("2026-04-10T12:00:00.000Z", {
      serviceOverrides: {
        runnerApiEnabled: false,
      },
    }).service;
    await expect(disabled.startScenarioRun({
      principalId: "principal-owner",
      config: { scenarioIds: ["harness.smoke.noop"] },
    })).rejects.toMatchObject({
      code: "FAILED_PRECONDITION",
      message: "Workbench runner API is disabled",
    });
  });

  test("persists failing verification evidence", async () => {
    const { service, repoRoot } = createHarness();

    const run = await service.startRun({
      principalId: "principal-owner",
      queueItemId: "spaces/T-0006",
      executionMode: "autonomous",
    });
    const [failed] = await service.processQueuedRuns();

    expect(run.status).toBe("queued");
    expect(run.currentStage).toBe("execute");
    expect(failed?.status).toBe("failed");
    expect(failed?.currentStage).toBe("report");
    expect(failed?.lastErrorCode).toBe("VERIFICATION_FAILED");
    expect(failed?.verificationResult?.status).toBe("failed");
    expect(failed?.verificationSuites[0]?.status).toBe("failed");
    expect(failed?.verificationSuites[0]?.exitCode).toBe(7);

    const artifacts = await service.listArtifacts({ runId: run.runId });
    expect(artifacts.some((artifact) => artifact.kind === "verification_log" && artifact.contentText.includes("nope"))).toBe(true);
    const taskMarkdown = readFileSync(join(repoRoot, "Documents", "work", "projects", "spaces", "tasks", "T-0006.md"), "utf8");
    expect(taskMarkdown).toContain("status: blocked");
    expect(taskMarkdown).toContain(`Workbench run ${failed!.runId} failed verification: Verification 1.`);
  });

  test("blocks autonomous runs when queue metadata is not autonomy-eligible", async () => {
    const { service } = createHarness();

    await expect(service.startRun({
      principalId: "principal-owner",
      queueItemId: "spaces/T-0004",
      executionMode: "autonomous",
    })).rejects.toMatchObject({
      code: "FAILED_PRECONDITION",
      message: "Queue item is not AI-shippable: spaces/T-0004",
    });

    await expect(service.startRun({
      principalId: "principal-owner",
      queueItemId: "spaces/T-0005",
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
      queueItemIds: ["spaces/T-0001", "spaces/T-0005"],
      executionMode: "autonomous",
    })).rejects.toMatchObject({
      code: "FAILED_PRECONDITION",
      message: "No machine-readable verification declared.",
    });

    const run = await service.startRun({
      principalId: "principal-owner",
      queueItemId: "spaces/T-0005",
      executionMode: "supervised",
    });

    await expect(service.setMode({
      principalId: "principal-owner",
      runId: run.runId,
      executionMode: "autonomous",
    })).rejects.toMatchObject({
      code: "FAILED_PRECONDITION",
      message: "Task status is in-progress, not ready.",
    });
  });

  test("audits active planning queue for non-executable rows and missing machine-readable verification", () => {
    const { repoRoot, workProjectsRoot } = createHarness();
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

    const audit = auditWorkbenchPlanningRepo(repoRoot, { workProjectsRoot, projectSlug: "spaces", now: new Date("2026-04-10T12:00:00.000Z") });

    expect(audit.executableQueueItemCount).toBe(7);
    expect(audit.nonExecutableRows).toEqual([]);
    expect(audit.missingMachineReadableVerification.map((issue) => issue.taskFilePath)).toEqual([
      join(repoRoot, "Documents", "work", "projects", "spaces", "tasks", "T-0004.md"),
      join(repoRoot, "Documents", "work", "projects", "spaces", "tasks", "T-0005.md"),
      join(repoRoot, "Documents", "work", "projects", "spaces", "tasks", "T-0007.md"),
    ]);
    expect(audit.malformedVerificationBlocks).toEqual([
      {
        queueIndex: 7,
        queueItemId: "spaces/T-0007",
        taskFilePath: join(repoRoot, "Documents", "work", "projects", "spaces", "tasks", "T-0007.md"),
        message: "Machine-readable verification block is malformed.",
      },
    ]);
    expect(audit.goalContractErrors).toEqual([]);
    expect(audit.goalContractWarnings).toEqual([]);
  });

  test("audits active planning queue for missing, drifted, and draft goal contracts", () => {
    const { repoRoot, workProjectsRoot } = createHarness();
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

    const audit = auditWorkbenchPlanningRepo(repoRoot, { workProjectsRoot, projectSlug: "spaces", now: new Date("2026-04-10T12:00:00.000Z") });

    expect(audit.goalContractErrors).toEqual([]);
    expect(audit.goalContractWarnings).toEqual([
      {
        queueIndex: 9,
        queueItemId: "spaces/T-0010",
        taskFilePath: join(repoRoot, "Documents", "work", "projects", "spaces", "tasks", "T-0010.md"),
        message: "goal_contract is marked draft and needs human review.",
        code: "draft_contract",
      },
    ]);
  });

  test("audits open backlog tasks beyond the active queue", () => {
    const { repoRoot, workProjectsRoot } = createHarness();
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

    const audit = auditWorkbenchOpenBacklog(repoRoot, { workProjectsRoot, projectSlug: "spaces", now: new Date("2026-04-10T12:00:00.000Z") });

    expect(audit.openTaskCount).toBeGreaterThanOrEqual(10);
    expect(audit.unqueuedOpenTasks).toEqual([]);
    expect(audit.nonExecutableRows).toEqual([]);
    expect(audit.goalContractErrors.map((issue) => issue.queueItemId)).not.toContain("spaces/T-0012");
    expect(audit.missingExplicitDelegationMetadata).toEqual([]);
    expect(audit.missingExplicitAiShippableMetadata).toEqual([]);
    expect(audit.missingMachineReadableVerification.map((issue) => issue.queueItemId)).toContain("spaces/T-0014");
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

    expect(items.map((item) => item.queueItemId)).toContain("spaces/T-0001");
    expect(items.map((item) => item.queueItemId)).toContain("spaces/T-0004");
  });

});

describe("WorkbenchService multi-slug", () => {
  function writeSlugProjectFile(workProjectsRoot: string, slug: string, repoRoot: string | null) {
    mkdirSync(join(workProjectsRoot, slug), { recursive: true });
    writeFileSync(join(workProjectsRoot, slug, "project.md"), `---
slug: ${slug}
title: ${slug}
status: in-progress
${repoRoot ? `repo: ${repoRoot}/` : ""}
---

# ${slug}
`);
  }

  function writeSlugTask(workProjectsRoot: string, slug: string, taskNumber: string) {
    const tasksRoot = join(workProjectsRoot, slug, "tasks");
    mkdirSync(tasksRoot, { recursive: true });
    writeFileSync(join(tasksRoot, `${taskNumber}.md`), `---
id: ${slug}/${taskNumber}
title: "${slug} ${taskNumber}"
status: ready
owner: agent
autonomous: true
priority: medium
created: 2026-06-11
updated: 2026-06-11
depends-on: []
verification-commands: ["printf 'ok'"]
products: [${slug}]
parallel: [independent]
---

# Task: ${slug} ${taskNumber}

Next action: Do the ${slug} thing.
`);
  }

  function createSlugRepo(name: string): string {
    const base = mkdtempSync(join(tmpdir(), `spaces-workbench-${name}-`));
    tempDirs.push(base);
    const repoRoot = join(base, `${name}-repo`);
    mkdirSync(repoRoot, { recursive: true });
    writeFileSync(join(repoRoot, "README.md"), `# ${name}\n`);
    initializeGitRepository(repoRoot);
    return repoRoot;
  }

  test("default configuration keeps today's single-slug queue and stamps projectSlug", async () => {
    const { service } = createHarness();

    const items = await service.listQueue();

    expect(items).toHaveLength(6);
    expect(new Set(items.map((item) => item.projectSlug))).toEqual(new Set(["spaces"]));
    expect(items.every((item) => item.executionModeEligibility.supervised)).toBe(true);
    expect(items.flatMap((item) => item.executionModeBlockers)).not.toContain(
      "Project 'spaces' has no repo configured in project.md.",
    );
  });

  test("merges queue items across configured slugs in slug order", async () => {
    const { service, workProjectsRoot } = createHarness("2026-04-10T12:00:00.000Z", {
      serviceOverrides: { workbenchProjectSlugs: ["spaces", "beta"] },
    });
    const betaRepo = createSlugRepo("beta");
    writeSlugProjectFile(workProjectsRoot, "beta", betaRepo);
    writeSlugTask(workProjectsRoot, "beta", "T-0001");

    const items = await service.listQueue();

    expect(items.map((item) => item.queueItemId)).toEqual([
      "spaces/T-0001",
      "spaces/T-0002",
      "spaces/T-0003",
      "spaces/T-0004",
      "spaces/T-0005",
      "spaces/T-0006",
      "beta/T-0001",
    ]);
    expect(items.map((item) => item.queueIndex)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const betaItem = items.at(-1)!;
    expect(betaItem.projectSlug).toBe("beta");
    expect(betaItem.executionModeEligibility).toEqual({ supervised: true, autonomous: true });
    expect(betaItem.executionModeBlockers).toEqual([]);
  });

  test("keeps repo-less slugs visible in the queue but execution-blocked", async () => {
    const { service, workProjectsRoot } = createHarness("2026-04-10T12:00:00.000Z", {
      serviceOverrides: { workbenchProjectSlugs: ["spaces", "gamma"] },
    });
    writeSlugTask(workProjectsRoot, "gamma", "T-0001");

    const items = await service.listQueue();
    const gammaItem = items.find((item) => item.queueItemId === "gamma/T-0001")!;

    expect(gammaItem).toBeDefined();
    expect(gammaItem.projectSlug).toBe("gamma");
    expect(gammaItem.executionModeBlockers).toContain(
      "Project 'gamma' has no repo configured in project.md.",
    );
    expect(gammaItem.executionModeEligibility).toEqual({ supervised: false, autonomous: false });

    await expect(service.startRun({
      principalId: "principal-owner",
      queueItemId: "gamma/T-0001",
      executionMode: "supervised",
    })).rejects.toMatchObject({
      code: "FAILED_PRECONDITION",
      message: "Project 'gamma' has no repo configured in project.md.",
    });
    // The gate fired before any side effect: the task file stays ready.
    const taskContent = readFileSync(join(workProjectsRoot, "gamma", "tasks", "T-0001.md"), "utf8");
    expect(taskContent).toContain("status: ready");
  });

  test("cuts worktrees from the task slug's own repo and reports it in touchedRepos", async () => {
    const { service, repoRoot, workProjectsRoot } = createHarness("2026-04-10T12:00:00.000Z", {
      serviceOverrides: { workbenchProjectSlugs: ["spaces", "beta"] },
    });
    const betaRepo = createSlugRepo("beta");
    writeSlugProjectFile(workProjectsRoot, "beta", betaRepo);
    writeSlugTask(workProjectsRoot, "beta", "T-0001");

    const run = await service.startRun({
      principalId: "principal-owner",
      queueItemId: "beta/T-0001",
      executionMode: "supervised",
    });

    const expectedParent = join(dirname(betaRepo), ".spaceskit-workbench", "beta-repo");
    expect(run.worktree?.path.startsWith(expectedParent)).toBe(true);
    expect(existsSync(run.worktree!.path)).toBe(true);
    expect(run.worktree!.path.startsWith(repoRoot)).toBe(false);
    expect(run.touchedRepos).toHaveLength(1);
    expect(run.touchedRepos[0]!.repoId).toBe("beta-repo");
    expect(run.touchedRepos[0]!.repoPath.endsWith("beta-repo")).toBe(true);
  });

  test("'all' discovers every slug with a tasks directory, skipping _-prefixed ones", async () => {
    const { service, workProjectsRoot } = createHarness("2026-04-10T12:00:00.000Z", {
      serviceOverrides: { workbenchProjectSlugs: ["all"] },
    });
    const betaRepo = createSlugRepo("beta");
    writeSlugProjectFile(workProjectsRoot, "beta", betaRepo);
    writeSlugTask(workProjectsRoot, "beta", "T-0001");
    writeSlugTask(workProjectsRoot, "_archive", "T-0001");
    mkdirSync(join(workProjectsRoot, "no-tasks-here"), { recursive: true });

    const items = await service.listQueue();
    const slugs = new Set(items.map((item) => item.projectSlug));

    expect(slugs).toEqual(new Set(["beta", "spaces"]));
    expect(items[0]!.projectSlug).toBe("beta");
    expect(items.map((item) => item.queueItemId)).toContain("beta/T-0001");
    expect(items.map((item) => item.queueItemId)).not.toContain("_archive/T-0001");
  });

  test("legacy single-slug option still resolves as the only configured slug", async () => {
    const { service, workProjectsRoot } = createHarness("2026-04-10T12:00:00.000Z", {
      serviceOverrides: { workbenchProjectSlugs: [] },
    });
    writeSlugTask(workProjectsRoot, "beta", "T-0001");

    const items = await service.listQueue();

    expect(new Set(items.map((item) => item.projectSlug))).toEqual(new Set(["spaces"]));
  });
});
