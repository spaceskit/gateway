import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import {
  SpaceChangeSetFileRepository,
  SpaceChangeSetRepository,
  SpaceChangeSetReviewRepository,
  SpaceParticipantRepository,
  SpaceRepository,
  type ChangeSetAdapter,
  type ChangeSetReviewDecision,
  type ChangeSetStatus,
} from "@spaceskit/persistence";
import { SpaceQuotaService, SpaceQuotaServiceError } from "./space-quota-service.js";
import {
  assertPathWithinRoot,
  fileExists,
  normalizeDecision,
  normalizeRelativePath,
  normalizeRequired,
  readUploadContent,
  requireOwnedOpenChangeSet,
  requireRoleForChangeSetAction,
  requireSpace,
  requireSpaceChangeSet,
  resolveChangeSetStagingRoot,
  resolveDefaultAdapter,
  resolveExpiresAtIso,
  resolveParticipantId,
  sha256Hex,
  shortHash,
  SpaceChangeSetServiceError,
  type PendingUpload,
  type SpaceChangeSetServiceErrorCode,
} from "./space-changeset-service-helpers.js";
import {
  applyChangeSetOperation,
  getChangeSetDiffOperation,
  runChangeSetMaintenance,
  submitChangeSetOperation,
} from "./space-changeset-service-operations.js";
import {
  mapChangeSet,
  mapChangeSetFile,
  mapChangeSetReview,
  normalizeOptional,
  parseJsonRecord,
} from "./space-changeset-service-normalizers.js";

export { SpaceChangeSetServiceError };
export type { SpaceChangeSetServiceErrorCode };

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

export class SpaceChangeSetService {
  private readonly now: () => Date;
  private readonly pendingUploads = new Map<string, PendingUpload>();

  constructor(private readonly options: SpaceChangeSetServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async createChangeSet(input: CreateChangeSetInput): Promise<ChangeSet> {
    const spaceId = normalizeRequired(input.spaceId, "spaceId");
    const principalId = normalizeRequired(input.principalId, "principalId");
    requireSpace(this.options, spaceId);
    requireRoleForChangeSetAction({
      repos: this.options,
      spaceId,
      principalId,
      actionLabel: "create changesets",
      allowedRoles: [
        "owner",
        "moderator",
        "collaborator",
      ],
    });
    this.options.quotaService?.assertCanCreateChangeSet(spaceId, principalId);

    const workspace = await this.options.workspaceResolver.ensureWorkspace(spaceId);
    const participantId = resolveParticipantId(this.options.participants, spaceId, principalId);
    const adapter = input.adapter ?? await resolveDefaultAdapter(workspace.effectiveWorkspaceRoot);
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

    await mkdir(resolveChangeSetStagingRoot(workspace, participantId, changeSetId), { recursive: true });
    this.options.quotaService?.recordChangeSetCreated(spaceId, principalId);
    return mapChangeSet(row);
  }

  listChangeSets(input: ListChangeSetsInput): ChangeSet[] {
    const spaceId = normalizeRequired(input.spaceId, "spaceId");
    const principalId = normalizeRequired(input.principalId, "principalId");
    requireSpace(this.options, spaceId);
    requireRoleForChangeSetAction({
      repos: this.options,
      spaceId,
      principalId,
      actionLabel: "list changesets",
      allowedRoles: [
        "owner",
        "moderator",
        "collaborator",
        "read_only",
      ],
    });

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
    requireRoleForChangeSetAction({
      repos: this.options,
      spaceId,
      principalId,
      actionLabel: "upload changeset files",
      allowedRoles: [
        "owner",
        "moderator",
        "collaborator",
      ],
    });
    const relativePath = normalizeRelativePath(input.relativePath);
    const row = requireOwnedOpenChangeSet(this.options, spaceId, changeSetId, principalId, ["draft", "uploaded"]);

    const workspace = await this.options.workspaceResolver.ensureWorkspace(spaceId);
    const participantId = row.participant_id || resolveParticipantId(this.options.participants, spaceId, principalId);
    const stagedRoot = resolveChangeSetStagingRoot(workspace, participantId, changeSetId);
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
    requireRoleForChangeSetAction({
      repos: this.options,
      spaceId,
      principalId,
      actionLabel: "upload changeset files",
      allowedRoles: [
        "owner",
        "moderator",
        "collaborator",
      ],
    });
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
    const row = requireOwnedOpenChangeSet(this.options, spaceId, changeSetId, principalId, ["draft", "uploaded"]);
    const workspace = await this.options.workspaceResolver.ensureWorkspace(spaceId);
    const targetPath = resolvePath(workspace.effectiveWorkspaceRoot, pending.relativePath);
    assertPathWithinRoot(targetPath, workspace.effectiveWorkspaceRoot, "changeset target path");

    const content = await readUploadContent(input);
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
    return submitChangeSetOperation({
      options: this.options,
      now: this.now,
      request: input,
    });
  }

  async reviewChangeSet(input: ReviewChangeSetInput): Promise<{
    changeSet: ChangeSet;
    review: ChangeSetReview;
  }> {
    const spaceId = normalizeRequired(input.spaceId, "spaceId");
    const changeSetId = normalizeRequired(input.changeSetId, "changeSetId");
    const principalId = normalizeRequired(input.principalId, "principalId");
    requireRoleForChangeSetAction({
      repos: this.options,
      spaceId,
      principalId,
      actionLabel: "review changesets",
      allowedRoles: ["owner", "moderator"],
    });
    const decision = normalizeDecision(input.decision);
    const row = requireSpaceChangeSet(this.options, spaceId, changeSetId);
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
    return applyChangeSetOperation({
      options: this.options,
      now: this.now,
      request: input,
    });
  }

  async getChangeSetDiff(spaceIdRaw: string, changeSetIdRaw: string): Promise<ChangeSetDiffResult> {
    return getChangeSetDiffOperation({
      options: this.options,
      now: this.now,
      spaceIdRaw,
      changeSetIdRaw,
    });
  }

  async runMaintenance(): Promise<{
    expiredDrafts: number;
    expiredByTtl: number;
    purgedStaging: number;
  }> {
    return runChangeSetMaintenance({
      options: this.options,
      now: this.now,
    });
  }
}
