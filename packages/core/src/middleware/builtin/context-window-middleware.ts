/**
 * ContextWindowMiddleware — auto-summarizes conversation history when
 * it approaches the model's context window limit.
 *
 * LLM layer (order: 5):
 * - Pre: Estimate token count of messages. If exceeding threshold,
 *   summarize older messages and replace with a summary.
 *
 * Stolen from: CrewAI's respect_context_window + auto-summarization.
 */

import type { Middleware, MiddlewareContext } from "../types.js";
import type { EventBus } from "../../events/event-bus.js";
import type { GenerateOptions, ModelMessage } from "../../agents/model-provider.js";
import {
  estimateTokens as estimateBudgetTokens,
  remainingForNextParticipant,
  type OrchestrationContextBudget,
} from "../../orchestrator/context-budget.js";

export interface ContextWindowMiddlewareOptions {
  eventBus: EventBus;
  /**
   * Threshold fraction of context window to trigger summarization.
   * Default: 0.75 (summarize when 75% of context used).
   */
  threshold?: number;
  /**
   * Number of recent messages to keep intact (not summarized).
   * Default: 10.
   */
  keepRecentMessages?: number;
  /**
   * Estimate the context window size for a model.
   * Default: returns 128000 (Claude-class model).
   */
  getContextWindowSize?: (modelId?: string) => number;
  /**
   * Generate a summary of messages. If not provided, uses a simple
   * concatenation fallback (not ideal, but doesn't require an LLM call).
   */
  summarize?: (messages: ModelMessage[]) => Promise<string>;
}

/**
 * Rough token estimation: ~4 chars per token (English text).
 * This is intentionally conservative — better to summarize too early
 * than to hit a context overflow error.
 */
function estimateTokens(messages: ModelMessage[], calibrationFactor = 1.0): number {
  let chars = 0;
  for (const msg of messages) {
    chars += msg.content.length;
    // Add overhead for role, tool calls, etc.
    chars += 20;
  }
  return estimateBudgetTokens(chars, calibrationFactor);
}

function buildFallbackSummary(messages: ModelMessage[]): string {
  const lines = messages
    .map((message) => `[${message.role}]: ${message.content.slice(0, 200)}`)
    .join("\n");
  return `[Previous conversation summary - ${messages.length} messages]\n${lines}`;
}

async function summarizeMessages(
  messages: ModelMessage[],
  summarize?: (messages: ModelMessage[]) => Promise<string>,
): Promise<string> {
  if (summarize) {
    try {
      const result = (await summarize(messages)).trim();
      if (result.length > 0) return result;
    } catch {
      // Fall through to deterministic fallback summarization.
    }
  }
  return buildFallbackSummary(messages);
}

function buildCompactedMessages(
  systemMessages: ModelMessage[],
  summaryMessage: ModelMessage | null,
  keptMessages: ModelMessage[],
): ModelMessage[] {
  return summaryMessage
    ? [...systemMessages, summaryMessage, ...keptMessages]
    : [...systemMessages, ...keptMessages];
}

