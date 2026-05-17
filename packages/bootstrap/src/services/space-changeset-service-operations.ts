import { rm } from "node:fs/promises";
import type { ChangeSetStatus } from "@spaceskit/persistence";
import {
  applyStagedChangeSetFiles,
  generateFileDiff,
  normalizeRequired,
  requireOwnedOpenChangeSet,
  requireRoleForChangeSetAction,
  requireSpaceChangeSet,
  resolveChangeSetStagingRoot,
  tryGitCommit,
  SpaceChangeSetServiceError,
} from "./space-changeset-service-helpers.js";
import {
  mapChangeSet,
} from "./space-changeset-service-normalizers.js";
import type {
  ApplyChangeSetInput,
  ChangeSet,
  ChangeSetApplyResult,
  ChangeSetDiffResult,
  SpaceChangeSetServiceOptions,
  SubmitChangeSetInput,
} from "./space-changeset-service-impl.js";

const OPEN_STATUSES: ChangeSetStatus[] = [
  "draft",
  "uploaded",
  "pending_review",
  "approved",
];

export async function applyChangeSetOperation(input: {
  options: SpaceChangeSetServiceOptions;
  now: () => Date;
  request: ApplyChangeSetInput;
}): Promise<{
  changeSet: ChangeSet;
  result: ChangeSetApplyResult;
}> {
  const spaceId = normalizeRequired(input.request.spaceId, "spaceId");
  const changeSetId = normalizeRequired(input.request.changeSetId, "changeSetId");
  const principalId = normalizeRequired(input.request.principalId, "principalId");
  requireRoleForChangeSetAction({
    repos: input.options,
    spaceId,
    principalId,
    actionLabel: "apply changesets",
    allowedRoles: ["owner", "moderator"],
  });
  const row = requireSpaceChangeSet(input.options, spaceId, changeSetId);
  if (row.status !== "approved") {
    throw new SpaceChangeSetServiceError(
      "FAILED_PRECONDITION",
      `Changeset ${changeSetId} is ${row.status}, expected approved`,
    );
  }

  input.options.quotaService?.assertCanApply(spaceId, principalId);
  const workspace = await input.options.workspaceResolver.ensureWorkspace(spaceId);
  const files = input.options.changeSetFiles.listByChangeSet(changeSetId);
  if (files.length === 0) {
    throw new SpaceChangeSetServiceError(
      "FAILED_PRECONDITION",
      "Cannot apply changeset without staged files",
    );
  }

  const { rollbackPath, appliedPaths } = await applyStagedChangeSetFiles({
    workspace,
    changeSetId,
    files,
  });

  const gitResult = row.adapter === "git"
    ? tryGitCommit({
      workspaceRoot: workspace.effectiveWorkspaceRoot,
      spaceUid: workspace.spaceUid,
      changeSetId,
      files,
    })
    : undefined;

  const updated = input.options.changeSets.update(changeSetId, {
    status: "applied",
    appliedAt: input.now().toISOString(),
  });
  if (!updated) {
    throw new SpaceChangeSetServiceError("NOT_FOUND", `Changeset not found: ${changeSetId}`);
  }

  input.options.quotaService?.recordApply(spaceId, row.created_by_principal_id);
  input.options.quotaService?.recordChangeSetClosed(spaceId, row.created_by_principal_id);

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

export function submitChangeSetOperation(input: {
  options: SpaceChangeSetServiceOptions;
  now: () => Date;
  request: SubmitChangeSetInput;
}): ChangeSet {
  const spaceId = normalizeRequired(input.request.spaceId, "spaceId");
  const changeSetId = normalizeRequired(input.request.changeSetId, "changeSetId");
  const principalId = normalizeRequired(input.request.principalId, "principalId");
  requireRoleForChangeSetAction({
    repos: input.options,
    spaceId,
    principalId,
    actionLabel: "submit changesets",
    allowedRoles: ["owner", "moderator", "collaborator"],
  });
  requireOwnedOpenChangeSet(input.options, spaceId, changeSetId, principalId, ["draft", "uploaded"]);
  const files = input.options.changeSetFiles.listByChangeSet(changeSetId);
  if (files.length === 0) {
    throw new SpaceChangeSetServiceError(
      "FAILED_PRECONDITION",
      "Cannot submit an empty changeset",
    );
  }
  const updated = input.options.changeSets.update(changeSetId, {
    status: "pending_review",
    submittedAt: input.now().toISOString(),
  });
  if (!updated) {
    throw new SpaceChangeSetServiceError("NOT_FOUND", `Changeset not found: ${changeSetId}`);
  }
  return mapChangeSet(updated);
}

export async function getChangeSetDiffOperation(input: {
  options: SpaceChangeSetServiceOptions;
  now: () => Date;
  spaceIdRaw: string;
  changeSetIdRaw: string;
}): Promise<ChangeSetDiffResult> {
  const spaceId = normalizeRequired(input.spaceIdRaw, "spaceId");
  const changeSetId = normalizeRequired(input.changeSetIdRaw, "changeSetId");
  requireSpaceChangeSet(input.options, spaceId, changeSetId);
  const workspace = await input.options.workspaceResolver.ensureWorkspace(spaceId);
  const files = input.options.changeSetFiles.listByChangeSet(changeSetId);

  const diffSections: string[] = [];
  for (const file of files) {
    const section = await generateFileDiff(workspace, file);
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
    generatedAt: input.now().toISOString(),
  };
}

export async function runChangeSetMaintenance(input: {
  options: SpaceChangeSetServiceOptions;
  now: () => Date;
}): Promise<{
  expiredDrafts: number;
  expiredByTtl: number;
  purgedStaging: number;
}> {
  const now = input.now();
  const staleDraftCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const purgeCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  let expiredDrafts = 0;
  let expiredByTtl = 0;
  let purgedStaging = 0;

  for (const row of input.options.changeSets.listStaleDrafts(staleDraftCutoff, 500)) {
    if (row.status === "expired") continue;
    if (OPEN_STATUSES.includes(row.status)) {
      input.options.quotaService?.recordChangeSetClosed(row.space_id, row.created_by_principal_id);
    }
    const updated = input.options.changeSets.update(row.changeset_id, { status: "expired" });
    if (updated) expiredDrafts += 1;
  }

  for (const row of input.options.changeSets.listExpirable(nowIso, 500)) {
    if (row.status === "expired") continue;
    if (OPEN_STATUSES.includes(row.status)) {
      input.options.quotaService?.recordChangeSetClosed(row.space_id, row.created_by_principal_id);
    }
    const updated = input.options.changeSets.update(row.changeset_id, { status: "expired" });
    if (updated) expiredByTtl += 1;
  }

  for (const row of input.options.changeSets.listPurgeCandidates(purgeCutoff, 500)) {
    if (!row.participant_id) continue;
    const workspace = await input.options.workspaceResolver.ensureWorkspace(row.space_id).catch(() => null);
    if (!workspace) continue;
    const stagingRoot = resolveChangeSetStagingRoot(
      workspace,
      row.participant_id,
      row.changeset_id,
    );
    await rm(stagingRoot, { recursive: true, force: true });
    input.options.changeSetFiles.deleteByChangeSet(row.changeset_id);
    purgedStaging += 1;
  }

  return {
    expiredDrafts,
    expiredByTtl,
    purgedStaging,
  };
}
