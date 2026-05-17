import type { ModelCapabilities } from "./model-capability-registry.js";
import type {
  ModelMessage,
  ThinkingConfig,
  TokenUsage,
  ToolDefinition,
  TurnReasoningEffort,
} from "./model-provider.js";

export function maybeBuildToolInventoryResponse(
  messages: ModelMessage[],
  toolDefs: ToolDefinition[],
): string | null {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const prompt = latestUserMessage?.content.trim().toLowerCase();
  if (!prompt) {
    return null;
  }

  const inventoryPatterns = [
    "which tools are available",
    "what tools are available",
    "what tools do you have",
    "what tools can you use",
    "list your tools",
    "list available tools",
    "show available tools",
  ];
  if (!inventoryPatterns.some((pattern) => prompt.includes(pattern))) {
    return null;
  }

  if (toolDefs.length === 0) {
    return "No tools are currently available in this space for this turn.";
  }

  const groups = new Map<string, string[]>();
  for (const tool of toolDefs) {
    const name = tool.name.trim();
    if (!name) continue;
    const prefix = name.split(".")[0] ?? "other";
    const existing = groups.get(prefix) ?? [];
    existing.push(name);
    groups.set(prefix, existing);
  }

  const lines = ["Available tools in this space:"];
  for (const prefix of Array.from(groups.keys()).sort((lhs, rhs) => lhs.localeCompare(rhs))) {
    const names = (groups.get(prefix) ?? []).sort((lhs, rhs) => lhs.localeCompare(rhs));
    const listed = names.slice(0, 8);
    const remaining = Math.max(0, names.length - listed.length);
    lines.push(`- ${prefix}: ${listed.join(", ")}${remaining > 0 ? `, +${remaining} more` : ""}`);
  }
  if (toolDefs.length > 40) {
    lines.push(`- Total tools: ${toolDefs.length}`);
  }
  return lines.join("\n");
}

export function resolveThinkingConfig(
  effort: TurnReasoningEffort | undefined,
  capabilities: ModelCapabilities,
): ThinkingConfig | undefined {
  if (!effort) return undefined;

  if (capabilities.supportsThinking) {
    const budgetMap: Record<TurnReasoningEffort, number> = {
      low: 1_024,
      medium: 4_096,
      high: 16_384,
      max: 32_768,
    };
    return {
      enabled: true,
      budgetTokens: budgetMap[effort],
      display: "summarized",
    };
  }

  return undefined;
}

export function estimateMissingUsage(messages: ModelMessage[], totalUsage: TokenUsage): void {
  if (totalUsage.totalTokens !== 0 || messages.length === 0) {
    return;
  }

  const estimatedInput = Math.ceil(
    messages
      .filter((message) => message.role !== "assistant")
      .reduce((acc, message) => acc + (typeof message.content === "string" ? message.content.length : 0), 0) / 4,
  );
  const estimatedOutput = Math.ceil(
    messages
      .filter((message) => message.role === "assistant")
      .reduce((acc, message) => acc + (typeof message.content === "string" ? message.content.length : 0), 0) / 4,
  );
  totalUsage.promptTokens = estimatedInput;
  totalUsage.completionTokens = estimatedOutput;
  totalUsage.totalTokens = estimatedInput + estimatedOutput;
  totalUsage.tokenAccuracy = "estimated";
  totalUsage.usageSource = "ledger";
}
