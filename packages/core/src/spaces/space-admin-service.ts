/**
 * SpaceAdminService — lifecycle and agent assignment management for spaces.
 *
 * This service is transport-agnostic. WS/HTTP/proto adapters should call this
 * layer so behavior and validation stay consistent.
 */

import { randomUUID } from "node:crypto";
import type { ThinkingCapturePolicy } from "./memory-policy.js";
import { SpaceAdminAssignments } from "./space-admin-assignments.js";
import type { AddAgentInput, SetSpaceOrchestratorInput, UpdateAgentAssignmentInput } from "./space-admin-assignments.js";
import { SpaceAdminBindings } from "./space-admin-bindings.js";
import { SpaceAdminError } from "./space-admin-errors.js";
import { SpaceAdminIdempotency } from "./space-admin-idempotency.js";
import type {
  ConversationTopology,
  SpaceAgentAssignment,
  SpaceConfig,
  SpaceResource,
  SpaceResourceType,
  SpaceState,
  TurnModelConfig,
  TurnModelStrategy,
} from "./types.js";
import { normalizeSpaceState, normalizeUuidString } from "./space-admin-normalizers.js";
import { SpaceAdminSupport } from "./space-admin-support.js";

export { normalizeSpaceState } from "./space-admin-normalizers.js";
export { SpaceAdminError } from "./space-admin-errors.js";
export type { SpaceAdminErrorCode } from "./space-admin-errors.js";
export type { AddAgentInput, SetSpaceOrchestratorInput, UpdateAgentAssignmentInput } from "./space-admin-assignments.js";

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
  private readonly spaceAdminSupport: SpaceAdminSupport;
  private readonly idempotency: SpaceAdminIdempotency;
  private readonly assignments: SpaceAdminAssignments;
  private readonly bindings: SpaceAdminBindings;

  constructor(options: SpaceAdminServiceOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date());
    this.spaceAdminSupport = new SpaceAdminSupport(options, this.now);
    this.idempotency = new SpaceAdminIdempotency(
      options,
      options.idempotencyPrincipalId ?? "space-admin",
      (message) => new SpaceAdminError("FAILED_PRECONDITION", message),
    );
    this.assignments = new SpaceAdminAssignments(
      options,
      this.now,
      this.idempotency,
      this.spaceAdminSupport,
      (spaceId) => this.getSpace(spaceId),
    );
    this.bindings = new SpaceAdminBindings(options, this.now, this.idempotency, this.spaceAdminSupport);
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

    return this.idempotency.run(
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
          configJson: JSON.stringify(this.spaceAdminSupport.buildSpaceConfigSeed(input, spaceUid)),
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
    return this.spaceAdminSupport.hydrateSpace(row);
  }

  async listSpaces(options: ListSpacesOptions = {}): Promise<SpaceConfig[]> {
    const rows = await this.options.listSpaceRows({
      statuses: options.statuses?.map((s) => s),
      resourceId: options.resourceId,
      limit: options.limit,
    });

    return Promise.all(rows.map(async (row) => {
      return this.spaceAdminSupport.hydrateSpace(row);
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

    return this.idempotency.run(
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

    return this.idempotency.run(
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
    return this.assignments.listAgentAssignments(spaceId);
  }

  async addSkillToSpace(input: AddSpaceSkillInput): Promise<string[]> {
    return this.bindings.addSkillToSpace(input);
  }

  async removeSkillFromSpace(input: RemoveSpaceSkillInput): Promise<{ removed: boolean; skills: string[] }> {
    return this.bindings.removeSkillFromSpace(input);
  }

  async listSpaceSkills(spaceIdRaw: string): Promise<string[]> {
    return this.bindings.listSpaceSkills(spaceIdRaw);
  }

  async addResource(input: AddSpaceResourceInput): Promise<SpaceResource> {
    return this.bindings.addResource(input);
  }

  async removeResource(input: RemoveSpaceResourceInput): Promise<boolean> {
    return this.bindings.removeResource(input);
  }

  async listResources(spaceIdRaw: string): Promise<SpaceResource[]> {
    return this.bindings.listResources(spaceIdRaw);
  }

  async setSpaceOrchestrator(input: SetSpaceOrchestratorInput): Promise<SpaceConfig> {
    return this.assignments.setSpaceOrchestrator(input);
  }

  async addAgent(input: AddAgentInput): Promise<SpaceAgentAssignment> {
    return this.assignments.addAgent(input);
  }

  async updateAgentAssignment(input: UpdateAgentAssignmentInput): Promise<SpaceAgentAssignment> {
    return this.assignments.updateAgentAssignment(input);
  }

  async removeAgent(spaceId: string, agentId: string, idempotencyKey?: string): Promise<boolean> {
    return this.assignments.removeAgent(spaceId, agentId, idempotencyKey);
  }

}
