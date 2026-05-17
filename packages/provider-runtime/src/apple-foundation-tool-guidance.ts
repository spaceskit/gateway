import {
  buildMediatedToolPrompt,
  buildToolUsageGuidance,
  hasInjectedToolGuidance,
  type ModelMessage,
  type ToolDefinition,
} from "@spaceskit/core";

/**
 * Inject tool descriptions and fenced-JSON calling instructions into the
 * message list. The on-device model sees tools as text and responds with
 * fenced JSON blocks that the gateway parses.
 */
export function injectTextToolGuidance(messages: ModelMessage[], tools: ToolDefinition[]): ModelMessage[] {
  const guidance: ModelMessage = {
    role: "system",
    content: buildMediatedToolPrompt(tools),
  };

  return [messages[0], guidance, ...messages.slice(1)];
}

export function injectHelperToolGuidance(messages: ModelMessage[], tools: ToolDefinition[]): ModelMessage[] {
  const guidance: ModelMessage = {
    role: "system",
    content: hasInjectedToolGuidance(messages)
      ? buildHelperResponseFormatGuidance()
      : buildHelperToolPrompt(tools),
  };

  return [messages[0], guidance, ...messages.slice(1)];
}

function buildHelperToolPrompt(tools: ToolDefinition[]): string {
  return [
    buildToolUsageGuidance(tools),
    buildHelperResponseFormatGuidance(),
  ].join("\n");
}

function buildHelperResponseFormatGuidance(): string {
  return [
    "When using the structured Apple helper response format:",
    "- Choose type = \"tool_call\" whenever the user explicitly instructs you to use a tool or when live gateway data/action is required.",
    "- When the user names an exact tool, call that exact tool and do not substitute a different tool.",
    "- After a successful tool result satisfies the request, return type = \"final\" instead of calling more tools.",
    "- Never call shell.* tools unless the user explicitly asks for shell or CLI work.",
    "- Set name to the exact tool name.",
    "- Set argumentsJSON to a valid JSON object string for that tool. Do not leave required arguments empty.",
    "- Choose type = \"final\" only when no tool execution is needed.",
    "- If the user asks which tools are available, answer only from the provided tool list and do not invent capabilities.",
  ].join("\n");
}
