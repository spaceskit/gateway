import type { ToolDefinition, ToolResult } from "./model-provider.js";

export const CONCIERGE_OPERATIONS_SKILL_ID = "role/concierge-operations";

export type ConciergeWorkbenchToolName =
  | "workbench.list_queue"
  | "workbench.get_queue_item"
  | "workbench.list_runs"
  | "workbench.get_run"
  | "workbench.get_policy"
  | "workbench.list_artifacts"
  | "workbench.start_run"
  | "workbench.retry_run"
  | "workbench.cancel_run"
  | "workbench.approve_stage"
  | "workbench.reject_stage";

export interface ConciergeWorkbenchToolExecutionContext {
  spaceId: string;
  agentId: string;
  turnId: string;
  principalId?: string;
}

export interface ConciergeWorkbenchConfirmationStatus {
  requestId: string;
  status: string;
  response?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export interface ConciergeWorkbenchToolConfig {
  workbenchService?: {
    listQueue?: (input: Record<string, unknown>) => Promise<unknown>;
    getQueueItem?: (input: Record<string, unknown>) => Promise<unknown>;
    listRuns?: (input: Record<string, unknown>) => Promise<unknown>;
    getRun?: (input: Record<string, unknown>) => Promise<unknown>;
    getPolicy?: (input: Record<string, unknown>) => Promise<unknown>;
    listArtifacts?: (input: Record<string, unknown>) => Promise<unknown>;
    startRun?: (input: Record<string, unknown>) => Promise<unknown>;
    retryRun?: (input: Record<string, unknown>) => Promise<unknown>;
    cancelRun?: (input: Record<string, unknown>) => Promise<unknown>;
    approveStage?: (input: Record<string, unknown>) => Promise<unknown>;
    rejectStage?: (input: Record<string, unknown>) => Promise<unknown>;
  } | null;
  confirmationService?: {
    getRequestStatus: (input: {
      requestId: string;
      spaceId: string;
      agentId: string;
    }) => Promise<ConciergeWorkbenchConfirmationStatus>;
  } | null;
}

type ConciergeWorkbenchService = NonNullable<ConciergeWorkbenchToolConfig["workbenchService"]>;
type ConciergeWorkbenchServiceMethodName = keyof ConciergeWorkbenchService;

const WORKBENCH_TOOL_PREFIX = "workbench.";
const WORKBENCH_TOOL_NAMES: readonly ConciergeWorkbenchToolName[] = [
  "workbench.list_queue",
  "workbench.get_queue_item",
  "workbench.list_runs",
  "workbench.get_run",
  "workbench.get_policy",
  "workbench.list_artifacts",
  "workbench.start_run",
  "workbench.retry_run",
  "workbench.cancel_run",
  "workbench.approve_stage",
  "workbench.reject_stage",
];
const WORKBENCH_MUTATION_TOOL_NAMES = new Set<ConciergeWorkbenchToolName>([
  "workbench.start_run",
  "workbench.retry_run",
  "workbench.cancel_run",
  "workbench.approve_stage",
  "workbench.reject_stage",
]);

export function createConciergeWorkbenchToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "workbench.list_queue",
      description: "List active Workbench queue items so the built-in concierge can recommend next work.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
      },
    },
    {
      name: "workbench.get_queue_item",
      description: "Get one Workbench queue item by id.",
      inputSchema: {
        type: "object",
        properties: {
          queueItemId: { type: "string" },
        },
        required: ["queueItemId"],
      },
    },
    {
      name: "workbench.list_runs",
      description: "List recent Workbench runs, optionally filtered by queue item.",
      inputSchema: {
        type: "object",
        properties: {
          queueItemId: { type: "string" },
          batchId: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
      },
    },
    {
      name: "workbench.get_run",
      description: "Get one Workbench run by id.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
        },
        required: ["runId"],
      },
    },
    {
      name: "workbench.get_policy",
      description: "Get Workbench execution policy and runner availability.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "workbench.list_artifacts",
      description: "List evidence artifacts for a Workbench run.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
        },
        required: ["runId"],
      },
    },
    mutationDefinition(
      "workbench.start_run",
      "Start a Workbench run after the user explicitly approves the action.",
      {
        queueItemId: { type: "string" },
        batchId: { type: "string" },
        executionMode: { type: "string", enum: ["supervised", "autonomous"] },
      },
      ["queueItemId", "confirmationRequestId"],
    ),
    mutationDefinition(
      "workbench.retry_run",
      "Retry a Workbench run after the user explicitly approves the action.",
      {
        runId: { type: "string" },
      },
      ["runId", "confirmationRequestId"],
    ),
    mutationDefinition(
      "workbench.cancel_run",
      "Cancel a Workbench run after the user explicitly approves the action.",
      {
        runId: { type: "string" },
      },
      ["runId", "confirmationRequestId"],
    ),
    mutationDefinition(
      "workbench.approve_stage",
      "Approve a Workbench review gate after the user explicitly approves the action.",
      {
        runId: { type: "string" },
        stage: { type: "string" },
      },
      ["runId", "confirmationRequestId"],
    ),
    mutationDefinition(
      "workbench.reject_stage",
      "Reject a Workbench review gate after the user explicitly approves the action.",
      {
        runId: { type: "string" },
        stage: { type: "string" },
        reason: { type: "string" },
      },
      ["runId", "confirmationRequestId"],
    ),
  ];
}

