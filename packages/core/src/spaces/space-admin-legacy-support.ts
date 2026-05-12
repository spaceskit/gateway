import { randomUUID } from "node:crypto";
import type { AgentSecurityScope } from "../security/types.js";
import type {
  CoordinatorRole,
  SpaceAgentAssignment,
  SpaceConfig,
  SpaceResource,
} from "./types.js";
import {
  asBoolean,
  asInt,
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
  uniqueStrings,
} from "./space-admin-normalizers.js";
import type {
  CreateSpaceInput,
  SpaceAdminServiceOptions,
  SpaceAssignmentStoreRecord,
  SpaceResourceStoreRecord,
  SpaceStoreRecord,
} from "./space-admin-service.js";

export class SpaceAdminLegacySupport {
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

  parseLegacyAssignments(
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

  async syncLegacyAssignments(spaceId: string): Promise<void> {
    const row = await this.options.getSpaceRow(spaceId);
    if (!row) return;

    const parsedConfig = parseSpaceConfig(row.spaceConfigJson);
    const assignments = await this.options.listAssignmentRows(spaceId);
    parsedConfig.agents = assignments.map((assignment) =>
      this.serializeAssignmentForConfig(this.rowToAssignment(assignment)),
    );

    await this.options.updateSpaceConfigJson(spaceId, JSON.stringify(parsedConfig));
  }

  parseLegacySkillIds(spaceConfigJson: string | null): string[] {
    const parsedConfig = parseSpaceConfig(spaceConfigJson);
    return uniqueStrings(
      parseStringArray(parsedConfig.skillIds ?? parsedConfig.skill_ids),
    );
  }

  async syncLegacySkillIds(spaceId: string): Promise<void> {
    const row = await this.options.getSpaceRow(spaceId);
    if (!row) return;

    const parsedConfig = parseSpaceConfig(row.spaceConfigJson);
    const skills = await this.options.listSpaceSkillRows(spaceId);
    parsedConfig.skillIds = uniqueStrings(skills.map((entry) => entry.skillId));

    await this.options.updateSpaceConfigJson(spaceId, JSON.stringify(parsedConfig));
  }

  async initializeAssignmentsFromLegacy(space: SpaceStoreRecord): Promise<void> {
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

  async recoverMissingAssignmentFromLegacy(
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

  async initializeSpaceSkillsFromLegacy(space: SpaceStoreRecord): Promise<void> {
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

  buildSpaceConfigSeed(input: CreateSpaceInput, spaceUid: string): Record<string, unknown> {
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
}
