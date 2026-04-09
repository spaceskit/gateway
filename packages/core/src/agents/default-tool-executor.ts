/**
 * DefaultToolExecutor — resolves and executes tool calls from agents.
 *
 * Tools are sourced from the CapabilityRegistry. Each capability operation
 * becomes a tool the agent can call. Permission checking uses the agent's
 * AgentSecurityScope to enforce boundaries.
 *
 * Stolen patterns:
 * - CrewAI: agents-as-tools (expose other agents as callable tools)
 * - Microsoft AF: typed tool definitions with schema validation
 * - Spaceskit original: capability multi-provider routing
 */

import { resolve as resolvePath, sep as pathSep } from "node:path";
import type { ToolCall, ToolResult, ToolDefinition } from "./model-provider.js";
import type {
  ToolAvailabilityOptions,
  ToolExecutor,
  ToolExecutionContext,
  ToolPermission,
} from "./tool-executor.js";
import type { CapabilityRegistry } from "../capabilities/registry.js";
import type {
  CapabilityInvocation,
  CapabilityOperationMetadata,
  CapabilityType,
} from "../capabilities/types.js";
import { isCapabilityType } from "../capabilities/types.js";
import type { AgentSecurityScope } from "../security/types.js";
import type { ToolAccessEvaluation } from "../security/tool-access.js";
import type { EventBus } from "../events/event-bus.js";
import type { MiddlewarePipeline } from "../middleware/pipeline.js";
import { MiddlewarePipeline as Pipeline } from "../middleware/pipeline.js";

/**
 * Standardized error returned from capability/tool invocations.
 * Provides structured error info for agent reasoning + retry logic.
 */
export interface CapabilityError {
  code: string;
  message: string;
  /** Whether the operation could succeed if retried. */
  retryable: boolean;
  /** Original error class name (if applicable). */
  errorType?: string;
  /** Capability + operation that failed. */
  tool: string;
}

export interface DefaultToolExecutorOptions {
  capabilityRegistry: CapabilityRegistry;
  eventBus: EventBus;
  middleware?: MiddlewarePipeline;
  /**
   * Resolve the security scope for an agent in a space.
   * Injected so the executor doesn't depend on persistence directly.
   */
  resolveSecurityScope: (
    spaceId: string,
    agentId: string,
  ) => Promise<AgentSecurityScope>;
  /**
   * Optional injected tool definitions (e.g. platform introspection tools).
   * Appended to capability-derived tools when the filter passes.
   */
  injectedToolDefinitions?: ToolDefinition[];
  /**
   * Executor for injected tools. Called when the tool name matches an injected tool.
   */
  injectedToolExecutor?: (
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ) => Promise<ToolResult>;
  /**
   * Filter that gates which agents receive injected tools.
   * Called with (spaceId, agentId, toolName?); tools are only included if this returns true.
   */
  injectedToolFilter?: (spaceId: string, agentId: string, toolName?: string) => Promise<boolean>;
  /**
   * Optional runtime policy hook for injected tools that do not map to capability operations.
   */
  evaluateInjectedToolAccess?: (input: {
    spaceId: string;
    agentId: string;
    principalId?: string;
    deviceId?: string;
    executionOrigin?: ToolExecutionContext["executionOrigin"];
    accessMode?: ToolExecutionContext["accessMode"];
    toolName: string;
  }) => Promise<ToolAccessEvaluation>;
  /**
   * Optional runtime policy hook for selector-based approvals and dangerous-capability gating.
   */
  evaluateToolAccess?: (input: {
    spaceId: string;
    agentId: string;
    principalId?: string;
    deviceId?: string;
    executionOrigin?: ToolExecutionContext["executionOrigin"];
    accessMode?: ToolExecutionContext["accessMode"];
    capability: CapabilityType;
    operation: string;
    targetProvider?: string;
  }) => Promise<ToolAccessEvaluation>;
  /**
   * Optional audit hook for denied runtime tool invocations.
   */
  onPermissionDenied?: (
    context: ToolExecutionContext,
    permission: ToolPermission,
  ) => void;
  /**
   * Optional hook that returns tool definitions for managed CLI tools
   * that require approval on the embedded profile. These are included
   * in the agent's available tools so it can attempt to call them,
   * triggering the approval gate at execution time.
   */
  getApprovableCliTools?: () => ToolDefinition[];
}

interface ToolDefinitionHint {
  description: string;
  inputSchema: Record<string, unknown>;
}

const TARGET_PROVIDER_PROPERTY: Record<string, unknown> = {
  type: "string",
  description: "Optional provider ID override when multiple providers are available.",
};

function buildObjectSchema(
  properties: Record<string, Record<string, unknown>>,
  required: string[] = [],
): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      targetProvider: TARGET_PROVIDER_PROPERTY,
      ...properties,
    },
    ...(required.length > 0 ? { required } : {}),
  };
}

