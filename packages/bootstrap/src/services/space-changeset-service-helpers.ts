import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, copyFile, mkdir, readFile, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve as resolvePath, sep as pathSep } from "node:path";
import type {
  ChangeSetAdapter,
  ChangeSetReviewDecision,
  ChangeSetStatus,
  SpaceChangeSetFileRow,
  SpaceChangeSetRepository,
  SpaceChangeSetRow,
  SpaceParticipantRepository,
  SpaceRepository,
} from "@spaceskit/persistence";
import {
  normalizeOptional,
  normalizeParticipantMode,
  parseJsonRecord,
  resolveModeratorPrincipalIds,
} from "./space-changeset-service-normalizers.js";

export type SpaceChangeSetServiceErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "FAILED_PRECONDITION"
  | "PERMISSION_DENIED"
  | "QUOTA_EXCEEDED";

export class SpaceChangeSetServiceError extends Error {
  readonly code: SpaceChangeSetServiceErrorCode;

  constructor(code: SpaceChangeSetServiceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface PendingUpload {
  uploadId: string;
  spaceId: string;
  changeSetId: string;
  principalId: string;
  relativePath: string;
  stagedPath: string;
  createdAt: number;
}

export interface WorkspaceContext {
  spaceId: string;
  spaceUid: string;
  effectiveWorkspaceRoot: string;
  workPath: string;
}

export interface UploadContentInput {
  contentBase64?: string;
  sourcePath?: string;
}

export interface ChangeSetGitResult {
  attempted: boolean;
  commitMessage: string;
  commitHash?: string;
  warning?: string;
}

export type ChangeSetPrincipalRole = "owner" | "moderator" | "collaborator" | "read_only" | "none";

export interface ChangeSetAccessRepositories {
  spaces: SpaceRepository;
  participants: SpaceParticipantRepository;
  changeSets: SpaceChangeSetRepository;
}

export function normalizeDecision(value: ChangeSetReviewDecision): ChangeSetReviewDecision {
  if (value === "approved" || value === "rejected") return value;
  throw new SpaceChangeSetServiceError("INVALID_ARGUMENT", `Unsupported review decision: ${String(value)}`);
}

export function normalizeRequired(value: string | undefined, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new SpaceChangeSetServiceError("INVALID_ARGUMENT", `${field} is required`);
  }
  return normalized;
}

export function normalizeRelativePath(rawPath: string): string {
  const normalized = normalizeRequired(rawPath, "relativePath").replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.includes("\0")) {
    throw new SpaceChangeSetServiceError("INVALID_ARGUMENT", "relativePath must be relative");
  }
  const parts = normalized.split("/").filter((segment) => segment.length > 0);
  if (parts.length === 0) {
    throw new SpaceChangeSetServiceError("INVALID_ARGUMENT", "relativePath cannot be empty");
  }
  if (parts.some((segment) => segment === "..")) {
    throw new SpaceChangeSetServiceError("INVALID_ARGUMENT", "relativePath cannot traverse parent directories");
  }
  return parts.join("/");
}

