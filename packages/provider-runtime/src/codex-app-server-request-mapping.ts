import type { GenerateOptions, ModelMessage } from "@spaceskit/core";

export type CodexUserInput = {
  type: "text";
  text: string;
  text_elements: [];
};

export function extractDeveloperInstructions(messages: ModelMessage[]): string | undefined {
  const systemMessages = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter(Boolean);
  if (systemMessages.length === 0) {
    return undefined;
  }
  return systemMessages.join("\n\n");
}

export function toUserInputs(
  messages: ModelMessage[],
  resumeThread: boolean,
): CodexUserInput[] {
  const renderableMessages = messages.filter((message) => message.role !== "system");
  const sliced = resumeThread ? toNewMessagesOnly(renderableMessages) : renderableMessages;
  const text = renderPrompt(sliced);
  return [{
    type: "text",
    text,
    text_elements: [],
  }];
}

export function renderPrompt(messages: ModelMessage[]): string {
  return messages
    .map((message) => {
      const role = message.role.toUpperCase();
      const suffix = message.role === "tool" && message.toolName
        ? ` (${message.toolName})`
        : "";
      return `${role}${suffix}:\n${message.content}`.trim();
    })
    .join("\n\n")
    .trim();
}

export function toNewMessagesOnly(messages: ModelMessage[]): ModelMessage[] {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  return lastUserIndex >= 0 ? messages.slice(lastUserIndex) : messages.slice(-1);
}

export function mapApprovalPolicy(
  accessMode: GenerateOptions["accessMode"],
  approvalBypassEnabled?: boolean,
): "untrusted" | "on-request" | "never" | undefined {
  if (accessMode === "full_access") {
    return approvalBypassEnabled ? "never" : "on-request";
  }
  if (accessMode === "default") {
    return "untrusted";
  }
  return undefined;
}

export function mapSandboxMode(
  accessMode: GenerateOptions["accessMode"],
): "read-only" | "danger-full-access" | undefined {
  if (accessMode === "full_access") {
    return "danger-full-access";
  }
  if (accessMode === "default") {
    return "read-only";
  }
  return undefined;
}

export function mapReasoningEffort(
  effort: GenerateOptions["effort"],
): "low" | "medium" | "high" | "xhigh" | undefined {
  switch (effort) {
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "max":
      return "xhigh";
    default:
      return undefined;
  }
}

export function mapReasoningSummary(
  options: GenerateOptions,
): "none" | "concise" | undefined {
  if (options.thinkingConfig?.display === "omitted") {
    return "none";
  }
  if (options.effort || options.thinkingConfig?.enabled) {
    return "concise";
  }
  return undefined;
}