function iso8601TimestampProperty(description: string): Record<string, unknown> {
  return {
    type: "string",
    description: `${description} Use ISO-8601 timestamp format.`,
  };
}

const DEFAULT_TOOL_INPUT_SCHEMA: Record<string, unknown> = buildObjectSchema({});

const REMINDER_LIST_ID_PROPERTY: Record<string, unknown> = {
  type: "string",
  description: "Reminder list identifier returned by lists.listLists.",
};

const REMINDER_ITEM_ID_PROPERTY: Record<string, unknown> = {
  type: "string",
  description: "Reminder/task item identifier.",
};

const REMINDER_PRIORITY_PROPERTY: Record<string, unknown> = {
  type: "integer",
  description: "Optional priority from 0 to 9.",
  minimum: 0,
  maximum: 9,
};

const CALENDAR_ID_PROPERTY: Record<string, unknown> = {
  type: "string",
  description: "Calendar identifier returned by calendar.listCalendars.",
};

const CALENDAR_EVENT_ID_PROPERTY: Record<string, unknown> = {
  type: "string",
  description: "Calendar event identifier.",
};

const EMAIL_ACCOUNT_ID_PROPERTY: Record<string, unknown> = {
  type: "string",
  description: "Email account identifier returned by email.listAccounts.",
};

const EMAIL_MAILBOX_ID_PROPERTY: Record<string, unknown> = {
  type: "string",
  description: "Mailbox identifier returned by email.listMailboxes.",
};

const EMAIL_MESSAGE_ID_PROPERTY: Record<string, unknown> = {
  type: "string",
  description: "Observed email message identifier.",
};

const EMAIL_COMPOSE_SESSION_ID_PROPERTY: Record<string, unknown> = {
  type: "string",
  description: "Observed Apple Mail compose session identifier.",
};

const RECURRENCE_SCHEMA: Record<string, unknown> = {
  type: "object",
  description: "Optional recurrence rule. Current Apple Calendar support is daily or weekly.",
  properties: {
    frequency: {
      type: "string",
      enum: ["daily", "weekly"],
      description: "Recurrence frequency.",
    },
    interval: {
      type: "integer",
      minimum: 1,
      description: "Repeat interval. Defaults to 1 when omitted.",
    },
    daysOfWeek: {
      type: "array",
      description: "Weekly recurrence day numbers from 1 (Sunday) to 7 (Saturday).",
      items: {
        type: "integer",
        minimum: 1,
        maximum: 7,
      },
    },
  },
};

