import { randomUUID } from "node:crypto";
import type { SpaceAdminService, SpaceManager } from "@spaceskit/core";
import {
  OrchestratorCommandRepository,
  type OrchestratorCommandStatus,
} from "@spaceskit/persistence";
import {
  SpaceContextError,
  SpaceContextService,
} from "./space-context-service.js";

export type OrchestratorCommandType =
  | "list_rooms"
  | "create_room"
  | "list_skills"
  | "create_skill"
  | "handoff_room"
  | "add_agent"
  | "share_context"
  | "run_space_prompt";

const CONTROL_ONLY_COMMANDS = new Set<OrchestratorCommandType>([
  "list_rooms",
  "create_room",
  "list_skills",
  "create_skill",
  "handoff_room",
]);

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

export class OrchestratorCommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface OrchestratorCommandServiceOptions {
  repository: OrchestratorCommandRepository;
  spaceAdminService: SpaceAdminService;
  spaceManager: Pick<SpaceManager, "executeTurn">;
  spaceContextService: SpaceContextService;
  defaultTargetSpaceId: string;
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

export class OrchestratorCommandService {
  constructor(private readonly options: OrchestratorCommandServiceOptions) {}

  async submitCommand(input: OrchestratorCommandInput): Promise<OrchestratorCommandResult> {
    const commandType = input.commandType;
    if (!commandType) {
      throw new OrchestratorCommandError("INVALID_ARGUMENT", "commandType is required");
    }

    const correlationId = input.correlationId?.trim() || randomUUID();
    const explicitTargetSpaceId = input.targetSpaceId?.trim();
    const isTrustedInternal = input.trustedInternal === true;
    const targetSpaceId = explicitTargetSpaceId || (isTrustedInternal ? this.options.defaultTargetSpaceId : "");
    const principalId = asString(input.principalId);
    const deviceId = asString(input.deviceId);
    const idempotencyKey = input.idempotencyKey?.trim() || `${commandType}:${correlationId}`;

    if (!targetSpaceId) {
      throw new OrchestratorCommandError("INVALID_ARGUMENT", "targetSpaceId is required");
    }
    if (!isTrustedInternal && this.options.requireCallerPrincipal === true && !principalId) {
      throw new OrchestratorCommandError(
        "PERMISSION_DENIED",
        "Authenticated principal identity is required for orchestrator commands",
      );
    }
    if (!isTrustedInternal && principalId && this.options.authorizeCommand) {
      const decision = await this.options.authorizeCommand({
        commandType,
        targetSpaceId,
        principalId,
        deviceId,
      });
      if (!decision.allowed) {
        throw new OrchestratorCommandError(
          "PERMISSION_DENIED",
          decision.reason?.trim() || "Access denied for orchestrator command",
        );
      }
    }
    if (this.options.controlOnlyMode && !CONTROL_ONLY_COMMANDS.has(commandType)) {
      throw new OrchestratorCommandError(
        "PERMISSION_DENIED",
        `Command is not allowed in control-only mode: ${commandType}`,
      );
    }

    const replay = this.options.repository.getByIdempotency(targetSpaceId, idempotencyKey);
    if (replay) {
      return this.getCommand(replay.command_id)!;
    }

    const commandId = `orch-${randomUUID()}`;
    this.options.repository.create({
      commandId,
      correlationId,
      apiVersion: input.apiVersion ?? "v1",
      commandType,
      targetSpaceId,
      targetAgentId: input.targetAgentId,
      idempotencyKey,
      payloadJson: JSON.stringify(input.payload ?? {}),
      status: "accepted",
    });

    this.options.repository.setStatus(commandId, "running");

    try {
      const result = await this.execute(commandType, targetSpaceId, input);
      this.options.repository.setStatus(commandId, "completed", JSON.stringify(result));
      return this.getCommand(commandId)!;
    } catch (error) {
      const normalized = normalizeError(error);
      this.options.repository.setStatus(
        commandId,
        "failed",
        null,
        normalized.code,
        normalized.message,
      );
      return this.getCommand(commandId)!;
    }
  }

