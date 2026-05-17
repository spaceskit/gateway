import type { CapabilityRegistry } from "../capabilities/registry.js";
import type { CapabilityInvocation } from "../capabilities/types.js";
import { isCapabilityType } from "../capabilities/types.js";
import type { AgentSecurityScope } from "../security/types.js";
import type { ToolAccessEvaluation } from "../security/tool-access.js";
import type { ToolCall } from "./model-provider.js";
import type { ToolExecutionContext, ToolPermission } from "./tool-executor.js";
import { normalizeTargetProvider } from "./default-tool-executor-errors.js";
import {
  evaluateFilesystemScope,
  extractShellCommand,
  matchesCommandAllowRule,
} from "./default-tool-executor-scope.js";

export interface CheckDefaultToolPermissionInput {
  toolCall: ToolCall;
  context: ToolExecutionContext;
  registry: CapabilityRegistry;
  resolveScope: (spaceId: string, agentId: string) => Promise<AgentSecurityScope>;
  isInjectedTool: (toolName: string) => boolean;
  checkInjectedToolAccess: (
    spaceId: string,
    agentId: string,
    toolName?: string,
  ) => Promise<boolean>;
  evaluateInjectedToolAccess?: (input: {
    spaceId: string;
    agentId: string;
    principalId?: string;
    deviceId?: string;
    executionOrigin?: ToolExecutionContext["executionOrigin"];
    accessMode?: ToolExecutionContext["accessMode"];
    toolName: string;
  }) => Promise<ToolAccessEvaluation>;
  evaluateToolAccess?: (input: {
    spaceId: string;
    agentId: string;
    principalId?: string;
    deviceId?: string;
    executionOrigin?: ToolExecutionContext["executionOrigin"];
    accessMode?: ToolExecutionContext["accessMode"];
    capability: CapabilityInvocation["capability"];
    operation: string;
    targetProvider?: string;
  }) => Promise<ToolAccessEvaluation>;
  turnToolCallCounts: Map<string, number>;
  emitPermissionDeniedEvent: (
    context: ToolExecutionContext,
    permission: ToolPermission,
  ) => void;
}