const TOOL_HINTS_BY_CAPABILITY: Partial<Record<CapabilityType, Record<string, ToolDefinitionHint>>> = {
  lists: {
    listLists: {
      description: "List reminder/task lists from connected list providers (for example Apple Reminders).",
      inputSchema: buildObjectSchema({}),
    },
    createList: {
      description: "Create a reminder/task list.",
      inputSchema: buildObjectSchema({
        name: {
          type: "string",
          description: "List name.",
        },
      }, ["name"]),
    },
    updateList: {
      description: "Rename/update a reminder/task list. Use lists.listLists first when listId is unknown.",
      inputSchema: buildObjectSchema({
        listId: REMINDER_LIST_ID_PROPERTY,
        name: {
          type: "string",
          description: "Updated list name.",
        },
      }, ["listId", "name"]),
    },
    deleteList: {
      description: "Delete a reminder/task list. Use lists.listLists first when listId is unknown.",
      inputSchema: buildObjectSchema({
        listId: REMINDER_LIST_ID_PROPERTY,
      }, ["listId"]),
    },
    listItems: {
      description: "List reminders/tasks in a list. Use lists.listLists first when listId is unknown. Returns at most 50 items by default; set limit higher if needed. Response includes totalCount and truncated flag when results are capped.",
      inputSchema: buildObjectSchema({
        listId: REMINDER_LIST_ID_PROPERTY,
        includeCompleted: {
          type: "boolean",
          description: "Include completed reminders/tasks. Defaults to true.",
        },
        limit: {
          type: "integer",
          description: "Maximum number of items to return. Defaults to 50 if omitted.",
          minimum: 1,
        },
      }),
    },
    createItem: {
      description: "Create a new reminder/task item in the target list. Use lists.listLists first when listId is unknown.",
      inputSchema: buildObjectSchema({
        listId: REMINDER_LIST_ID_PROPERTY,
        title: {
          type: "string",
          description: "Reminder/task title.",
        },
        notes: {
          type: "string",
          description: "Optional notes/details for the reminder.",
        },
        startAt: iso8601TimestampProperty("Optional start date/time."),
        dueAt: iso8601TimestampProperty("Optional due date/time."),
        priority: REMINDER_PRIORITY_PROPERTY,
        location: {
          type: "string",
          description: "Optional reminder location text.",
        },
        url: {
          type: "string",
          description: "Optional URL associated with the reminder.",
        },
      }, ["listId", "title"]),
    },
    updateItem: {
      description: "Update an existing reminder/task item. Use this for general edits, or reopen a completed item with isCompleted: false. Set isCompleted: true to mark it done if lists.completeItem is unavailable.",
      inputSchema: buildObjectSchema({
        itemId: REMINDER_ITEM_ID_PROPERTY,
        listId: REMINDER_LIST_ID_PROPERTY,
        title: {
          type: "string",
          description: "Updated reminder/task title.",
        },
        notes: {
          type: "string",
          description: "Updated notes/details. Use null to clear.",
        },
        startAt: {
          ...iso8601TimestampProperty("Updated start date/time."),
          description: "Updated start date/time. Use null to clear. Use ISO-8601 timestamp format.",
        },
        dueAt: {
          ...iso8601TimestampProperty("Updated due date/time."),
          description: "Updated due date/time. Use null to clear. Use ISO-8601 timestamp format.",
        },
        priority: {
          ...REMINDER_PRIORITY_PROPERTY,
          description: "Updated priority from 0 to 9. Use null to clear.",
        },
        location: {
          type: "string",
          description: "Updated location text. Use null to clear.",
        },
        url: {
          type: "string",
          description: "Updated URL. Use null to clear.",
        },
        isCompleted: {
          type: "boolean",
          description: "Set true to mark the reminder done. Set false to reopen it.",
        },
      }, ["itemId"]),
    },
    completeItem: {
      description: "Mark a reminder/task item as completed/done. Prefer this over lists.updateItem for direct 'mark done' requests.",
      inputSchema: buildObjectSchema({
        itemId: REMINDER_ITEM_ID_PROPERTY,
      }, ["itemId"]),
    },
    deleteItem: {
      description: "Delete a reminder/task item.",
      inputSchema: buildObjectSchema({
        itemId: REMINDER_ITEM_ID_PROPERTY,
      }, ["itemId"]),
    },
  },
  calendar: {
    listCalendars: {
      description: "List calendars from connected calendar providers (for example Apple Calendar).",
      inputSchema: buildObjectSchema({}),
    },
    listEvents: {
      description: "List calendar events in a time window. Use calendar.listCalendars first when calendarId is unknown. Defaults to a rolling time range when startAt/endAt are omitted.",
      inputSchema: buildObjectSchema({
        calendarId: CALENDAR_ID_PROPERTY,
        startAt: iso8601TimestampProperty("Optional window start."),
        endAt: iso8601TimestampProperty("Optional window end."),
        limit: {
          type: "integer",
          description: "Maximum number of events to return. Defaults to 100.",
          minimum: 1,
        },
      }),
    },
    getEvent: {
      description: "Fetch one calendar event by id.",
      inputSchema: buildObjectSchema({
        eventId: CALENDAR_EVENT_ID_PROPERTY,
      }, ["eventId"]),
    },
    createEvent: {
      description: "Create a calendar event. Use calendar.listCalendars first when calendarId is unknown.",
      inputSchema: buildObjectSchema({
        calendarId: CALENDAR_ID_PROPERTY,
        title: {
          type: "string",
          description: "Event title.",
        },
        startAt: iso8601TimestampProperty("Event start date/time."),
        endAt: iso8601TimestampProperty("Event end date/time."),
        notes: {
          type: "string",
          description: "Optional event notes/body.",
        },
        recurrence: RECURRENCE_SCHEMA,
      }, ["calendarId", "title", "startAt", "endAt"]),
    },
    updateEvent: {
      description: "Update a calendar event. Use this for general edits, and set recurrence to null to remove an existing recurrence rule.",
      inputSchema: buildObjectSchema({
        eventId: CALENDAR_EVENT_ID_PROPERTY,
        calendarId: CALENDAR_ID_PROPERTY,
        title: {
          type: "string",
          description: "Updated event title.",
        },
        startAt: {
          ...iso8601TimestampProperty("Updated event start date/time."),
          description: "Updated event start date/time. Use null to clear. Use ISO-8601 timestamp format.",
        },
        endAt: {
          ...iso8601TimestampProperty("Updated event end date/time."),
          description: "Updated event end date/time. Use null to clear. Use ISO-8601 timestamp format.",
        },
        notes: {
          type: "string",
          description: "Updated notes/body. Use null to clear.",
        },
        recurrence: {
          ...RECURRENCE_SCHEMA,
          description: "Updated recurrence rule. Use null to clear recurrence.",
        },
      }, ["eventId"]),
    },
    deleteEvent: {
      description: "Delete a calendar event.",
      inputSchema: buildObjectSchema({
        eventId: CALENDAR_EVENT_ID_PROPERTY,
      }, ["eventId"]),
    },
  },
  email: {
    listAccounts: {
      description: "List observed Apple Mail accounts from the built-in MailKit provider.",
      inputSchema: buildObjectSchema({}),
    },
    listMailboxes: {
      description: "List observed Apple Mail mailboxes. Use email.listAccounts first when accountId is unknown.",
      inputSchema: buildObjectSchema({
        accountId: EMAIL_ACCOUNT_ID_PROPERTY,
      }),
    },
    listMessages: {
      description: "List observed and recent Apple Mail messages. This is not a full mailbox sync. Use email.listMailboxes first when mailboxId is unknown.",
      inputSchema: buildObjectSchema({
        accountId: EMAIL_ACCOUNT_ID_PROPERTY,
        mailboxId: EMAIL_MAILBOX_ID_PROPERTY,
        threadId: {
          type: "string",
          description: "Optional thread identifier filter.",
        },
        limit: {
          type: "integer",
          description: "Maximum number of observed messages to return. Defaults to 50.",
          minimum: 1,
        },
      }),
    },
    getMessage: {
      description: "Fetch one observed Apple Mail message by id.",
      inputSchema: buildObjectSchema({
        messageId: EMAIL_MESSAGE_ID_PROPERTY,
      }, ["messageId"]),
    },
    listComposeSessions: {
      description: "List observed Apple Mail compose sessions captured through MailKit.",
      inputSchema: buildObjectSchema({}),
    },
    getComposeSession: {
      description: "Fetch one observed Apple Mail compose session by id.",
      inputSchema: buildObjectSchema({
        composeSessionId: EMAIL_COMPOSE_SESSION_ID_PROPERTY,
      }, ["composeSessionId"]),
    },
  },
};

