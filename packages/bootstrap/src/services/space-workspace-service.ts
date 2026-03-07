import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve as resolvePath, sep as pathSep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Logger } from "@spaceskit/observability";
import {
  SpaceRepository,
  SpaceResourceRepository,
  SpaceWorkspaceRepository,
  type SpaceWorkspaceRow,
} from "@spaceskit/persistence";

export const SPACE_WORKSPACE_LAYOUT_VERSION = 2;
export const SPACE_WORKSPACE_MANAGED_RESOURCE_PREFIX = "space-workspace-root-";
const SPACE_DIR_FOLDER = ".space";
const SPACE_DIR_GITIGNORE_ENTRY = ".space/";

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
  updatedAt: string;
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

interface SpaceWorkspaceLayout {
  root: string;
  meta: string;
  logs: string;
  work: string;
  sharedContext: string;
  scratchpads: string;
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
    const spaceUid = this.resolveOrCreateSpaceUid(space);
    const managedResourceId = this.managedResourceId(spaceId);
    const existing = this.options.workspaces.getBySpace(spaceId);
    const explicitRoot = normalizeOptionalString(existing?.explicit_root) ?? "";
    const effectiveRoot = explicitRoot
      ? normalizeAbsolutePath(explicitRoot, "explicit workspace root")
      : this.defaultWorkspaceRoot(spaceUid);
    const metadataState = await this.provisionWorkspaceLayout(spaceId, spaceUid, explicitRoot, effectiveRoot);

    this.ensureManagedWorkspaceResource(spaceId, effectiveRoot, managedResourceId);
    const row = this.options.workspaces.upsert({
      spaceId,
      explicitRoot,
      effectiveRoot,
      managedResourceId,
      layoutVersion: existing?.layout_version || SPACE_WORKSPACE_LAYOUT_VERSION,
      metadataPath: metadataState.path,
      metadataStatus: metadataState.status,
      metadataUpdatedAt: metadataState.updatedAt,
    });
    return this.toWorkspacePayload(spaceId, spaceUid, row, metadataState.gitRepoDetected);
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
    const explicitRoot = normalizeOptionalString(explicitWorkspaceRoot)
      ? normalizeAbsolutePath(explicitWorkspaceRoot!, "workspaceRoot")
      : "";
    const effectiveRoot = explicitRoot || this.defaultWorkspaceRoot(spaceUid);
    const managedResourceId = this.managedResourceId(spaceId);

    const metadataState = await this.provisionWorkspaceLayout(spaceId, spaceUid, explicitRoot, effectiveRoot);
    this.ensureManagedWorkspaceResource(spaceId, effectiveRoot, managedResourceId);
    const row = this.options.workspaces.upsert({
      spaceId,
      explicitRoot,
      effectiveRoot,
      managedResourceId,
      layoutVersion: SPACE_WORKSPACE_LAYOUT_VERSION,
      metadataPath: metadataState.path,
      metadataStatus: metadataState.status,
      metadataUpdatedAt: metadataState.updatedAt,
    });

    return this.toWorkspacePayload(spaceId, spaceUid, row, metadataState.gitRepoDetected);
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
    const existingSpaceUid = normalizeOptionalString(parsed.spaceUid)
      ?? normalizeOptionalString(parsed.space_uid);
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

