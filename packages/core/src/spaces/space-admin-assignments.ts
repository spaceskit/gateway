import type { AgentSecurityScope } from "../security/types.js";
import { SpaceAdminError } from "./space-admin-errors.js";
import type { SpaceAdminIdempotency } from "./space-admin-idempotency.js";
import { normalizeOptionalString, normalizeRole, parseSpaceConfig } from "./space-admin-normalizers.js";
import type { SpaceAdminSupport } from "./space-admin-support.js";
import type { SpaceAdminServiceOptions } from "./space-admin-service.js";
import type { CoordinatorRole, SpaceAgentAssignment, SpaceConfig } from "./types.js";

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

export class SpaceAdminAssignments {
  constructor(
    private readonly options: SpaceAdminServiceOptions,
    private readonly now: () => Date,
    private readonly idempotency: SpaceAdminIdempotency,
    private readonly support: SpaceAdminSupport,
    private readonly loadSpaceConfig: (spaceId: string) => Promise<SpaceConfig | null>,
  ) {}

  async listAgentAssignments(spaceId: string): Promise<SpaceAgentAssignment[]> {
    const row = await this.options.getSpaceRow(spaceId);
    if (!row) {
      throw new SpaceAdminError("NOT_FOUND", `Space not found: ${spaceId}`);
    }

    const assignments = await this.options.listAssignmentRows(spaceId);
    return assignments.map((assignment) => this.support.rowToAssignment(assignment));
  }

  async setSpaceOrchestrator(input: SetSpaceOrchestratorInput): Promise<SpaceConfig> {
    const spaceId = input.spaceId.trim();
    const profileId = input.profileId.trim();
    if (!spaceId || !profileId) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "spaceId and profileId are required");
    }

    return this.idempotency.run(
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
        await this.support.alignOrchestratorAssignment(spaceId, profileId);

        const updated = await this.loadSpaceConfig(spaceId);
        if (!updated) {
          throw new SpaceAdminError("FAILED_PRECONDITION", `Failed to load updated space: ${spaceId}`);
        }
        return updated;
      },
    );
  }

  async addAgent(input: AddAgentInput): Promise<SpaceAgentAssignment> {
    this.validateAssignmentInput(input.spaceId, input.agentId, input.profileId);

    return this.idempotency.run(
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
        await this.support.enforceSingleCoordinatorAndPrimary(input.spaceId, input.agentId, {
          enforceCoordinator: requestedRole === "global_coordinator",
          enforcePrimary: requestedIsPrimary,
        });

        const normalized = await this.options.getAssignmentRow(input.spaceId, input.agentId);
        return this.support.rowToAssignment(normalized ?? assignmentRow);
      },
    );
  }

  async updateAgentAssignment(input: UpdateAgentAssignmentInput): Promise<SpaceAgentAssignment> {
    const spaceId = input.spaceId.trim();
    const agentId = input.agentId.trim();
    if (!spaceId || !agentId) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "spaceId and agentId are required");
    }

    return this.idempotency.run(
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

        const existing = await this.options.getAssignmentRow(spaceId, agentId);
        if (!existing) {
          throw new SpaceAdminError("NOT_FOUND", `Assignment not found: ${spaceId}/${agentId}`);
        }

        const existingAssignment = this.support.rowToAssignment(existing);
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
        await this.support.enforceSingleCoordinatorAndPrimary(spaceId, agentId, {
          enforceCoordinator: requestedRole === "global_coordinator",
          enforcePrimary: requestedIsPrimary,
        });

        const normalized = await this.options.getAssignmentRow(spaceId, agentId);
        return this.support.rowToAssignment(normalized ?? assignmentRow);
      },
    );
  }

  async removeAgent(spaceId: string, agentId: string, idempotencyKey?: string): Promise<boolean> {
    const trimmedSpaceId = spaceId.trim();
    const trimmedAgentId = agentId.trim();
    if (!trimmedSpaceId || !trimmedAgentId) {
      throw new SpaceAdminError("INVALID_ARGUMENT", "spaceId and agentId are required");
    }

    return this.idempotency.run(
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
        return this.options.deleteAssignmentRow(trimmedSpaceId, trimmedAgentId);
      },
    );
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
}