export class DefaultToolExecutor implements ToolExecutor {
  private registry: CapabilityRegistry;
  private eventBus: EventBus;
  private middleware: MiddlewarePipeline;
  private resolveScope: DefaultToolExecutorOptions["resolveSecurityScope"];
  private injectedToolDefinitions: ToolDefinition[];
  private injectedToolExecutor: DefaultToolExecutorOptions["injectedToolExecutor"];
  private injectedToolFilter: DefaultToolExecutorOptions["injectedToolFilter"];
  private evaluateInjectedToolAccess: DefaultToolExecutorOptions["evaluateInjectedToolAccess"];
  private evaluateToolAccess: DefaultToolExecutorOptions["evaluateToolAccess"];
  private onPermissionDenied: DefaultToolExecutorOptions["onPermissionDenied"];
  private getApprovableCliTools: DefaultToolExecutorOptions["getApprovableCliTools"];

  /** Track tool call counts per turn for limit enforcement (instance-scoped). */
  private turnToolCallCounts = new Map<string, number>();

  /** Cache for injected-tool filter results within a single getAvailableTools call scope. */
  private injectedFilterCache = new Map<string, boolean>();

  constructor(options: DefaultToolExecutorOptions) {
    this.registry = options.capabilityRegistry;
    this.eventBus = options.eventBus;
    this.middleware = options.middleware ?? new Pipeline();
    this.resolveScope = options.resolveSecurityScope;
    this.injectedToolDefinitions = options.injectedToolDefinitions ?? [];
    this.injectedToolExecutor = options.injectedToolExecutor;
    this.injectedToolFilter = options.injectedToolFilter;
    this.evaluateInjectedToolAccess = options.evaluateInjectedToolAccess;
    this.evaluateToolAccess = options.evaluateToolAccess;
    this.onPermissionDenied = options.onPermissionDenied;
    this.getApprovableCliTools = options.getApprovableCliTools;
  }

  /**
   * Get all tool definitions available to a specific agent in a specific space.
   * Filters by the agent's allowed capabilities.
   */
  async getAvailableTools(
    spaceId: string,
    agentId: string,
    options?: ToolAvailabilityOptions,
  ): Promise<ToolDefinition[]> {
    const scope = await this.resolveScope(spaceId, agentId);
    const allCapabilities = this.registry.getAvailableCapabilities();

    // Filter to allowed capabilities (empty allowlist = all allowed)
    const allowed =
      scope.allowedCapabilities.length > 0
        ? allCapabilities.filter((c) => scope.allowedCapabilities.includes(c))
        : allCapabilities;

    const tools: ToolDefinition[] = [];

    for (const capType of allowed) {
      const providers = this.registry.getProvidersForSpace(
        capType,
        spaceId,
      );
      // Collect unique operations across all providers
      const operations = new Set<string>();
      for (const provider of providers) {
        for (const op of provider.operations) {
          operations.add(op);
        }
      }

      for (const operation of Array.from(operations).sort((lhs, rhs) => lhs.localeCompare(rhs))) {
        const hint = resolveToolHint(capType, operation);
        tools.push({
          name: `${capType}.${operation}`,
          description: hint.description,
          inputSchema: hint.inputSchema,
        });
      }
    }

    // Append injected tools if the filter passes
    if (this.injectedToolDefinitions.length > 0 && !options?.suppressInjectedTools) {
      for (const tool of this.injectedToolDefinitions) {
        const includeInjected = await this.checkInjectedToolAccess(spaceId, agentId, tool.name);
        if (includeInjected) {
          tools.push(tool);
        }
      }
    }

    // Append managed CLI tools that require approval (visible but gated at execution time)
    if (this.getApprovableCliTools) {
      const existingNames = new Set(tools.map((t) => t.name));
      for (const cliTool of this.getApprovableCliTools()) {
        if (!existingNames.has(cliTool.name)) {
          tools.push(cliTool);
        }
      }
    }

    return tools;
  }

