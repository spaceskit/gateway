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
 *
 * This file focuses on routing/execution. Helpers live in sibling modules:
 * - `default-tool-executor-hints.ts`: tool schema/description metadata
 * - `default-tool-executor-scope.ts`: filesystem/shell scope evaluation
 * - `default-tool-executor-errors.ts`: capability error normalization +
 *   target provider coercion
 */

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
  CapabilityType,
} from "../capabilities/types.js";
import { isCapabilityType } from "../capabilities/types.js";
import type { AgentSecurityScope } from "../security/types.js";
import type { ToolAccessEvaluation } from "../security/tool-access.js";
import type { EventBus } from "../events/event-bus.js";
import type { MiddlewarePipeline } from "../middleware/pipeline.js";
import { MiddlewarePipeline as Pipeline } from "../middleware/pipeline.js";
import {
  capabilityTypeFromToolName,
  resolveToolHint,
} from "./default-tool-executor-hints.js";
import {
  isCapabilityErrorOutput,
  normalizeTargetProvider,
  toCapabilityError,
} from "./default-tool-executor-errors.js";
import type { CapabilityError } from "./default-tool-executor-errors.js";
import { checkDefaultToolPermission } from "./default-tool-executor-permission.js";

export type { CapabilityError } from "./default-tool-executor-errors.js";

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
        const capabilityType = capabilityTypeFromToolName(cliTool.name);
        if (
          capabilityType
          && scope.allowedCapabilities.length > 0
          && !scope.allowedCapabilities.includes(capabilityType)
        ) {
          continue;
        }
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
    return checkDefaultToolPermission({
      toolCall,
      context,
      registry: this.registry,
      resolveScope: this.resolveScope,
      isInjectedTool: this.isInjectedTool.bind(this),
      checkInjectedToolAccess: this.checkInjectedToolAccess.bind(this),
      evaluateInjectedToolAccess: this.evaluateInjectedToolAccess,
      evaluateToolAccess: this.evaluateToolAccess,
      turnToolCallCounts: this.turnToolCallCounts,
      emitPermissionDeniedEvent: this.emitPermissionDeniedEvent.bind(this),
    });
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
