import type { ReflectionService, SpaceAdminService, SpaceManager } from "@spaceskit/core";
import type {
  OrchestratorCommandRepository,
  OrchestratorCommandStatus,
  TurnRepository,
} from "@spaceskit/persistence";
import type { SpaceContextService } from "./space-context-service.js";

export type OrchestratorCommandType =
  | "list_spaces"
  | "get_space_digest"
  | "create_space"
  | "list_skills"
  | "create_skill"
  | "handoff_space"
  | "add_agent"
  | "share_context"
  | "run_space_prompt";

export interface OrchestratorCommandInput {
  apiVersion?: string;
  correlationId?: string;
  idempotencyKey?: string;
  commandType: OrchestratorCommandType;
  targetSpaceId?: string;
  targetAgentId?: string;
  payload?: Record<string, unknown>;
  /**
   * Authenticated caller principal identity for external command paths.
   */
  principalId?: string;
  /**
   * Optional caller device identity for audit/policy hooks.
   */
  deviceId?: string;
  /**
   * Reserved for trusted internal/system callers.
   * External caller paths must provide an explicit targetSpaceId.
   */
  trustedInternal?: boolean;
}

export interface OrchestratorCommandEvent {
  status: OrchestratorCommandStatus;
  event: Record<string, unknown>;
  createdAt: string;
}

export interface OrchestratorCommandResult {
  commandId: string;
  correlationId: string;
  apiVersion: string;
  commandType: string;
  targetSpaceId: string;
  targetAgentId?: string;
  status: OrchestratorCommandStatus;
  result?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
  createdAt: string;
  updatedAt: string;
  events: OrchestratorCommandEvent[];
}

export interface OrchestratorCommandServiceOptions {
  repository: OrchestratorCommandRepository;
  spaceAdminService: SpaceAdminService;
  spaceManager: Pick<SpaceManager, "executeTurn">;
  spaceContextService: SpaceContextService;
  defaultTargetSpaceId: string;
  turnRepo?: Pick<TurnRepository, "listBySpace">;
  reflectionService?: Pick<ReflectionService, "runSummaryJob">;
  /**
   * If true, non-trusted callers must provide a caller principal.
   */
  requireCallerPrincipal?: boolean;
  /**
   * Optional authorization hook for orchestrator commands.
   * Used to enforce space-sharing policy on direct service entry paths.
   */
  authorizeCommand?: (input: {
    commandType: OrchestratorCommandType;
    targetSpaceId: string;
    principalId: string;
    deviceId?: string;
  }) => { allowed: boolean; reason?: string } | Promise<{ allowed: boolean; reason?: string }>;
  /** Restrict externally-submitted commands to the control-plane command set. */
  controlOnlyMode?: boolean;
  gatewaySkillCatalogService?: {
    listSkills: (input?: {
      query?: string;
      tags?: string[];
      status?: "active" | "archived" | "all";
      limit?: number;
    }) => unknown[];
    upsertSkill: (input: {
      skillId?: string;
      name: string;
      description?: string;
      contentMarkdown: string;
      sourceRef?: string;
      tags?: string[];
      status?: "active" | "archived";
    }) => {
      skill: unknown;
      created: boolean;
    };
  };
}

