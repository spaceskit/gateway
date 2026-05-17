import { randomUUID } from "node:crypto";
import type { AgentSecurityScope } from "../security/types.js";
import type {
  CoordinatorRole,
  SpaceAgentAssignment,
  SpaceConfig,
  SpaceResource,
} from "./types.js";
import {
  asString,
  isRecord,
  normalizeOptionalString,
  normalizeRole,
  normalizeSpaceResourceType,
  normalizeSpaceState,
  normalizeTurnModel,
  parseDate,
  parseOptionalDate,
  parseOptionalInt,
  parseSpaceConfig,
  parseStringArray,
  parseStringMap,
  parseThinkingCapturePolicy,
  parseTurnModelConfig,
  parseVisibility,
  resolveSpaceUid,
} from "./space-admin-normalizers.js";
import type {
  CreateSpaceInput,
  SpaceAdminServiceOptions,
  SpaceAssignmentStoreRecord,
  SpaceResourceStoreRecord,
  SpaceStoreRecord,
} from "./space-admin-service.js";

export class SpaceAdminSupport {
  constructor(
    private readonly options: SpaceAdminServiceOptions,
    private readonly now: () => Date,
  ) {}

  async hydrateSpace(row: SpaceStoreRecord): Promise<SpaceConfig> {
    const parsedConfig = parseSpaceConfig(row.spaceConfigJson);
    const existingSpaceUid = resolveSpaceUid(parsedConfig);
    const spaceUid = existingSpaceUid ?? randomUUID();
    if (!existingSpaceUid) {
      parsedConfig.spaceUid = spaceUid;
      await this.options.updateSpaceConfigJson(row.spaceId, JSON.stringify(parsedConfig));
    }
    const storedAssignments = await this.options.listAssignmentRows(row.spaceId);
    const storedSkills = await this.options.listSpaceSkillRows(row.spaceId);

    const assignments = storedAssignments.map((assignment) => this.rowToAssignment(assignment));
    const skillIds = storedSkills.map((entry) => entry.skillId);

    const orchestratorProfileId = normalizeOptionalString(parsedConfig.orchestratorProfileId)
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
      thinkingCapturePolicy: parseThinkingCapturePolicy(parsedConfig.thinkingCapturePolicy),
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

  rowToAssignment(row: SpaceAssignmentStoreRecord): SpaceAgentAssignment {
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

  rowToSpaceResource(row: SpaceResourceStoreRecord): SpaceResource {
    return {
      resourceId: row.resourceId,
      spaceId: row.spaceId,
      uri: row.uri,
      type: normalizeSpaceResourceType(row.type),
      label: normalizeOptionalString(row.label),
      addedAt: parseDate(row.addedAt, this.now()),
    };
  }

  async alignOrchestratorAssignment(spaceId: string, profileId: string): Promise<void> {
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

  async enforceSingleCoordinatorAndPrimary(
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

  buildSpaceConfigSeed(input: CreateSpaceInput, spaceUid: string): Record<string, unknown> {
    const config: Record<string, unknown> = {
      spaceUid,
      capabilities: input.capabilities ?? [],
      capabilityOverrides: input.capabilityOverrides ?? {},
      visibility: input.visibility ?? "shared",
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
}
