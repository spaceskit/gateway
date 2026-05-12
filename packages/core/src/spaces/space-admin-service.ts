/**
 * SpaceAdminService — lifecycle and agent assignment management for spaces.
 *
 * This service is transport-agnostic. WS/HTTP/proto adapters should call this
 * layer so behavior and validation stay consistent.
 */

import { randomUUID } from "node:crypto";
import type { AgentSecurityScope } from "../security/types.js";
import type { ThinkingCapturePolicy } from "./memory-policy.js";
import type {
  ConversationTopology,
  CoordinatorRole,
  SpaceAgentAssignment,
  SpaceConfig,
  SpaceResource,
  SpaceResourceType,
  SpaceState,
  TurnModelConfig,
  TurnModelStrategy,
} from "./types.js";
import {
  inferResponseType,
  normalizeOptionalString,
  normalizeRole,
  normalizeSpaceState,
  normalizeUuidString,
  parseSpaceConfig,
  parseSpaceResourceType,
  stableJsonHash,
  uniqueStrings,
} from "./space-admin-normalizers.js";
import { SpaceAdminLegacySupport } from "./space-admin-legacy-support.js";

export { normalizeSpaceState } from "./space-admin-normalizers.js";

export type SpaceAdminErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "FAILED_PRECONDITION";

export class SpaceAdminError extends Error {
  readonly code: SpaceAdminErrorCode;

