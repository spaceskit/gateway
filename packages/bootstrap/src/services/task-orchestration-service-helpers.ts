import type {
  ArchetypeDefinition,
  CapabilityTier,
  EventBus,
  TurnModelStrategy,
  TurnModelConfig,
} from "@spaceskit/core";
import { isCapabilityTier, resolveTierProviderHints } from "@spaceskit/core";
import type {
  CreateProfileInput,
  ProfileModelConfig,
  SpaceTemplateRepository,
  TaskRecordRepository,
} from "@spaceskit/persistence";
import type { OrchestrateTaskInput } from "./task-orchestration-service-impl.js";

export type TaskOutcome =
  | { type: "completed"; detail?: string; turnsCompleted: number }
  | { type: "failed"; detail: string; turnsCompleted: number }
  | { type: "input_required"; detail: string; turnsCompleted: number };

export type TaskAgentAssignment = {
  agentId: string;
  profileId: string;
  role: string;
  isPrimary: boolean;
  agentTier?: CapabilityTier;
};

export type TaskOrchestrationProfileRepository = {
  getById(id: string): {
    profile_id: string;
    name: string;
    description: string;
    can_moderate: number;
    is_default: number;
    preferred_tier?: string;
  } | undefined;
  getActiveRevision(id: string): {
    profile_id: string;
    personality_prompt: string;
    default_skill_set_ids_json: string;
    provider_hint: string;
    model_config_json: string;
  } | undefined;
  create(input: CreateProfileInput): unknown;
};

export function createEarlyTaskOutcomeListener(input: {
  taskId: string;
  spaceId: string;
  topology: string;
  totalSteps: number;
  taskRecordRepo: TaskRecordRepository;
  eventBus: EventBus;
}): {
  promise: Promise<TaskOutcome>;
  bindTurnId: (turnId: string) => void;
  dispose: () => void;
} {
  let boundTurnId: string | undefined;
  let settled = false;
  let turnsCompleted = 0;
  let resolvePromise: (outcome: TaskOutcome) => void;

  const promise = new Promise<TaskOutcome>((resolve) => {
    resolvePromise = resolve;
  });

  const bufferedOrchestratorEvents: Array<Record<string, unknown>> = [];
  const bufferedTurnEvents: Array<Record<string, unknown>> = [];

  const finish = (outcome: TaskOutcome) => {
    if (settled) return;
    settled = true;
    unsubOrchestrator();
    unsubTurn();
    resolvePromise(outcome);
  };

  const updateProgress = (currentPhase: string, latestMessage?: string) => {
    if (!boundTurnId) return;
    input.taskRecordRepo.update({
      taskId: input.taskId,
      progress: {
        turnsCompleted,
        turnsTotal: input.totalSteps,
        currentPhase,
        rootTurnId: boundTurnId,
        latestMessage,
      },
    });
    input.eventBus.emit({
      type: "task.progress",
      timestamp: new Date(),
      spaceId: input.spaceId,
      data: {
        taskId: input.taskId,
        progress: {
          turnsCompleted,
          turnsTotal: input.totalSteps,
          currentPhase,
        },
        message: latestMessage,
      },
    });
  };

  const processOrchestratorEvent = (event: Record<string, unknown>) => {
    const typed = event as {
      spaceId?: string;
      correlationId?: string;
      eventType?: string;
      event?: { summary?: { finalSummaryText?: string; failureReason?: string } };
    };
    if (typed.spaceId !== input.spaceId) return;
    if (typed.correlationId !== boundTurnId) return;
    if (typed.eventType === "summary.completed") {
      turnsCompleted = Math.max(turnsCompleted, 1);
      updateProgress("completed", typed.event?.summary?.finalSummaryText);
      finish({
        type: "completed",
        detail: typed.event?.summary?.finalSummaryText,
        turnsCompleted,
      });
      return;
    }
    if (typed.eventType === "summary.failed") {
      const detail = typed.event?.summary?.failureReason ?? "Task orchestration failed";
      updateProgress("failed", detail);
      finish({ type: "failed", detail, turnsCompleted });
    }
  };

  const processTurnEvent = (event: Record<string, unknown>) => {
    const typed = event as {
      spaceId?: string;
      turnId?: string;
      event?: {
        type?: string;
        text?: string;
        error?: { message?: string };
        request?: { description?: string };
        result?: { finalMessage?: { content?: string } };
      };
    };
    if (typed.spaceId !== input.spaceId) return;
    if (typed.turnId !== boundTurnId) return;
    const eventType = typed.event?.type ?? "";
    if (eventType === "text_delta") {
      updateProgress("executing", typeof typed.event?.text === "string" ? typed.event.text : undefined);
      return;
    }
    if (eventType === "turn_completed") {
      const finalMessage = typed.event?.result && typeof typed.event.result === "object" && typed.event.result
        && "finalMessage" in typed.event.result
        ? (typed.event.result as { finalMessage?: { content?: string } }).finalMessage?.content
        : undefined;
      turnsCompleted += 1;
      updateProgress(input.topology === "direct" ? "completed" : "executing", finalMessage);
      if (input.topology === "direct") {
        finish({ type: "completed", detail: finalMessage, turnsCompleted });
      }
      return;
    }
    if (eventType === "feedback_requested") {
      const detail = typed.event?.request?.description ?? "Task paused awaiting feedback";
      updateProgress("input-required", detail);
      finish({ type: "input_required", detail, turnsCompleted });
      return;
    }
    if (eventType === "error") {
      const detail = typed.event?.error?.message ?? "Task orchestration failed";
      updateProgress("failed", detail);
      finish({ type: "failed", detail, turnsCompleted });
    }
  };

  const unsubOrchestrator = input.eventBus.on("space.orchestrator_event", (event) => {
    if (!boundTurnId) {
      bufferedOrchestratorEvents.push(event as Record<string, unknown>);
      return;
    }
    processOrchestratorEvent(event as Record<string, unknown>);
  });

  const unsubTurn = input.eventBus.on("space.turn_event", (event) => {
    if (!boundTurnId) {
      bufferedTurnEvents.push(event as Record<string, unknown>);
      return;
    }
    processTurnEvent(event as Record<string, unknown>);
  });

  const bindTurnId = (turnId: string) => {
    boundTurnId = turnId;
    for (const event of bufferedOrchestratorEvents) {
      if (settled) break;
      processOrchestratorEvent(event);
    }
    bufferedOrchestratorEvents.length = 0;
    for (const event of bufferedTurnEvents) {
      if (settled) break;
      processTurnEvent(event);
    }
    bufferedTurnEvents.length = 0;
  };

  const dispose = () => {
    if (settled) return;
    settled = true;
    unsubOrchestrator();
    unsubTurn();
    bufferedOrchestratorEvents.length = 0;
    bufferedTurnEvents.length = 0;
  };

  return { promise, bindTurnId, dispose };
}

