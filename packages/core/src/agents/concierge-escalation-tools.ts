import type { ToolDefinition, ToolResult } from "./model-provider.js";

export const USER_ESCALATION_SKILL_ID = "system/user-escalation";

export type ConciergeEscalationUrgency = "passive" | "important" | "urgent";
export type ConciergeEscalationResponseMode = "structured";
export type ConciergeEscalationAllowedResponse =
  | "approve"
  | "reject"
  | "defer"
  | "revise"
  | "open_app";
export type ConciergeEscalationFallbackPolicy = "none" | "urgent_call_after_timeout";
export type ConciergeEscalationStatus =
  | "pending"
  | "notified"
  | "actioned"
  | "expired"
  | "escalated_to_call"
  | "cancelled";
export type ConciergeEscalationDeliveryChannel = "notification" | "call";

export interface ConciergeEscalationRequestInput {
  question: string;
  reason: string;
  urgency?: ConciergeEscalationUrgency;
  responseMode?: ConciergeEscalationResponseMode;
  allowedResponses?: ConciergeEscalationAllowedResponse[];
  timeoutSeconds?: number;
  fallbackPolicy?: ConciergeEscalationFallbackPolicy;
  spaceId?: string;
  targetAgentId?: string;
}

export interface ConciergeEscalationRequestResult {
  requestId: string;
  status: ConciergeEscalationStatus;
  deliveryChannel: ConciergeEscalationDeliveryChannel;
  expiresAt?: string;
  deepLink?: string;
  response?: Record<string, unknown>;
}

export interface ConciergeEscalationStatusResult extends ConciergeEscalationRequestResult {
  question: string;
  reason: string;
  urgency: ConciergeEscalationUrgency;
  allowedResponses: ConciergeEscalationAllowedResponse[];
  fallbackPolicy: ConciergeEscalationFallbackPolicy;
}

export interface ConciergeEscalationCancelInput {
  requestId: string;
  reason?: string;
}

export interface ConciergeEscalationToolConfig {
  service: {
    requestUserInput: (input: ConciergeEscalationRequestInput & {
      spaceId: string;
      requestingAgentId: string;
      requestingTurnId: string;
      principalId?: string;
      deviceId?: string;
    }) => Promise<ConciergeEscalationRequestResult>;
    getRequestStatus: (input: {
      requestId: string;
      spaceId: string;
      agentId: string;
    }) => Promise<ConciergeEscalationStatusResult>;
    cancelRequest: (input: ConciergeEscalationCancelInput & {
      spaceId: string;
      agentId: string;
    }) => Promise<ConciergeEscalationRequestResult>;
  };
}

export interface ConciergeEscalationToolExecutionContext {
  spaceId: string;
  agentId: string;
  turnId: string;
  principalId?: string;
  deviceId?: string;
}

const CONCIERGE_TOOL_PREFIX = "concierge.";
const CONCIERGE_TOOL_NAMES = new Set([
  "concierge.request_user_input",
  "concierge.get_request_status",
  "concierge.cancel_request",
]);
const ALLOWED_RESPONSES = ["approve", "reject", "defer", "revise", "open_app"] as const;

export function createConciergeEscalationToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "concierge.request_user_input",
      description:
        "Ask the user for structured input through the gateway concierge. Use this when the agent is blocked on a human decision.",
      inputSchema: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "Short user-facing question to answer.",
          },
          reason: {
            type: "string",
            description: "Short internal reason the input is needed.",
          },
          urgency: {
            type: "string",
            enum: ["passive", "important", "urgent"],
            description: "How quickly the user should be interrupted.",
          },
          responseMode: {
            type: "string",
            enum: ["structured"],
            description: "Only structured responses are supported in v1.",
          },
          allowedResponses: {
            type: "array",
            description: "Allowed structured actions the user may choose from.",
            items: {
              type: "string",
              enum: [...ALLOWED_RESPONSES],
            },
          },
          timeoutSeconds: {
            type: "integer",
            minimum: 1,
            description: "How long to wait before the request expires or escalates.",
          },
          fallbackPolicy: {
            type: "string",
            enum: ["none", "urgent_call_after_timeout"],
            description: "Optional fallback if the request is urgent and unanswered.",
          },
          spaceId: {
            type: "string",
            description: "Target space ID. Defaults to the current space when omitted.",
          },
          targetAgentId: {
            type: "string",
            description: "Optional agent to associate with any urgent concierge call.",
          },
        },
        required: ["question", "reason"],
      },
    },
    {
      name: "concierge.get_request_status",
      description: "Get the latest status for a concierge user-input request.",
      inputSchema: {
        type: "object",
        properties: {
          requestId: {
            type: "string",
            description: "The request id returned by concierge.request_user_input.",
          },
        },
        required: ["requestId"],
      },
    },
    {
      name: "concierge.cancel_request",
      description: "Cancel a pending concierge input request.",
      inputSchema: {
        type: "object",
        properties: {
          requestId: {
            type: "string",
            description: "The request id returned by concierge.request_user_input.",
          },
          reason: {
            type: "string",
            description: "Optional cancellation reason for audit trails.",
          },
        },
        required: ["requestId"],
      },
    },
  ];
}

