import type { SpaceAdminService, SpaceConfig } from "@spaceskit/core";
import type { SpaceRepository } from "@spaceskit/persistence";
import { throwGatewayError } from "./gateway-admin-model-normalizers.js";
import {
  buildCanonicalConciergeSpaceConfigJson,
  hasAssignmentPolicyConflicts,
} from "./gateway-admin-managed-space-policy.js";

export interface ManagedGatewaySpaceSpec {
  spaceId: string;
  resourceId: string;
  name: string;
  goal: string;
  profileId: string;
  agentId: string;
}

export interface GatewayAdminManagedSpaceRepairContext {
  spaceAdminService: Pick<
    SpaceAdminService,
    "getSpace" | "createSpace" | "addAgent" | "updateAgentAssignment" | "setSpaceOrchestrator"
  >;
  spaceRepo?: SpaceRepository;
  main: ManagedGatewaySpaceSpec;
  concierge: ManagedGatewaySpaceSpec;
}

export interface ManagedSpaceRepairResult {
  spaceUid: string;
  repaired: boolean;
  assignedProfileId?: string;
  updatedAt: string;
}

type ManagedSpaceKind = "main" | "concierge";
type ManagedSpaceVisibility = "shared" | "private";
type ManagedSpaceAssignment = SpaceConfig["agents"][number];

interface ManagedSpacePolicy {
  kind: ManagedSpaceKind;
  label: "Main" | "Concierge";
  visibility: ManagedSpaceVisibility;
}

interface ManagedSpaceRefreshResult {
  refreshed: SpaceConfig;
  assignment: ManagedSpaceAssignment;
}

const CANONICAL_ROLE = "global_coordinator" as const;
const CANONICAL_TURN_ORDER = 0;

export async function ensureGatewayAdminMainSpace(
  context: GatewayAdminManagedSpaceRepairContext,
  repairIfMissing: boolean,
): Promise<ManagedSpaceRepairResult> {
  const policy: ManagedSpacePolicy = {
    kind: "main",
    label: "Main",
    visibility: "shared",
  };
  const spec = context.main;
  const spaceResult = await ensureManagedSpaceExists(context, spec, policy, repairIfMissing);
  let repaired = spaceResult.repaired;

  const assignmentResult = await ensureCanonicalAssignment(
    context,
    spec,
    policy,
    repairIfMissing,
    spaceResult.space,
  );
  repaired = repaired || assignmentResult.repaired;

  const conflictResult = await normalizeAssignmentPolicyConflicts(
    context,
    spec,
    policy,
    repairIfMissing,
    assignmentResult.refreshed,
  );
  repaired = repaired || conflictResult.repaired;

  return repairResult(conflictResult.refreshed, conflictResult.assignment, repaired);
}

export async function ensureGatewayAdminConciergeSpace(
  context: GatewayAdminManagedSpaceRepairContext,
  repairIfMissing: boolean,
): Promise<ManagedSpaceRepairResult> {
  const policy: ManagedSpacePolicy = {
    kind: "concierge",
    label: "Concierge",
    visibility: "private",
  };
  const spec = context.concierge;
  const spaceResult = await ensureManagedSpaceExists(context, spec, policy, repairIfMissing);
  let repaired = spaceResult.repaired;

  if (repairConciergeMetadata(context, spec, repairIfMissing)) {
    repaired = true;
  }

  const assignmentResult = await ensureCanonicalAssignment(
    context,
    spec,
    policy,
    repairIfMissing,
    spaceResult.space,
  );
  repaired = repaired || assignmentResult.repaired;

  const conflictResult = await normalizeAssignmentPolicyConflicts(
    context,
    spec,
    policy,
    repairIfMissing,
    assignmentResult.refreshed,
  );
  repaired = repaired || conflictResult.repaired;

  const orchestratorResult = await normalizeConciergeOrchestrator(
    context,
    spec,
    repairIfMissing,
    conflictResult.refreshed,
  );
  repaired = repaired || orchestratorResult.repaired;

  return repairResult(orchestratorResult.refreshed, orchestratorResult.assignment, repaired);
}