export function resolveTemplateForTask(
  input: OrchestrateTaskInput,
  spaceTemplateRepo: SpaceTemplateRepository,
  resolveArchetypeHint: (hint: string) => ArchetypeDefinition | undefined,
): {
  templateId: string;
  archetype: ArchetypeDefinition | undefined;
  templateConfig: Record<string, unknown> | undefined;
} {
  if (input.templateId) {
    const rev = spaceTemplateRepo.getActiveRevision(input.templateId);
    const config = rev ? safeParseJson(rev.space_config_json) : undefined;
    return { templateId: input.templateId, archetype: undefined, templateConfig: config };
  }

  if (input.templateHint) {
    const archetype = resolveArchetypeHint(input.templateHint);
    if (archetype) {
      const templateId = `archetype/${archetype.id}`;
      const rev = spaceTemplateRepo.getActiveRevision(templateId);
      const config = rev ? safeParseJson(rev.space_config_json) : undefined;
      return { templateId, archetype, templateConfig: config };
    }

    const templates = spaceTemplateRepo.list();
    const hint = input.templateHint.toLowerCase();
    const match = templates.find((template) =>
      template.name.toLowerCase().includes(hint) ||
      template.description.toLowerCase().includes(hint),
    );
    if (match) {
      const rev = spaceTemplateRepo.getActiveRevision(match.template_id);
      const config = rev ? safeParseJson(rev.space_config_json) : undefined;
      return { templateId: match.template_id, archetype: undefined, templateConfig: config };
    }
  }

  const archetype = resolveArchetypeHint("research")!;
  return { templateId: "archetype/research", archetype, templateConfig: undefined };
}

export function resolveTurnModel(
  topology: string,
  archetype: ArchetypeDefinition | undefined,
): TurnModelStrategy {
  if (archetype?.turnModel) return archetype.turnModel as TurnModelStrategy;
  switch (topology) {
    case "broadcast_team":
      return "primary_only";
    case "shared_team_chat":
      return "sequential_all";
    default:
      return "primary_only";
  }
}

export function resolveTurnModelConfig(
  topology: string,
  archetype: ArchetypeDefinition | undefined,
): TurnModelConfig | undefined {
  if (!archetype?.masterModeEnabled) return undefined;
  return { strategy: resolveTurnModel(topology, archetype), masterModeEnabled: true };
}

export function generateTaskSpaceName(description: string): string {
  const words = description.split(/\s+/).slice(0, 5).join(" ");
  return words.length > 50 ? words.substring(0, 47) + "..." : words;
}

