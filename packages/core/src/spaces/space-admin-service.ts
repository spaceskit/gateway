/**
 * SpaceAdminService — lifecycle and agent assignment management for spaces.
 *
 * This service is transport-agnostic. WS/HTTP/proto adapters should call this
 * layer so behavior and validation stay consistent.
 */

import { randomUUID } from "node:crypto";
import { normalizeUuid } from "../identity/uuid.js";
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

const TURN_MODEL_VALUES: TurnModelStrategy[] = [
  "sequential_all",
  "primary_only",
  "first_success",
  "round_robin",
  "parallel_race",
  "debate_synthesis",
  "adaptive_auto",
];

const SPACE_STATE_VALUES: SpaceState[] = [
  "created",
  "active",
  "paused",
  "completed",
  "failed",
  "archived",
  "deleted",
];

const ROLE_VALUES = new Set<CoordinatorRole | "participant">([
  "participant",
  "global_coordinator",
  "space_moderator",
]);

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
          configJson: JSON.stringify(this.buildSpaceConfigSeed(input, spaceUid)),
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
    await this.initializeAssignmentsFromLegacy(row);
    return this.hydrateSpace(row);
  }

  async listSpaces(options: ListSpacesOptions = {}): Promise<SpaceConfig[]> {
    const rows = await this.options.listSpaceRows({
      statuses: options.statuses?.map((s) => s),
      resourceId: options.resourceId,
      limit: options.limit,
    });

    return Promise.all(rows.map(async (row) => {
      await this.initializeAssignmentsFromLegacy(row);
      return this.hydrateSpace(row);
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
    await this.initializeAssignmentsFromLegacy(row);

    const assignments = await this.options.listAssignmentRows(spaceId);
    if (assignments.length > 0) {
      return assignments.map((assignment) => this.rowToAssignment(assignment));
    }

    const legacy = this.parseLegacyAssignments(spaceId, row.spaceConfigJson, row.createdAt);
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

        await this.initializeSpaceSkillsFromLegacy(space);
        await this.options.upsertSpaceSkillRow({
          spaceId,
          skillId,
          addedAt: this.now().toISOString(),
        });
        await this.syncLegacySkillIds(spaceId);
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

        await this.initializeSpaceSkillsFromLegacy(space);
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
          await this.syncLegacySkillIds(spaceId);
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

    await this.initializeSpaceSkillsFromLegacy(row);
    const stored = await this.options.listSpaceSkillRows(spaceId);
    if (stored.length > 0) {
      return uniqueStrings(stored.map((entry) => entry.skillId));
    }

    return this.parseLegacySkillIds(row.spaceConfigJson);
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
        return this.rowToSpaceResource(row);
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
    return resources.map((entry) => this.rowToSpaceResource(entry));
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
        await this.alignOrchestratorAssignment(spaceId, profileId);

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
        await this.initializeAssignmentsFromLegacy(row);
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
        await this.enforceSingleCoordinatorAndPrimary(input.spaceId, input.agentId, {
          enforceCoordinator: requestedRole === "global_coordinator",
          enforcePrimary: requestedIsPrimary,
        });

        await this.syncLegacyAssignments(input.spaceId);
        const normalized = await this.options.getAssignmentRow(input.spaceId, input.agentId);
        return this.rowToAssignment(normalized ?? assignmentRow);
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
        await this.initializeAssignmentsFromLegacy(space);

        let existing = await this.options.getAssignmentRow(spaceId, agentId);
        if (!existing) {
          existing = await this.recoverMissingAssignmentFromLegacy(space, agentId);
        }
        if (!existing) {
          throw new SpaceAdminError("NOT_FOUND", `Assignment not found: ${spaceId}/${agentId}`);
        }

        const existingAssignment = this.rowToAssignment(existing);
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
        await this.enforceSingleCoordinatorAndPrimary(spaceId, agentId, {
          enforceCoordinator: requestedRole === "global_coordinator",
          enforcePrimary: requestedIsPrimary,
        });

        await this.syncLegacyAssignments(spaceId);
        const normalized = await this.options.getAssignmentRow(spaceId, agentId);
        return this.rowToAssignment(normalized ?? assignmentRow);
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
        await this.initializeAssignmentsFromLegacy(row);

        let deleted = await this.options.deleteAssignmentRow(trimmedSpaceId, trimmedAgentId);
        if (!deleted) {
          await this.recoverMissingAssignmentFromLegacy(row, trimmedAgentId);
          deleted = await this.options.deleteAssignmentRow(trimmedSpaceId, trimmedAgentId);
        }
        if (deleted) {
          await this.syncLegacyAssignments(trimmedSpaceId);
        }
        return deleted;
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async hydrateSpace(row: SpaceStoreRecord): Promise<SpaceConfig> {
    const parsedConfig = parseSpaceConfig(row.spaceConfigJson);
    const existingSpaceUid = resolveSpaceUid(parsedConfig);
    const spaceUid = existingSpaceUid ?? randomUUID();
    if (!existingSpaceUid) {
      parsedConfig.spaceUid = spaceUid;
      await this.options.updateSpaceConfigJson(row.spaceId, JSON.stringify(parsedConfig));
    }
    const storedAssignments = await this.options.listAssignmentRows(row.spaceId);
    const storedSkills = await this.options.listSpaceSkillRows(row.spaceId);

    const assignments = storedAssignments.length > 0
      ? storedAssignments.map((assignment) => this.rowToAssignment(assignment))
      : this.parseLegacyAssignments(row.spaceId, row.spaceConfigJson, row.createdAt);
    const skillIds = storedSkills.length > 0
      ? uniqueStrings(storedSkills.map((entry) => entry.skillId))
      : this.parseLegacySkillIds(row.spaceConfigJson);

    const orchestratorProfileId = normalizeOptionalString(parsedConfig.orchestratorProfileId)
      ?? normalizeOptionalString(parsedConfig.orchestrator_profile_id)
      ?? assignments.find((assignment) => assignment.isPrimary)?.profileId;

    return {
      id: row.spaceId,
      spaceUid,
      status: normalizeSpaceState(row.status),
      resourceId: row.resourceId,
      name: row.name,
      goal: row.goal || undefined,
      orchestratorProfileId,
      templateId: row.templateId || undefined,
      turnModel: normalizeTurnModel(row.turnModel),
      turnModelConfig: parseTurnModelConfig(parsedConfig),
      thinkingCapturePolicy: parseThinkingCapturePolicy(
        parsedConfig.thinkingCapturePolicy ?? parsedConfig.thinking_capture_policy,
      ),
      skillIds,
      agents: assignments,
      capabilities: parseStringArray(parsedConfig.capabilities),
      capabilityOverrides: parseStringMap(parsedConfig.capabilityOverrides),
      maxTurns: parseOptionalInt(parsedConfig.maxTurns),
      visibility: parseVisibility(parsedConfig.visibility),
      moderatorProfileId: asString(parsedConfig.moderatorProfileId),
      archivedAt: parseOptionalDate(row.archivedAt),
      deletedAt: parseOptionalDate(row.deletedAt),
      createdAt: parseDate(row.createdAt, this.now()),
      updatedAt: parseDate(row.updatedAt, this.now()),
    };
  }

  private parseLegacyAssignments(
    spaceId: string,
    spaceConfigJson: string | null,
    fallbackAssignedAt: string,
  ): SpaceAgentAssignment[] {
    const parsedConfig = parseSpaceConfig(spaceConfigJson);
    const rawAgents = Array.isArray(parsedConfig.agents) ? parsedConfig.agents : [];
    const fallbackDate = parseDate(fallbackAssignedAt, this.now());

    const assignments: SpaceAgentAssignment[] = [];
    for (let idx = 0; idx < rawAgents.length; idx++) {
      const raw = rawAgents[idx];
      if (!isRecord(raw)) continue;

      const agentId = asString(raw.agentId) ?? asString(raw.agent_id);
      if (!agentId) continue;

      const profileId = asString(raw.profileId) ?? asString(raw.profile_id) ?? agentId;
      const role = normalizeRole(
        asString(raw.role) as CoordinatorRole | "participant" | undefined,
      );
      const turnOrder = asInt(raw.turnOrder) ?? asInt(raw.turn_order) ?? idx;
      const isPrimary = asBoolean(raw.isPrimary) ?? asBoolean(raw.is_primary) ?? false;

      let securityScope: AgentSecurityScope | undefined;
      const rawSecurity = raw.securityScope ?? raw.security_scope;
      if (isRecord(rawSecurity)) {
        securityScope = rawSecurity as unknown as AgentSecurityScope;
      }
      const spawnContext = normalizeOptionalString(raw.spawnContext ?? raw.spawn_context);
      const rawContextOverrides = raw.contextOverrides ?? raw.context_overrides;
      const contextOverrides = isRecord(rawContextOverrides)
        ? rawContextOverrides
        : undefined;

      const assignedAtRaw = asString(raw.assignedAt) ?? asString(raw.assigned_at);
      assignments.push({
        spaceId,
        agentId,
        profileId,
        securityScope,
        spawnContext,
        contextOverrides,
        role,
        turnOrder,
        isPrimary,
        assignedAt: parseDate(assignedAtRaw, fallbackDate),
      });
    }

    return assignments;
  }

  private rowToAssignment(row: SpaceAssignmentStoreRecord): SpaceAgentAssignment {
    let securityScope: AgentSecurityScope | undefined;
    if (row.securityScopeJson) {
      try {
        const parsed = JSON.parse(row.securityScopeJson);
        if (isRecord(parsed)) {
          securityScope = parsed as unknown as AgentSecurityScope;
        }
      } catch {
        // Ignore malformed scope and keep assignment usable.
      }
    }
    let contextOverrides: Record<string, unknown> | undefined;
    if (row.contextOverridesJson) {
      try {
        const parsed = JSON.parse(row.contextOverridesJson);
        if (isRecord(parsed)) {
          contextOverrides = parsed;
        }
      } catch {
        // Ignore malformed overrides and keep assignment usable.
      }
    }

    return {
      spaceId: row.spaceId,
      agentId: row.agentId,
      profileId: row.profileId,
      securityScope,
      spawnContext: normalizeOptionalString(row.spawnContext),
      contextOverrides,
      role: normalizeRole(row.role as CoordinatorRole | "participant"),
      turnOrder: row.turnOrder,
      isPrimary: row.isPrimary === 1,
      assignedAt: parseDate(row.assignedAt, this.now()),
    };
  }

  private rowToSpaceResource(row: SpaceResourceStoreRecord): SpaceResource {
    return {
      resourceId: row.resourceId,
      spaceId: row.spaceId,
      uri: row.uri,
      type: normalizeSpaceResourceType(row.type),
      label: normalizeOptionalString(row.label),
      addedAt: parseDate(row.addedAt, this.now()),
    };
  }

  private isReservedSpaceResourceId(resourceId: string): boolean {
    if (this.reservedSpaceResourceIdPrefixes.length === 0) return false;
    return this.reservedSpaceResourceIdPrefixes.some((prefix) => resourceId.startsWith(prefix));
  }

  private async syncLegacyAssignments(spaceId: string): Promise<void> {
    const row = await this.options.getSpaceRow(spaceId);
    if (!row) return;

    const parsedConfig = parseSpaceConfig(row.spaceConfigJson);
    const assignments = await this.options.listAssignmentRows(spaceId);
    parsedConfig.agents = assignments.map((assignment) =>
      this.serializeAssignmentForConfig(this.rowToAssignment(assignment)),
    );

    await this.options.updateSpaceConfigJson(spaceId, JSON.stringify(parsedConfig));
  }

  private parseLegacySkillIds(spaceConfigJson: string | null): string[] {
    const parsedConfig = parseSpaceConfig(spaceConfigJson);
    return uniqueStrings(
      parseStringArray(parsedConfig.skillIds ?? parsedConfig.skill_ids),
    );
  }

  private async syncLegacySkillIds(spaceId: string): Promise<void> {
    const row = await this.options.getSpaceRow(spaceId);
    if (!row) return;

    const parsedConfig = parseSpaceConfig(row.spaceConfigJson);
    const skills = await this.options.listSpaceSkillRows(spaceId);
    parsedConfig.skillIds = uniqueStrings(skills.map((entry) => entry.skillId));

    await this.options.updateSpaceConfigJson(spaceId, JSON.stringify(parsedConfig));
  }

  private async initializeAssignmentsFromLegacy(space: SpaceStoreRecord): Promise<void> {
    const existing = await this.options.listAssignmentRows(space.spaceId);
    const legacy = this.parseLegacyAssignments(space.spaceId, space.spaceConfigJson, space.createdAt);
    if (legacy.length === 0) return;

    if (existing.length === 0) {
      for (const assignment of legacy) {
        await this.options.upsertAssignmentRow({
          spaceId: assignment.spaceId,
          agentId: assignment.agentId,
          profileId: assignment.profileId,
          securityScopeJson: assignment.securityScope
            ? JSON.stringify(assignment.securityScope)
            : null,
          spawnContext: assignment.spawnContext ?? null,
          contextOverridesJson: assignment.contextOverrides
            ? JSON.stringify(assignment.contextOverrides)
            : null,
          role: assignment.role,
          turnOrder: assignment.turnOrder,
          isPrimary: assignment.isPrimary,
          assignedAt: assignment.assignedAt.toISOString(),
        });
      }
      return;
    }

    const existingAgentIds = new Set(existing.map((assignment) => assignment.agentId));
    const missingLegacyAssignments = legacy.filter((assignment) => !existingAgentIds.has(assignment.agentId));
    for (const assignment of missingLegacyAssignments) {
      await this.options.upsertAssignmentRow({
        spaceId: assignment.spaceId,
        agentId: assignment.agentId,
        profileId: assignment.profileId,
        securityScopeJson: assignment.securityScope
          ? JSON.stringify(assignment.securityScope)
          : null,
        spawnContext: assignment.spawnContext ?? null,
        contextOverridesJson: assignment.contextOverrides
          ? JSON.stringify(assignment.contextOverrides)
          : null,
        role: assignment.role,
        turnOrder: assignment.turnOrder,
        isPrimary: assignment.isPrimary,
        assignedAt: assignment.assignedAt.toISOString(),
      });
    }
  }

  /**
   * Some older/partial states can hold a legacy assignment in space_config_json
   * even when the normalized row is missing. Recover one row on-demand so
   * update/remove calls remain stable.
   */
  private async recoverMissingAssignmentFromLegacy(
    space: SpaceStoreRecord,
    agentId: string,
  ): Promise<SpaceAssignmentStoreRecord | null> {
    const legacy = this.parseLegacyAssignments(space.spaceId, space.spaceConfigJson, space.createdAt);
    const target = legacy.find((assignment) => assignment.agentId === agentId);
    if (!target) {
      return null;
    }

    return this.options.upsertAssignmentRow({
      spaceId: target.spaceId,
      agentId: target.agentId,
      profileId: target.profileId,
      securityScopeJson: target.securityScope ? JSON.stringify(target.securityScope) : null,
      spawnContext: target.spawnContext ?? null,
      contextOverridesJson: target.contextOverrides ? JSON.stringify(target.contextOverrides) : null,
      role: target.role,
      turnOrder: target.turnOrder,
      isPrimary: target.isPrimary,
      assignedAt: target.assignedAt.toISOString(),
    });
  }

  private async alignOrchestratorAssignment(spaceId: string, profileId: string): Promise<void> {
    const assignments = await this.options.listAssignmentRows(spaceId);
    if (assignments.length === 0) {
      return;
    }

    const target = this.selectOrchestratorTarget(assignments, profileId);
    if (!target) {
      return;
    }

    const normalizedRole = normalizeRole(target.role as CoordinatorRole | "participant");
    if (normalizedRole !== "global_coordinator" || target.isPrimary !== 1) {
      await this.options.upsertAssignmentRow({
        spaceId: target.spaceId,
        agentId: target.agentId,
        profileId: target.profileId,
        securityScopeJson: target.securityScopeJson,
        spawnContext: target.spawnContext,
        contextOverridesJson: target.contextOverridesJson,
        role: "global_coordinator",
        turnOrder: target.turnOrder,
        isPrimary: true,
        assignedAt: target.assignedAt,
      });
    }

    await this.enforceSingleCoordinatorAndPrimary(spaceId, target.agentId, {
      enforceCoordinator: true,
      enforcePrimary: true,
    });
    await this.syncLegacyAssignments(spaceId);
  }

  private selectOrchestratorTarget(
    assignments: SpaceAssignmentStoreRecord[],
    profileId: string,
  ): SpaceAssignmentStoreRecord | null {
    const fromProfile = assignments.filter((assignment) => assignment.profileId === profileId);
    if (fromProfile.length > 0) {
      return this.preferredAssignmentRow(fromProfile);
    }

    const coordinators = assignments.filter(
      (assignment) => normalizeRole(assignment.role as CoordinatorRole | "participant") === "global_coordinator",
    );
    if (coordinators.length > 0) {
      return this.preferredAssignmentRow(coordinators);
    }

    const primaries = assignments.filter((assignment) => assignment.isPrimary === 1);
    if (primaries.length > 0) {
      return this.preferredAssignmentRow(primaries);
    }

    return this.preferredAssignmentRow(assignments);
  }

  private preferredAssignmentRow(rows: SpaceAssignmentStoreRecord[]): SpaceAssignmentStoreRecord | null {
    if (rows.length === 0) {
      return null;
    }

    return [...rows].sort((lhs, rhs) => {
      if (lhs.isPrimary !== rhs.isPrimary) {
        return rhs.isPrimary - lhs.isPrimary;
      }
      if (lhs.turnOrder !== rhs.turnOrder) {
        return lhs.turnOrder - rhs.turnOrder;
      }
      return lhs.agentId.localeCompare(rhs.agentId);
    })[0] ?? null;
  }

  private async enforceSingleCoordinatorAndPrimary(
    spaceId: string,
    selectedAgentId: string,
    options: { enforceCoordinator: boolean; enforcePrimary: boolean },
  ): Promise<void> {
    if (!options.enforceCoordinator && !options.enforcePrimary) {
      return;
    }

    const assignments = await this.options.listAssignmentRows(spaceId);
    for (const assignment of assignments) {
      if (assignment.agentId === selectedAgentId) {
        continue;
      }

      const currentRole = normalizeRole(assignment.role as CoordinatorRole | "participant");
      const currentIsPrimary = assignment.isPrimary === 1;
      const nextRole = options.enforceCoordinator && currentRole === "global_coordinator"
        ? "participant"
        : currentRole;
      const nextIsPrimary = options.enforcePrimary && currentIsPrimary
        ? false
        : currentIsPrimary;

      if (nextRole === currentRole && nextIsPrimary === currentIsPrimary) {
        continue;
      }

      await this.options.upsertAssignmentRow({
        spaceId: assignment.spaceId,
        agentId: assignment.agentId,
        profileId: assignment.profileId,
        securityScopeJson: assignment.securityScopeJson,
        spawnContext: assignment.spawnContext,
        contextOverridesJson: assignment.contextOverridesJson,
        role: nextRole,
        turnOrder: assignment.turnOrder,
        isPrimary: nextIsPrimary,
        assignedAt: assignment.assignedAt,
      });
    }
  }

  private async initializeSpaceSkillsFromLegacy(space: SpaceStoreRecord): Promise<void> {
    const existing = await this.options.listSpaceSkillRows(space.spaceId);
    if (existing.length > 0) return;

    const legacySkillIds = this.parseLegacySkillIds(space.spaceConfigJson);
    if (legacySkillIds.length === 0) return;

    for (const skillId of legacySkillIds) {
      await this.options.upsertSpaceSkillRow({
        spaceId: space.spaceId,
        skillId,
        addedAt: space.createdAt,
      });
    }
  }

  private serializeAssignmentForConfig(assignment: SpaceAgentAssignment): Record<string, unknown> {
    return {
      spaceId: assignment.spaceId,
      agentId: assignment.agentId,
      profileId: assignment.profileId,
      securityScope: assignment.securityScope,
      spawnContext: assignment.spawnContext,
      contextOverrides: assignment.contextOverrides,
      role: assignment.role,
      turnOrder: assignment.turnOrder,
      isPrimary: assignment.isPrimary,
      assignedAt: assignment.assignedAt.toISOString(),
    };
  }

  private buildSpaceConfigSeed(input: CreateSpaceInput, spaceUid: string): Record<string, unknown> {
    const config: Record<string, unknown> = {
      spaceUid,
      capabilities: input.capabilities ?? [],
      capabilityOverrides: input.capabilityOverrides ?? {},
      visibility: input.visibility ?? "shared",
      skillIds: [],
      agents: [],
    };

    if (input.turnModelConfig) {
      config.turnModelConfig = input.turnModelConfig;
    }
    if (input.conversationTopology) {
      config.conversationTopology = input.conversationTopology;
    }
    if (typeof input.maxTurns === "number") {
      config.maxTurns = input.maxTurns;
    }
    if (input.thinkingCapturePolicy) {
      config.thinkingCapturePolicy = input.thinkingCapturePolicy;
    }
    if (input.moderatorProfileId) {
      config.moderatorProfileId = input.moderatorProfileId;
    }
    return config;
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
        console.warn(`[SpaceAdminService] Missing idempotencyKey for ${endpoint} — request is not replay-safe`);
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

function stableJsonHash(value: unknown): string {
  return JSON.stringify(sortValue(value)) ?? "null";
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, sortValue(entry)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

function inferResponseType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function parseSpaceConfig(spaceConfigJson: string | null): Record<string, unknown> {
  if (!spaceConfigJson) return {};
  try {
    const parsed = JSON.parse(spaceConfigJson);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function resolveSpaceUid(parsedConfig: Record<string, unknown>): string | undefined {
  const direct = normalizeUuidString(parsedConfig.spaceUid);
  if (direct) return direct;
  return normalizeUuidString(parsedConfig.space_uid);
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function normalizeSpaceResourceType(value: unknown): SpaceResourceType {
  if (value === "folder") return "folder";
  if (value === "url") return "url";
  return "url";
}

function parseSpaceResourceType(value: unknown): SpaceResourceType | null {
  if (value === "folder" || value === "url") return value;
  return null;
}

function parseStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const mapped: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      mapped[key] = raw;
    }
  }
  return mapped;
}

function parseTurnModelConfig(value: Record<string, unknown>): TurnModelConfig | undefined {
  if (isRecord(value.turnModelConfig)) {
    return value.turnModelConfig as unknown as TurnModelConfig;
  }
  if (isRecord(value.turn_model_config)) {
    return value.turn_model_config as unknown as TurnModelConfig;
  }
  return undefined;
}

function parseVisibility(value: unknown): "shared" | "private" {
  if (value === "private") return "private";
  return "shared";
}

function parseOptionalInt(value: unknown): number | undefined {
  const parsed = asInt(value);
  return parsed === undefined ? undefined : parsed;
}

function parseThinkingCapturePolicy(value: unknown): ThinkingCapturePolicy | undefined {
  switch (normalizeOptionalString(value)) {
    case "OFF":
    case "SUMMARY":
    case "FULL":
      return normalizeOptionalString(value) as ThinkingCapturePolicy;
    default:
      return undefined;
  }
}

function normalizeTurnModel(raw: string): TurnModelStrategy {
  if ((TURN_MODEL_VALUES as string[]).includes(raw)) {
    return raw as TurnModelStrategy;
  }
  return "sequential_all";
}

export function normalizeSpaceState(raw: string): SpaceState {
  if ((SPACE_STATE_VALUES as string[]).includes(raw)) {
    return raw as SpaceState;
  }
  return "created";
}

function normalizeRole(raw: CoordinatorRole | "participant" | undefined): CoordinatorRole | "participant" {
  if (raw && ROLE_VALUES.has(raw)) {
    return raw;
  }
  return "participant";
}

function parseDate(raw: string | undefined, fallback: Date): Date {
  if (!raw) return fallback;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function parseOptionalDate(raw: string | null | undefined): Date | undefined {
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeUuidString(value: unknown): string | undefined {
  return normalizeUuid(value);
}

function asInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
