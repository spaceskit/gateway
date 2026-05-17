import { randomUUID } from "node:crypto";
import {
  SpaceContextError,
} from "./space-context-service.js";
import {
  asBoolean,
  asNumber,
  asRecord,
  asRole,
  asString,
  asStringArray,
  buildSpaceDigestFallback,
  extractTextPreview,
  normalizeDigestWindow,
  normalizeSkillListStatus,
  normalizeSkillWriteStatus,
  normalizeSpaceStatusList,
  parseObject,
} from "./orchestrator-command-service-helpers.js";
import type {
  OrchestratorCommandInput,
  OrchestratorCommandResult,
  OrchestratorCommandServiceOptions,
  OrchestratorCommandType,
} from "./orchestrator-command-service-types.js";
export type {
  OrchestratorCommandEvent,
  OrchestratorCommandInput,
  OrchestratorCommandResult,
  OrchestratorCommandServiceOptions,
  OrchestratorCommandType,
} from "./orchestrator-command-service-types.js";

const CONTROL_ONLY_COMMANDS = new Set<OrchestratorCommandType>([
  "list_spaces",
  "get_space_digest",
  "create_space",
  "list_skills",
  "create_skill",
  "handoff_space",
]);

export class OrchestratorCommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
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
      case "list_spaces": {
        const statuses = normalizeSpaceStatusList(payload.statuses);
        const spaces = await this.options.spaceAdminService.listSpaces({
          statuses: statuses.length > 0 ? statuses : undefined,
          resourceId: asString(payload.resourceId),
          limit: asNumber(payload.limit),
        });
        return {
          spaces,
          count: spaces.length,
        };
      }

      case "get_space_digest": {
        const requestedSpaceId = asString(payload.spaceId) ?? targetSpaceId;
        const digestWindow = normalizeDigestWindow(payload.window);
        const turnLimit = digestWindow === "recent" ? 10 : 3;
        const space = await this.options.spaceAdminService.getSpace(requestedSpaceId);
        if (!space) {
          throw new OrchestratorCommandError("NOT_FOUND", `Space not found: ${requestedSpaceId}`);
        }
        if (!this.options.turnRepo) {
          throw new OrchestratorCommandError(
            "FAILED_PRECONDITION",
            "Turn repository is unavailable for get_space_digest",
          );
        }

        const turns = this.options.turnRepo.listBySpace(requestedSpaceId, turnLimit).map((turn) => ({
          agentId: turn.actor_id,
          status: turn.status,
          output: extractTextPreview(turn.output_json),
          createdAt: turn.created_at,
        }));
        const digest = await this.options.reflectionService?.runSummaryJob({
          kind: "space_digest",
          spaceId: requestedSpaceId,
          spaceName: space.name,
          goal: space.goal ?? undefined,
          activeAgents: space.agents.length,
          turns,
          pendingActions: [],
        });

        return {
          spaceId: requestedSpaceId,
          name: space.name,
          summary: digest?.summaryText ?? buildSpaceDigestFallback(space.name, turns),
          activeAgents: space.agents.length,
          lastTurnAt: turns[0]?.createdAt ?? null,
          pendingActions: [],
          trace: digest?.trace ?? null,
        };
      }

      case "create_space": {
        const resourceId = asString(payload.resourceId) ?? asString(payload.resource_id);
        const name = asString(payload.name);
        if (!resourceId || !name) {
          throw new OrchestratorCommandError(
            "INVALID_ARGUMENT",
            "create_space requires payload.resourceId and payload.name",
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

      case "handoff_space": {
        const handoffSpaceId = asString(payload.handoffSpaceId)
          ?? asString(payload.targetSpaceId);
        if (!handoffSpaceId) {
          throw new OrchestratorCommandError(
            "INVALID_ARGUMENT",
            "handoff_space requires payload.handoffSpaceId",
          );
        }
        const space = await this.options.spaceAdminService.getSpace(handoffSpaceId);
        if (!space) {
          throw new OrchestratorCommandError("NOT_FOUND", `Space not found: ${handoffSpaceId}`);
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
            space,
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
