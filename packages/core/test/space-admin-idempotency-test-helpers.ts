import {
  SpaceAdminService,
  type CreateSpaceStoreInput,
  type SpaceStoreRecord,
  type UpsertSpaceAssignmentStoreInput,
  type SpaceAssignmentStoreRecord,
  type SpaceSkillStoreRecord,
  type UpsertSpaceSkillStoreInput,
  type SpaceResourceStoreRecord,
  type UpsertSpaceResourceStoreInput,
} from "../src/spaces/space-admin-service.js";

export function makeService(
  stores: ReturnType<typeof makeStores>,
  knownProfiles: Set<string> = new Set(),
  options: {
    archivedProfiles?: Set<string>;
    orchestratorCapableProfiles?: Set<string>;
    protectedSkillIds?: Set<string>;
    reservedResourcePrefixes?: string[];
    protectedResourceIds?: Set<string>;
    onMissingIdempotencyKey?: (endpoint: string) => void;
    omitIdempotencyStore?: boolean;
  } = {},
): SpaceAdminService {
  const archivedProfiles = options.archivedProfiles ?? new Set<string>();
  const orchestratorCapableProfiles = options.orchestratorCapableProfiles ?? knownProfiles;
  return new SpaceAdminService({
    createSpaceRow: async (input) => stores.createSpace(input),
    getSpaceRow: async (spaceId) => stores.getSpace(spaceId),
    listSpaceRows: async (query) => stores.listSpaces(query.statuses),
    archiveSpaceRow: async (spaceId, archivedAt) => stores.archiveSpace(spaceId, archivedAt),
    deleteSpaceRow: async (spaceId, deletedAt) => stores.deleteSpace(spaceId, deletedAt),
    updateSpaceConfigJson: async (spaceId, configJson) => {
      stores.updateSpaceConfig(spaceId, configJson);
    },
    profileExists: async (profileId) => {
      if (knownProfiles.size === 0) return true;
      return knownProfiles.has(profileId);
    },
    profileArchived: async (profileId) => archivedProfiles.has(profileId),
    profileCanModerate: async (profileId) => {
      if (knownProfiles.size === 0) return true;
      return orchestratorCapableProfiles.has(profileId);
    },
    getAssignmentRow: async (spaceId, agentId) => stores.getAssignment(spaceId, agentId),
    listAssignmentRows: async (spaceId) => stores.listAssignments(spaceId),
    upsertAssignmentRow: async (input) => stores.upsertAssignment(input),
    deleteAssignmentRow: async (spaceId, agentId) => stores.deleteAssignment(spaceId, agentId),
    listSpaceSkillRows: async (spaceId) => stores.listSpaceSkills(spaceId),
    upsertSpaceSkillRow: async (input) => stores.upsertSpaceSkill(input),
    deleteSpaceSkillRow: async (spaceId, skillId) => stores.deleteSpaceSkill(spaceId, skillId),
    isProtectedSpaceSkill: options.protectedSkillIds
      ? async (spaceId, skillId) => options.protectedSkillIds!.has(`${spaceId}:${skillId}`)
      : undefined,
    listSpaceResourceRows: async (spaceId) => stores.listSpaceResources(spaceId),
    upsertSpaceResourceRow: async (input) => stores.upsertSpaceResource(input),
    deleteSpaceResourceRow: async (spaceId, resourceId) => stores.deleteSpaceResource(spaceId, resourceId),
    reservedSpaceResourceIdPrefixes: options.reservedResourcePrefixes,
    isProtectedSpaceResource: options.protectedResourceIds
      ? async (spaceId, resourceId) => options.protectedResourceIds!.has(`${spaceId}:${resourceId}`)
      : undefined,
    loadIdempotencyRecord: options.omitIdempotencyStore
      ? undefined
      : async (principalId, endpoint, idempotencyKey) =>
          stores.loadIdempotency(principalId, endpoint, idempotencyKey),
    saveIdempotencyRecord: options.omitIdempotencyStore
      ? undefined
      : async (record) => {
          stores.saveIdempotency(record.principalId, record.endpoint, record.idempotencyKey, {
            requestHash: record.requestHash,
            responseType: record.responseType,
            responsePayload: record.responsePayload,
          });
        },
    onMissingIdempotencyKey: options.onMissingIdempotencyKey,
  });
}

