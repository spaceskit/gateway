import { randomUUID } from "node:crypto";
import type { RuntimeFeedbackCheckpoint, TurnContext, TurnEvent } from "./agent-runtime.js";
import type { ToolCall, ToolResult } from "./model-provider.js";
import type { ToolExecutionContext, ToolPermission } from "./tool-executor.js";
import type { AgentTurnLoopDeps } from "./agent-turn-loop.js";
import { normalizeApprovalContext } from "./agent-runtime-tools.js";
import { appendToolResultMessage } from "./agent-runtime-turn-result.js";

export interface ExecuteTurnToolCallsInput {
  deps: Pick<
    AgentTurnLoopDeps,
    "agentId" | "config" | "toolExecutor" | "setState" | "waitForFeedback" | "onPromptBridgeWarning"
  >;
  context: TurnContext;
  messages: import("./model-provider.js").ModelMessage[];
  toolCalls: ToolCall[];
  allToolCalls: ToolCall[];
  allToolResults: ToolResult[];
  suppressInjectedTools: boolean;
  signal: AbortSignal;
}

export async function* executeTurnToolCalls(
  input: ExecuteTurnToolCallsInput,
): AsyncIterable<TurnEvent> {
  const {
    deps,
    context,
    messages,
    toolCalls,
    allToolCalls,
    allToolResults,
    suppressInjectedTools,
    signal,
  } = input;
  deps.setState("acting");
  yield { type: "state_changed", state: "acting" };

  const executionCtx: ToolExecutionContext = {
    spaceId: context.spaceId,
    agentId: deps.agentId,
    turnId: context.turnId,
    lineageId: context.lineageId,
    principalId: context.principalId,
    deviceId: context.deviceId,
    executionOrigin: context.executionOrigin,
    accessMode: context.accessMode,
    suppressInjectedTools,
  };

  const permissionChecks = await Promise.all(
    toolCalls.map((toolCall) => deps.toolExecutor.checkPermission(toolCall, executionCtx)),
  );

  const denied: { toolCall: ToolCall; permission: ToolPermission }[] = [];
  const needsApproval: { toolCall: ToolCall; permission: ToolPermission }[] = [];
  const autoApproved: ToolCall[] = [];

  for (let i = 0; i < toolCalls.length; i++) {
    const toolCall = toolCalls[i];
    const permission = permissionChecks[i];
    allToolCalls.push(toolCall);

    if (!permission.allowed) {
      denied.push({ toolCall, permission });
    } else if (permission.requiresApproval) {
      needsApproval.push({ toolCall, permission });
    } else {
      autoApproved.push(toolCall);
    }
  }

  for (const { toolCall, permission } of denied) {
    yield { type: "tool_call_start", toolCall };
    const errorResult: ToolResult = {
      toolCallId: toolCall.id,
      result: `Permission denied: ${permission.reason}`,
      isError: true,
    };
    appendAndRecordToolResult(input, toolCall, errorResult);
    yield { type: "tool_result", result: errorResult };
  }

  if (autoApproved.length > 0 && !signal.aborted) {
    for (const toolCall of autoApproved) {
      yield { type: "tool_call_start", toolCall };
    }

    const parallelResults = await Promise.all(
      autoApproved.map((toolCall) =>
        deps.toolExecutor.execute(toolCall, executionCtx),
      ),
    );

    for (let i = 0; i < autoApproved.length; i++) {
      const toolCall = autoApproved[i];
      const toolResult = parallelResults[i];
      appendAndRecordToolResult(input, toolCall, toolResult);
      yield { type: "tool_result", result: toolResult };
    }
  }

  for (const { toolCall, permission } of needsApproval) {
    if (signal.aborted) break;

    yield { type: "tool_call_start", toolCall };

    const approvalContext = normalizeApprovalContext(permission.approvalContext, toolCall.name);
    const checkpoint: RuntimeFeedbackCheckpoint = {
      id: randomUUID(),
      agentId: deps.agentId,
      triggerClass: approvalContext ? "policy_escalation" : "permission_gate",
      description: permission.reason ?? `Tool "${toolCall.name}" requires approval`,
      options: ["approve", "reject"],
      ...(approvalContext ? { context: approvalContext } : {}),
    };

    deps.setState("needs_feedback");
    yield { type: "state_changed", state: "needs_feedback" };
    yield { type: "feedback_requested", request: checkpoint };

    const feedbackResult = await deps.waitForFeedback(context.turnId);
    if (feedbackResult.action === "reject" || feedbackResult.action === "defer") {
      const deniedResult: ToolResult = {
        toolCallId: toolCall.id,
        result: "Tool execution denied by human reviewer",
        isError: true,
      };
      appendAndRecordToolResult(input, toolCall, deniedResult);
      yield { type: "tool_result", result: deniedResult };
      continue;
    }

    deps.setState("acting");
    yield { type: "state_changed", state: "acting" };

    const toolResult = await deps.toolExecutor.execute(toolCall, executionCtx);
    appendAndRecordToolResult(input, toolCall, toolResult);
    yield { type: "tool_result", result: toolResult };
  }

  deps.setState("thinking");
  yield { type: "state_changed", state: "thinking" };
}

function appendAndRecordToolResult(
  input: ExecuteTurnToolCallsInput,
  toolCall: ToolCall,
  toolResult: ToolResult,
): void {
  input.allToolResults.push(toolResult);
  appendToolResultMessage({
    messages: input.messages,
    context: input.context,
    toolCall,
    rawResult: toolResult.result,
    agentId: input.deps.agentId,
    providerId: input.deps.config.modelProvider,
    modelId: input.deps.config.modelId,
    onPromptBridgeWarning: input.deps.onPromptBridgeWarning,
  });
}