function truncateSummaryToFit(
  summary: string,
  systemMessages: ModelMessage[],
  keptMessages: ModelMessage[],
  maxTokens: number,
): string {
  const trimmed = summary.trim();
  if (trimmed.length === 0) return "";

  const summaryRole: ModelMessage["role"] = "user";
  const asMessage = (content: string): ModelMessage => ({ role: summaryRole, content });
  if (estimateTokens(buildCompactedMessages(systemMessages, asMessage(trimmed), keptMessages)) <= maxTokens) {
    return trimmed;
  }

  let low = 0;
  let high = trimmed.length;
  let best = "";

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const slice = trimmed.slice(0, mid).trimEnd();
    const candidate = slice.length > 0 && slice.length < trimmed.length
      ? `${slice}...`
      : slice;
    const candidateMessage = candidate.length > 0 ? asMessage(candidate) : null;
    const candidateTokens = estimateTokens(
      buildCompactedMessages(systemMessages, candidateMessage, keptMessages),
    );

    if (candidateTokens <= maxTokens) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

export function createContextWindowMiddleware(
  options: ContextWindowMiddlewareOptions,
): Middleware {
  const threshold = options.threshold ?? 0.75;
  const keepRecent = Math.max(0, options.keepRecentMessages ?? 10);
  const getWindowSize = options.getContextWindowSize ?? (() => 128_000);
  const calibrationByScope = new Map<string, number>();

  return {
    name: "context-window",
    layer: "llm",
    order: 5,
    async process(ctx: MiddlewareContext, next: () => Promise<void>) {
      // Only process if input contains messages
      if (!ctx.input || typeof ctx.input !== "object") {
        await next();
        return;
      }

      const llmInput = ctx.input as GenerateOptions;
      if (!Array.isArray(llmInput.messages) || llmInput.messages.length === 0) {
        await next();
        return;
      }

      const contextWindow = getWindowSize(llmInput.modelId);
      const calibrationKey = buildCalibrationKey(ctx, llmInput.modelId);
      const calibrationFactor = calibrationByScope.get(calibrationKey) ?? 1.0;
      const budget = isOrchestrationBudget(ctx.metadata.orchestrationBudget)
        ? ctx.metadata.orchestrationBudget
        : undefined;
      const orchestrationRemaining = budget
        ? remainingForNextParticipant(budget)
        : undefined;
      const maxTokens = Math.max(
        1,
        Math.floor(
          orchestrationRemaining !== undefined
            ? Math.min(contextWindow * threshold, orchestrationRemaining)
            : contextWindow * threshold,
        ),
      );
      const currentTokens = estimateTokens(llmInput.messages, calibrationFactor);
      ctx.metadata._preEstimateTokens = currentTokens;

      if (currentTokens <= maxTokens) {
        await next();
        updateCalibrationIfAvailable(
          ctx,
          calibrationByScope,
          calibrationKey,
        );
        return;
      }

      // Context exceeds threshold — summarize older messages, then compact.
      const systemMessages = llmInput.messages.filter((message) => message.role === "system");
      const nonSystemMessages = llmInput.messages.filter((message) => message.role !== "system");
      if (nonSystemMessages.length === 0) {
        await next();
        return;
      }

      const keepCount = Math.min(keepRecent, nonSystemMessages.length);
      const keptMessages = keepCount > 0
        ? [...nonSystemMessages.slice(-keepCount)]
        : [];
      const toSummarize = nonSystemMessages.slice(0, nonSystemMessages.length - keepCount);

      options.eventBus.emit({
        type: "context.summarizing",
        spaceId: ctx.spaceId,
        messagesBeforeSummary: llmInput.messages.length,
        tokenEstimate: currentTokens,
        contextWindow,
        timestamp: new Date(),
      });

      let summaryMessage: ModelMessage | null = null;
      let summaryTruncated = false;
      if (toSummarize.length > 0) {
        const summary = await summarizeMessages(toSummarize, options.summarize);
        summaryMessage = summary.length > 0 ? { role: "user", content: summary } : null;
        if (summaryMessage) {
          const truncated = truncateSummaryToFit(
            summaryMessage.content,
            systemMessages,
            keptMessages,
            maxTokens,
          );
          if (truncated !== summaryMessage.content) {
            summaryTruncated = true;
          }
          summaryMessage = truncated.length > 0 ? { role: "user", content: truncated } : null;
        }
      }

      let droppedRecentMessages = 0;
      let compactedMessages = buildCompactedMessages(systemMessages, summaryMessage, keptMessages);
      let compactedTokens = estimateTokens(compactedMessages);

      while (compactedTokens > maxTokens && keptMessages.length > 0) {
        keptMessages.shift();
        droppedRecentMessages += 1;
        compactedMessages = buildCompactedMessages(systemMessages, summaryMessage, keptMessages);
        compactedTokens = estimateTokens(compactedMessages);
      }

      if (compactedTokens > maxTokens && summaryMessage) {
        summaryMessage = null;
        compactedMessages = buildCompactedMessages(systemMessages, summaryMessage, keptMessages);
        compactedTokens = estimateTokens(compactedMessages);
      }

      while (compactedTokens > maxTokens && keptMessages.length > 0) {
        keptMessages.shift();
        droppedRecentMessages += 1;
        compactedMessages = buildCompactedMessages(systemMessages, summaryMessage, keptMessages);
        compactedTokens = estimateTokens(compactedMessages);
      }

      llmInput.messages = compactedMessages;

      ctx.metadata.contextCompacted = true;
      ctx.metadata.contextSummarized = toSummarize.length > 0;
      ctx.metadata.messagesSummarized = toSummarize.length;
      ctx.metadata.summaryTruncated = summaryTruncated;
      ctx.metadata.messagesDroppedFromRecent = droppedRecentMessages;
      ctx.metadata.maxTokenEstimate = maxTokens;
      ctx.metadata.newTokenEstimate = compactedTokens;

      options.eventBus.emit({
        type: "context.summarized",
        spaceId: ctx.spaceId,
        messagesSummarized: toSummarize.length,
        droppedRecentMessages,
        summaryTruncated,
        newTokenEstimate: compactedTokens,
        maxTokenEstimate: maxTokens,
        newMessageCount: llmInput.messages.length,
        timestamp: new Date(),
      });

      await next();
      updateCalibrationIfAvailable(
        ctx,
        calibrationByScope,
        calibrationKey,
      );
    },
  };
}

function buildCalibrationKey(ctx: MiddlewareContext, modelId?: string): string {
  return [
    modelId ?? "",
    ctx.spaceId ?? "",
    ctx.agentId ?? "",
  ].join("::");
}

function isOrchestrationBudget(value: unknown): value is OrchestrationContextBudget {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OrchestrationContextBudget>;
  return typeof candidate.totalBudgetTokens === "number"
    && typeof candidate.reservedForSystemPrompt === "number"
    && typeof candidate.reservedForUserInput === "number"
    && candidate.spentByParticipants instanceof Map;
}

function updateCalibrationIfAvailable(
  ctx: MiddlewareContext,
  calibrationByScope: Map<string, number>,
  calibrationKey: string,
): void {
  const estimated = typeof ctx.metadata._preEstimateTokens === "number"
    ? ctx.metadata._preEstimateTokens
    : undefined;
  const output = ctx.output as { usage?: { promptTokens?: number } } | undefined;
  const actual = output?.usage?.promptTokens;
  if (!estimated || typeof actual !== "number" || !Number.isFinite(actual) || actual <= 0) {
    return;
  }

  const nextFactor = Math.max(0.25, Math.min(8, actual / estimated));
  calibrationByScope.set(calibrationKey, nextFactor);
  ctx.metadata.calibrationFactor = nextFactor;
}