  /**
   * Check if a tool call is permitted before execution.
   */
  async checkPermission(
    toolCall: ToolCall,
    context: ToolExecutionContext,
  ): Promise<ToolPermission> {
    const scope = await this.resolveScope(context.spaceId, context.agentId);

    // Injected tools (e.g. platform.*) bypass capability allowlist checks —
    // access is already gated by the injectedToolFilter.
    if (this.isInjectedTool(toolCall.name)) {
      if (context.suppressInjectedTools) {
        const denied: ToolPermission = {
          toolName: toolCall.name,
          allowed: false,
          reason: "Platform introspection tools are suppressed for trivial or greeting turns",
          reasonCode: "injected_tool_suppressed",
        };
        this.emitPermissionDeniedEvent(context, denied);
        return denied;
      }
      const injectedAllowed = await this.checkInjectedToolAccess(context.spaceId, context.agentId, toolCall.name);
      if (!injectedAllowed) {
        const denied: ToolPermission = {
          toolName: toolCall.name,
          allowed: false,
          reason: "Agent is not authorized for platform introspection tools",
          reasonCode: "injected_tool_not_authorized",
        };
        this.emitPermissionDeniedEvent(context, denied);
        return denied;
      }
      if (this.evaluateInjectedToolAccess) {
        const decision = await this.evaluateInjectedToolAccess({
          spaceId: context.spaceId,
          agentId: context.agentId,
          principalId: context.principalId,
          deviceId: context.deviceId,
          executionOrigin: context.executionOrigin,
          accessMode: context.accessMode,
          toolName: toolCall.name,
        });

        if (!decision.allowed && !decision.requiresApproval) {
          const denied: ToolPermission = {
            toolName: toolCall.name,
            allowed: false,
            reason: decision.reason ?? `Tool unavailable: ${toolCall.name}`,
            reasonCode: decision.reasonCode ?? "tool_unavailable",
          };
          this.emitPermissionDeniedEvent(context, denied);
          return denied;
        }

        if (decision.requiresApproval) {
          return {
            toolName: toolCall.name,
            allowed: true,
            requiresApproval: true,
            reason: decision.reason ?? `Tool "${toolCall.name}" requires approval`,
            reasonCode: decision.reasonCode,
            approvalContext: decision.approvalContext,
          };
        }
      }
      return { toolName: toolCall.name, allowed: true };
    }

    // Parse capability.operation from tool name
    const parts = toolCall.name.split(".");
    const capType = parts[0];
    const operation = parts.slice(1).join(".");

    // Check capability allowlist
    if (
      scope.allowedCapabilities.length > 0 &&
      !scope.allowedCapabilities.includes(capType)
    ) {
      const denied: ToolPermission = {
        toolName: toolCall.name,
        allowed: false,
        reason: `Capability "${capType}" not in agent's allowlist`,
        reasonCode: "capability_not_allowlisted",
      };
      this.emitPermissionDeniedEvent(context, denied);
      return denied;
    }

    if (!capType || !isCapabilityType(capType) || !operation) {
      const denied: ToolPermission = {
        toolName: toolCall.name,
        allowed: false,
        reason: `Invalid tool call name: ${toolCall.name}`,
        reasonCode: "invalid_tool_name",
      };
      this.emitPermissionDeniedEvent(context, denied);
      return denied;
    }

    const invocation: CapabilityInvocation = {
      capability: capType,
      operation,
      args: toolCall.arguments,
      targetProvider: normalizeTargetProvider(toolCall.arguments.targetProvider, toolCall.name),
    };
    const operationMetadata = this.registry.getOperationMetadata(invocation, context.spaceId);

    if (operationMetadata.requiresShell && !scope.allowShell && !this.evaluateToolAccess) {
      const denied: ToolPermission = {
        toolName: toolCall.name,
        allowed: false,
        reason: "Shell execution is disabled for this agent",
        reasonCode: "shell_not_allowed",
      };
      this.emitPermissionDeniedEvent(context, denied);
      return denied;
    }

    if (operationMetadata.requiresNetwork && !scope.allowNetwork) {
      const denied: ToolPermission = {
        toolName: toolCall.name,
        allowed: false,
        reason: "Network access is disabled for this agent",
        reasonCode: "network_not_allowed",
      };
      this.emitPermissionDeniedEvent(context, denied);
      return denied;
    }

    if (operationMetadata.requiresShell && scope.commandAllowlist.length > 0) {
      const commandValue = extractShellCommand(toolCall.arguments, operationMetadata);
      if (!commandValue) {
        const denied: ToolPermission = {
          toolName: toolCall.name,
          allowed: false,
          reason: "Shell command argument is required when commandAllowlist is configured",
          reasonCode: "command_missing",
        };
        this.emitPermissionDeniedEvent(context, denied);
        return denied;
      }
      const allowed = scope.commandAllowlist.some((rule) => matchesCommandAllowRule(commandValue, rule));
      if (!allowed) {
        const denied: ToolPermission = {
          toolName: toolCall.name,
          allowed: false,
          reason: `Shell command not allowed: ${commandValue}`,
          reasonCode: "command_not_allowlisted",
        };
        this.emitPermissionDeniedEvent(context, denied);
        return denied;
      }
    }

    const filesystemScopeError = evaluateFilesystemScope(toolCall, scope, operationMetadata);
    if (filesystemScopeError) {
      const denied: ToolPermission = {
        toolName: toolCall.name,
        allowed: false,
        reason: filesystemScopeError,
        reasonCode: "filesystem_scope_violation",
      };
      this.emitPermissionDeniedEvent(context, denied);
      return denied;
    }

    // Check tool call count limit
    const countKey = `${context.turnId}:${context.agentId}`;
    const count = this.turnToolCallCounts.get(countKey) ?? 0;
    if (count >= scope.maxToolCallsPerTurn) {
      const denied: ToolPermission = {
        toolName: toolCall.name,
        allowed: false,
        reason: `Max tool calls per turn (${scope.maxToolCallsPerTurn}) exceeded`,
        reasonCode: "max_tool_calls_exceeded",
      };
      this.emitPermissionDeniedEvent(context, denied);
      return denied;
    }

    if (this.evaluateToolAccess) {
      const decision = await this.evaluateToolAccess({
        spaceId: context.spaceId,
        agentId: context.agentId,
        principalId: context.principalId,
        deviceId: context.deviceId,
        executionOrigin: context.executionOrigin,
        accessMode: context.accessMode,
        capability: capType,
        operation,
        targetProvider: invocation.targetProvider,
      });

      if (!decision.allowed && !decision.requiresApproval) {
        const denied: ToolPermission = {
          toolName: toolCall.name,
          allowed: false,
          reason: decision.reason ?? `Tool unavailable: ${toolCall.name}`,
          reasonCode: decision.reasonCode ?? "tool_unavailable",
        };
        this.emitPermissionDeniedEvent(context, denied);
        return denied;
      }

      if (decision.requiresApproval) {
        return {
          toolName: toolCall.name,
          allowed: true,
          requiresApproval: true,
          reason: decision.reason ?? `Tool "${toolCall.name}" requires approval`,
          reasonCode: decision.reasonCode,
          approvalContext: decision.approvalContext,
        };
      }
    }

    // Check if tool requires human approval
    const requiresApproval = scope.requireOutputReview;

    return {
      toolName: toolCall.name,
      allowed: true,
      requiresApproval,
    };
  }

