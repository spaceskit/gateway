import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestClient, createTestGateway, E2E_TIMEOUT } from "./harness.js";

function writePlanningTask(
  repoRoot: string,
  fileName: string,
  {
    delegation = "autonomous",
    parallel = "gateway",
    aiShippable = "yes",
    products = "gateway",
    verificationCommands = ["cd gateway && bun run typecheck"],
  }: {
    delegation?: string;
    parallel?: string;
    aiShippable?: string;
    products?: string;
    verificationCommands?: string[] | null;
  } = {},
): void {
  const taskPath = join(repoRoot, "_planning", "backlog", "tasks", fileName);
  const goalId = fileName.replace(/\.md$/i, "");
  const verificationSection = verificationCommands === null
    ? ""
    : `
## Verification Commands (Machine-Readable)
${verificationCommands.map((command, index) => `${index + 1}. \`${command}\``).join("\n")}
`;
  const goalContractSection = `
\`\`\`yaml goal_contract
schemaVersion: 1
goalId: ${goalId}
contractState: reviewed
owner: gateway
status: In Progress
delegation: ${delegation}
aiShippable: ${aiShippable === "yes" ? "true" : "false"}
products:
${products.split(",").map((product) => `  - ${product.trim()}`).join("\n")}
outcome: Exercise the workbench control plane.
scope:
  in:
    - Exercise the workbench control plane.
  out:
    - Native app UI changes.
successCriteria:
  - Exercise the workbench control plane.
verification:
${verificationCommands && verificationCommands.length > 0 ? `  commands:\n${verificationCommands.map((command) => `    - ${command}`).join("\n")}` : "  commands: []"}
blockers: []
\`\`\`
`;
  writeFileSync(taskPath, `<!-- planning_classification: canonical -->
<!-- planning_last_reviewed: 2026-04-10 -->

# Task: ${fileName.replace(/\.md$/i, "")}

## Metadata
- Priority: P1
- Complexity: M(3)
- Status: In Progress
- Owner: gateway
- Delegation: ${delegation}
- Parallel: ${parallel}
- AI-Shippable: ${aiShippable}
- Type: code

${goalContractSection}
## Cross-Product / Cross-Platform
- Products: ${products}
- Platforms: macOS

## Goal
- Exercise the workbench control plane.
${verificationSection}
`);
}

function writeUserStory(repoRoot: string, fileName: string): void {
  const storyDir = join(repoRoot, "_planning", "backlog", "user-stories");
  mkdirSync(storyDir, { recursive: true });
  writeFileSync(join(storyDir, fileName), `<!-- planning_classification: canonical -->
<!-- planning_last_reviewed: 2026-04-10 -->

# ${fileName.replace(/\.md$/i, "")}

## Metadata
- Priority: P1
- Complexity: L(5)
- Status: In Progress

## Story
- Story umbrella row for linked tasks.
`);
}

