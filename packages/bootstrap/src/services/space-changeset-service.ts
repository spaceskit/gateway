import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, copyFile, mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve as resolvePath, sep as pathSep } from "node:path";
import {
  SpaceChangeSetFileRepository,
  SpaceChangeSetRepository,
  SpaceChangeSetReviewRepository,
  SpaceParticipantRepository,
  SpaceRepository,
  type ChangeSetAdapter,
  type ChangeSetReviewDecision,
  type ChangeSetStatus,
  type SpaceParticipantRow,
  type SpaceChangeSetFileRow,
  type SpaceChangeSetRow,
} from "@spaceskit/persistence";
import { SpaceQuotaService, SpaceQuotaServiceError } from "./space-quota-service.js";
import {
  mapChangeSet,
  mapChangeSetFile,
  mapChangeSetReview,
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

export interface ChangeSet {
  changeSetId: string;
  spaceId: string;
  participantId?: string;
  createdByPrincipalId: string;
  status: ChangeSetStatus;
  title?: string;
  description?: string;
  adapter: ChangeSetAdapter;
  targetBranch?: string;
  workspaceBasePath?: string;
  submittedAt?: string;
  reviewedAt?: string;
  appliedAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeSetFile {
  relativePath: string;
  stagedPath: string;
  sha256: string;
  sizeBytes: number;
  changeType: "added" | "modified" | "deleted";
  createdAt: string;
}

export interface ChangeSetReview {
  reviewId: string;
  changeSetId: string;
  reviewerPrincipalId: string;
  decision: ChangeSetReviewDecision;
  comment?: string;
  diffSummary?: Record<string, unknown>;
  createdAt: string;
}

export interface ChangeSetApplyResult {
  changeSetId: string;
  adapter: ChangeSetAdapter;
  appliedPaths: string[];
  rollbackPath: string;
  git?: {
    attempted: boolean;
    commitMessage: string;
    commitHash?: string;
    warning?: string;
  };
}

export interface ChangeSetDiffResult {
  changeSetId: string;
  unifiedDiff: string;
  files: Array<{
    relativePath: string;
    changeType: string;
    sizeBytes: number;
  }>;
  generatedAt: string;
}

export interface CreateChangeSetInput {
  spaceId: string;
  principalId: string;
  title?: string;
  description?: string;
  adapter?: ChangeSetAdapter;
  targetBranch?: string;
  expiresInSeconds?: number;
}

export interface ListChangeSetsInput {
  spaceId: string;
  principalId: string;
  statuses?: ChangeSetStatus[];
  limit?: number;
  offset?: number;
}

export interface UploadChangeSetFileInitInput {
  spaceId: string;
  changeSetId: string;
  principalId: string;
  relativePath: string;
}

export interface UploadChangeSetFileCompleteInput {
  spaceId: string;
  changeSetId: string;
  principalId: string;
  uploadId: string;
  contentBase64?: string;
  sourcePath?: string;
  expectedSha256?: string;
}

export interface SubmitChangeSetInput {
  spaceId: string;
  changeSetId: string;
  principalId: string;
}

export interface ReviewChangeSetInput {
  spaceId: string;
  changeSetId: string;
  principalId: string;
  decision: ChangeSetReviewDecision;
  comment?: string;
}

export interface ApplyChangeSetInput {
  spaceId: string;
  changeSetId: string;
  principalId: string;
}

interface PendingUpload {
  uploadId: string;
  spaceId: string;
  changeSetId: string;
  principalId: string;
  relativePath: string;
  stagedPath: string;
  createdAt: number;
}

interface WorkspaceContext {
  spaceId: string;
  spaceUid: string;
  effectiveWorkspaceRoot: string;
  workPath: string;
}

export interface SpaceWorkspaceResolver {
  ensureWorkspace: (spaceId: string) => Promise<{
    spaceId: string;
    spaceUid: string;
    effectiveWorkspaceRoot: string;
    workPath: string;
  }>;
}

export interface SpaceChangeSetServiceOptions {
  spaces: SpaceRepository;
  participants: SpaceParticipantRepository;
  changeSets: SpaceChangeSetRepository;
  changeSetFiles: SpaceChangeSetFileRepository;
  changeSetReviews: SpaceChangeSetReviewRepository;
  workspaceResolver: SpaceWorkspaceResolver;
  quotaService?: SpaceQuotaService;
  now?: () => Date;
}

const OPEN_STATUSES: ChangeSetStatus[] = [
  "draft",
  "uploaded",
  "pending_review",
  "approved",
];

type ChangeSetPrincipalRole = "owner" | "moderator" | "collaborator" | "read_only" | "none";

export class SpaceChangeSetService {
  private readonly now: () => Date;
  private readonly pendingUploads = new Map<string, PendingUpload>();

  constructor(private readonly options: SpaceChangeSetServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async createChangeSet(input: CreateChangeSetInput): Promise<ChangeSet> {
    const spaceId = normalizeRequired(input.spaceId, "spaceId");
    const principalId = normalizeRequired(input.principalId, "principalId");
    this.requireSpace(spaceId);
    this.requireRoleForAction(spaceId, principalId, "create changesets", [
      "owner",
      "moderator",
      "collaborator",
    ]);
    this.options.quotaService?.assertCanCreateChangeSet(spaceId, principalId);

    const workspace = await this.resolveWorkspace(spaceId);
    const participantId = this.resolveParticipantId(spaceId, principalId);
    const adapter = input.adapter ?? await this.resolveDefaultAdapter(workspace.effectiveWorkspaceRoot);
    const changeSetId = `changeset-${randomUUID()}`;
    const expiresAt = resolveExpiresAtIso(this.now(), input.expiresInSeconds);

    const row = this.options.changeSets.create({
      changeSetId,
      spaceId,
      participantId,
      createdByPrincipalId: principalId,
      status: "draft",
      title: input.title?.trim() ?? "",
      description: input.description?.trim() ?? "",
      adapter,
      targetBranch: input.targetBranch?.trim() ?? "",
      workspaceBasePath: workspace.effectiveWorkspaceRoot,
      expiresAt,
    });

    await mkdir(this.resolveChangeSetStagingRoot(workspace, participantId, changeSetId), { recursive: true });
    this.options.quotaService?.recordChangeSetCreated(spaceId, principalId);
    return mapChangeSet(row);
  }

  listChangeSets(input: ListChangeSetsInput): ChangeSet[] {
    const spaceId = normalizeRequired(input.spaceId, "spaceId");
    const principalId = normalizeRequired(input.principalId, "principalId");
    this.requireSpace(spaceId);
    this.requireRoleForAction(spaceId, principalId, "list changesets", [
      "owner",
      "moderator",
      "collaborator",
      "read_only",
    ]);

    return this.options.changeSets.listBySpace(spaceId, {
      statuses: input.statuses,
      limit: input.limit,
      offset: input.offset,
    }).map(mapChangeSet);
  }

  async uploadFileInit(input: UploadChangeSetFileInitInput): Promise<{
    uploadId: string;
    changeSet: ChangeSet;
    relativePath: string;
  }> {
    const spaceId = normalizeRequired(input.spaceId, "spaceId");
    const changeSetId = normalizeRequired(input.changeSetId, "changeSetId");
    const principalId = normalizeRequired(input.principalId, "principalId");
    this.requireRoleForAction(spaceId, principalId, "upload changeset files", [
      "owner",
      "moderator",
      "collaborator",
    ]);
    const relativePath = normalizeRelativePath(input.relativePath);
    const row = this.requireOwnedOpenChangeSet(spaceId, changeSetId, principalId, ["draft", "uploaded"]);

    const workspace = await this.resolveWorkspace(spaceId);
    const participantId = row.participant_id || this.resolveParticipantId(spaceId, principalId);
    const stagedRoot = this.resolveChangeSetStagingRoot(workspace, participantId, changeSetId);
    const stagedPath = resolvePath(stagedRoot, relativePath);
    assertPathWithinRoot(stagedPath, stagedRoot, "staged file path");
    await mkdir(dirname(stagedPath), { recursive: true });

    const uploadId = `upload-${randomUUID()}`;
    this.pendingUploads.set(uploadId, {
      uploadId,
      spaceId,
      changeSetId,
      principalId,
      relativePath,
      stagedPath,
      createdAt: Date.now(),
    });
    return {
      uploadId,
      changeSet: mapChangeSet(row),
      relativePath,
    };
  }

  async uploadFileComplete(input: UploadChangeSetFileCompleteInput): Promise<{
    changeSet: ChangeSet;
    file: ChangeSetFile;
  }> {
    const spaceId = normalizeRequired(input.spaceId, "spaceId");
    const changeSetId = normalizeRequired(input.changeSetId, "changeSetId");
    const principalId = normalizeRequired(input.principalId, "principalId");
    this.requireRoleForAction(spaceId, principalId, "upload changeset files", [
      "owner",
      "moderator",
      "collaborator",
    ]);
    const uploadId = normalizeRequired(input.uploadId, "uploadId");
    const pending = this.pendingUploads.get(uploadId);
    if (!pending) {
      throw new SpaceChangeSetServiceError("NOT_FOUND", `Unknown uploadId: ${uploadId}`);
    }
    if (
      pending.spaceId !== spaceId
      || pending.changeSetId !== changeSetId
      || pending.principalId !== principalId
    ) {
      throw new SpaceChangeSetServiceError(
        "PERMISSION_DENIED",
        "Upload session does not match space/changeset/principal",
      );
    }
    const row = this.requireOwnedOpenChangeSet(spaceId, changeSetId, principalId, ["draft", "uploaded"]);
    const workspace = await this.resolveWorkspace(spaceId);
    const targetPath = resolvePath(workspace.effectiveWorkspaceRoot, pending.relativePath);
    assertPathWithinRoot(targetPath, workspace.effectiveWorkspaceRoot, "changeset target path");

    const content = await this.readUploadContent(input);
    this.options.quotaService?.assertCanUpload(spaceId, principalId, content.byteLength);

    const previous = this.options.changeSetFiles.get(changeSetId, pending.relativePath);
    await writeFile(pending.stagedPath, content);
    const sha256 = sha256Hex(content);
    if (normalizeOptional(input.expectedSha256) && input.expectedSha256 !== sha256) {
      throw new SpaceChangeSetServiceError(
        "FAILED_PRECONDITION",
        `SHA-256 mismatch for ${pending.relativePath}`,
      );
    }

    const changeType = await fileExists(targetPath) ? "modified" : "added";
    const file = this.options.changeSetFiles.upsert({
      changeSetId,
      relativePath: pending.relativePath,
      stagedPath: pending.stagedPath,
      sha256,
      sizeBytes: content.byteLength,
      changeType,
    });

    const updated = this.options.changeSets.update(changeSetId, {
      status: "uploaded",
    });
    if (!updated) {
      throw new SpaceChangeSetServiceError("NOT_FOUND", `Changeset not found: ${changeSetId}`);
    }
    this.pendingUploads.delete(uploadId);

    const previousSize = previous?.size_bytes ?? 0;
    const deltaBytes = content.byteLength - previousSize;
    this.options.quotaService?.recordUpload(spaceId, principalId, deltaBytes);

    return {
      changeSet: mapChangeSet(updated),
      file: mapChangeSetFile(file),
    };
  }

  submitChangeSet(input: SubmitChangeSetInput): ChangeSet {
    const spaceId = normalizeRequired(input.spaceId, "spaceId");
    const changeSetId = normalizeRequired(input.changeSetId, "changeSetId");
    const principalId = normalizeRequired(input.principalId, "principalId");
    this.requireRoleForAction(spaceId, principalId, "submit changesets", [
      "owner",
      "moderator",
      "collaborator",
    ]);
    const row = this.requireOwnedOpenChangeSet(spaceId, changeSetId, principalId, ["draft", "uploaded"]);
    const files = this.options.changeSetFiles.listByChangeSet(changeSetId);
    if (files.length === 0) {
      throw new SpaceChangeSetServiceError(
        "FAILED_PRECONDITION",
        "Cannot submit an empty changeset",
      );
    }
    const updated = this.options.changeSets.update(changeSetId, {
      status: "pending_review",
      submittedAt: this.now().toISOString(),
    });
    if (!updated) {
      throw new SpaceChangeSetServiceError("NOT_FOUND", `Changeset not found: ${changeSetId}`);
    }
    return mapChangeSet(updated);
  }

  async reviewChangeSet(input: ReviewChangeSetInput): Promise<{
    changeSet: ChangeSet;
    review: ChangeSetReview;
  }> {
    const spaceId = normalizeRequired(input.spaceId, "spaceId");
    const changeSetId = normalizeRequired(input.changeSetId, "changeSetId");
    const principalId = normalizeRequired(input.principalId, "principalId");
    this.requireRoleForAction(spaceId, principalId, "review changesets", ["owner", "moderator"]);
    const decision = normalizeDecision(input.decision);
    const row = this.requireSpaceChangeSet(spaceId, changeSetId);
    if (row.status !== "pending_review") {
      throw new SpaceChangeSetServiceError(
        "FAILED_PRECONDITION",
        `Changeset ${changeSetId} is ${row.status}, expected pending_review`,
      );
    }
    if (row.created_by_principal_id === principalId) {
      throw new SpaceChangeSetServiceError(
        "PERMISSION_DENIED",
        "Changeset creator cannot self-review",
      );
    }

    const files = this.options.changeSetFiles.listByChangeSet(changeSetId);
    const review = this.options.changeSetReviews.create({
      reviewId: `review-${randomUUID()}`,
      changeSetId,
      reviewerPrincipalId: principalId,
      decision,
      comment: input.comment?.trim() ?? "",
      diffSummaryJson: JSON.stringify({
        files: files.length,
        totalBytes: files.reduce((sum, entry) => sum + entry.size_bytes, 0),
      }),
    });

    const nextStatus: ChangeSetStatus = decision === "approved" ? "approved" : "rejected";
    const updated = this.options.changeSets.update(changeSetId, {
      status: nextStatus,
      reviewedAt: this.now().toISOString(),
    });
    if (!updated) {
      throw new SpaceChangeSetServiceError("NOT_FOUND", `Changeset not found: ${changeSetId}`);
    }

    if (nextStatus === "rejected" && OPEN_STATUSES.includes(row.status)) {
      this.options.quotaService?.recordChangeSetClosed(spaceId, row.created_by_principal_id);
    }

    return {
      changeSet: mapChangeSet(updated),
      review: mapChangeSetReview(review),
    };
  }

  async applyChangeSet(input: ApplyChangeSetInput): Promise<{
    changeSet: ChangeSet;
    result: ChangeSetApplyResult;
  }> {
    const spaceId = normalizeRequired(input.spaceId, "spaceId");
    const changeSetId = normalizeRequired(input.changeSetId, "changeSetId");
    const principalId = normalizeRequired(input.principalId, "principalId");
    this.requireRoleForAction(spaceId, principalId, "apply changesets", ["owner", "moderator"]);
    const row = this.requireSpaceChangeSet(spaceId, changeSetId);
    if (row.status !== "approved") {
      throw new SpaceChangeSetServiceError(
        "FAILED_PRECONDITION",
        `Changeset ${changeSetId} is ${row.status}, expected approved`,
      );
    }

    this.options.quotaService?.assertCanApply(spaceId, principalId);
    const workspace = await this.resolveWorkspace(spaceId);
    const files = this.options.changeSetFiles.listByChangeSet(changeSetId);
    if (files.length === 0) {
      throw new SpaceChangeSetServiceError(
        "FAILED_PRECONDITION",
        "Cannot apply changeset without staged files",
      );
    }

    const rollbackPath = join(workspace.workPath, "rollback", changeSetId);
    await mkdir(rollbackPath, { recursive: true });
    const appliedPaths: string[] = [];

    for (const file of files) {
      const targetPath = resolvePath(workspace.effectiveWorkspaceRoot, file.relative_path);
      assertPathWithinRoot(targetPath, workspace.effectiveWorkspaceRoot, "workspace apply path");
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

    const gitResult = row.adapter === "git"
      ? this.tryGitCommit(workspace.effectiveWorkspaceRoot, workspace.spaceUid, changeSetId, files)
      : undefined;

    const updated = this.options.changeSets.update(changeSetId, {
      status: "applied",
      appliedAt: this.now().toISOString(),
    });
    if (!updated) {
      throw new SpaceChangeSetServiceError("NOT_FOUND", `Changeset not found: ${changeSetId}`);
    }

    this.options.quotaService?.recordApply(spaceId, row.created_by_principal_id);
    this.options.quotaService?.recordChangeSetClosed(spaceId, row.created_by_principal_id);

    return {
      changeSet: mapChangeSet(updated),
      result: {
        changeSetId,
        adapter: row.adapter,
        appliedPaths,
        rollbackPath,
        git: gitResult,
      },
    };
  }

  async getChangeSetDiff(spaceIdRaw: string, changeSetIdRaw: string): Promise<ChangeSetDiffResult> {
    const spaceId = normalizeRequired(spaceIdRaw, "spaceId");
    const changeSetId = normalizeRequired(changeSetIdRaw, "changeSetId");
    this.requireSpaceChangeSet(spaceId, changeSetId);
    const workspace = await this.resolveWorkspace(spaceId);
    const files = this.options.changeSetFiles.listByChangeSet(changeSetId);

    const diffSections: string[] = [];
    for (const file of files) {
      const section = await this.generateFileDiff(workspace, file);
      diffSections.push(section);
    }

    return {
      changeSetId,
      unifiedDiff: diffSections.filter(Boolean).join("\n"),
      files: files.map((file) => ({
        relativePath: file.relative_path,
        changeType: file.change_type,
        sizeBytes: file.size_bytes,
      })),
      generatedAt: this.now().toISOString(),
    };
  }

  async runMaintenance(): Promise<{
    expiredDrafts: number;
    expiredByTtl: number;
    purgedStaging: number;
  }> {
    const now = this.now();
    const staleDraftCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
    const purgeCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const nowIso = now.toISOString();

    let expiredDrafts = 0;
    let expiredByTtl = 0;
    let purgedStaging = 0;

    for (const row of this.options.changeSets.listStaleDrafts(staleDraftCutoff, 500)) {
      if (row.status === "expired") continue;
      if (OPEN_STATUSES.includes(row.status)) {
        this.options.quotaService?.recordChangeSetClosed(row.space_id, row.created_by_principal_id);
      }
      const updated = this.options.changeSets.update(row.changeset_id, { status: "expired" });
      if (updated) expiredDrafts += 1;
    }

    for (const row of this.options.changeSets.listExpirable(nowIso, 500)) {
      if (row.status === "expired") continue;
      if (OPEN_STATUSES.includes(row.status)) {
        this.options.quotaService?.recordChangeSetClosed(row.space_id, row.created_by_principal_id);
      }
      const updated = this.options.changeSets.update(row.changeset_id, { status: "expired" });
      if (updated) expiredByTtl += 1;
    }

    for (const row of this.options.changeSets.listPurgeCandidates(purgeCutoff, 500)) {
      if (!row.participant_id) continue;
      const workspace = await this.resolveWorkspace(row.space_id).catch(() => null);
      if (!workspace) continue;
      const stagingRoot = this.resolveChangeSetStagingRoot(
        workspace,
        row.participant_id,
        row.changeset_id,
      );
      await rm(stagingRoot, { recursive: true, force: true });
      this.options.changeSetFiles.deleteByChangeSet(row.changeset_id);
      purgedStaging += 1;
    }

    return {
      expiredDrafts,
      expiredByTtl,
      purgedStaging,
    };
  }

  private requireRoleForAction(
    spaceId: string,
    principalId: string,
    actionLabel: string,
    allowedRoles: ChangeSetPrincipalRole[],
  ): ChangeSetPrincipalRole {
    const role = this.resolvePrincipalRole(spaceId, principalId);
    if (allowedRoles.includes(role)) {
      return role;
    }

    throw new SpaceChangeSetServiceError(
      "PERMISSION_DENIED",
      `Principal role ${role} cannot ${actionLabel}; required: ${allowedRoles.join(" or ")}`,
    );
  }

  private resolvePrincipalRole(spaceId: string, principalId: string): ChangeSetPrincipalRole {
    const activeCount = this.options.participants.countActiveBySpace(spaceId);
    if (activeCount === 0) {
      return "owner";
    }

    const participant = this.options.participants.getActiveByPrincipal(spaceId, principalId);
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

    if (this.isConfiguredChangeSetModerator(spaceId, principalId)) {
      return "moderator";
    }

    return "collaborator";
  }

  private isConfiguredChangeSetModerator(spaceId: string, principalId: string): boolean {
    const row = this.options.spaces.getById(spaceId);
    if (!row?.space_config_json) return false;

    const parsed = parseJsonRecord(row.space_config_json);
    const configured = resolveModeratorPrincipalIds(parsed);
    if (configured.length === 0) return false;
    return configured.includes(principalId);
  }

  private requireSpace(spaceId: string): void {
    if (!this.options.spaces.getById(spaceId)) {
      throw new SpaceChangeSetServiceError("NOT_FOUND", `Space not found: ${spaceId}`);
    }
  }

  private requireSpaceChangeSet(spaceId: string, changeSetId: string): SpaceChangeSetRow {
    this.requireSpace(spaceId);
    const row = this.options.changeSets.getById(changeSetId);
    if (!row || row.space_id !== spaceId) {
      throw new SpaceChangeSetServiceError(
        "NOT_FOUND",
        `Changeset not found: ${changeSetId}`,
      );
    }
    return row;
  }

  private requireOwnedOpenChangeSet(
    spaceId: string,
    changeSetId: string,
    principalId: string,
    allowedStatuses: ChangeSetStatus[],
  ): SpaceChangeSetRow {
    const row = this.requireSpaceChangeSet(spaceId, changeSetId);
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

  private resolveParticipantId(spaceId: string, principalId: string): string {
    const participant = this.options.participants.getActiveByPrincipal(spaceId, principalId);
    if (participant?.participant_id) {
      return participant.participant_id;
    }
    return `owner-${shortHash(principalId)}`;
  }

  private async resolveWorkspace(spaceId: string): Promise<WorkspaceContext> {
    return this.options.workspaceResolver.ensureWorkspace(spaceId);
  }

  private resolveChangeSetStagingRoot(
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

  private async resolveDefaultAdapter(workspaceRoot: string): Promise<ChangeSetAdapter> {
    const gitRoot = resolvePath(workspaceRoot, ".git");
    return await fileExists(gitRoot) ? "git" : "filesystem";
  }

  private async readUploadContent(input: UploadChangeSetFileCompleteInput): Promise<Buffer> {
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

  private async generateFileDiff(workspace: WorkspaceContext, file: SpaceChangeSetFileRow): Promise<string> {
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

  private tryGitCommit(
    workspaceRoot: string,
    spaceUid: string,
    changeSetId: string,
    files: SpaceChangeSetFileRow[],
  ): ChangeSetApplyResult["git"] {
    const commitMessage = `spaces/${spaceUid}/${changeSetId}`;
    const filePaths = files.map((entry) => entry.relative_path).filter((entry) => entry.length > 0);
    const revParse = spawnSync("git", ["-C", workspaceRoot, "rev-parse", "--is-inside-work-tree"], {
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

    const add = spawnSync("git", ["-C", workspaceRoot, "add", "--", ...filePaths], {
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
      ["-C", workspaceRoot, "commit", "--no-gpg-sign", "-m", commitMessage],
      { encoding: "utf8" },
    );
    if (commit.status !== 0) {
      return {
        attempted: true,
        commitMessage,
        warning: commit.stderr.trim() || "git commit failed",
      };
    }

    const hash = spawnSync("git", ["-C", workspaceRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    });
    return {
      attempted: true,
      commitMessage,
      commitHash: hash.status === 0 ? hash.stdout.trim() : undefined,
    };
  }
}

function normalizeDecision(value: ChangeSetReviewDecision): ChangeSetReviewDecision {
  if (value === "approved" || value === "rejected") return value;
  throw new SpaceChangeSetServiceError("INVALID_ARGUMENT", `Unsupported review decision: ${String(value)}`);
}

function normalizeRequired(value: string | undefined, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new SpaceChangeSetServiceError("INVALID_ARGUMENT", `${field} is required`);
  }
  return normalized;
}

function normalizeRelativePath(rawPath: string): string {
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

function resolveExpiresAtIso(now: Date, secondsRaw?: number): string | undefined {
  if (typeof secondsRaw !== "number" || !Number.isFinite(secondsRaw) || secondsRaw <= 0) {
    return undefined;
  }
  const seconds = Math.min(Math.floor(secondsRaw), 90 * 24 * 60 * 60);
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function assertPathWithinRoot(targetPath: string, rootPath: string, label: string): void {
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