export function createConciergeEscalationToolExecutor(
  config: ConciergeEscalationToolConfig,
): (
  name: string,
  args: Record<string, unknown>,
  context: ConciergeEscalationToolExecutionContext,
) => Promise<ToolResult> {
  return async (name, args, context) => {
    const toolCallId = `${name}:${context.turnId}`;
    switch (name) {
      case "concierge.request_user_input": {
        const result = await config.service.requestUserInput({
          question: asRequiredString(args.question, "question"),
          reason: asRequiredString(args.reason, "reason"),
          urgency: asUrgency(args.urgency),
          responseMode: asResponseMode(args.responseMode),
          allowedResponses: asAllowedResponses(args.allowedResponses),
          timeoutSeconds: asOptionalInteger(args.timeoutSeconds),
          fallbackPolicy: asFallbackPolicy(args.fallbackPolicy),
          spaceId: asOptionalString(args.spaceId) ?? context.spaceId,
          targetAgentId: asOptionalString(args.targetAgentId),
          requestingAgentId: context.agentId,
          requestingTurnId: context.turnId,
          principalId: context.principalId,
          deviceId: context.deviceId,
        });
        return {
          toolCallId,
          result,
          isError: false,
        };
      }
      case "concierge.get_request_status": {
        const result = await config.service.getRequestStatus({
          requestId: asRequiredString(args.requestId, "requestId"),
          spaceId: context.spaceId,
          agentId: context.agentId,
        });
        return {
          toolCallId,
          result,
          isError: false,
        };
      }
      case "concierge.cancel_request": {
        const result = await config.service.cancelRequest({
          requestId: asRequiredString(args.requestId, "requestId"),
          reason: asOptionalString(args.reason),
          spaceId: context.spaceId,
          agentId: context.agentId,
        });
        return {
          toolCallId,
          result,
          isError: false,
        };
      }
      default:
        throw new Error(`Unsupported concierge escalation tool: ${name}`);
    }
  };
}

export function createConciergeEscalationToolFilter(config: {
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
    if (!config.profileRepo) return false;
    const space = await config.spaceAdminService.getSpace(spaceId);
    const assignment = space?.agents?.find((entry) => entry.agentId === agentId);
    if (!assignment?.profileId) return false;
    const revision = config.profileRepo.getActiveRevision(assignment.profileId);
    return parseSkillIds(revision?.default_skill_set_ids_json).includes(USER_ESCALATION_SKILL_ID);
  };
}

export function isConciergeEscalationTool(toolName: string): boolean {
  return toolName.startsWith(CONCIERGE_TOOL_PREFIX) && CONCIERGE_TOOL_NAMES.has(toolName);
}

function parseSkillIds(rawValue: string | null | undefined): string[] {
  if (!rawValue?.trim()) return [];
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function asRequiredString(value: unknown, field: string): string {
  const normalized = asOptionalString(value);
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function asOptionalInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.floor(value);
}

function asUrgency(value: unknown): ConciergeEscalationUrgency | undefined {
  return value === "passive" || value === "important" || value === "urgent"
    ? value
    : undefined;
}

function asResponseMode(value: unknown): ConciergeEscalationResponseMode | undefined {
  return value === "structured" ? value : undefined;
}

function asFallbackPolicy(value: unknown): ConciergeEscalationFallbackPolicy | undefined {
  return value === "none" || value === "urgent_call_after_timeout"
    ? value
    : undefined;
}

function asAllowedResponses(value: unknown): ConciergeEscalationAllowedResponse[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value.filter(
    (entry): entry is ConciergeEscalationAllowedResponse =>
      entry === "approve"
      || entry === "reject"
      || entry === "defer"
      || entry === "revise"
      || entry === "open_app",
  );
  return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
}