  constructor(code: SpaceAdminErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface SpaceStoreRecord {
  spaceId: string;
  resourceId: string;
  spaceType: string;
  name: string;
  goal: string;
  status: string;
  turnModel: string;
  spaceConfigJson: string | null;
  templateId: string;
  templateRevision: number;
  archivedAt?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSpaceStoreInput {
  spaceId: string;
  resourceId: string;
  spaceType: string;
  name: string;
  goal: string;
  turnModel: string;
  configJson?: string;
  templateId?: string;
  templateRevision?: number;
}

export interface ListSpacesStoreQuery {
  statuses?: string[];
  resourceId?: string;
  limit?: number;
}

export interface ArchiveSpaceInput {
  idempotencyKey?: string;
  spaceId: string;
}

export interface DeleteSpaceInput {
  idempotencyKey?: string;
  spaceId: string;
}

export interface SpaceAssignmentStoreRecord {
  spaceId: string;
  agentId: string;
  profileId: string;
  securityScopeJson: string | null;
  spawnContext: string | null;
  contextOverridesJson: string | null;
  role: string;
  turnOrder: number;
  isPrimary: number;
  assignedAt: string;
  updatedAt: string;
}

export interface UpsertSpaceAssignmentStoreInput {
  spaceId: string;
  agentId: string;
  profileId: string;
  securityScopeJson?: string | null;
  spawnContext?: string | null;
  contextOverridesJson?: string | null;
  role?: string;
  turnOrder?: number;
  isPrimary?: boolean;
  assignedAt?: string;
}

export interface SpaceSkillStoreRecord {
  spaceId: string;
  skillId: string;
  addedAt: string;
}

export interface UpsertSpaceSkillStoreInput {
  spaceId: string;
  skillId: string;
  addedAt?: string;
}

export interface SpaceResourceStoreRecord {
  resourceId: string;
  spaceId: string;
  uri: string;
  type: string;
  label: string;
  addedAt: string;
}

export interface UpsertSpaceResourceStoreInput {
  resourceId: string;
  spaceId: string;
  uri: string;
  type: string;
  label?: string;
  addedAt?: string;
}

export interface SpaceAdminServiceOptions {
  createSpaceRow: (input: CreateSpaceStoreInput) => Promise<SpaceStoreRecord>;
  getSpaceRow: (spaceId: string) => Promise<SpaceStoreRecord | null>;
  listSpaceRows: (query: ListSpacesStoreQuery) => Promise<SpaceStoreRecord[]>;
  archiveSpaceRow?: (spaceId: string, archivedAt: string) => Promise<SpaceStoreRecord | null>;
  deleteSpaceRow?: (spaceId: string, deletedAt: string) => Promise<SpaceStoreRecord | null>;
  updateSpaceConfigJson: (spaceId: string, configJson: string) => Promise<void>;
  /** Optional profile existence check used by orchestrator assignment updates. */
  profileExists?: (profileId: string) => Promise<boolean> | boolean;
  /** Optional profile archived-state check for assignment safety. */
  profileArchived?: (profileId: string) => Promise<boolean> | boolean;
  /** Optional profile capability check for orchestrator eligibility. */
  profileCanModerate?: (profileId: string) => Promise<boolean> | boolean;

  getAssignmentRow: (spaceId: string, agentId: string) => Promise<SpaceAssignmentStoreRecord | null>;
  listAssignmentRows: (spaceId: string) => Promise<SpaceAssignmentStoreRecord[]>;
  upsertAssignmentRow: (input: UpsertSpaceAssignmentStoreInput) => Promise<SpaceAssignmentStoreRecord>;
  deleteAssignmentRow: (spaceId: string, agentId: string) => Promise<boolean>;

  listSpaceSkillRows: (spaceId: string) => Promise<SpaceSkillStoreRecord[]>;
  upsertSpaceSkillRow: (input: UpsertSpaceSkillStoreInput) => Promise<SpaceSkillStoreRecord>;
  deleteSpaceSkillRow: (spaceId: string, skillId: string) => Promise<boolean>;
  /** Optional guard for protected skill bindings (for example system main-space skills). */
  isProtectedSpaceSkill?: (spaceId: string, skillId: string) => Promise<boolean> | boolean;

  listSpaceResourceRows: (spaceId: string) => Promise<SpaceResourceStoreRecord[]>;
  upsertSpaceResourceRow: (input: UpsertSpaceResourceStoreInput) => Promise<SpaceResourceStoreRecord>;
  deleteSpaceResourceRow: (spaceId: string, resourceId: string) => Promise<boolean>;
  /** Reserved resource-id prefixes rejected for user-managed resources. */
  reservedSpaceResourceIdPrefixes?: string[];
  /** Optional guard for protected resources (for example managed workspace roots). */
  isProtectedSpaceResource?: (spaceId: string, resourceId: string) => Promise<boolean> | boolean;

  loadIdempotencyRecord?: (
    principalId: string,
    endpoint: string,
    idempotencyKey: string,
  ) => Promise<{
    requestHash: string;
    responseType: string;
    responsePayload: string;
  } | null>;
  saveIdempotencyRecord?: (record: {
    principalId: string;
    endpoint: string;
    idempotencyKey: string;
    requestHash: string;
    responseType: string;
    responsePayload: string;
  }) => Promise<void>;
  idempotencyPrincipalId?: string;
  /**
   * Optional callback invoked when a request is missing `idempotencyKey`
   * while idempotency support is otherwise wired (load + save). Use this
   * to forward to a structured logger or telemetry channel. Defaults to a
   * no-op so test runs and production are silent unless explicitly opted in.
   */
  onMissingIdempotencyKey?: (endpoint: string) => void;

  now?: () => Date;
}

export interface AddAgentInput {
  idempotencyKey?: string;
  spaceId: string;
  agentId: string;
  profileId: string;
  securityScope?: AgentSecurityScope;
  spawnContext?: string;
  contextOverrides?: Record<string, unknown>;
  role?: CoordinatorRole | "participant";
  turnOrder?: number;
  isPrimary?: boolean;
}

export interface UpdateAgentAssignmentInput {
  idempotencyKey?: string;
  spaceId: string;
  agentId: string;
  profileId?: string;
  securityScope?: AgentSecurityScope | null;
  spawnContext?: string | null;
  contextOverrides?: Record<string, unknown> | null;
  role?: CoordinatorRole | "participant";
  turnOrder?: number;
  isPrimary?: boolean;
}

export interface SetSpaceOrchestratorInput {
  idempotencyKey?: string;
  spaceId: string;
  profileId: string;
}

export interface AddSpaceSkillInput {
  idempotencyKey?: string;
  spaceId: string;
  skillId: string;
}

export interface RemoveSpaceSkillInput {
  idempotencyKey?: string;
  spaceId: string;
  skillId: string;
}

export interface AddSpaceResourceInput {
  apiVersion?: string;
  idempotencyKey?: string;
  resourceId?: string;
  spaceId: string;
  uri: string;
  type: SpaceResourceType;
  label?: string;
}

export interface RemoveSpaceResourceInput {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  resourceId: string;
}

export interface CreateSpaceInput {
  idempotencyKey?: string;
  spaceId?: string;
  /** Optional caller-provided immutable UID. When omitted, generated server-side. */
  spaceUid?: string;
  resourceId: string;
  spaceType?: string;
  name: string;
  goal?: string;
  turnModel?: TurnModelStrategy;
  templateId?: string;
  templateRevision?: number;
  capabilities?: string[];
  capabilityOverrides?: Record<string, string>;
  visibility?: "shared" | "private";
  turnModelConfig?: TurnModelConfig;
  conversationTopology?: ConversationTopology;
  maxTurns?: number;
  thinkingCapturePolicy?: ThinkingCapturePolicy;
  moderatorProfileId?: string;
  initialAgents?: Omit<AddAgentInput, "spaceId">[];
}

export interface ListSpacesOptions {
  statuses?: SpaceState[];
  resourceId?: string;
  limit?: number;
}

export class SpaceAdminService {
  private readonly options: SpaceAdminServiceOptions;
  private readonly now: () => Date;
  private readonly idempotencyPrincipalId: string;
  private readonly reservedSpaceResourceIdPrefixes: string[];
  private readonly isProtectedSpaceSkill?: SpaceAdminServiceOptions["isProtectedSpaceSkill"];
  private readonly isProtectedSpaceResource?: SpaceAdminServiceOptions["isProtectedSpaceResource"];
  private readonly legacySupport: SpaceAdminLegacySupport;

  constructor(options: SpaceAdminServiceOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date());
    this.idempotencyPrincipalId = options.idempotencyPrincipalId ?? "space-admin";
    this.reservedSpaceResourceIdPrefixes = uniqueStrings(
      (options.reservedSpaceResourceIdPrefixes ?? [])
        .map((prefix) => prefix.trim())
        .filter((prefix) => prefix.length > 0),
    );
    this.isProtectedSpaceSkill = options.isProtectedSpaceSkill;
    this.isProtectedSpaceResource = options.isProtectedSpaceResource;
    this.legacySupport = new SpaceAdminLegacySupport(options, this.now);
  }

  async createSpace(input: CreateSpaceInput): Promise<SpaceConfig> {
    const name = input.name.trim();
    if (!name) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "Space name is required");
    }

    const spaceId = input.spaceId ?? `space-${randomUUID()}`;
    const requestedSpaceUid = normalizeUuidString(input.spaceUid);
    const resourceId = input.resourceId.trim();
    if (!resourceId) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "resourceId is required");
    }

    return this.withIdempotency(
      "space.create",
      input.idempotencyKey,
      {
        spaceId,
        spaceUid: requestedSpaceUid ?? null,
        resourceId,
        spaceType: input.spaceType ?? "space",
        name,
        goal: input.goal ?? "",
        turnModel: input.turnModel ?? "sequential_all",
        templateId: input.templateId ?? "",
        templateRevision: input.templateRevision ?? 0,
        capabilities: input.capabilities ?? [],
        capabilityOverrides: input.capabilityOverrides ?? {},
        visibility: input.visibility ?? "shared",
        turnModelConfig: input.turnModelConfig ?? null,
        maxTurns: input.maxTurns ?? null,
        moderatorProfileId: input.moderatorProfileId ?? "",
        initialAgents: input.initialAgents ?? [],
      },
      async () => {
        const spaceUid = requestedSpaceUid ?? randomUUID();
        const row = await this.options.createSpaceRow({
          spaceId,
          resourceId,
          spaceType: input.spaceType ?? "space",
          name,
          goal: input.goal ?? "",
          turnModel: input.turnModel ?? "sequential_all",
          configJson: JSON.stringify(this.legacySupport.buildSpaceConfigSeed(input, spaceUid)),
          templateId: input.templateId ?? "",
          templateRevision: input.templateRevision ?? 0,
        });

        if (input.initialAgents?.length) {
          for (let idx = 0; idx < input.initialAgents.length; idx++) {
            const assignment = input.initialAgents[idx];
            await this.addAgent({
              spaceId: row.spaceId,
              agentId: assignment.agentId,
              profileId: assignment.profileId,
              securityScope: assignment.securityScope,
              spawnContext: assignment.spawnContext,
              contextOverrides: assignment.contextOverrides,
              role: assignment.role,
              turnOrder: assignment.turnOrder ?? idx,
              isPrimary: assignment.isPrimary,
              idempotencyKey: input.idempotencyKey
                ? `${input.idempotencyKey}:initial-agent:${idx}`
                : undefined,
            });
          }
        }

        const hydrated = await this.getSpace(row.spaceId);
        if (!hydrated) {
          throw new SpaceAdminError("FAILED_PRECONDITION", `Failed to load created space: ${row.spaceId}`);
        }
        return hydrated;
      },
    );
  }

  async getSpace(spaceId: string): Promise<SpaceConfig | null> {
    const row = await this.options.getSpaceRow(spaceId);
    if (!row) return null;
    await this.legacySupport.initializeAssignmentsFromLegacy(row);
    return this.legacySupport.hydrateSpace(row);
  }

  async listSpaces(options: ListSpacesOptions = {}): Promise<SpaceConfig[]> {
    const rows = await this.options.listSpaceRows({
      statuses: options.statuses?.map((s) => s),
      resourceId: options.resourceId,
      limit: options.limit,
    });

    return Promise.all(rows.map(async (row) => {
      await this.legacySupport.initializeAssignmentsFromLegacy(row);
      return this.legacySupport.hydrateSpace(row);
    }));
  }

  async archiveSpace(input: ArchiveSpaceInput): Promise<SpaceConfig> {
    const spaceId = input.spaceId.trim();
    if (!spaceId) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "spaceId is required");
    }
    if (!this.options.archiveSpaceRow) {
      throw new SpaceAdminError("FAILED_PRECONDITION", "Space archive persistence unavailable");
    }

    return this.withIdempotency(
      "space.archive",
      input.idempotencyKey,
      { spaceId },
      async () => {
        const row = await this.options.getSpaceRow(spaceId);
        if (!row) {
          throw new SpaceAdminError("NOT_FOUND", `Space not found: ${spaceId}`);
        }
        if (normalizeSpaceState(row.status) === "deleted") {
          throw new SpaceAdminError("FAILED_PRECONDITION", `Space is deleted: ${spaceId}`);
        }

        const archived = await this.options.archiveSpaceRow!(spaceId, this.now().toISOString());
        if (!archived) {
          throw new SpaceAdminError("NOT_FOUND", `Space not found: ${spaceId}`);
        }

        const hydrated = await this.getSpace(spaceId);
        if (!hydrated) {
          throw new SpaceAdminError("FAILED_PRECONDITION", `Failed to load archived space: ${spaceId}`);
        }
        return hydrated;
      },
    );
  }

  async deleteSpace(input: DeleteSpaceInput): Promise<SpaceConfig> {
    const spaceId = input.spaceId.trim();
    if (!spaceId) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "spaceId is required");
    }
    if (!this.options.deleteSpaceRow) {
      throw new SpaceAdminError("FAILED_PRECONDITION", "Space delete persistence unavailable");
    }

    return this.withIdempotency(
      "space.delete",
      input.idempotencyKey,
      { spaceId },
      async () => {
        const row = await this.options.getSpaceRow(spaceId);
        if (!row) {
          throw new SpaceAdminError("NOT_FOUND", `Space not found: ${spaceId}`);
        }

        const deleted = await this.options.deleteSpaceRow!(spaceId, this.now().toISOString());
        if (!deleted) {
          throw new SpaceAdminError("NOT_FOUND", `Space not found: ${spaceId}`);
        }

        const hydrated = await this.getSpace(spaceId);
        if (!hydrated) {
          throw new SpaceAdminError("FAILED_PRECONDITION", `Failed to load deleted space: ${spaceId}`);
        }
        return hydrated;
      },
    );
  }

  async listAgentAssignments(spaceId: string): Promise<SpaceAgentAssignment[]> {
    const row = await this.options.getSpaceRow(spaceId);
    if (!row) {
      throw new SpaceAdminError("NOT_FOUND", `Space not found: ${spaceId}`);
    }
    await this.legacySupport.initializeAssignmentsFromLegacy(row);

    const assignments = await this.options.listAssignmentRows(spaceId);
    if (assignments.length > 0) {
      return assignments.map((assignment) => this.legacySupport.rowToAssignment(assignment));
    }

    const legacy = this.legacySupport.parseLegacyAssignments(spaceId, row.spaceConfigJson, row.createdAt);
    return legacy;
  }

  async addSkillToSpace(input: AddSpaceSkillInput): Promise<string[]> {
    const spaceId = input.spaceId.trim();
    const skillId = input.skillId.trim();
    this.validateSpaceSkillInput(spaceId, skillId);

    return this.withIdempotency(
      "space.add_skill",
      input.idempotencyKey,
      {
        spaceId,
        skillId,
      },
      async () => {
        const space = await this.options.getSpaceRow(spaceId);
        if (!space) {
          throw new SpaceAdminError("NOT_FOUND", `Space not found: ${spaceId}`);
        }

        await this.legacySupport.initializeSpaceSkillsFromLegacy(space);
        await this.options.upsertSpaceSkillRow({
          spaceId,
          skillId,
          addedAt: this.now().toISOString(),
        });
        await this.legacySupport.syncLegacySkillIds(spaceId);
        return this.listSpaceSkills(spaceId);
      },
    );
  }

  async removeSkillFromSpace(input: RemoveSpaceSkillInput): Promise<{ removed: boolean; skills: string[] }> {
    const spaceId = input.spaceId.trim();
    const skillId = input.skillId.trim();
    this.validateSpaceSkillInput(spaceId, skillId);

    return this.withIdempotency(
      "space.remove_skill",
      input.idempotencyKey,
      {
        spaceId,
        skillId,
      },
      async () => {
        const space = await this.options.getSpaceRow(spaceId);
        if (!space) {
          throw new SpaceAdminError("NOT_FOUND", `Space not found: ${spaceId}`);
        }

        await this.legacySupport.initializeSpaceSkillsFromLegacy(space);
        if (this.isProtectedSpaceSkill) {
          const protectedSkill = await this.isProtectedSpaceSkill(spaceId, skillId);
          if (protectedSkill) {
            throw new SpaceAdminError(
              "FAILED_PRECONDITION",
              `Skill cannot be removed from protected space binding: ${skillId}`,
            );
          }
        }
        const removed = await this.options.deleteSpaceSkillRow(spaceId, skillId);
        if (removed) {
          await this.legacySupport.syncLegacySkillIds(spaceId);
        }

        const skills = await this.listSpaceSkills(spaceId);
        return { removed, skills };
      },
    );
  }

  async listSpaceSkills(spaceIdRaw: string): Promise<string[]> {
    const spaceId = spaceIdRaw.trim();
    if (!spaceId) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "spaceId is required");
    }

    const row = await this.options.getSpaceRow(spaceId);
    if (!row) {
      throw new SpaceAdminError("NOT_FOUND", `Space not found: ${spaceId}`);
    }

    await this.legacySupport.initializeSpaceSkillsFromLegacy(row);
    const stored = await this.options.listSpaceSkillRows(spaceId);
    if (stored.length > 0) {
      return uniqueStrings(stored.map((entry) => entry.skillId));
    }

    return this.legacySupport.parseLegacySkillIds(row.spaceConfigJson);
  }

  async addResource(input: AddSpaceResourceInput): Promise<SpaceResource> {
    const spaceId = input.spaceId.trim();
    const requestedResourceId = input.resourceId?.trim();
    const uri = input.uri.trim();
    const type = parseSpaceResourceType(input.type);
    const label = input.label?.trim();
    if (!type) {
      throw new SpaceAdminError("INVALID_ARGUMENT", `Invalid resource type: ${String(input.type)}`);
    }
    if (requestedResourceId && this.isReservedSpaceResourceId(requestedResourceId)) {
      throw new SpaceAdminError(
        "INVALID_ARGUMENT",
        `resourceId uses a reserved prefix and cannot be assigned directly: ${requestedResourceId}`,
      );
    }
    this.validateSpaceResourceInput(spaceId, uri, type);

    return this.withIdempotency(
      "space.add_resource",
      input.idempotencyKey,
      {
        spaceId,
        resourceId: requestedResourceId ?? null,
        uri,
        type,
        label: label ?? null,
      },
      async () => {
        const space = await this.options.getSpaceRow(spaceId);
        if (!space) {
          throw new SpaceAdminError("NOT_FOUND", `Space not found: ${spaceId}`);
        }

        const row = await this.options.upsertSpaceResourceRow({
          resourceId: requestedResourceId || `space-resource-${randomUUID()}`,
          spaceId,
          uri,
          type,
          label,
          addedAt: this.now().toISOString(),
        });
        return this.legacySupport.rowToSpaceResource(row);
      },
    );
  }

  async removeResource(input: RemoveSpaceResourceInput): Promise<boolean> {
    const spaceId = input.spaceId.trim();
    const resourceId = input.resourceId.trim();
    if (!spaceId || !resourceId) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "spaceId and resourceId are required");
    }

    return this.withIdempotency(
      "space.remove_resource",
      input.idempotencyKey,
      {
        spaceId,
        resourceId,
      },
      async () => {
        const space = await this.options.getSpaceRow(spaceId);
        if (!space) {
          throw new SpaceAdminError("NOT_FOUND", `Space not found: ${spaceId}`);
        }
        if (this.isProtectedSpaceResource) {
          const protectedResource = await this.isProtectedSpaceResource(spaceId, resourceId);
          if (protectedResource) {
            throw new SpaceAdminError(
              "FAILED_PRECONDITION",
              `Resource cannot be removed directly while managed: ${resourceId}`,
            );
          }
        }
        return this.options.deleteSpaceResourceRow(spaceId, resourceId);
      },
    );
  }

  async listResources(spaceIdRaw: string): Promise<SpaceResource[]> {
    const spaceId = spaceIdRaw.trim();
    if (!spaceId) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "spaceId is required");
    }

    const row = await this.options.getSpaceRow(spaceId);
    if (!row) {
      throw new SpaceAdminError("NOT_FOUND", `Space not found: ${spaceId}`);
    }

    const resources = await this.options.listSpaceResourceRows(spaceId);
    return resources.map((entry) => this.legacySupport.rowToSpaceResource(entry));
  }

  async setSpaceOrchestrator(input: SetSpaceOrchestratorInput): Promise<SpaceConfig> {
    const spaceId = input.spaceId.trim();
    const profileId = input.profileId.trim();
    if (!spaceId || !profileId) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "spaceId and profileId are required");
    }

    return this.withIdempotency(
      "space.set_orchestrator",
      input.idempotencyKey,
      {
        spaceId,
        profileId,
      },
      async () => {
        const space = await this.options.getSpaceRow(spaceId);
        if (!space) {
          throw new SpaceAdminError("NOT_FOUND", `Space not found: ${spaceId}`);
        }
        await this.assertAssignableProfile(profileId, { forOrchestrator: true });

        const parsedConfig = parseSpaceConfig(space.spaceConfigJson);
        parsedConfig.orchestratorProfileId = profileId;
        await this.options.updateSpaceConfigJson(spaceId, JSON.stringify(parsedConfig));
        await this.legacySupport.alignOrchestratorAssignment(spaceId, profileId);

        const updated = await this.getSpace(spaceId);
        if (!updated) {
          throw new SpaceAdminError("FAILED_PRECONDITION", `Failed to load updated space: ${spaceId}`);
        }
        return updated;
      },
    );
  }

  async addAgent(input: AddAgentInput): Promise<SpaceAgentAssignment> {
    this.validateAssignmentInput(input.spaceId, input.agentId, input.profileId);

    return this.withIdempotency(
      "space.add_agent",
      input.idempotencyKey,
      {
        spaceId: input.spaceId,
        agentId: input.agentId,
        profileId: input.profileId,
        securityScope: input.securityScope ?? null,
        spawnContext: input.spawnContext ?? null,
        contextOverrides: input.contextOverrides ?? null,
        role: input.role ?? "participant",
        turnOrder: input.turnOrder ?? null,
        isPrimary: input.isPrimary ?? false,
      },
      async () => {
        const row = await this.options.getSpaceRow(input.spaceId);
        if (!row) {
          throw new SpaceAdminError("NOT_FOUND", `Space not found: ${input.spaceId}`);
        }
        await this.legacySupport.initializeAssignmentsFromLegacy(row);
        await this.assertAssignableProfile(input.profileId);

        const existing = await this.options.getAssignmentRow(input.spaceId, input.agentId);
        if (existing) {
          throw new SpaceAdminError(
            "ALREADY_EXISTS",
            `Agent ${input.agentId} is already assigned to space ${input.spaceId}`,
          );
        }

        const currentAssignments = await this.listAgentAssignments(input.spaceId);
        const turnOrder = input.turnOrder ?? this.nextTurnOrder(currentAssignments);
        const requestedRole = normalizeRole(input.role);
        const requestedIsPrimary = input.isPrimary ?? requestedRole === "global_coordinator";

        const assignmentRow = await this.options.upsertAssignmentRow({
          spaceId: input.spaceId,
          agentId: input.agentId,
          profileId: input.profileId,
          securityScopeJson: input.securityScope ? JSON.stringify(input.securityScope) : null,
          spawnContext: normalizeOptionalString(input.spawnContext) ?? null,
          contextOverridesJson: input.contextOverrides ? JSON.stringify(input.contextOverrides) : null,
          role: requestedRole,
          turnOrder,
          isPrimary: requestedIsPrimary,
          assignedAt: this.now().toISOString(),
        });
        await this.legacySupport.enforceSingleCoordinatorAndPrimary(input.spaceId, input.agentId, {
          enforceCoordinator: requestedRole === "global_coordinator",
          enforcePrimary: requestedIsPrimary,
        });

        await this.legacySupport.syncLegacyAssignments(input.spaceId);
        const normalized = await this.options.getAssignmentRow(input.spaceId, input.agentId);
        return this.legacySupport.rowToAssignment(normalized ?? assignmentRow);
      },
    );
  }

  async updateAgentAssignment(input: UpdateAgentAssignmentInput): Promise<SpaceAgentAssignment> {
    const spaceId = input.spaceId.trim();
    const agentId = input.agentId.trim();
    if (!spaceId || !agentId) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "spaceId and agentId are required");
    }

    return this.withIdempotency(
      "space.update_agent_assignment",
      input.idempotencyKey,
      {
        spaceId,
        agentId,
        profileId: input.profileId ?? null,
        securityScope: input.securityScope ?? null,
        spawnContext: input.spawnContext ?? null,
        contextOverrides: input.contextOverrides ?? null,
        role: input.role ?? null,
        turnOrder: input.turnOrder ?? null,
        isPrimary: input.isPrimary ?? null,
      },
      async () => {
        const space = await this.options.getSpaceRow(spaceId);
        if (!space) {
          throw new SpaceAdminError("NOT_FOUND", `Space not found: ${spaceId}`);
        }
        await this.legacySupport.initializeAssignmentsFromLegacy(space);

        let existing = await this.options.getAssignmentRow(spaceId, agentId);
        if (!existing) {
          existing = await this.legacySupport.recoverMissingAssignmentFromLegacy(space, agentId);
        }
        if (!existing) {
          throw new SpaceAdminError("NOT_FOUND", `Assignment not found: ${spaceId}/${agentId}`);
        }

        const existingAssignment = this.legacySupport.rowToAssignment(existing);
        const requestedProfileId = input.profileId?.trim();
        if (requestedProfileId && requestedProfileId !== existingAssignment.profileId) {
          await this.assertAssignableProfile(requestedProfileId);
        }
        const nextSecurityScope = input.securityScope === undefined
          ? existingAssignment.securityScope
          : input.securityScope ?? undefined;
        const nextSpawnContext = input.spawnContext === undefined
          ? existingAssignment.spawnContext
          : normalizeOptionalString(input.spawnContext) ?? undefined;
        const nextContextOverrides = input.contextOverrides === undefined
          ? existingAssignment.contextOverrides
          : input.contextOverrides ?? undefined;
        const requestedRole = normalizeRole(input.role ?? existingAssignment.role);
        const requestedIsPrimary = requestedRole === "global_coordinator"
          ? (input.isPrimary ?? true)
          : (input.isPrimary ?? existingAssignment.isPrimary);

        const assignmentRow = await this.options.upsertAssignmentRow({
          spaceId,
          agentId,
          profileId: requestedProfileId || existingAssignment.profileId,
          securityScopeJson: nextSecurityScope ? JSON.stringify(nextSecurityScope) : null,
          spawnContext: nextSpawnContext ?? null,
          contextOverridesJson: nextContextOverrides ? JSON.stringify(nextContextOverrides) : null,
          role: requestedRole,
          turnOrder: input.turnOrder ?? existingAssignment.turnOrder,
          isPrimary: requestedIsPrimary,
          assignedAt: existingAssignment.assignedAt.toISOString(),
        });
        await this.legacySupport.enforceSingleCoordinatorAndPrimary(spaceId, agentId, {
          enforceCoordinator: requestedRole === "global_coordinator",
          enforcePrimary: requestedIsPrimary,
        });

        await this.legacySupport.syncLegacyAssignments(spaceId);
        const normalized = await this.options.getAssignmentRow(spaceId, agentId);
        return this.legacySupport.rowToAssignment(normalized ?? assignmentRow);
      },
    );
  }

  async removeAgent(spaceId: string, agentId: string, idempotencyKey?: string): Promise<boolean> {
    const trimmedSpaceId = spaceId.trim();
    const trimmedAgentId = agentId.trim();
    if (!trimmedSpaceId || !trimmedAgentId) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "spaceId and agentId are required");
    }

    return this.withIdempotency(
      "space.remove_agent",
      idempotencyKey,
      {
        spaceId: trimmedSpaceId,
        agentId: trimmedAgentId,
      },
      async () => {
        const row = await this.options.getSpaceRow(trimmedSpaceId);
        if (!row) {
          throw new SpaceAdminError("NOT_FOUND", `Space not found: ${trimmedSpaceId}`);
        }
        await this.legacySupport.initializeAssignmentsFromLegacy(row);

        let deleted = await this.options.deleteAssignmentRow(trimmedSpaceId, trimmedAgentId);
        if (!deleted) {
          await this.legacySupport.recoverMissingAssignmentFromLegacy(row, trimmedAgentId);
          deleted = await this.options.deleteAssignmentRow(trimmedSpaceId, trimmedAgentId);
        }
        if (deleted) {
          await this.legacySupport.syncLegacyAssignments(trimmedSpaceId);
        }
        return deleted;
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private isReservedSpaceResourceId(resourceId: string): boolean {
    if (this.reservedSpaceResourceIdPrefixes.length === 0) return false;
    return this.reservedSpaceResourceIdPrefixes.some((prefix) => resourceId.startsWith(prefix));
  }

  private nextTurnOrder(assignments: SpaceAgentAssignment[]): number {
    if (assignments.length === 0) return 0;
    return Math.max(...assignments.map((assignment) => assignment.turnOrder)) + 1;
  }

  private validateAssignmentInput(spaceId: string, agentId: string, profileId: string): void {
    if (!spaceId.trim()) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "spaceId is required");
    }
    if (!agentId.trim()) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "agentId is required");
    }
    if (!profileId.trim()) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "profileId is required");
    }
  }

  private validateSpaceSkillInput(spaceId: string, skillId: string): void {
    if (!spaceId.trim()) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "spaceId is required");
    }
    if (!skillId.trim()) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "skillId is required");
    }
  }

  private validateSpaceResourceInput(
    spaceId: string,
    uri: string,
    type: SpaceResourceType,
  ): void {
    if (!spaceId.trim()) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "spaceId is required");
    }
    if (!uri.trim()) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "uri is required");
    }
    if (type !== "folder" && type !== "url") {
      throw new SpaceAdminError("INVALID_ARGUMENT", `Invalid resource type: ${type}`);
    }
  }

  private async assertAssignableProfile(
    profileIdRaw: string,
    options: { forOrchestrator?: boolean } = {},
  ): Promise<void> {
    const profileId = profileIdRaw.trim();
    if (!profileId) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "profileId is required");
    }

    if (this.options.profileExists) {
      const profileExists = await this.options.profileExists(profileId);
      if (!profileExists) {
        throw new SpaceAdminError("INVALID_ARGUMENT", `Profile not found: ${profileId}`);
      }
    }

    if (this.options.profileArchived) {
      const archived = await this.options.profileArchived(profileId);
      if (archived) {
        throw new SpaceAdminError("INVALID_ARGUMENT", `Profile is archived: ${profileId}`);
      }
    }

    if (options.forOrchestrator && this.options.profileCanModerate) {
      const canModerate = await this.options.profileCanModerate(profileId);
      if (!canModerate) {
        throw new SpaceAdminError(
          "INVALID_ARGUMENT",
          `Profile cannot be assigned as orchestrator (canModerate=false): ${profileId}`,
        );
      }
    }
  }

  private async withIdempotency<T>(
    endpoint: string,
    idempotencyKey: string | undefined,
    requestPayload: Record<string, unknown>,
    execute: () => Promise<T>,
  ): Promise<T> {
    const normalizedKey = idempotencyKey?.trim();
    const loadRecord = this.options.loadIdempotencyRecord;
    const saveRecord = this.options.saveIdempotencyRecord;

    if (!normalizedKey || !loadRecord || !saveRecord) {
      if (!normalizedKey && loadRecord && saveRecord) {
        this.options.onMissingIdempotencyKey?.(endpoint);
      }
      return execute();
    }

    const requestHash = stableJsonHash(requestPayload);
    const existing = await loadRecord(this.idempotencyPrincipalId, endpoint, normalizedKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new SpaceAdminError(
          "FAILED_PRECONDITION",
          `Idempotency key replay with different request payload: ${normalizedKey}`,
        );
      }

      try {
        return JSON.parse(existing.responsePayload) as T;
      } catch {
        throw new SpaceAdminError("FAILED_PRECONDITION", "Stored idempotency response is invalid");
      }
    }

    const result = await execute();

    await saveRecord({
      principalId: this.idempotencyPrincipalId,
      endpoint,
      idempotencyKey: normalizedKey,
      requestHash,
      responseType: inferResponseType(result),
      responsePayload: JSON.stringify(result),
    });

    return result;
  }
}