  /**
   * Execute a tool call. Routes through the CapabilityRegistry
   * with middleware interception.
   */
  async execute(
    toolCall: ToolCall,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    // Increment tool call counter
    const countKey = `${context.turnId}:${context.agentId}`;
    this.turnToolCallCounts.set(
      countKey,
      (this.turnToolCallCounts.get(countKey) ?? 0) + 1,
    );

    // Route injected tools to their executor
    if (this.isInjectedTool(toolCall.name) && this.injectedToolExecutor) {
      const result = await this.injectedToolExecutor(
        toolCall.name,
        toolCall.arguments,
        context,
      );

      // Emit audit event
      this.eventBus.emit({
        type: "tool.executed",
        spaceId: context.spaceId,
        agentId: context.agentId,
        turnId: context.turnId,
        toolName: toolCall.name,
        isError: result.isError ?? false,
        timestamp: new Date(),
      });

      return result;
    }

    // Parse capability.operation from tool name
    const parts = toolCall.name.split(".");
    const capType = parts[0];
    const operation = parts.slice(1).join(".");

    if (!capType || !isCapabilityType(capType)) {
      return {
        toolCallId: toolCall.id,
        result: { code: "INVALID_CAPABILITY", message: `Unknown capability type: ${capType}`, retryable: false, tool: toolCall.name } satisfies CapabilityError,
        isError: true,
      };
    }

    const invocation: CapabilityInvocation = {
      capability: capType,
      operation,
      args: toolCall.arguments,
      targetProvider: normalizeTargetProvider(toolCall.arguments.targetProvider, toolCall.name),
    };

    // Run through capability middleware
    const ctx = Pipeline.createContext("capability", invocation, {
      spaceId: context.spaceId,
      agentId: context.agentId,
      turnId: context.turnId,
    });

    let result: unknown;
    let isError = false;

    await this.middleware.execute("capability", ctx, async () => {
      try {
        const capResult = await this.registry.invoke(
          invocation,
          {
            spaceId: context.spaceId,
            agentId: context.agentId,
            principalId: context.principalId,
            deviceId: context.deviceId,
            executionOrigin: context.executionOrigin,
            accessMode: context.accessMode,
          },
        );
        result = "data" in capResult ? capResult.data : capResult;
        ctx.output = result;
      } catch (err) {
        isError = true;
        const capError = toCapabilityError(err, toolCall.name);
        result = capError;
        ctx.output = capError;

        // Emit structured error event
        this.eventBus.emit({
          type: "capability.error",
          spaceId: context.spaceId,
          agentId: context.agentId,
          turnId: context.turnId,
          toolName: toolCall.name,
          error: capError,
          timestamp: new Date(),
        });
      }
    });
    if (ctx.terminate && isCapabilityErrorOutput(ctx.output)) {
      isError = true;
      result = ctx.output;
    }

    // Emit audit event
    this.eventBus.emit({
      type: "tool.executed",
      spaceId: context.spaceId,
      agentId: context.agentId,
      turnId: context.turnId,
      toolName: toolCall.name,
      isError,
      timestamp: new Date(),
    });

    return {
      toolCallId: toolCall.id,
      result: ctx.output ?? result,
      isError,
    };
  }

