import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import type { WorkbenchQueueItemPayload, WorkbenchWorktreeRefPayload } from "@spaceskit/server";
import { WorkbenchServiceError, sanitizeSlug } from "./workbench-service-normalizers.js";

export function resolveWorkbenchGitRoot(repoRoot: string): string {
  const result = spawnSync("git", ["-C", repoRoot, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new WorkbenchServiceError("FAILED_PRECONDITION", `Repo root is not a git checkout: ${repoRoot}`);
  }
  return result.stdout.trim();
}

export function allocateWorkbenchWorktree(input: {
  repoRoot: string;
  worktreeParentRoot: string;
  queueItem: WorkbenchQueueItemPayload;
  runId: string;
  now: () => Date;
}): WorkbenchWorktreeRefPayload {
  const gitRoot = resolveWorkbenchGitRoot(input.repoRoot);
  const baseBranchName = resolveCurrentBranch(gitRoot);
  const slug = sanitizeSlug(input.queueItem.queueItemId.replace(/\.md$/i, ""));
  const branchName = `workbench/${slug}-${input.runId.slice(-8)}`;
  const worktreePath = resolve(input.worktreeParentRoot, `${slug}-${input.runId.slice(-8)}`);
  mkdirSync(dirname(worktreePath), { recursive: true });
  const result = spawnSync("git", ["-C", gitRoot, "worktree", "add", "-b", branchName, worktreePath, "HEAD"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new WorkbenchServiceError(
      "FAILED_PRECONDITION",
      `Failed to allocate worktree for ${input.queueItem.queueItemId}: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return {
    path: worktreePath,
    branchName,
    baseBranchName,
    createdAt: input.now().toISOString(),
  };
}

function resolveCurrentBranch(gitRoot: string): string {
  const result = spawnSync("git", ["-C", gitRoot, "branch", "--show-current"], {
    encoding: "utf8",
  });
  const branchName = result.status === 0 ? result.stdout.trim() : "";
  return branchName || "main";
}