  getCommand(commandId: string): OrchestratorCommandResult | null {
    const row = this.options.repository.getById(commandId);
    if (!row) return null;

    const events = this.options.repository.listEvents(commandId).map((event) => ({
      status: event.status,
      event: parseObject(event.event_json) ?? {},
      createdAt: event.created_at,
    }));

    return {
      commandId: row.command_id,
      correlationId: row.correlation_id,
      apiVersion: row.api_version,
      commandType: row.command_type,
      targetSpaceId: row.target_space_id,
      targetAgentId: row.target_agent_id || undefined,
      status: row.status,
      result: parseObject(row.result_json),
      error: row.error_code
        ? {
          code: row.error_code,
          message: row.error_message || "Command failed",
        }
        : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      events,
    };
  }

  private async execute(
    commandType: OrchestratorCommandType,
    targetSpaceId: string,
    input: OrchestratorCommandInput,
  ): Promise<Record<string, unknown>> {
    const payload = input.payload ?? {};

    switch (commandType) {
      case "list_rooms": {
        const statuses = normalizeSpaceStatusList(payload.statuses);
        const spaces = await this.options.spaceAdminService.listSpaces({
          statuses: statuses.length > 0 ? statuses : undefined,
          resourceId: asString(payload.resourceId),
          limit: asNumber(payload.limit),
        });
        return {
          rooms: spaces,
          count: spaces.length,
        };
      }

      case "create_room": {
        const resourceId = asString(payload.resourceId) ?? asString(payload.resource_id);
        const name = asString(payload.name);
        if (!resourceId || !name) {
          throw new OrchestratorCommandError(
            "INVALID_ARGUMENT",
            "create_room requires payload.resourceId and payload.name",
          );
        }

        const space = await this.options.spaceAdminService.createSpace({
          spaceId: asString(payload.spaceId) ?? undefined,
          resourceId,
          spaceType: asString(payload.spaceType) ?? "space",
          name,
          goal: asString(payload.goal) ?? "",
        });

        return {
          space,
          created: true,
        };
      }

      case "list_skills": {
        if (!this.options.gatewaySkillCatalogService) {
          throw new OrchestratorCommandError(
            "FAILED_PRECONDITION",
            "Skill catalog service is unavailable",
          );
        }
        const skills = this.options.gatewaySkillCatalogService.listSkills({
          query: asString(payload.query),
          tags: asStringArray(payload.tags),
          status: normalizeSkillListStatus(payload.status),
          limit: asNumber(payload.limit),
        });
        return {
          skills,
          count: skills.length,
        };
      }

      case "create_skill": {
        if (!this.options.gatewaySkillCatalogService) {
          throw new OrchestratorCommandError(
            "FAILED_PRECONDITION",
            "Skill catalog service is unavailable",
          );
        }
        const name = asString(payload.name);
        const contentMarkdown = asString(payload.contentMarkdown) ?? asString(payload.content_markdown);
        if (!name || !contentMarkdown) {
          throw new OrchestratorCommandError(
            "INVALID_ARGUMENT",
            "create_skill requires payload.name and payload.contentMarkdown",
          );
        }
        const created = this.options.gatewaySkillCatalogService.upsertSkill({
          skillId: asString(payload.skillId) ?? asString(payload.skill_id),
          name,
          description: asString(payload.description),
          contentMarkdown,
          sourceRef: asString(payload.sourceRef) ?? asString(payload.source_ref),
          tags: asStringArray(payload.tags),
          status: normalizeSkillWriteStatus(payload.status),
        });
        return created;
      }

      case "handoff_room": {
        const handoffSpaceId = asString(payload.handoffSpaceId)
          ?? asString(payload.roomSpaceId)
          ?? asString(payload.targetRoomSpaceId)
          ?? asString(payload.targetSpaceId);
        if (!handoffSpaceId) {
          throw new OrchestratorCommandError(
            "INVALID_ARGUMENT",
            "handoff_room requires payload.handoffSpaceId",
          );
        }
        const room = await this.options.spaceAdminService.getSpace(handoffSpaceId);
        if (!room) {
          throw new OrchestratorCommandError("NOT_FOUND", `Room not found: ${handoffSpaceId}`);
        }

        const promptText = asString(payload.promptText);
        const promptTargetAgentId = asString(payload.targetAgentId) ?? input.targetAgentId;
        const turn = promptText
          ? await this.options.spaceManager.executeTurn(
            handoffSpaceId,
            promptText,
            promptTargetAgentId,
          )
          : null;

        return {
          handoff: {
            fromSpaceId: targetSpaceId,
            toSpaceId: handoffSpaceId,
            room,
            initiated: true,
          },
          ...(turn ? { turnId: turn.turnId } : {}),
          ...(promptTargetAgentId ? { targetAgentId: promptTargetAgentId } : {}),
        };
      }

      case "add_agent": {
        const agentId = asString(payload.agentId) ?? asString(payload.agent_id);
        const profileId = asString(payload.profileId) ?? asString(payload.profile_id);
        if (!agentId || !profileId) {
          throw new OrchestratorCommandError(
            "INVALID_ARGUMENT",
            "add_agent requires payload.agentId and payload.profileId",
          );
        }

        const assignment = await this.options.spaceAdminService.addAgent({
          spaceId: targetSpaceId,
          agentId,
          profileId,
          role: asRole(payload.role),
          isPrimary: asBoolean(payload.isPrimary),
          turnOrder: asNumber(payload.turnOrder),
        });

        return { assignment };
      }

      case "share_context": {
        const sourceSpaceId = asString(payload.sourceSpaceId) ?? targetSpaceId;
        const targetSpaceIdPayload = asString(payload.targetSpaceId);
        const artifactId = asString(payload.artifactId);
        if (!targetSpaceIdPayload || !artifactId) {
          throw new OrchestratorCommandError(
            "INVALID_ARGUMENT",
            "share_context requires payload.targetSpaceId and payload.artifactId",
          );
        }

        const transfer = this.options.spaceContextService.shareContext(
          sourceSpaceId,
          targetSpaceIdPayload,
          artifactId,
        );
        return { transfer };
      }

      case "run_space_prompt": {
        const promptText = asString(payload.promptText);
        if (!promptText) {
          throw new OrchestratorCommandError(
            "INVALID_ARGUMENT",
            "run_space_prompt requires payload.promptText",
          );
        }

        const payloadTargetAgentId = asString(payload.targetAgentId) ?? input.targetAgentId;
        const turn = await this.options.spaceManager.executeTurn(
          targetSpaceId,
          promptText,
          payloadTargetAgentId,
        );

        return {
          turnId: turn.turnId,
          targetSpaceId,
          targetAgentId: payloadTargetAgentId,
          source: "scheduler",
          metadata: asRecord(payload.metadata),
        };
      }

      default:
        throw new OrchestratorCommandError(
          "INVALID_ARGUMENT",
          `Unsupported commandType: ${String(commandType)}`,
        );
    }
  }
}

function parseObject(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore parse errors.
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function asRole(value: unknown): "participant" | "global_coordinator" | "space_moderator" | undefined {
  if (
    value === "participant"
    || value === "global_coordinator"
    || value === "space_moderator"
  ) {
    return value;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeSpaceStatusList(value: unknown): Array<"created" | "active" | "paused" | "completed" | "failed"> {
  if (!Array.isArray(value)) return [];
  const normalized = new Set<"created" | "active" | "paused" | "completed" | "failed">();
  for (const entry of value) {
    if (
      entry === "created"
      || entry === "active"
      || entry === "paused"
      || entry === "completed"
      || entry === "failed"
    ) {
      normalized.add(entry);
    }
  }
  return [...normalized];
}

function normalizeSkillListStatus(value: unknown): "active" | "archived" | "all" | undefined {
  if (value === "active" || value === "archived" || value === "all") {
    return value;
  }
  return undefined;
}

function normalizeSkillWriteStatus(value: unknown): "active" | "archived" | undefined {
  if (value === "active" || value === "archived") {
    return value;
  }
  return undefined;
}

function normalizeError(error: unknown): { code: string; message: string } {
  if (error instanceof OrchestratorCommandError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof SpaceContextError) {
    return { code: error.code, message: error.message };
  }
  if (typeof error === "object" && error !== null) {
    const candidate = error as { code?: unknown; message?: unknown };
    if (typeof candidate.code === "string" && typeof candidate.message === "string") {
      return { code: candidate.code, message: candidate.message };
    }
  }
  if (error instanceof Error) {
    return { code: "INTERNAL", message: error.message };
  }
  return { code: "INTERNAL", message: "Unknown command error" };
}