export function resolveExpiresAtIso(now: Date, secondsRaw?: number): string | undefined {
  if (typeof secondsRaw !== "number" || !Number.isFinite(secondsRaw) || secondsRaw <= 0) {
    return undefined;
  }
  const seconds = Math.min(Math.floor(secondsRaw), 90 * 24 * 60 * 60);
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

export function resolveChangeSetStagingRoot(
  workspace: WorkspaceContext,
  participantId: string,
  changeSetId: string,
): string {
  return resolvePath(
    workspace.workPath,
    "staging",
    participantId,
    changeSetId,
  );
}

export async function resolveDefaultAdapter(workspaceRoot: string): Promise<ChangeSetAdapter> {
  const gitRoot = resolvePath(workspaceRoot, ".git");
  return await fileExists(gitRoot) ? "git" : "filesystem";
}

export function requireRoleForChangeSetAction(input: {
  repos: Pick<ChangeSetAccessRepositories, "spaces" | "participants">;
  spaceId: string;
  principalId: string;
  actionLabel: string;
  allowedRoles: ChangeSetPrincipalRole[];
}): ChangeSetPrincipalRole {
  const role = resolvePrincipalRole(input.repos, input.spaceId, input.principalId);
  if (input.allowedRoles.includes(role)) {
    return role;
  }

  throw new SpaceChangeSetServiceError(
    "PERMISSION_DENIED",
    `Principal role ${role} cannot ${input.actionLabel}; required: ${input.allowedRoles.join(" or ")}`,
  );
}

export function requireSpace(
  repos: Pick<ChangeSetAccessRepositories, "spaces">,
  spaceId: string,
): void {
  if (!repos.spaces.getById(spaceId)) {
    throw new SpaceChangeSetServiceError("NOT_FOUND", `Space not found: ${spaceId}`);
  }
}

export function requireSpaceChangeSet(
  repos: Pick<ChangeSetAccessRepositories, "spaces" | "changeSets">,
  spaceId: string,
  changeSetId: string,
): SpaceChangeSetRow {
  requireSpace(repos, spaceId);
  const row = repos.changeSets.getById(changeSetId);
  if (!row || row.space_id !== spaceId) {
    throw new SpaceChangeSetServiceError(
      "NOT_FOUND",
      `Changeset not found: ${changeSetId}`,
    );
  }
  return row;
}

export function requireOwnedOpenChangeSet(
  repos: Pick<ChangeSetAccessRepositories, "spaces" | "changeSets">,
  spaceId: string,
  changeSetId: string,
  principalId: string,
  allowedStatuses: ChangeSetStatus[],
): SpaceChangeSetRow {
  const row = requireSpaceChangeSet(repos, spaceId, changeSetId);
  if (row.created_by_principal_id !== principalId) {
    throw new SpaceChangeSetServiceError(
      "PERMISSION_DENIED",
      "Only the changeset creator can mutate this draft",
    );
  }
  if (!allowedStatuses.includes(row.status)) {
    throw new SpaceChangeSetServiceError(
      "FAILED_PRECONDITION",
      `Changeset ${changeSetId} is ${row.status}, expected ${allowedStatuses.join(" | ")}`,
    );
  }
  return row;
}

export function resolveParticipantId(
  participants: SpaceParticipantRepository,
  spaceId: string,
  principalId: string,
): string {
  const participant = participants.getActiveByPrincipal(spaceId, principalId);
  if (participant?.participant_id) {
    return participant.participant_id;
  }
  return `owner-${shortHash(principalId)}`;
}

function resolvePrincipalRole(
  repos: Pick<ChangeSetAccessRepositories, "spaces" | "participants">,
  spaceId: string,
  principalId: string,
): ChangeSetPrincipalRole {
  const activeCount = repos.participants.countActiveBySpace(spaceId);
  if (activeCount === 0) {
    return "owner";
  }

  const participant = repos.participants.getActiveByPrincipal(spaceId, principalId);
  if (!participant) {
    return "none";
  }

  const mode = normalizeParticipantMode(participant.mode);
  if (mode === "read_only") {
    return "read_only";
  }

  if (!participant.joined_via_invite_id) {
    return "owner";
  }

  if (isConfiguredChangeSetModerator(repos.spaces, spaceId, principalId)) {
    return "moderator";
  }

  return "collaborator";
}

function isConfiguredChangeSetModerator(
  spaces: SpaceRepository,
  spaceId: string,
  principalId: string,
): boolean {
  const row = spaces.getById(spaceId);
  if (!row?.space_config_json) return false;

  const parsed = parseJsonRecord(row.space_config_json);
  const configured = resolveModeratorPrincipalIds(parsed);
  if (configured.length === 0) return false;
  return configured.includes(principalId);
}

export async function readUploadContent(input: UploadContentInput): Promise<Buffer> {
  const sourcePath = normalizeOptional(input.sourcePath);
  const contentBase64 = normalizeOptional(input.contentBase64);
  if (sourcePath) {
    if (!isAbsolute(sourcePath)) {
      throw new SpaceChangeSetServiceError("INVALID_ARGUMENT", "sourcePath must be absolute");
    }
    return readFile(sourcePath);
  }
  if (!contentBase64) {
    throw new SpaceChangeSetServiceError(
      "INVALID_ARGUMENT",
      "Either contentBase64 or sourcePath must be provided",
    );
  }
  try {
    return Buffer.from(contentBase64, "base64");
  } catch {
    throw new SpaceChangeSetServiceError("INVALID_ARGUMENT", "Invalid base64 payload");
  }
}

export async function applyStagedChangeSetFiles(input: {
  workspace: WorkspaceContext;
  changeSetId: string;
  files: SpaceChangeSetFileRow[];
}): Promise<{ rollbackPath: string; appliedPaths: string[] }> {
  const rollbackPath = join(input.workspace.workPath, "rollback", input.changeSetId);
  const appliedPaths: string[] = [];
  await mkdir(rollbackPath, { recursive: true });

  for (const file of input.files) {
    const targetPath = resolvePath(input.workspace.effectiveWorkspaceRoot, file.relative_path);
    assertPathWithinRoot(targetPath, input.workspace.effectiveWorkspaceRoot, "workspace apply path");
    const rollbackFilePath = resolvePath(rollbackPath, file.relative_path);
    await mkdir(dirname(rollbackFilePath), { recursive: true });

    if (await fileExists(targetPath)) {
      await copyFile(targetPath, rollbackFilePath);
    }

    if (file.change_type === "deleted") {
      if (await fileExists(targetPath)) {
        await unlink(targetPath);
        appliedPaths.push(file.relative_path);
      }
      continue;
    }

    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(file.staged_path, targetPath);
    appliedPaths.push(file.relative_path);
  }

  return { rollbackPath, appliedPaths };
}

export async function generateFileDiff(
  workspace: WorkspaceContext,
  file: SpaceChangeSetFileRow,
): Promise<string> {
  const targetPath = resolvePath(workspace.effectiveWorkspaceRoot, file.relative_path);
  assertPathWithinRoot(targetPath, workspace.effectiveWorkspaceRoot, "diff target path");
  const left = (await fileExists(targetPath)) ? targetPath : "/dev/null";
  const right = file.change_type === "deleted" ? "/dev/null" : file.staged_path;
  const result = spawnSync("git", ["diff", "--no-index", "--", left, right], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status === 0 || result.status === 1) {
    return result.stdout.trim();
  }
  return [
    `diff --git a/${file.relative_path} b/${file.relative_path}`,
    `--- a/${file.relative_path}`,
    `+++ b/${file.relative_path}`,
    "@@ -0,0 +0,0 @@",
    `# failed to generate diff (${result.stderr.trim() || "unknown error"})`,
  ].join("\n");
}

export function tryGitCommit(input: {
  workspaceRoot: string;
  spaceUid: string;
  changeSetId: string;
  files: SpaceChangeSetFileRow[];
}): ChangeSetGitResult {
  const commitMessage = `spaces/${input.spaceUid}/${input.changeSetId}`;
  const filePaths = input.files.map((entry) => entry.relative_path).filter((entry) => entry.length > 0);
  const revParse = spawnSync("git", ["-C", input.workspaceRoot, "rev-parse", "--is-inside-work-tree"], {
    encoding: "utf8",
  });
  if (revParse.status !== 0) {
    return {
      attempted: false,
      commitMessage,
      warning: "Workspace is not a git worktree",
    };
  }

  if (filePaths.length === 0) {
    return { attempted: false, commitMessage, warning: "No file paths to commit" };
  }

  const add = spawnSync("git", ["-C", input.workspaceRoot, "add", "--", ...filePaths], {
    encoding: "utf8",
  });
  if (add.status !== 0) {
    return {
      attempted: true,
      commitMessage,
      warning: add.stderr.trim() || "git add failed",
    };
  }

  const commit = spawnSync(
    "git",
    ["-C", input.workspaceRoot, "commit", "--no-gpg-sign", "-m", commitMessage],
    { encoding: "utf8" },
  );
  if (commit.status !== 0) {
    return {
      attempted: true,
      commitMessage,
      warning: commit.stderr.trim() || "git commit failed",
    };
  }

  const hash = spawnSync("git", ["-C", input.workspaceRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  return {
    attempted: true,
    commitMessage,
    commitHash: hash.status === 0 ? hash.stdout.trim() : undefined,
  };
}

export function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function assertPathWithinRoot(targetPath: string, rootPath: string, label: string): void {
  const normalizedTarget = resolvePath(targetPath);
  const normalizedRoot = resolvePath(rootPath);
  if (
    normalizedTarget !== normalizedRoot
    && !normalizedTarget.startsWith(`${normalizedRoot}${pathSep}`)
  ) {
    throw new SpaceChangeSetServiceError(
      "PERMISSION_DENIED",
      `${label} escapes workspace root: ${targetPath}`,
    );
  }
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