export function createConciergeWorkbenchToolExecutor(
  config: ConciergeWorkbenchToolConfig,
): (
  name: string,
  args: Record<string, unknown>,
  context: ConciergeWorkbenchToolExecutionContext,
) => Promise<ToolResult> {
  return async (name, args, context) => {
    const toolCallId = `${name}:${context.turnId}`;
    if (!isConciergeWorkbenchTool(name)) {
      return errorResult(toolCallId, "unsupported_workbench_tool", `Unsupported Workbench tool: ${name}`);
    }
    if (!config.workbenchService) {
      return errorResult(toolCallId, "workbench_unavailable", "Workbench service is unavailable.");
    }

    try {
      if (WORKBENCH_MUTATION_TOOL_NAMES.has(name)) {
        const confirmation = await requireApprovedConfirmation(name, config, args, context);
        if (confirmation) return { toolCallId, result: confirmation, isError: true };
        if (!context.principalId?.trim()) {
          return errorResult(toolCallId, "principal_required", "Workbench mutations require an authenticated principal.");
        }
      }

      const payload = payloadForTool(name, args, context);
      switch (name) {
        case "workbench.list_queue":
          return serviceResult(toolCallId, config.workbenchService, "listQueue", payload);
        case "workbench.get_queue_item":
          return serviceResult(toolCallId, config.workbenchService, "getQueueItem", payload);
        case "workbench.list_runs":
          return serviceResult(toolCallId, config.workbenchService, "listRuns", payload);
        case "workbench.get_run":
          return serviceResult(toolCallId, config.workbenchService, "getRun", payload);
        case "workbench.get_policy":
          return serviceResult(toolCallId, config.workbenchService, "getPolicy", payload);
        case "workbench.list_artifacts":
          return serviceResult(toolCallId, config.workbenchService, "listArtifacts", payload);
        case "workbench.start_run":
          return serviceResult(toolCallId, config.workbenchService, "startRun", payload);
        case "workbench.retry_run":
          return serviceResult(toolCallId, config.workbenchService, "retryRun", payload);
        case "workbench.cancel_run":
          return serviceResult(toolCallId, config.workbenchService, "cancelRun", payload);
        case "workbench.approve_stage":
          return serviceResult(toolCallId, config.workbenchService, "approveStage", payload);
        case "workbench.reject_stage":
          return serviceResult(toolCallId, config.workbenchService, "rejectStage", payload);
      }
    } catch (error) {
      return errorResult(toolCallId, "workbench_tool_failed", error instanceof Error ? error.message : String(error));
    }
  };
}

export function createConciergeWorkbenchToolFilter(config: {
  spaceAdminService: {
    getSpace: (spaceId: string) => Promise<{
      agents?: Array<{ agentId: string; profileId: string }>;
    } | null>;
  };
  profileRepo: {
    getActiveRevision: (profileId: string) => {
      default_skill_set_ids_json?: string | null;
    } | undefined;
  } | null;
}): (spaceId: string, agentId: string) => Promise<boolean> {
  return async (spaceId, agentId) => {
    const space = await config.spaceAdminService.getSpace(spaceId);
    const profileId = space?.agents?.find((agent) => agent.agentId === agentId)?.profileId;
    if (!profileId || !config.profileRepo) return false;
    const revision = config.profileRepo.getActiveRevision(profileId);
    const skillIds = parseSkillIds(revision?.default_skill_set_ids_json);
    return skillIds.includes(CONCIERGE_OPERATIONS_SKILL_ID);
  };
}

export function isConciergeWorkbenchTool(toolName: string): toolName is ConciergeWorkbenchToolName {
  return toolName.startsWith(WORKBENCH_TOOL_PREFIX)
    && WORKBENCH_TOOL_NAMES.includes(toolName as ConciergeWorkbenchToolName);
}

function mutationDefinition(
  name: ConciergeWorkbenchToolName,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): ToolDefinition {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: {
        ...properties,
        confirmationRequestId: {
          type: "string",
          description: "Approved concierge escalation request id authorizing this Workbench mutation.",
        },
      },
      required,
    },
  };
}

async function requireApprovedConfirmation(
  name: ConciergeWorkbenchToolName,
  config: ConciergeWorkbenchToolConfig,
  args: Record<string, unknown>,
  context: ConciergeWorkbenchToolExecutionContext,
): Promise<Record<string, unknown> | null> {
  const confirmationRequestId = asRequiredString(args.confirmationRequestId);
  if (!confirmationRequestId) {
    return {
      error: {
        code: "confirmation_required",
        message: "Workbench mutation requires confirmationRequestId from an approved concierge request.",
      },
    };
  }
  if (!config.confirmationService) {
    return {
      error: {
        code: "confirmation_unavailable",
        message: "Concierge confirmation service is unavailable.",
      },
    };
  }
  const status = await config.confirmationService.getRequestStatus({
    requestId: confirmationRequestId,
    spaceId: context.spaceId,
    agentId: context.agentId,
  });
  if (status.status !== "actioned" || status.response?.action !== "approve") {
    return {
      error: {
        code: "confirmation_not_approved",
        message: "Workbench mutation confirmation has not been approved.",
        requestId: confirmationRequestId,
        status: status.status,
      },
    };
  }
  const contextMismatch = validateConfirmationContext(name, args, status.context);
  if (contextMismatch) {
    return {
      error: {
        code: "confirmation_context_mismatch",
        message: contextMismatch,
        requestId: confirmationRequestId,
      },
    };
  }
  return null;
}