export function buildTaskAgentAssignments(input: {
  agentCount: number;
  requestedTier: CapabilityTier | undefined;
  topology: string;
  archetype: ArchetypeDefinition | undefined;
  templateConfig: Record<string, unknown> | undefined;
}): TaskAgentAssignment[] {
  if (input.templateConfig?.agents && Array.isArray(input.templateConfig.agents)) {
    const templateAgents = input.templateConfig.agents as TaskAgentAssignment[];
    if (input.agentCount === templateAgents.length) {
      return templateAgents;
    }

    const coordinator = templateAgents.find((agent) => agent.role === "global_coordinator");
    const workers = templateAgents.filter((agent) => agent.role !== "global_coordinator");
    const targetWorkers = coordinator ? input.agentCount - 1 : input.agentCount;
    const result: TaskAgentAssignment[] = [];
    if (coordinator) result.push(coordinator);

    for (let i = 0; i < targetWorkers; i++) {
      const baseWorker = workers[i % workers.length];
      if (baseWorker) {
        result.push({
          ...baseWorker,
          agentId: i < workers.length ? baseWorker.agentId : `${baseWorker.agentId}-${i + 1}`,
          agentTier: input.requestedTier ?? baseWorker.agentTier,
        });
      }
    }

    return result;
  }

  if (input.topology === "broadcast_team") {
    return buildBroadcastTeamAssignments(input);
  }
  return buildSharedTeamAssignments(input);
}

export function resolveProfileIdForTier(input: {
  baseProfileId: string;
  tier: CapabilityTier;
  profileRepo: TaskOrchestrationProfileRepository;
}): string {
  const baseProfile = input.profileRepo.getById(input.baseProfileId);
  if (!baseProfile) return input.baseProfileId;

  const preferredTier = normalizeCapabilityTier(baseProfile.preferred_tier);
  if (preferredTier === input.tier) return input.baseProfileId;

  const revision = input.profileRepo.getActiveRevision(input.baseProfileId);
  if (!revision) return input.baseProfileId;

  const derivedProfileId = `${input.baseProfileId}::${input.tier}`;
  if (input.profileRepo.getById(derivedProfileId)) {
    return derivedProfileId;
  }

  const providerHints = resolveTierProviderHints(input.tier);
  const primaryProvider = providerHints.providers[0] ?? revision.provider_hint;
  const preferredModels = providerHints.providers
    .map((providerId) => providerHints.modelIds[providerId])
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const modelConfig: ProfileModelConfig | undefined = preferredModels.length > 0
    ? {
      preferredModels,
      constraints: { capabilityTier: input.tier },
    }
    : undefined;

  input.profileRepo.create({
    profileId: derivedProfileId,
    name: `${baseProfile.name} (${input.tier})`,
    description: baseProfile.description,
    personalityPrompt: revision.personality_prompt,
    defaultSkillIds: parseStringArray(revision.default_skill_set_ids_json),
    canModerate: baseProfile.can_moderate === 1,
    isDefault: false,
    providerHint: primaryProvider,
    modelConfig,
    source: `task-orchestration-tier:${input.baseProfileId}`,
  });

  return derivedProfileId;
}

function buildBroadcastTeamAssignments(input: {
  agentCount: number;
  requestedTier: CapabilityTier | undefined;
  archetype: ArchetypeDefinition | undefined;
}): TaskAgentAssignment[] {
  const agents: TaskAgentAssignment[] = [];
  const coordinatorProfileId = input.archetype
    ? `archetype/${input.archetype.id === "debate" ? "debate-synthesizer" : `${input.archetype.id}-coordinator`}`
    : "archetype/research-coordinator";

  agents.push({
    agentId: "coordinator",
    profileId: coordinatorProfileId,
    role: "global_coordinator",
    isPrimary: true,
    agentTier: input.requestedTier ?? input.archetype?.coordinatorTier ?? "advanced",
  });

  const workerProfileId = input.archetype
    ? `archetype/${input.archetype.id === "debate" ? "debater" : input.archetype.id === "analysis" ? "analyst" : "researcher"}`
    : "archetype/researcher";

  for (let i = 0; i < input.agentCount - 1; i++) {
    agents.push({
      agentId: `worker-${i + 1}`,
      profileId: workerProfileId,
      role: "participant",
      isPrimary: false,
      agentTier: input.requestedTier ?? input.archetype?.workerTier ?? "standard",
    });
  }

  return agents;
}

function buildSharedTeamAssignments(input: {
  agentCount: number;
  requestedTier: CapabilityTier | undefined;
  archetype: ArchetypeDefinition | undefined;
}): TaskAgentAssignment[] {
  const profileId = input.archetype
    ? `archetype/${input.archetype.id === "coding" ? "developer" : "discussant"}`
    : "archetype/discussant";

  const agents: TaskAgentAssignment[] = [];
  for (let i = 0; i < input.agentCount; i++) {
    agents.push({
      agentId: `agent-${i + 1}`,
      profileId,
      role: "participant",
      isPrimary: i === 0,
      agentTier: input.requestedTier ?? input.archetype?.workerTier ?? "standard",
    });
  }

  return agents;
}

function safeParseJson(json: string | null | undefined): Record<string, unknown> | undefined {
  if (!json) return undefined;
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      : [];
  } catch {
    return [];
  }
}

function normalizeCapabilityTier(value: string | undefined): CapabilityTier | undefined {
  return value && isCapabilityTier(value) ? value : undefined;
}