function initializeGitRepository(repoRoot: string): void {
  runOrThrow(["git", "init", "--initial-branch=main"], repoRoot);
  runOrThrow(["git", "config", "user.email", "workbench@example.com"], repoRoot);
  runOrThrow(["git", "config", "user.name", "Workbench Test"], repoRoot);
  runOrThrow(["git", "add", "."], repoRoot);
  runOrThrow(["git", "commit", "-m", "Initial planning state"], repoRoot);
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

function createWorkbenchFixtureRepo(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "spaces-workbench-e2e-"));
  mkdirSync(join(repoRoot, "_planning", "backlog", "tasks"), { recursive: true });
  writeFileSync(join(repoRoot, "_planning", "WHAT-TO-DO-NEXT.md"), `<!-- planning_classification: canonical -->
<!-- planning_last_reviewed: 2026-04-10 -->

# What To Do Next

## Active Queue

| # | Item | Type | Status | Next Action |
|---|---|---|---|---|
| 1 | \`US-75-unified-rich-content-contract-and-rendering.md\` | US-75 | In Progress | Track the umbrella row only |
| 2 | \`td-workbench-verified.md\` | TD | In Progress | Start the verified run |
| 3 | \`td-workbench-review-only.md\` | TD | In Progress | Allow supervised review-only execution |
| 4 | **UI polish batch** | Mixed | Planned | Group the follow-up work |
| 5 | \`td-workbench-conflicting.md\` | TD | In Progress | Reject autonomous batch conflicts |
`);
  writePlanningTask(repoRoot, "td-workbench-verified.md", {
    delegation: "autonomous",
    parallel: "gateway",
    aiShippable: "yes",
    products: "gateway",
    verificationCommands: [
      "printf 'verified-e2e'",
      "test -f _planning/WHAT-TO-DO-NEXT.md",
    ],
  });
  writePlanningTask(repoRoot, "td-workbench-review-only.md", {
    delegation: "autonomous",
    parallel: "independent",
    aiShippable: "yes",
    products: "spaces-mac-ios",
    verificationCommands: null,
  });
  writePlanningTask(repoRoot, "td-workbench-conflicting.md", {
    delegation: "autonomous",
    parallel: "gateway",
    aiShippable: "yes",
    products: "gateway",
    verificationCommands: [
      "cd gateway && bun test ./packages/server/test/message-router.workbench.test.ts",
    ],
  });
  writeUserStory(repoRoot, "US-75-unified-rich-content-contract-and-rendering.md");
  initializeGitRepository(repoRoot);
  return repoRoot;
}