  /**
   * Clear tool call counters for a completed turn.
   * If agentId is not provided, removes all entries for this turnId.
   */
  clearTurnCounts(turnId: string, agentId?: string): void {
    if (agentId) {
      this.turnToolCallCounts.delete(`${turnId}:${agentId}`);
    } else {
      // Clean up all entries for this turn
      for (const key of this.turnToolCallCounts.keys()) {
        if (key.startsWith(`${turnId}:`)) {
          this.turnToolCallCounts.delete(key);
        }
      }
    }
  }

  /**
   * Check if a tool name matches an injected tool definition.
   */
  private isInjectedTool(toolName: string): boolean {
    return this.injectedToolDefinitions.some((t) => t.name === toolName);
  }

  /**
   * Check if an agent is allowed to use injected tools.
   * Results are cached per (spaceId, agentId) pair for the lifetime of the instance.
   */
  private async checkInjectedToolAccess(spaceId: string, agentId: string, toolName?: string): Promise<boolean> {
    if (!this.injectedToolFilter) return true;

    const cacheKey = `${spaceId}:${agentId}:${toolName ?? "*"}`;
    const cached = this.injectedFilterCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const allowed = await this.injectedToolFilter(spaceId, agentId, toolName);
    this.injectedFilterCache.set(cacheKey, allowed);
    return allowed;
  }