export async function checkDefaultToolPermission(
  input: CheckDefaultToolPermissionInput,
): Promise<ToolPermission> {
  const {
    toolCall,
    context,
    registry,
    resolveScope,
    isInjectedTool,
    checkInjectedToolAccess,
    evaluateInjectedToolAccess,
    evaluateToolAccess,
    turnToolCallCounts,
    emitPermissionDeniedEvent,
  } = input;
  const scope = await resolveScope(context.spaceId, context.agentId);

  if (isInjectedTool(toolCall.name)) {
    return checkInjectedToolPermission({
      toolCall,
      context,
      checkInjectedToolAccess,
      evaluateInjectedToolAccess,
      emitPermissionDeniedEvent,
    });
  }

  const parts = toolCall.name.split(".");
  const capType = parts[0];
  const operation = parts.slice(1).join(".");

  if (
    scope.allowedCapabilities.length > 0 &&
    !scope.allowedCapabilities.includes(capType)
  ) {
    return deny(context, emitPermissionDeniedEvent, {
      toolName: toolCall.name,
      allowed: false,
      reason: `Capability "${capType}" not in agent's allowlist`,
      reasonCode: "capability_not_allowlisted",
    });
  }

  if (!capType || !isCapabilityType(capType) || !operation) {
    return deny(context, emitPermissionDeniedEvent, {
      toolName: toolCall.name,
      allowed: false,
      reason: `Invalid tool call name: ${toolCall.name}`,
      reasonCode: "invalid_tool_name",
    });
  }

  const invocation: CapabilityInvocation = {
    capability: capType,
    operation,
    args: toolCall.arguments,
    targetProvider: normalizeTargetProvider(toolCall.arguments.targetProvider, toolCall.name),
  };
  const operationMetadata = registry.getOperationMetadata(invocation, context.spaceId);

  if (operationMetadata.requiresShell && !scope.allowShell && !evaluateToolAccess) {
    return deny(context, emitPermissionDeniedEvent, {
      toolName: toolCall.name,
      allowed: false,
      reason: "Shell execution is disabled for this agent",
      reasonCode: "shell_not_allowed",
    });
  }

  if (operationMetadata.requiresNetwork && !scope.allowNetwork) {
    return deny(context, emitPermissionDeniedEvent, {
      toolName: toolCall.name,
      allowed: false,
      reason: "Network access is disabled for this agent",
      reasonCode: "network_not_allowed",
    });
  }

  if (operationMetadata.requiresShell && scope.commandAllowlist.length > 0) {
    const commandValue = extractShellCommand(toolCall.arguments, operationMetadata);
    if (!commandValue) {
      return deny(context, emitPermissionDeniedEvent, {
        toolName: toolCall.name,
        allowed: false,
        reason: "Shell command argument is required when commandAllowlist is configured",
        reasonCode: "command_missing",
      });
    }
    const allowed = scope.commandAllowlist.some((rule) => matchesCommandAllowRule(commandValue, rule));
    if (!allowed) {
      return deny(context, emitPermissionDeniedEvent, {
        toolName: toolCall.name,
        allowed: false,
        reason: `Shell command not allowed: ${commandValue}`,
        reasonCode: "command_not_allowlisted",
      });
    }
  }

  const filesystemScopeError = evaluateFilesystemScope(toolCall, scope, operationMetadata);
  if (filesystemScopeError) {
    return deny(context, emitPermissionDeniedEvent, {
      toolName: toolCall.name,
      allowed: false,
      reason: filesystemScopeError,
      reasonCode: "filesystem_scope_violation",
    });
  }

  const countKey = `${context.turnId}:${context.agentId}`;
  const count = turnToolCallCounts.get(countKey) ?? 0;
  if (count >= scope.maxToolCallsPerTurn) {
    return deny(context, emitPermissionDeniedEvent, {
      toolName: toolCall.name,
      allowed: false,
      reason: `Max tool calls per turn (${scope.maxToolCallsPerTurn}) exceeded`,
      reasonCode: "max_tool_calls_exceeded",
    });
  }

  if (evaluateToolAccess) {
    const decision = await evaluateToolAccess({
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
    const permission = permissionFromPolicyDecision(toolCall.name, decision);
    if (permission) {
      if (!permission.allowed) {
        emitPermissionDeniedEvent(context, permission);
      }
      return permission;
    }
  }

  return {
    toolName: toolCall.name,
    allowed: true,
    requiresApproval: scope.requireOutputReview,
  };
}

async function checkInjectedToolPermission(input: {
  toolCall: ToolCall;
  context: ToolExecutionContext;
  checkInjectedToolAccess: CheckDefaultToolPermissionInput["checkInjectedToolAccess"];
  evaluateInjectedToolAccess: CheckDefaultToolPermissionInput["evaluateInjectedToolAccess"];
  emitPermissionDeniedEvent: CheckDefaultToolPermissionInput["emitPermissionDeniedEvent"];
}): Promise<ToolPermission> {
  const {
    toolCall,
    context,
    checkInjectedToolAccess,
    evaluateInjectedToolAccess,
    emitPermissionDeniedEvent,
  } = input;
  if (context.suppressInjectedTools) {
    return deny(context, emitPermissionDeniedEvent, {
      toolName: toolCall.name,
      allowed: false,
      reason: "Platform introspection tools are suppressed for trivial or greeting turns",
      reasonCode: "injected_tool_suppressed",
    });
  }

  const injectedAllowed = await checkInjectedToolAccess(context.spaceId, context.agentId, toolCall.name);
  if (!injectedAllowed) {
    return deny(context, emitPermissionDeniedEvent, {
      toolName: toolCall.name,
      allowed: false,
      reason: "Agent is not authorized for platform introspection tools",
      reasonCode: "injected_tool_not_authorized",
    });
  }

  if (evaluateInjectedToolAccess) {
    const decision = await evaluateInjectedToolAccess({
      spaceId: context.spaceId,
      agentId: context.agentId,
      principalId: context.principalId,
      deviceId: context.deviceId,
      executionOrigin: context.executionOrigin,
      accessMode: context.accessMode,
      toolName: toolCall.name,
    });
    const permission = permissionFromPolicyDecision(toolCall.name, decision);
    if (permission) {
      if (!permission.allowed) {
        emitPermissionDeniedEvent(context, permission);
      }
      return permission;
    }
  }

  return { toolName: toolCall.name, allowed: true };
}

function permissionFromPolicyDecision(
  toolName: string,
  decision: ToolAccessEvaluation,
): ToolPermission | undefined {
  if (!decision.allowed && !decision.requiresApproval) {
    return {
      toolName,
      allowed: false,
      reason: decision.reason ?? `Tool unavailable: ${toolName}`,
      reasonCode: decision.reasonCode ?? "tool_unavailable",
    };
  }

  if (decision.requiresApproval) {
    return {
      toolName,
      allowed: true,
      requiresApproval: true,
      reason: decision.reason ?? `Tool "${toolName}" requires approval`,
      reasonCode: decision.reasonCode,
      approvalContext: decision.approvalContext,
    };
  }

  return undefined;
}

function deny(
  context: ToolExecutionContext,
  emitPermissionDeniedEvent: CheckDefaultToolPermissionInput["emitPermissionDeniedEvent"],
  permission: ToolPermission,
): ToolPermission {
  emitPermissionDeniedEvent(context, permission);
  return permission;
}