function validateConfirmationContext(
  name: ConciergeWorkbenchToolName,
  args: Record<string, unknown>,
  confirmationContext: Record<string, unknown> | undefined,
): string | null {
  if (!confirmationContext || confirmationContext.source !== "workbench") {
    return "Workbench mutation confirmation is missing Workbench context.";
  }
  if (!matchesRequestedMutation(name, confirmationContext)) {
    return "Workbench mutation confirmation does not authorize this mutation.";
  }

  switch (name) {
    case "workbench.start_run":
      return validateMatchingString("queueItemId", args, confirmationContext)
        ?? validateOptionalMatchingString("executionMode", args, confirmationContext);
    case "workbench.retry_run":
    case "workbench.cancel_run":
      return validateMatchingString("runId", args, confirmationContext);
    case "workbench.approve_stage":
    case "workbench.reject_stage":
      return validateMatchingString("runId", args, confirmationContext)
        ?? validateOptionalMatchingString("stage", args, confirmationContext);
    default:
      return null;
  }
}

function matchesRequestedMutation(
  name: ConciergeWorkbenchToolName,
  confirmationContext: Record<string, unknown>,
): boolean {
  if (confirmationContext.requestedMutation === name) return true;
  return name === "workbench.reject_stage" && confirmationContext.rejectMutation === name;
}

function validateMatchingString(
  key: string,
  args: Record<string, unknown>,
  confirmationContext: Record<string, unknown>,
): string | null {
  const actual = asRequiredString(args[key]);
  const expected = asRequiredString(confirmationContext[key]);
  if (actual && expected && actual === expected) return null;
  return `Workbench mutation confirmation does not authorize ${key}=${actual || "<missing>"}.`;
}

function validateOptionalMatchingString(
  key: string,
  args: Record<string, unknown>,
  confirmationContext: Record<string, unknown>,
): string | null {
  const actual = asRequiredString(args[key]);
  const expected = asRequiredString(confirmationContext[key]);
  if (!actual || !expected || actual === expected) return null;
  return `Workbench mutation confirmation does not authorize ${key}=${actual}.`;
}

function payloadForTool(
  name: ConciergeWorkbenchToolName,
  args: Record<string, unknown>,
  context: ConciergeWorkbenchToolExecutionContext,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const copyOptional = (key: string) => {
    const value = args[key];
    if (typeof value === "string" && value.trim()) payload[key] = value.trim();
    if (typeof value === "number" && Number.isFinite(value)) payload[key] = value;
  };
  switch (name) {
    case "workbench.list_queue":
      copyOptional("limit");
      break;
    case "workbench.get_queue_item":
      payload.queueItemId = asRequiredString(args.queueItemId);
      break;
    case "workbench.list_runs":
      copyOptional("queueItemId");
      copyOptional("batchId");
      copyOptional("limit");
      break;
    case "workbench.get_run":
      payload.runId = asRequiredString(args.runId);
      break;
    case "workbench.get_policy":
      break;
    case "workbench.list_artifacts":
      payload.runId = asRequiredString(args.runId);
      break;
    case "workbench.start_run":
      payload.queueItemId = asRequiredString(args.queueItemId);
      copyOptional("batchId");
      copyOptional("executionMode");
      break;
    case "workbench.retry_run":
    case "workbench.cancel_run":
      payload.runId = asRequiredString(args.runId);
      break;
    case "workbench.approve_stage":
      payload.runId = asRequiredString(args.runId);
      copyOptional("stage");
      break;
    case "workbench.reject_stage":
      payload.runId = asRequiredString(args.runId);
      copyOptional("stage");
      copyOptional("reason");
      break;
  }
  if (context.principalId?.trim()) {
    payload.principalId = context.principalId.trim();
  }
  return payload;
}

async function serviceResult(
  toolCallId: string,
  service: ConciergeWorkbenchService,
  methodName: ConciergeWorkbenchServiceMethodName,
  payload: Record<string, unknown>,
): Promise<ToolResult> {
  const fn = service[methodName];
  if (!fn) {
    return errorResult(toolCallId, "workbench_method_unavailable", `Workbench service method unavailable: ${methodName}`);
  }
  return {
    toolCallId,
    result: await fn.call(service, payload),
    isError: false,
  };
}

function errorResult(toolCallId: string, code: string, message: string): ToolResult {
  return {
    toolCallId,
    result: {
      error: {
        code,
        message,
      },
    },
    isError: true,
  };
}

function asRequiredString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseSkillIds(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}
