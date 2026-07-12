import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import type { Logger } from "@spaceskit/observability";
import {
  SpaceRepository,
  SpaceResourceRepository,
  SpaceWorkspaceRepository,
  type SpaceWorkspaceRow,
} from "@spaceskit/persistence";
import {
  detectGitRepo,
  discoverProjectFiles,
  ensureFileExists,
  ensureGitignoreContains,
  isAbsolutePath,
  normalizeFileUrlPath,
  normalizeOptionalString,
  parseMetadataStatus,
  parseSpaceConfig,
  readJsonFile,
  serializeEventForJsonl,
  slugifyManagedFolderName,
  SPACE_DIR_FOLDER,
  SPACE_DIR_GITIGNORE_ENTRY,
  workspaceLayout,
} from "./space-workspace-service-helpers.js";

export {
  WELL_KNOWN_PROJECT_FILES,
  isPathWithinScope,
  normalizeCandidatePath,
} from "./space-workspace-service-helpers.js";

export const SPACE_WORKSPACE_LAYOUT_VERSION = 2;
export const SPACE_WORKSPACE_MANAGED_RESOURCE_PREFIX = "space-workspace-root-";
const MANAGED_FOLDER_UID_SUFFIX_LENGTH = 8;

export type SpaceWorkspaceMode = "managed" | "folder_bound";
export type SpaceWorkspaceMetadataStatus = "unknown" | "ready" | "conflict";

export interface SpaceWorkspacePayload {
  spaceId: string;
  spaceUid: string;
  mode: SpaceWorkspaceMode;
  explicitWorkspaceRoot?: string;
  effectiveWorkspaceRoot: string;
  metaPath: string;
  logsPath: string;
  workPath: string;
  sharedContextPath: string;
  scratchpadsPath: string;
  layoutVersion: number;
  gitRepoDetected: boolean;
  metadataStatus: SpaceWorkspaceMetadataStatus;
  discoveredProjectFiles: string[];
  updatedAt: string;
}

export type SpaceOpenWorkspaceStatus =
  | "opened_existing"
  | "created_new"
  | "unbound"
  | "conflict";

export interface SpaceOpenWorkspaceConflict {
  reason: string;
  message: string;
  workspaceRoot: string;
  metadataPath?: string;
  existingSpaceId?: string;
  existingSpaceUid?: string;
  existingWorkspaceRoot?: string;
  requestedSpaceId?: string;
  requestedSpaceUid?: string;
}

export interface SpaceOpenWorkspaceServiceResult {
  status: SpaceOpenWorkspaceStatus;
  workspaceRoot: string;
  gitRepoDetected: boolean;
  hasSpaceMetadata: boolean;
  spaceId?: string;
  metadataSpaceId?: string;
  metadataSpaceUid?: string;
  workspace?: SpaceWorkspacePayload;
  conflict?: SpaceOpenWorkspaceConflict;
}

export type SpaceWorkspaceServiceErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "FAILED_PRECONDITION";

export class SpaceWorkspaceServiceError extends Error {
  readonly code: SpaceWorkspaceServiceErrorCode;

  constructor(code: SpaceWorkspaceServiceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface SpaceWorkspaceServiceOptions {
  spaces: SpaceRepository;
  resources: SpaceResourceRepository;
  workspaces: SpaceWorkspaceRepository;
  spacesRoot: string;
  logger?: Logger;
  now?: () => Date;
  debugEventPayloads?: boolean;
}

interface ProvisionedWorkspaceState {
  path: string;
  status: SpaceWorkspaceMetadataStatus;
  updatedAt: string;
  gitRepoDetected: boolean;
}

export class SpaceWorkspaceService {
  private readonly now: () => Date;
  private readonly spacesRoot: string;
  private readonly pendingLogWrites = new Map<string, Promise<void>>();

  constructor(private readonly options: SpaceWorkspaceServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.spacesRoot = resolvePath(options.spacesRoot);
  }

  getSpacesRoot(): string {
    return this.spacesRoot;
  }

  managedResourceId(spaceIdRaw: string): string {
    const spaceId = normalizeRequiredString(spaceIdRaw, "spaceId");
    return `${SPACE_WORKSPACE_MANAGED_RESOURCE_PREFIX}${spaceId}`;
  }

  isReservedResourceId(resourceIdRaw: string): boolean {
    const resourceId = resourceIdRaw.trim();
    if (!resourceId) return false;
    return resourceId.startsWith(SPACE_WORKSPACE_MANAGED_RESOURCE_PREFIX);
  }

  isManagedWorkspaceResource(spaceIdRaw: string, resourceIdRaw: string): boolean {
    const spaceId = spaceIdRaw.trim();
    const resourceId = resourceIdRaw.trim();
    if (!spaceId || !resourceId) return false;
    return resourceId === this.managedResourceId(spaceId);
  }

  async ensureWorkspace(spaceIdRaw: string): Promise<SpaceWorkspacePayload> {
    const spaceId = normalizeRequiredString(spaceIdRaw, "spaceId");
    const space = this.requireSpace(spaceId);
    const managedResourceId = this.managedResourceId(spaceId);
    const existing = this.options.workspaces.getBySpace(spaceId);
    const existingManagedFolderName = normalizeOptionalString(existing?.managed_folder_name) ?? "";
    const existingExplicitRoot = normalizeOptionalString(existing?.explicit_root);
    if (existing && !existingExplicitRoot && !existingManagedFolderName) {
      throw new SpaceWorkspaceServiceError(
        "FAILED_PRECONDITION",
        `Managed workspace metadata is incomplete for space: ${spaceId}`,
      );
    }
    const explicitRoot = existingExplicitRoot
      ? normalizeAbsolutePath(existingExplicitRoot, "explicit workspace root")
      : "";

    // On a fresh/wiped DB (no workspace row, no explicit binding) adopt an existing on-disk folder
    // for this space before generating a new uid, so we reconcile the space's uid to the folder's.
    // This prevents both the per-folder UID conflict guard from firing and orphan accumulation.
    let adopted: { folderName: string; spaceUid?: string } | undefined;
    if (!existing && !explicitRoot) {
      adopted = await this.findAdoptableManagedFolder(spaceId);
      if (adopted?.spaceUid) {
        this.adoptSpaceUid(space, adopted.spaceUid);
      }
    }

    const spaceUid = this.resolveOrCreateSpaceUid(space);
    const managedFolderName = explicitRoot
      ? existingManagedFolderName
      : adopted?.folderName
        ?? await this.resolveManagedFolderName(spaceId, space.name, spaceUid, existingManagedFolderName);
    const effectiveRoot = explicitRoot || this.defaultWorkspaceRoot(managedFolderName);
    const metadataState = await this.provisionWorkspaceLayout(spaceId, spaceUid, explicitRoot, effectiveRoot);

    this.ensureManagedWorkspaceResource(spaceId, effectiveRoot, managedResourceId);
    const row = this.options.workspaces.upsert({
      spaceId,
      explicitRoot,
      effectiveRoot,
      managedFolderName,
      managedResourceId,
      layoutVersion: existing?.layout_version || SPACE_WORKSPACE_LAYOUT_VERSION,
      metadataPath: metadataState.path,
      metadataStatus: metadataState.status,
      metadataUpdatedAt: metadataState.updatedAt,
    });
    // If we just repointed this space at a different managed folder, remove the one it used to
    // occupy so superseded directories don't linger as orphans under the spaces root.
    if (!explicitRoot && existingManagedFolderName && existingManagedFolderName !== managedFolderName) {
      await this.removeSupersededManagedFolder(spaceId, existingManagedFolderName);
    }
    return this.toWorkspacePayload(spaceId, spaceUid, row, metadataState.gitRepoDetected);
  }

  /**
   * Delete a managed workspace folder that this space no longer uses. Guarded: only removes a
   * directory directly under the managed spaces root whose .space/space.json still belongs to
   * this space (so a folder reassigned to another space or holding a user's data is never touched).
   */
  private async removeSupersededManagedFolder(spaceId: string, folderName: string): Promise<void> {
    const target = this.defaultWorkspaceRoot(folderName);
    if (!existsSync(target)) {
      return;
    }
    const meta = await readJsonFile(join(target, SPACE_DIR_FOLDER, "space.json"));
    const candidateSpaceId = normalizeOptionalString(
      typeof meta.spaceId === "string" ? meta.spaceId : undefined,
    );
    if (candidateSpaceId !== spaceId) {
      return;
    }
    try {
      await rm(target, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; a leftover folder is not fatal.
    }
  }

  async getWorkspace(spaceIdRaw: string): Promise<SpaceWorkspacePayload> {
    return this.ensureWorkspace(spaceIdRaw);
  }

  async setWorkspace(
    spaceIdRaw: string,
    explicitWorkspaceRoot?: string | null,
  ): Promise<SpaceWorkspacePayload> {
    const spaceId = normalizeRequiredString(spaceIdRaw, "spaceId");
    const space = this.requireSpace(spaceId);
    const spaceUid = this.resolveOrCreateSpaceUid(space);
    const existing = this.options.workspaces.getBySpace(spaceId);
    const existingManagedFolderName = normalizeOptionalString(existing?.managed_folder_name) ?? "";
    const explicitRoot = normalizeOptionalString(explicitWorkspaceRoot)
      ? normalizeAbsolutePath(explicitWorkspaceRoot!, "workspaceRoot")
      : "";
    const managedFolderName = explicitRoot
      ? existingManagedFolderName
      : await this.resolveManagedFolderName(spaceId, space.name, spaceUid, existingManagedFolderName);
    const effectiveRoot = explicitRoot || this.defaultWorkspaceRoot(managedFolderName);
    const managedResourceId = this.managedResourceId(spaceId);

    const metadataState = await this.provisionWorkspaceLayout(spaceId, spaceUid, explicitRoot, effectiveRoot);
    this.ensureManagedWorkspaceResource(spaceId, effectiveRoot, managedResourceId);
    const row = this.options.workspaces.upsert({
      spaceId,
      explicitRoot,
      effectiveRoot,
      managedFolderName,
      managedResourceId,
      layoutVersion: SPACE_WORKSPACE_LAYOUT_VERSION,
      metadataPath: metadataState.path,
      metadataStatus: metadataState.status,
      metadataUpdatedAt: metadataState.updatedAt,
    });

    return this.toWorkspacePayload(spaceId, spaceUid, row, metadataState.gitRepoDetected);
  }

  async openWorkspace(workspaceRootRaw: string): Promise<SpaceOpenWorkspaceServiceResult> {
    const workspaceRoot = normalizeAbsolutePath(workspaceRootRaw, "workspaceRoot");
    const layout = workspaceLayout(workspaceRoot);
    const metadataPath = join(layout.meta, "space.json");
    const metadata = await readJsonFile(metadataPath);
    const metadataSpaceId = normalizeOptionalString(metadata.spaceId);
    const metadataSpaceUid = normalizeOptionalString(metadata.spaceUid);
    const metadataWorkspaceRoot = normalizeOptionalString(metadata.effectiveWorkspaceRoot)
      ?? normalizeOptionalString(metadata.explicitWorkspaceRoot);
    const gitRepoDetected = detectGitRepo(workspaceRoot);
    const hasSpaceMetadata = Object.keys(metadata).length > 0;

    if (!hasSpaceMetadata) {
      return {
        status: "unbound",
        workspaceRoot,
        gitRepoDetected,
        hasSpaceMetadata: false,
      };
    }

    if (metadataSpaceId) {
      const existingSpace = this.options.spaces.getById(metadataSpaceId);
      if (existingSpace && existingSpace.status !== "archived" && existingSpace.status !== "deleted") {
        try {
          const workspace = await this.setWorkspace(metadataSpaceId, workspaceRoot);
          return {
            status: "opened_existing",
            workspaceRoot,
            gitRepoDetected: workspace.gitRepoDetected,
            hasSpaceMetadata: true,
            spaceId: metadataSpaceId,
            metadataSpaceId,
            metadataSpaceUid,
            workspace,
          };
        } catch (error) {
          if (error instanceof SpaceWorkspaceServiceError && error.code === "FAILED_PRECONDITION") {
            return {
              status: "conflict",
              workspaceRoot,
              gitRepoDetected,
              hasSpaceMetadata: true,
              metadataSpaceId,
              metadataSpaceUid,
              conflict: {
                reason: "metadata_conflict",
                message: error.message,
                workspaceRoot,
                metadataPath,
                existingSpaceId: metadataSpaceId,
                existingSpaceUid: metadataSpaceUid,
                existingWorkspaceRoot: metadataWorkspaceRoot,
              },
            };
          }
          throw error;
        }
      }

      if (existingSpace) {
        return {
          status: "conflict",
          workspaceRoot,
          gitRepoDetected,
          hasSpaceMetadata: true,
          metadataSpaceId,
          metadataSpaceUid,
          conflict: {
            reason: "inactive_space",
            message: `Workspace metadata points to an inactive space: ${metadataSpaceId}`,
            workspaceRoot,
            metadataPath,
            existingSpaceId: metadataSpaceId,
            existingSpaceUid: metadataSpaceUid,
            existingWorkspaceRoot: metadataWorkspaceRoot,
          },
        };
      }
    }

    return {
      status: "created_new",
      workspaceRoot,
      gitRepoDetected,
      hasSpaceMetadata: true,
      metadataSpaceId,
      metadataSpaceUid,
    };
  }

  async getAgentScratchpadPath(spaceIdRaw: string, agentIdRaw: string): Promise<string> {
    const workspace = await this.ensureWorkspace(spaceIdRaw);
    const agentId = normalizeRequiredString(agentIdRaw, "agentId");
    return join(workspace.scratchpadsPath, `${agentId}.md`);
  }

  async appendSpaceEventLog(spaceIdRaw: string | undefined, event: Record<string, unknown>): Promise<void> {
    const spaceId = normalizeOptionalString(spaceIdRaw);
    if (!spaceId) return;

    const queueKey = spaceId;
    const pending = this.pendingLogWrites.get(queueKey) ?? Promise.resolve();
    const next = pending
      .catch(() => {})
      .then(async () => {
        try {
          const workspace = await this.ensureWorkspace(spaceId);
          const entry = serializeEventForJsonl(event, this.options.debugEventPayloads === true);
          const logFile = join(workspace.logsPath, "events.jsonl");
          await appendFile(logFile, `${JSON.stringify(entry)}\n`, "utf8");
        } catch (error) {
          this.options.logger?.warn("Failed writing space workspace event log", {
            spaceId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });

    this.pendingLogWrites.set(queueKey, next);
    await next;
    if (this.pendingLogWrites.get(queueKey) === next) {
      this.pendingLogWrites.delete(queueKey);
    }
  }

  private requireSpace(spaceId: string): NonNullable<ReturnType<SpaceRepository["getById"]>> {
    const row = this.options.spaces.getById(spaceId);
    if (!row) {
      throw new SpaceWorkspaceServiceError("NOT_FOUND", `Space not found: ${spaceId}`);
    }
    return row;
  }

  private resolveOrCreateSpaceUid(space: NonNullable<ReturnType<SpaceRepository["getById"]>>): string {
    const parsed = parseSpaceConfig(space?.space_config_json ?? null);
    const existingSpaceUid = normalizeOptionalString(parsed.spaceUid);
    if (existingSpaceUid) {
      return existingSpaceUid;
    }

    const generated = randomUUID();
    const nextConfig = {
      ...parsed,
      spaceUid: generated,
    };
    this.options.spaces.updateConfig(space.space_id, JSON.stringify(nextConfig));
    return generated;
  }

  /**
   * Persist a spaceUid taken from an adopted on-disk folder so the space's stored uid matches the
   * folder it is reusing. No-op if the space already has a uid that matches. Mutates the in-memory
   * space row so resolveOrCreateSpaceUid() reads the reconciled value within the same call.
   */
  private adoptSpaceUid(
    space: NonNullable<ReturnType<SpaceRepository["getById"]>>,
    adoptedUid: string,
  ): void {
    const parsed = parseSpaceConfig(space?.space_config_json ?? null);
    if (normalizeOptionalString(parsed.spaceUid) === adoptedUid) {
      return;
    }
    const nextConfig = JSON.stringify({ ...parsed, spaceUid: adoptedUid });
    this.options.spaces.updateConfig(space.space_id, nextConfig);
    space.space_config_json = nextConfig;
  }

  private defaultWorkspaceRoot(managedFolderName: string): string {
    return resolvePath(this.spacesRoot, managedFolderName);
  }

  private async resolveManagedFolderName(
    spaceId: string,
    spaceName: string,
    spaceUid: string,
    existingManagedFolderName: string,
  ): Promise<string> {
    if (existingManagedFolderName) {
      return existingManagedFolderName;
    }

    const slug = slugifyManagedFolderName(spaceName) ?? "space";
    const shortUidSuffix = spaceUid.slice(0, MANAGED_FOLDER_UID_SUFFIX_LENGTH).toLowerCase();
    const shortCandidate = `${slug}--${shortUidSuffix}`;
    if (await this.isManagedFolderNameAvailable(spaceId, spaceUid, shortCandidate)) {
      return shortCandidate;
    }

    const fullCandidate = `${slug}--${spaceUid.toLowerCase()}`;
    if (await this.isManagedFolderNameAvailable(spaceId, spaceUid, fullCandidate)) {
      return fullCandidate;
    }

    throw new SpaceWorkspaceServiceError(
      "FAILED_PRECONDITION",
      `Unable to allocate a managed workspace folder for space: ${spaceId}`,
    );
  }

  /**
   * Scan the managed spaces root for a folder whose .space/space.json already belongs to this
   * space (matching spaceId) and return its folder name plus the spaceUid recorded on disk.
   * Returns undefined when no such folder exists. The caller reconciles the space's uid to the
   * adopted folder's so re-provisioning does not trip the per-folder UID conflict guard.
   */
  private async findAdoptableManagedFolder(
    spaceId: string,
  ): Promise<{ folderName: string; spaceUid?: string } | undefined> {
    if (!existsSync(this.spacesRoot)) {
      return undefined;
    }
    let entries: string[];
    try {
      entries = (await readdir(this.spacesRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((lhs, rhs) => lhs.localeCompare(rhs));
    } catch {
      return undefined;
    }
    for (const name of entries) {
      const meta = await readJsonFile(join(this.spacesRoot, name, SPACE_DIR_FOLDER, "space.json"));
      const candidateSpaceId = normalizeOptionalString(
        typeof meta.spaceId === "string" ? meta.spaceId : undefined,
      );
      if (candidateSpaceId === spaceId) {
        return {
          folderName: name,
          spaceUid: normalizeOptionalString(
            typeof meta.spaceUid === "string" ? meta.spaceUid : undefined,
          ),
        };
      }
    }
    return undefined;
  }

  private async isManagedFolderNameAvailable(
    spaceId: string,
    spaceUid: string,
    managedFolderName: string,
  ): Promise<boolean> {
    if (!managedFolderName.trim()) {
      return false;
    }

    const candidateRoot = this.defaultWorkspaceRoot(managedFolderName);
    if (!existsSync(candidateRoot)) {
      return true;
    }

    const existingSpaceMeta = await readJsonFile(join(candidateRoot, SPACE_DIR_FOLDER, "space.json"));
    const existingSpaceId = normalizeOptionalString(
      typeof existingSpaceMeta.spaceId === "string" ? existingSpaceMeta.spaceId : undefined,
    );
    const existingSpaceUid = normalizeOptionalString(
      typeof existingSpaceMeta.spaceUid === "string" ? existingSpaceMeta.spaceUid : undefined,
    );
    if (!existingSpaceId && !existingSpaceUid) {
      return false;
    }

    return (!existingSpaceId || existingSpaceId === spaceId)
      && (!existingSpaceUid || existingSpaceUid === spaceUid);
  }

  private toWorkspacePayload(
    spaceId: string,
    spaceUid: string,
    row: SpaceWorkspaceRow,
    gitRepoDetected?: boolean,
  ): SpaceWorkspacePayload {
    const explicitRoot = normalizeOptionalString(row.explicit_root);
    const effectiveRoot = normalizeAbsolutePath(row.effective_root, "effective workspace root");
    const layout = workspaceLayout(effectiveRoot);
    return {
      spaceId,
      spaceUid,
      mode: explicitRoot ? "folder_bound" : "managed",
      ...(explicitRoot ? { explicitWorkspaceRoot: explicitRoot } : {}),
      effectiveWorkspaceRoot: effectiveRoot,
      metaPath: layout.meta,
      logsPath: layout.logs,
      workPath: layout.work,
      sharedContextPath: layout.sharedContext,
      scratchpadsPath: layout.scratchpads,
      layoutVersion: row.layout_version || SPACE_WORKSPACE_LAYOUT_VERSION,
      gitRepoDetected: gitRepoDetected ?? detectGitRepo(effectiveRoot),
      metadataStatus: parseMetadataStatus(row.metadata_status),
      discoveredProjectFiles: discoverProjectFiles(effectiveRoot),
      updatedAt: row.updated_at,
    };
  }

  private async provisionWorkspaceLayout(
    spaceId: string,
    spaceUid: string,
    explicitRoot: string,
    effectiveRoot: string,
  ): Promise<ProvisionedWorkspaceState> {
    const layout = workspaceLayout(effectiveRoot);
    const nowIso = this.now().toISOString();
    const gitRepoDetected = detectGitRepo(effectiveRoot);

    await mkdir(layout.root, { recursive: true });
    await Promise.all([
      mkdir(layout.meta, { recursive: true }),
      mkdir(layout.logs, { recursive: true }),
      mkdir(layout.work, { recursive: true }),
      mkdir(layout.sharedContext, { recursive: true }),
      mkdir(layout.scratchpads, { recursive: true }),
    ]);
    const manifestPath = join(layout.meta, "manifest.json");
    const spaceMetaPath = join(layout.meta, "space.json");
    const policyPath = join(layout.meta, "policy.json");
    const localOverridePath = join(layout.meta, "local.override.json");

    const existingSpaceMeta = await readJsonFile(spaceMetaPath);
    const existingSpaceId = normalizeOptionalString(
      typeof existingSpaceMeta.spaceId === "string" ? existingSpaceMeta.spaceId : undefined,
    );
    const existingSpaceUid = normalizeOptionalString(
      typeof existingSpaceMeta.spaceUid === "string" ? existingSpaceMeta.spaceUid : undefined,
    );
    // Explicit folder binding may adopt stale metadata for the same logical space
    // after a gateway/main-space reset, but managed folders keep UID isolation.
    const hasConflict = Boolean(
      (existingSpaceId && existingSpaceId !== spaceId)
      || (!existingSpaceId && existingSpaceUid && existingSpaceUid !== spaceUid)
      || (!explicitRoot && existingSpaceId === spaceId && existingSpaceUid && existingSpaceUid !== spaceUid)
    );
    if (hasConflict) {
      throw new SpaceWorkspaceServiceError(
        "FAILED_PRECONDITION",
        `Workspace root is already bound to another space: ${effectiveRoot}`,
      );
    }

    const manifest = {
      layoutVersion: SPACE_WORKSPACE_LAYOUT_VERSION,
      generatedAt: nowIso,
      root: layout.root,
      spaceDir: layout.meta,
      paths: {
        meta: layout.meta,
        logs: layout.logs,
        work: layout.work,
        sharedContext: layout.sharedContext,
        scratchpads: layout.scratchpads,
      },
    };
    const spaceMetadata = {
      spaceId,
      spaceUid,
      mode: explicitRoot ? "folder_bound" : "managed",
      explicitWorkspaceRoot: explicitRoot || undefined,
      effectiveWorkspaceRoot: effectiveRoot,
      gitRepoDetected,
      layoutVersion: SPACE_WORKSPACE_LAYOUT_VERSION,
      updatedAt: nowIso,
    };
    const policyJson = {
      defaults: {
        retentionDays: 30,
        quotaProfile: "standard",
      },
      workspaceRoot: effectiveRoot,
      spaceDirPath: layout.meta,
      gitRepoDetected,
    };

    await Promise.all([
      writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
      writeFile(spaceMetaPath, `${JSON.stringify(spaceMetadata, null, 2)}\n`, "utf8"),
      writeFile(policyPath, `${JSON.stringify(policyJson, null, 2)}\n`, "utf8"),
    ]);
    await ensureFileExists(localOverridePath, "{}\n");
    if (gitRepoDetected) {
      await ensureGitignoreContains(effectiveRoot, SPACE_DIR_GITIGNORE_ENTRY);
    }

    return {
      path: layout.meta,
      status: "ready",
      updatedAt: nowIso,
      gitRepoDetected,
    };
  }

  private ensureManagedWorkspaceResource(
    spaceId: string,
    effectiveRoot: string,
    managedResourceId: string,
  ): void {
    const existing = this.options.resources.get(spaceId, managedResourceId);
    this.options.resources.upsert({
      resourceId: managedResourceId,
      spaceId,
      uri: pathToFileURL(effectiveRoot).toString(),
      type: "folder",
      label: "Workspace Root (managed)",
      addedAt: existing?.added_at,
    });
  }
}

function normalizeRequiredString(value: unknown, field: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new SpaceWorkspaceServiceError("INVALID_ARGUMENT", `${field} is required`);
  }
  return normalized;
}

function normalizeAbsolutePath(value: string, field: string): string {
  const normalizedInput = normalizeRequiredString(value, field);

  let resolvedInput = normalizedInput;
  const fileUrlPath = normalizeFileUrlPath(resolvedInput);
  if (fileUrlPath === null) {
      throw new SpaceWorkspaceServiceError("INVALID_ARGUMENT", `${field} must be a valid file:// URL`);
  }
  resolvedInput = fileUrlPath;

  if (!isAbsolutePath(resolvedInput)) {
    throw new SpaceWorkspaceServiceError("INVALID_ARGUMENT", `${field} must be an absolute path`);
  }

  return resolvePath(resolvedInput);
}