export function makeStores() {
  const now = () => new Date().toISOString();
  const spaces = new Map<string, SpaceStoreRecord>();
  const assignments = new Map<string, SpaceAssignmentStoreRecord>();
  const spaceSkills = new Map<string, SpaceSkillStoreRecord>();
  const spaceResources = new Map<string, SpaceResourceStoreRecord>();
  const idempotency = new Map<string, { requestHash: string; responseType: string; responsePayload: string }>();

  let createSpaceCalls = 0;
  let upsertAssignmentCalls = 0;
  let upsertSpaceSkillCalls = 0;
  let updateSpaceConfigCalls = 0;

  return {
    get createSpaceCalls() {
      return createSpaceCalls;
    },
    get upsertAssignmentCalls() {
      return upsertAssignmentCalls;
    },
    get upsertSpaceSkillCalls() {
      return upsertSpaceSkillCalls;
    },
    get updateSpaceConfigCalls() {
      return updateSpaceConfigCalls;
    },
    createSpace(input: CreateSpaceStoreInput): SpaceStoreRecord {
      createSpaceCalls += 1;
      const row: SpaceStoreRecord = {
        spaceId: input.spaceId,
        resourceId: input.resourceId,
        spaceType: input.spaceType,
        name: input.name,
        goal: input.goal,
        status: "created",
        turnModel: input.turnModel,
        spaceConfigJson: input.configJson ?? null,
        templateId: input.templateId ?? "",
        templateRevision: input.templateRevision ?? 0,
        archivedAt: null,
        deletedAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      spaces.set(row.spaceId, row);
      return row;
    },
    getSpace(spaceId: string): SpaceStoreRecord | null {
      return spaces.get(spaceId) ?? null;
    },
    listSpaces(statuses?: string[]): SpaceStoreRecord[] {
      const rows = Array.from(spaces.values());
      if (statuses && statuses.length > 0) {
        return rows.filter((row) => statuses.includes(row.status));
      }
      return rows.filter((row) => row.status !== "archived" && row.status !== "deleted");
    },
    archiveSpace(spaceId: string, archivedAt: string): SpaceStoreRecord | null {
      const row = spaces.get(spaceId);
      if (!row) return null;
      row.status = "archived";
      row.archivedAt = archivedAt;
      row.deletedAt = null;
      row.updatedAt = archivedAt;
      return row;
    },
    deleteSpace(spaceId: string, deletedAt: string): SpaceStoreRecord | null {
      const row = spaces.get(spaceId);
      if (!row) return null;
      row.status = "deleted";
      row.deletedAt = deletedAt;
      row.updatedAt = deletedAt;
      return row;
    },
    updateSpaceConfig(spaceId: string, configJson: string): void {
      const row = spaces.get(spaceId);
      if (!row) return;
      updateSpaceConfigCalls += 1;
      row.spaceConfigJson = configJson;
      row.updatedAt = now();
    },
    getAssignment(spaceId: string, agentId: string): SpaceAssignmentStoreRecord | null {
      return assignments.get(`${spaceId}:${agentId}`) ?? null;
    },
    listAssignments(spaceId: string): SpaceAssignmentStoreRecord[] {
      return Array.from(assignments.values()).filter((entry) => entry.spaceId === spaceId);
    },
    upsertAssignment(input: UpsertSpaceAssignmentStoreInput): SpaceAssignmentStoreRecord {
      upsertAssignmentCalls += 1;
      const row: SpaceAssignmentStoreRecord = {
        spaceId: input.spaceId,
        agentId: input.agentId,
        profileId: input.profileId,
        securityScopeJson: input.securityScopeJson ?? null,
        role: input.role ?? "participant",
        turnOrder: input.turnOrder ?? 0,
        isPrimary: input.isPrimary ? 1 : 0,
        assignedAt: input.assignedAt ?? now(),
        updatedAt: now(),
      };
      assignments.set(`${row.spaceId}:${row.agentId}`, row);
      return row;
    },
    deleteAssignment(spaceId: string, agentId: string): boolean {
      return assignments.delete(`${spaceId}:${agentId}`);
    },
    listSpaceSkills(spaceId: string): SpaceSkillStoreRecord[] {
      return Array.from(spaceSkills.values())
        .filter((entry) => entry.spaceId === spaceId)
        .sort((lhs, rhs) => lhs.addedAt.localeCompare(rhs.addedAt));
    },
    upsertSpaceSkill(input: UpsertSpaceSkillStoreInput): SpaceSkillStoreRecord {
      upsertSpaceSkillCalls += 1;
      const key = `${input.spaceId}:${input.skillId}`;
      const existing = spaceSkills.get(key);
      if (existing) {
        return existing;
      }
      const row: SpaceSkillStoreRecord = {
        spaceId: input.spaceId,
        skillId: input.skillId,
        addedAt: input.addedAt ?? now(),
      };
      spaceSkills.set(key, row);
      return row;
    },
    deleteSpaceSkill(spaceId: string, skillId: string): boolean {
      return spaceSkills.delete(`${spaceId}:${skillId}`);
    },
    listSpaceResources(spaceId: string): SpaceResourceStoreRecord[] {
      return Array.from(spaceResources.values())
        .filter((entry) => entry.spaceId === spaceId)
        .sort((lhs, rhs) => lhs.addedAt.localeCompare(rhs.addedAt));
    },
    upsertSpaceResource(input: UpsertSpaceResourceStoreInput): SpaceResourceStoreRecord {
      const key = `${input.spaceId}:${input.resourceId}`;
      const row: SpaceResourceStoreRecord = {
        resourceId: input.resourceId,
        spaceId: input.spaceId,
        uri: input.uri,
        type: input.type,
        label: input.label ?? "",
        addedAt: input.addedAt ?? now(),
      };
      spaceResources.set(key, row);
      return row;
    },
    deleteSpaceResource(spaceId: string, resourceId: string): boolean {
      return spaceResources.delete(`${spaceId}:${resourceId}`);
    },
    loadIdempotency(
      principalId: string,
      endpoint: string,
      idempotencyKey: string,
    ): { requestHash: string; responseType: string; responsePayload: string } | null {
      return idempotency.get(`${principalId}:${endpoint}:${idempotencyKey}`) ?? null;
    },
    saveIdempotency(
      principalId: string,
      endpoint: string,
      idempotencyKey: string,
      record: { requestHash: string; responseType: string; responsePayload: string },
    ): void {
      idempotency.set(`${principalId}:${endpoint}:${idempotencyKey}`, record);
    },
  };
}