async function ensureManagedSpaceExists(
  context: GatewayAdminManagedSpaceRepairContext,
  spec: ManagedGatewaySpaceSpec,
  policy: ManagedSpacePolicy,
  repairIfMissing: boolean,
): Promise<{ space: SpaceConfig; repaired: boolean }> {
  const existing = await context.spaceAdminService.getSpace(spec.spaceId);
  if (existing) {
    return { space: existing, repaired: false };
  }

  if (!repairIfMissing) {
    throwGatewayError(
      "FAILED_PRECONDITION",
      `${policy.label} space is missing: ${spec.spaceId}`,
    );
  }

  const space = await context.spaceAdminService.createSpace({
    spaceId: spec.spaceId,
    resourceId: spec.resourceId,
    spaceType: policy.kind,
    name: spec.name,
    goal: spec.goal,
    turnModel: "sequential_all",
    visibility: policy.visibility,
    initialAgents: [canonicalInitialAgent(spec)],
  });
  return { space, repaired: true };
}

async function ensureCanonicalAssignment(
  context: GatewayAdminManagedSpaceRepairContext,
  spec: ManagedGatewaySpaceSpec,
  policy: ManagedSpacePolicy,
  repairIfMissing: boolean,
  space: SpaceConfig,
): Promise<ManagedSpaceRefreshResult & { repaired: boolean }> {
  let repaired = false;
  const assignment = space.agents.find((candidate) => candidate.agentId === spec.agentId);

  if (!assignment) {
    if (!repairIfMissing) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `${policy.label} agent assignment is missing: ${spec.agentId}`,
      );
    }
    await context.spaceAdminService.addAgent(canonicalAgentUpdate(spec));
    repaired = true;
  } else if (requiresAssignmentNormalization(assignment, spec)) {
    if (!repairIfMissing) {
      throwGatewayError(
        "FAILED_PRECONDITION",
        `${policy.label} assignment is out of policy for agent ${spec.agentId}`,
      );
    }
    await context.spaceAdminService.updateAgentAssignment(canonicalAgentUpdate(spec));
    repaired = true;
  }

  return {
    ...(await refreshManagedSpace(context, spec, policy, "repair")),
    repaired,
  };
}

async function normalizeAssignmentPolicyConflicts(
  context: GatewayAdminManagedSpaceRepairContext,
  spec: ManagedGatewaySpaceSpec,
  policy: ManagedSpacePolicy,
  repairIfMissing: boolean,
  space: SpaceConfig,
): Promise<ManagedSpaceRefreshResult & { repaired: boolean }> {
  if (!hasAssignmentPolicyConflicts(space.agents, spec.agentId)) {
    const assignment = requiredAssignment(space, spec, policy, "repair");
    return { refreshed: space, assignment, repaired: false };
  }

  if (!repairIfMissing) {
    throwGatewayError(
      "FAILED_PRECONDITION",
      `${policy.label} assignment policy conflict detected for canonical agent ${spec.agentId}`,
    );
  }

  await context.spaceAdminService.updateAgentAssignment(canonicalAgentUpdate(spec));
  return {
    ...(await refreshManagedSpace(context, spec, policy, "policy normalization")),
    repaired: true,
  };
}

async function normalizeConciergeOrchestrator(
  context: GatewayAdminManagedSpaceRepairContext,
  spec: ManagedGatewaySpaceSpec,
  repairIfMissing: boolean,
  space: SpaceConfig,
): Promise<ManagedSpaceRefreshResult & { repaired: boolean }> {
  if (space.orchestratorProfileId === spec.profileId) {
    const assignment = requiredAssignment(space, spec, { kind: "concierge", label: "Concierge", visibility: "private" }, "repair");
    return { refreshed: space, assignment, repaired: false };
  }

  if (!repairIfMissing) {
    throwGatewayError(
      "FAILED_PRECONDITION",
      `Concierge orchestrator profile is out of policy for ${spec.spaceId}`,
    );
  }

  await context.spaceAdminService.setSpaceOrchestrator({
    spaceId: spec.spaceId,
    profileId: spec.profileId,
  });
  return {
    ...(await refreshManagedSpace(
      context,
      spec,
      { kind: "concierge", label: "Concierge", visibility: "private" },
      "orchestrator normalization",
    )),
    repaired: true,
  };
}

