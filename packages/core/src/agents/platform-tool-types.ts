import type { CapabilityExecutionOrigin, CapabilityRegistry } from "../capabilities/registry.js";
import type { ReflectionService } from "../reflection/reflection-service.js";
import type { SpaceAdminService } from "../spaces/space-admin-service.js";

export interface PlatformToolConfig {
  spaceAdminService: SpaceAdminService;
  capabilityRegistry: CapabilityRegistry;
  taskOrchestrationService?: {
    orchestrate: (input: {
      taskDescription: string;
      requestedBy: string;
      templateHint?: string;
      templateId?: string;
      agentCount?: number;
      agentTier?: string;
      topology?: "direct" | "shared_team_chat" | "broadcast_team";
      spaceId?: string;
      maxTurns?: number;
    }) => Promise<{
      taskId: string;
      spaceId: string;
      rootTurnId: string;
      templateId: string;
      agentCount: number;
      state: string;
    }>;
    getTaskProgress?: (taskId: string, requestedBy?: string) => unknown;
    listTasks?: (requestedBy?: string) => unknown[];
  } | null;
  memoryProvider?: {
    search: (query: Record<string, unknown>) => Promise<unknown>;
  } | null;
  gatewayProfile?: "embedded" | "external";
  turnRepo?: {
    listBySpace(spaceId: string, limit?: number, offset?: number): Array<{
      turn_id: string;
      space_id: string;
      actor_type: string;
      actor_id: string;
      input_json: string | null;
      output_json: string | null;
      status: string;
      token_input_count: number;
      token_output_count: number;
      created_at: string;
      completed_at: string | null;
    }>;
    countBySpace(spaceId: string): number;
  } | null;
  profileRepo?: {
    getById(profileId: string): {
      profile_id: string;
      name: string;
      description: string;
      can_moderate: number;
      is_default: number;
      active_revision: number;
      archived: number;
      created_at: string;
      updated_at: string;
    } | undefined;
    getActiveRevision(profileId: string): {
      profile_id: string;
      revision: number;
      personality_prompt: string;
      default_skill_set_ids_json: string;
      provider_hint: string;
      model_config_json: string;
      created_at: string;
    } | undefined;
  } | null;
  startedAt?: Date;
  reflectionService?: Pick<ReflectionService, "runSummaryJob">;
}

export interface PlatformToolExecutionContext {
  spaceId: string;
  agentId: string;
  turnId: string;
  principalId?: string;
  executionOrigin?: CapabilityExecutionOrigin;
}