  private emitPermissionDeniedEvent(
    context: ToolExecutionContext,
    permission: ToolPermission,
  ): void {
    this.eventBus.emit({
      type: "tool.permission_denied",
      spaceId: context.spaceId,
      agentId: context.agentId,
      turnId: context.turnId,
      lineageId: context.lineageId,
      toolName: permission.toolName,
      reasonCode: permission.reasonCode ?? "permission_denied",
      reason: permission.reason ?? "Permission denied",
      timestamp: new Date(),
    });
    this.onPermissionDenied?.(context, permission);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Known retryable error patterns. */
const RETRYABLE_PATTERNS = [
  /rate.?limit/i,
  /timeout/i,
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /503/,
  /429/,
  /too many requests/i,
  /temporarily unavailable/i,
];

/**
 * Convert an unknown error into a structured CapabilityError.
 */
function getErrorCode(err: Error): string {
  if ("code" in err && typeof (err as NodeJS.ErrnoException).code === "string") {
    return (err as NodeJS.ErrnoException).code!;
  }
  return "CAPABILITY_ERROR";
}

function toCapabilityError(err: unknown, toolName: string): CapabilityError {
  if (err instanceof Error) {
    const message = err.message;
    const retryable = RETRYABLE_PATTERNS.some((p) => p.test(message));

    return {
      code: getErrorCode(err),
      message,
      retryable,
      errorType: err.constructor.name,
      tool: toolName,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: String(err),
    retryable: false,
    tool: toolName,
  };
}

function isCapabilityErrorOutput(value: unknown): value is CapabilityError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === "string"
    && typeof candidate.message === "string"
    && typeof candidate.tool === "string"
    && (candidate.retryable === undefined || typeof candidate.retryable === "boolean")
  );
}

function evaluateFilesystemScope(
  toolCall: ToolCall,
  scope: AgentSecurityScope,
  operationMetadata?: CapabilityOperationMetadata,
): string | null {
  const [capType] = toolCall.name.split(".");
  if (capType !== "filesystem" && capType !== "files") return null;

  const targetPath = extractToolPath(
    toolCall.arguments,
    operationMetadata?.pathArgs,
  );
  if (!targetPath) return null;

  const scopes = normalizeFilesystemScopes(scope);
  if (scopes.length === 0) {
    return "Filesystem access denied: no scope configured";
  }

  if (scopes.includes("/")) {
    return null;
  }

  const normalizedTarget = normalizePathValue(targetPath);
  const allowed = scopes.some((entry) => isWithinScope(normalizedTarget, entry));
  if (!allowed) {
    return `Filesystem access denied: ${targetPath} is outside agent scope`;
  }

  return null;
}

function extractToolPath(args: Record<string, unknown>, pathArgs?: string[]): string | null {
  const candidates = pathArgs && pathArgs.length > 0
    ? pathArgs
    : ["path", "filePath", "targetPath", "directory", "cwd"];
  for (const key of candidates) {
    const value = args[key];
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return null;
}

function extractShellCommand(
  args: Record<string, unknown>,
  operationMetadata: CapabilityOperationMetadata,
): string | undefined {
  const keys = operationMetadata.commandArgs?.length
    ? operationMetadata.commandArgs
    : ["command", "cmd", "script", "program"];
  for (const key of keys) {
    const value = args[key];
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized.length > 0) return normalized;
  }
  return undefined;
}

function matchesCommandAllowRule(command: string, ruleRaw: string): boolean {
  const rule = ruleRaw.trim();
  if (!rule) return false;
  if (rule === "*") return true;
  if (rule.endsWith("*")) {
    const prefix = rule.slice(0, -1);
    return command.startsWith(prefix);
  }
  return command === rule;
}

function normalizeFilesystemScopes(scope: AgentSecurityScope): string[] {
  const raw = scope.filesystemScopes?.length
    ? scope.filesystemScopes
    : [scope.filesystemScope];
  return Array.from(
    new Set(
      raw
        .map((entry) => normalizePathValue(entry))
        .filter((entry) => entry.length > 0),
    ),
  );
}

function normalizePathValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("file://")) {
    try {
      const url = new URL(trimmed);
      return resolvePath(decodeURIComponent(url.pathname));
    } catch {
      return "";
    }
  }

  return resolvePath(trimmed);
}

function isWithinScope(targetPath: string, scopePath: string): boolean {
  if (!scopePath) return false;
  if (targetPath === scopePath) return true;
  return targetPath.startsWith(`${scopePath}${pathSep}`);
}

function normalizeTargetProvider(rawValue: unknown, toolName: string): string | undefined {
  if (typeof rawValue !== "string") return undefined;
  const trimmed = rawValue.trim();
  if (!trimmed) return undefined;

  const normalized = trimmed.toLowerCase();
  if (
    normalized === "auto"
    || normalized === "default"
    || normalized === "none"
    || normalized === "null"
    || normalized === "nil"
    || normalized === "n/a"
    || normalized === "any"
  ) {
    return undefined;
  }

  if (toolName.startsWith("lists.")) {
    if (
      normalized === "apple"
      || normalized === "apple_reminders"
      || normalized === "apple-reminders"
      || normalized === "reminders"
      || normalized === "eventkit"
    ) {
      return "apple-reminders-eventkit";
    }
  }

  if (toolName.startsWith("email.")) {
    if (
      normalized === "apple"
      || normalized === "apple_mail"
      || normalized === "apple-mail"
      || normalized === "mail"
      || normalized === "mailkit"
    ) {
      return "apple-mail-mailkit";
    }
  }

  return trimmed;
}

function resolveToolHint(capability: CapabilityType, operation: string): ToolDefinitionHint {
  const exactHint = TOOL_HINTS_BY_CAPABILITY[capability]?.[operation];
  if (exactHint) {
    return exactHint;
  }
  return {
    description: `${humanizeCapability(capability)}: ${humanizeOperation(operation)}.`,
    inputSchema: DEFAULT_TOOL_INPUT_SCHEMA,
  };
}

function humanizeCapability(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "Capability";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function humanizeOperation(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "operation";
  const spaced = normalized
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