function repairConciergeMetadata(
  context: GatewayAdminManagedSpaceRepairContext,
  spec: ManagedGatewaySpaceSpec,
  repairIfMissing: boolean,
): boolean {
  const rawSpace = context.spaceRepo?.getById(spec.spaceId);
  const desiredConfigJson = buildCanonicalConciergeSpaceConfigJson(
    rawSpace?.space_config_json,
    spec.profileId,
  );
  const requiresMetadataRepair = Boolean(rawSpace) && (
    rawSpace?.resource_id !== spec.resourceId
    || rawSpace?.space_type !== "concierge"
    || rawSpace?.name !== spec.name
    || rawSpace?.goal !== spec.goal
    || rawSpace?.turn_model !== "sequential_all"
    || rawSpace?.space_config_json !== desiredConfigJson
  );

  if (!requiresMetadataRepair) {
    return false;
  }

  if (!repairIfMissing) {
    throwGatewayError(
      "FAILED_PRECONDITION",
      `Concierge space metadata is out of policy for ${spec.spaceId}`,
    );
  }

  updateRawSpaceMetadata(context.spaceRepo, {
    spaceId: spec.spaceId,
    resourceId: spec.resourceId,
    spaceType: "concierge",
    name: spec.name,
    goal: spec.goal,
    turnModel: "sequential_all",
    configJson: desiredConfigJson,
  });
  return true;
}

async function refreshManagedSpace(
  context: GatewayAdminManagedSpaceRepairContext,
  spec: ManagedGatewaySpaceSpec,
  policy: ManagedSpacePolicy,
  stage: string,
): Promise<ManagedSpaceRefreshResult> {
  const refreshed = await context.spaceAdminService.getSpace(spec.spaceId);
  if (!refreshed) {
    throwGatewayError(
      "FAILED_PRECONDITION",
      `Unable to load ${policy.kind} space after ${stage}: ${spec.spaceId}`,
    );
  }

  return {
    refreshed,
    assignment: requiredAssignment(refreshed, spec, policy, stage),
  };
}

function requiredAssignment(
  space: SpaceConfig,
  spec: ManagedGatewaySpaceSpec,
  policy: ManagedSpacePolicy,
  stage: string,
): ManagedSpaceAssignment {
  const assignment = space.agents.find((candidate) => candidate.agentId === spec.agentId);
  if (!assignment) {
    throwGatewayError(
      "FAILED_PRECONDITION",
      `Unable to load canonical ${policy.kind} assignment after ${stage}: ${spec.spaceId}/${spec.agentId}`,
    );
  }
  return assignment;
}

function requiresAssignmentNormalization(
  assignment: ManagedSpaceAssignment,
  spec: ManagedGatewaySpaceSpec,
): boolean {
  return (
    assignment.profileId !== spec.profileId
    || assignment.role !== CANONICAL_ROLE
    || assignment.turnOrder !== CANONICAL_TURN_ORDER
    || !assignment.isPrimary
  );
}

function canonicalInitialAgent(spec: ManagedGatewaySpaceSpec) {
  return {
    agentId: spec.agentId,
    profileId: spec.profileId,
    role: CANONICAL_ROLE,
    turnOrder: CANONICAL_TURN_ORDER,
    isPrimary: true,
  };
}

function canonicalAgentUpdate(spec: ManagedGatewaySpaceSpec) {
  return {
    spaceId: spec.spaceId,
    ...canonicalInitialAgent(spec),
  };
}

function repairResult(
  space: SpaceConfig,
  assignment: ManagedSpaceAssignment,
  repaired: boolean,
): ManagedSpaceRepairResult {
  return {
    spaceUid: space.spaceUid,
    repaired,
    assignedProfileId: assignment.profileId,
    updatedAt: String(space.updatedAt),
  };
}

function updateRawSpaceMetadata(
  spaceRepo: SpaceRepository | undefined,
  input: {
    spaceId: string;
    resourceId: string;
    spaceType: string;
    name: string;
    goal: string;
    turnModel: string;
    configJson: string;
  },
): void {
  const db = (spaceRepo as { db?: { query: (sql: string) => { run: (...args: unknown[]) => unknown } } } | undefined)?.db;
  if (!db) {
    throw new Error("Space persistence unavailable for concierge metadata repair");
  }
  db.query(
    `UPDATE spaces
     SET resource_id = ?,
         space_type = ?,
         name = ?,
         goal = ?,
         turn_model = ?,
         space_config_json = ?,
         updated_at = ?
     WHERE space_id = ?`,
  ).run(
    input.resourceId,
    input.spaceType,
    input.name,
    input.goal,
    input.turnModel,
    input.configJson,
    new Date().toISOString(),
    input.spaceId,
  );
}
