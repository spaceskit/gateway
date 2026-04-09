import { SpaceAdminService } from "@spaceskit/core";
import { SPACE_WORKSPACE_MANAGED_RESOURCE_PREFIX } from "./services/space-workspace-service.js";
import type { BootstrapState } from "./bootstrap-state.js";
import { MAIN_SPACE_SYSTEM_SKILL_IDS } from "./seed/main-space-system-skills.js";

export function initializeSpaceAdminService(state: BootstrapState): void {
  const {
    config,
    logger,
    spaceRepo,
    spaceAssignmentRepo,
    spaceSkillRepo,
    spaceResourceRepo,
    profileRepo,
    idempotencyRepo,
    spaceWorkspaceService,
    toolAccessPolicyRepo,
  } = state;
  const protectedMainSpaceSkillIds = new Set(MAIN_SPACE_SYSTEM_SKILL_IDS);

  const spaceAdminService = new SpaceAdminService({
    createSpaceRow: async (input) => {
      if (!spaceRepo) {
        throw new Error("Space persistence unavailable");
      }
      const row = spaceRepo.create({
        spaceId: input.spaceId,
        resourceId: input.resourceId,
        spaceType: input.spaceType,
        name: input.name,
        goal: input.goal,
        turnModel: input.turnModel,
        configJson: input.configJson,
        templateId: input.templateId,
        templateRevision: input.templateRevision,
      });
      toolAccessPolicyRepo?.upsert({
        scopeType: "space",
        scopeId: row.space_id,
        rulesJson: "[]",
        dangerousCapabilitiesJson: "[]",
        guestAccessPreset: "read_only",
        updatedBy: "system",
      });
      return {
        spaceId: row.space_id,
        resourceId: row.resource_id,
        spaceType: row.space_type,
        name: row.name,
        goal: row.goal,
        status: row.status,
        turnModel: row.turn_model,
        spaceConfigJson: row.space_config_json,
        templateId: row.template_id,
        templateRevision: row.template_revision,
        archivedAt: row.archived_at,
        deletedAt: row.deleted_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },
    getSpaceRow: async (spaceId) => {
      if (!spaceRepo) return null;
      const row = spaceRepo.getById(spaceId);
      if (!row) return null;
      return {
        spaceId: row.space_id,
        resourceId: row.resource_id,
        spaceType: row.space_type,
        name: row.name,
        goal: row.goal,
        status: row.status,
        turnModel: row.turn_model,
        spaceConfigJson: row.space_config_json,
        templateId: row.template_id,
        templateRevision: row.template_revision,
        archivedAt: row.archived_at,
        deletedAt: row.deleted_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },
    listSpaceRows: async (query) => {
      if (!spaceRepo) return [];
      return spaceRepo.list({
        statuses: query.statuses,
        resourceId: query.resourceId,
        limit: query.limit,
      }).map((row: any) => ({
        spaceId: row.space_id,
        resourceId: row.resource_id,
        spaceType: row.space_type,
        name: row.name,
        goal: row.goal,
        status: row.status,
        turnModel: row.turn_model,
        spaceConfigJson: row.space_config_json,
        templateId: row.template_id,
        templateRevision: row.template_revision,
        archivedAt: row.archived_at,
        deletedAt: row.deleted_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    },
    archiveSpaceRow: async (spaceId, archivedAt) => {
      if (!spaceRepo) return null;
      const row = spaceRepo.archive(spaceId, archivedAt);
      if (!row) return null;
      return {
        spaceId: row.space_id,
        resourceId: row.resource_id,
        spaceType: row.space_type,
        name: row.name,
        goal: row.goal,
        status: row.status,
        turnModel: row.turn_model,
        spaceConfigJson: row.space_config_json,
        templateId: row.template_id,
        templateRevision: row.template_revision,
        archivedAt: row.archived_at,
        deletedAt: row.deleted_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },
    deleteSpaceRow: async (spaceId, deletedAt) => {
      if (!spaceRepo) return null;
      const row = spaceRepo.deleteSoft(spaceId, deletedAt);
      if (!row) return null;
      return {
        spaceId: row.space_id,
        resourceId: row.resource_id,
        spaceType: row.space_type,
        name: row.name,
        goal: row.goal,
        status: row.status,
        turnModel: row.turn_model,
        spaceConfigJson: row.space_config_json,
        templateId: row.template_id,
        templateRevision: row.template_revision,
        archivedAt: row.archived_at,
        deletedAt: row.deleted_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },
    updateSpaceConfigJson: async (spaceId, configJson) => {
      if (!spaceRepo) {
        throw new Error("Space persistence unavailable");
      }
      spaceRepo.updateConfig(spaceId, configJson);
    },
    profileExists: async (profileId) => {
      if (!profileRepo) return false;
      return profileRepo.getById(profileId) !== undefined;
    },
    profileArchived: async (profileId) => {
      if (!profileRepo) return true;
      const row = profileRepo.getById(profileId);
      if (!row) return true;
      return row.archived === 1;
    },
    profileCanModerate: async (profileId) => {
      if (!profileRepo) return false;
      const row = profileRepo.getById(profileId);
      if (!row) return false;
      return row.archived === 0 && row.can_moderate === 1;
    },
    getAssignmentRow: async (spaceId, agentId) => {
      if (!spaceAssignmentRepo) return null;
      const row = spaceAssignmentRepo.get(spaceId, agentId);
      if (!row) return null;
      return {
        spaceId: row.space_id,
        agentId: row.agent_id,
        profileId: row.profile_id,
        securityScopeJson: row.security_scope_json,
        spawnContext: row.spawn_context,
        contextOverridesJson: row.context_overrides_json,
        role: row.role,
        turnOrder: row.turn_order,
        isPrimary: row.is_primary,
        assignedAt: row.assigned_at,
        updatedAt: row.updated_at,
      };
    },
    listAssignmentRows: async (spaceId) => {
      if (!spaceAssignmentRepo) return [];
      return spaceAssignmentRepo.listBySpace(spaceId).map((row: any) => ({
        spaceId: row.space_id,
        agentId: row.agent_id,
        profileId: row.profile_id,
        securityScopeJson: row.security_scope_json,
        spawnContext: row.spawn_context,
        contextOverridesJson: row.context_overrides_json,
        role: row.role,
        turnOrder: row.turn_order,
        isPrimary: row.is_primary,
        assignedAt: row.assigned_at,
        updatedAt: row.updated_at,
      }));
    },
    upsertAssignmentRow: async (input) => {
      if (!spaceAssignmentRepo) {
        throw new Error("Assignment persistence unavailable");
      }
      const row = spaceAssignmentRepo.upsert({
        spaceId: input.spaceId,
        agentId: input.agentId,
        profileId: input.profileId,
        securityScopeJson: input.securityScopeJson ?? null,
        spawnContext: input.spawnContext ?? null,
        contextOverridesJson: input.contextOverridesJson ?? null,
        role: input.role,
        turnOrder: input.turnOrder,
        isPrimary: input.isPrimary,
        assignedAt: input.assignedAt,
      });
      return {
        spaceId: row.space_id,
        agentId: row.agent_id,
        profileId: row.profile_id,
        securityScopeJson: row.security_scope_json,
        spawnContext: row.spawn_context,
        contextOverridesJson: row.context_overrides_json,
        role: row.role,
        turnOrder: row.turn_order,
        isPrimary: row.is_primary,
        assignedAt: row.assigned_at,
        updatedAt: row.updated_at,
      };
    },
    deleteAssignmentRow: async (spaceId, agentId) => {
      if (!spaceAssignmentRepo) return false;
      return spaceAssignmentRepo.delete(spaceId, agentId);
    },
    listSpaceSkillRows: async (spaceId) => {
      if (!spaceSkillRepo) return [];
      return spaceSkillRepo.listBySpace(spaceId).map((row: any) => ({
        spaceId: row.space_id,
        skillId: row.skill_id,
        addedAt: row.added_at,
      }));
    },
    upsertSpaceSkillRow: async (input) => {
      if (!spaceSkillRepo) {
        throw new Error("Space skill persistence unavailable");
      }
      const row = spaceSkillRepo.upsert({
        spaceId: input.spaceId,
        skillId: input.skillId,
        addedAt: input.addedAt,
      });
      return { spaceId: row.space_id, skillId: row.skill_id, addedAt: row.added_at };
    },
    deleteSpaceSkillRow: async (spaceId, skillId) => {
      if (!spaceSkillRepo) return false;
      return spaceSkillRepo.delete(spaceId, skillId);
    },
    isProtectedSpaceSkill: async (spaceId, skillId) => {
      const normalizedSpaceId = spaceId.trim();
      const normalizedSkillId = skillId.trim();
      if (!normalizedSpaceId || !normalizedSkillId) return false;
      return normalizedSpaceId === config.mainSpaceId && protectedMainSpaceSkillIds.has(normalizedSkillId);
    },
    listSpaceResourceRows: async (spaceId) => {
      if (!spaceResourceRepo) return [];
      return spaceResourceRepo.listBySpace(spaceId).map((row: any) => ({
        resourceId: row.resource_id,
        spaceId: row.space_id,
        uri: row.uri,
        type: row.type,
        label: row.label,
        addedAt: row.added_at,
      }));
    },
    upsertSpaceResourceRow: async (input) => {
      if (!spaceResourceRepo) {
        throw new Error("Space resource persistence unavailable");
      }
      const row = spaceResourceRepo.upsert({
        resourceId: input.resourceId,
        spaceId: input.spaceId,
        uri: input.uri,
        type: input.type as "folder" | "url",
        label: input.label,
        addedAt: input.addedAt,
      });
      return {
        resourceId: row.resource_id,
        spaceId: row.space_id,
        uri: row.uri,
        type: row.type,
        label: row.label,
        addedAt: row.added_at,
      };
    },
    deleteSpaceResourceRow: async (spaceId, resourceId) => {
      if (!spaceResourceRepo) return false;
      return spaceResourceRepo.delete(spaceId, resourceId);
    },
    reservedSpaceResourceIdPrefixes: [SPACE_WORKSPACE_MANAGED_RESOURCE_PREFIX],
    isProtectedSpaceResource: async (spaceId, resourceId) => {
      if (!spaceWorkspaceService) return false;
      await spaceWorkspaceService.ensureWorkspace(spaceId);
      return spaceWorkspaceService.isManagedWorkspaceResource(spaceId, resourceId);
    },
    loadIdempotencyRecord: async (principalId, endpoint, idempotencyKey) => {
      if (!idempotencyRepo) return null;
      const row = idempotencyRepo.get(principalId, endpoint, idempotencyKey);
      if (!row) return null;
      return {
        requestHash: row.request_hash,
        responseType: row.response_type,
        responsePayload: row.response_payload,
      };
    },
    saveIdempotencyRecord: async (record) => {
      if (!idempotencyRepo) return;
      idempotencyRepo.put({
        principalId: record.principalId,
        endpoint: record.endpoint,
        idempotencyKey: record.idempotencyKey,
        requestHash: record.requestHash,
        responseType: record.responseType,
        responsePayload: record.responsePayload,
      });
    },
    idempotencyPrincipalId: "gateway-space-admin",
  });

  state.spaceAdminService = spaceAdminService;
  logger.info("Space admin service initialized");
}