describe("external workbench control plane", () => {
  test("supports review-only gating, authenticated run control, and conflict-safe batches", {
    timeout: E2E_TIMEOUT,
  }, async () => {
    const repoRoot = createWorkbenchFixtureRepo();
    let gateway: Awaited<ReturnType<typeof createTestGateway>> | null = null;
    let client: Awaited<ReturnType<typeof createTestClient>> | null = null;

    try {
      gateway = await createTestGateway(undefined, {
        gatewayProfile: "external",
        env: {
          SPACESKIT_SECRET_REF_MASTER_KEY: "test-workbench-e2e-master-key",
          SPACESKIT_WORKBENCH_REPO_ROOT: repoRoot,
          SPACESKIT_WORKBENCH_AGENT_LOOP: "false",
        },
      });
      client = await createTestClient(gateway.wsUrl);

      const queue = await client.listWorkbenchQueue();
      expect(queue.map((item) => item.queueItemId)).toEqual([
        "td-workbench-verified.md",
        "td-workbench-review-only.md",
        "td-workbench-conflicting.md",
      ]);

      const verified = queue.find((item) => item.queueItemId === "td-workbench-verified.md");
      const reviewOnly = queue.find((item) => item.queueItemId === "td-workbench-review-only.md");
      expect(verified).toMatchObject({
        verificationMode: "machine_readable",
        executionModeBlockers: [],
      });
      expect(reviewOnly).toMatchObject({
        verificationMode: "review_only",
        executionModeBlockers: ["No machine-readable verification declared."],
      });

      const verifiedSupervisedRun = await client.startWorkbenchRun({
        queueItemId: "td-workbench-verified.md",
        executionMode: "supervised",
      });
      expect(verifiedSupervisedRun.verificationMode).toBe("machine_readable");

      const upgradedRun = await client.setWorkbenchMode({
        runId: verifiedSupervisedRun.runId,
        executionMode: "autonomous",
      });
      expect(upgradedRun.run?.executionMode).toBe("autonomous");

      const cancelledVerifiedRun = await client.cancelWorkbenchRun({
        runId: verifiedSupervisedRun.runId,
      });
      expect(cancelledVerifiedRun.status).toBe("cancelled");

      const reviewRun = await client.startWorkbenchRun({
        queueItemId: "td-workbench-review-only.md",
        executionMode: "supervised",
      });
      expect(reviewRun.verificationMode).toBe("review_only");
      expect(reviewRun.executionModeBlockers).toContain("No machine-readable verification declared.");
      expect(reviewRun.worktree?.path).toBeDefined();

      const fetchedReviewRun = await client.getWorkbenchRun({ runId: reviewRun.runId });
      expect(fetchedReviewRun.runId).toBe(reviewRun.runId);
      expect(fetchedReviewRun.verificationMode).toBe("review_only");

      const listedRuns = await client.listWorkbenchRuns();
      expect(listedRuns.map((run) => run.runId)).toContain(reviewRun.runId);

      const artifacts = await client.listWorkbenchArtifacts({ runId: reviewRun.runId });
      expect(artifacts.map((artifact) => artifact.kind)).toEqual(["plan", "verification", "report"]);
      expect(artifacts[1]?.contentText).toContain("Mode: `review_only`");

      await expect(client.setWorkbenchMode({
        runId: reviewRun.runId,
        executionMode: "autonomous",
      })).rejects.toThrow("No machine-readable verification declared");

      const rejectedReviewRun = await client.rejectWorkbenchStage({
        runId: reviewRun.runId,
        stage: "review_gate",
      });
      expect(rejectedReviewRun.approvalState).toBe("rejected");
      expect(rejectedReviewRun.status).toBe("cancelled");

      const approvedReviewRun = await client.startWorkbenchRun({
        queueItemId: "td-workbench-review-only.md",
        executionMode: "supervised",
      });
      const approvedAfterGate = await client.approveWorkbenchStage({
        runId: approvedReviewRun.runId,
        stage: "review_gate",
      });
      expect(approvedAfterGate.approvalState).toBe("approved");
      expect(approvedAfterGate.currentStage).toBe("execute");

      await expect(client.startWorkbenchRun({
        queueItemId: "td-workbench-review-only.md",
        executionMode: "autonomous",
      })).rejects.toThrow("No machine-readable verification declared");

      const autonomousVerifiedRun = await client.startWorkbenchRun({
        queueItemId: "td-workbench-verified.md",
        executionMode: "autonomous",
      });
      expect(autonomousVerifiedRun.executionMode).toBe("autonomous");
      expect(autonomousVerifiedRun.approvalState).toBe("not_required");
      expect(autonomousVerifiedRun.status).toBe("completed");
      expect(autonomousVerifiedRun.currentStage).toBe("report");
      expect(autonomousVerifiedRun.verificationResult?.status).toBe("passed");
      expect(autonomousVerifiedRun.verificationSuites.every((suite) => suite.status === "passed")).toBe(true);
      expect(autonomousVerifiedRun.verificationSuites.every((suite) => suite.logArtifactId)).toBe(true);

      const autonomousArtifacts = await client.listWorkbenchArtifacts({ runId: autonomousVerifiedRun.runId });
      expect(autonomousArtifacts.find((artifact) => artifact.kind === "docs")?.contentText).toContain("Status: `not_available`");
      expect(autonomousArtifacts.some((artifact) =>
        artifact.kind === "verification_log" && artifact.contentText.includes("verified-e2e"),
      )).toBe(true);

      await expect(client.createWorkbenchBatch({
        name: "Conflicting autonomous batch",
        queueItemIds: ["td-workbench-verified.md", "td-workbench-conflicting.md"],
        executionMode: "autonomous",
      })).rejects.toThrow("Queue items conflict and cannot share a batch");

      await expect(client.createWorkbenchBatch({
        name: "Review-only autonomous batch",
        queueItemIds: ["td-workbench-verified.md", "td-workbench-review-only.md"],
        executionMode: "autonomous",
      })).rejects.toThrow("No machine-readable verification declared");

      const supervisedBatch = await client.createWorkbenchBatch({
        name: "Supervised mixed batch",
        queueItemIds: ["td-workbench-verified.md", "td-workbench-review-only.md"],
        executionMode: "supervised",
      });
      expect(supervisedBatch.executionMode).toBe("supervised");
      expect(supervisedBatch.queueItemIds).toEqual([
        "td-workbench-verified.md",
        "td-workbench-review-only.md",
      ]);

      await expect(client.setWorkbenchMode({
        batchId: supervisedBatch.batchId,
        executionMode: "autonomous",
      })).rejects.toThrow("No machine-readable verification declared");
    } finally {
      try {
        await client?.disconnect();
      } catch {}
      try {
        await gateway?.cleanup();
      } catch {}
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