  private defaultWorkspaceRoot(spaceUid: string): string {
    return resolvePath(this.spacesRoot, spaceUid);
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
    const hasConflict = Boolean(
      (existingSpaceId && existingSpaceId !== spaceId)
      || (existingSpaceUid && existingSpaceUid !== spaceUid),
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

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseMetadataStatus(value: unknown): SpaceWorkspaceMetadataStatus {
  if (value === "unknown" || value === "ready" || value === "conflict") {
    return value;
  }
  return "unknown";
}

function detectGitRepo(root: string): boolean {
  return existsSync(join(root, ".git"));
}

async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(path, "utf8");
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

async function ensureFileExists(path: string, content: string): Promise<void> {
  try {
    await readFile(path, "utf8");
  } catch {
    await writeFile(path, content, "utf8");
  }
}

async function ensureGitignoreContains(root: string, entry: string): Promise<void> {
  const gitignorePath = join(root, ".gitignore");
  let current = "";
  try {
    current = await readFile(gitignorePath, "utf8");
  } catch {
    current = "";
  }

  const lines = current
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.includes(entry)) return;

  const next = current.endsWith("\n") || current.length === 0
    ? `${current}${entry}\n`
    : `${current}\n${entry}\n`;
  await writeFile(gitignorePath, next, "utf8");
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
  if (resolvedInput.startsWith("file://")) {
    try {
      resolvedInput = fileURLToPath(new URL(resolvedInput));
    } catch {
      throw new SpaceWorkspaceServiceError("INVALID_ARGUMENT", `${field} must be a valid file:// URL`);
    }
  }

  if (!isAbsolute(resolvedInput)) {
    throw new SpaceWorkspaceServiceError("INVALID_ARGUMENT", `${field} must be an absolute path`);
  }

  return resolvePath(resolvedInput);
}

function workspaceLayout(root: string): SpaceWorkspaceLayout {
  const normalizedRoot = resolvePath(root);
  return {
    root: normalizedRoot,
    meta: join(normalizedRoot, SPACE_DIR_FOLDER),
    logs: join(normalizedRoot, SPACE_DIR_FOLDER, "logs"),
    work: join(normalizedRoot, SPACE_DIR_FOLDER, "work"),
    sharedContext: join(normalizedRoot, SPACE_DIR_FOLDER, "shared-context"),
    scratchpads: join(normalizedRoot, SPACE_DIR_FOLDER, "scratchpads"),
  };
}

function parseSpaceConfig(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function serializeEventForJsonl(event: Record<string, unknown>, includeDebugPayloads: boolean): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: typeof event.type === "string" ? event.type : "unknown",
    timestamp: normalizeEventTimestamp(event.timestamp),
    spaceId: typeof event.spaceId === "string" ? event.spaceId : undefined,
    turnId: typeof event.turnId === "string" ? event.turnId : undefined,
    agentId: typeof event.agentId === "string" ? event.agentId : undefined,
  };

  const metadata: Record<string, unknown> = {};
  const heavyKeys = new Set([
    "input",
    "output",
    "messages",
    "payload",
    "args",
    "result",
    "content",
    "text",
    "prompt",
    "toolCalls",
  ]);

  for (const [key, value] of Object.entries(event)) {
    if (key === "type" || key === "timestamp" || key === "spaceId" || key === "turnId" || key === "agentId") {
      continue;
    }

    if (!includeDebugPayloads && heavyKeys.has(key)) {
      continue;
    }

    metadata[key] = summarizeValue(value, includeDebugPayloads);
  }

  if (Object.keys(metadata).length > 0) {
    base.metadata = metadata;
  }

  return base;
}

function normalizeEventTimestamp(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

function summarizeValue(value: unknown, includeDebugPayloads: boolean): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (includeDebugPayloads) return value;
    return value.length > 256 ? `[string:${value.length}]` : value;
  }
  if (Array.isArray(value)) {
    if (includeDebugPayloads) return value;
    return `[array:${value.length}]`;
  }
  if (typeof value === "object") {
    if (includeDebugPayloads) return value;
    return "[object]";
  }
  return String(value);
}

export function normalizeCandidatePath(
  rawPath: unknown,
  cwdRaw?: unknown,
): string | null {
  if (typeof rawPath !== "string") return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;

  let decoded = trimmed;
  if (decoded.startsWith("file://")) {
    try {
      decoded = fileURLToPath(new URL(decoded));
    } catch {
      return null;
    }
  }

  const cwd = typeof cwdRaw === "string" && cwdRaw.trim().length > 0
    ? cwdRaw.trim()
    : undefined;
  const resolved = cwd
    ? resolvePath(cwd, decoded)
    : resolvePath(decoded);
  return resolved;
}

export function isPathWithinScope(targetPath: string, scopePath: string): boolean {
  const normalizedTarget = resolvePath(targetPath);
  const normalizedScope = resolvePath(scopePath);
  if (normalizedTarget === normalizedScope) return true;
  return normalizedTarget.startsWith(`${normalizedScope}${pathSep}`);
}
