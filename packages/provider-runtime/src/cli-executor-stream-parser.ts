import type {
  ModelMessage,
  StreamChunk,
} from "@spaceskit/core";
import type { SupportedProviderId } from "./cli-executor-command-types.js";
import { parseClaudeStreamRecord } from "./cli-executor-claude-stream-parser.js";
import { parseCodexStreamRecord } from "./cli-executor-codex-stream-parser.js";
import { parseGeminiStreamRecord } from "./cli-executor-gemini-stream-parser.js";
import { estimateUsage } from "./cli-executor-output.js";
import {
  normalizeAgentStateValue,
} from "./cli-executor-stream-helpers.js";
import type {
  CliStreamParser,
  JsonLineParserState,
  JsonLineRecordParser,
  NormalizedAgentState,
} from "./cli-executor-stream-parser-types.js";

export function createCliStreamParser(providerId: SupportedProviderId, messages: ModelMessage[]): CliStreamParser {
  switch (providerId) {
    case "claude":
      return new JsonLineCliStreamParser((record, state) => parseClaudeStreamRecord(record, state), messages);
    case "codex":
      return new JsonLineCliStreamParser((record, state) => parseCodexStreamRecord(record, state), messages);
    case "gemini":
      return new JsonLineCliStreamParser((record, state) => parseGeminiStreamRecord(record, state), messages);
  }
}

class JsonLineCliStreamParser implements CliStreamParser {
  private readonly state: JsonLineParserState;
  private lineBuffer = "";

  constructor(
    private readonly parseRecord: JsonLineRecordParser,
    messages: ModelMessage[],
  ) {
    this.state = {
      messages,
      toolCalls: new Map(),
      emittedToolStarts: new Set(),
      assistantText: "",
      sawFinish: false,
      lastState: null,
      sawVisibleAssistantOutput: false,
      latestCompletedAgentMessage: undefined,
    };
  }

  push(chunk: string): StreamChunk[] {
    this.lineBuffer += chunk;
    const output: StreamChunk[] = [];

    while (true) {
      const newlineIndex = this.lineBuffer.indexOf("\n");
      if (newlineIndex === -1) break;
      const line = this.lineBuffer.slice(0, newlineIndex).trim();
      this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);
      if (!line) continue;
      output.push(...this.parseLine(line));
    }

    return output;
  }

  finish(): StreamChunk[] {
    const output: StreamChunk[] = [];
    const trailing = this.lineBuffer.trim();
    this.lineBuffer = "";
    if (trailing) {
      output.push(...this.parseLine(trailing));
    }
    if (!this.state.sawFinish && this.state.assistantText.length > 0) {
      output.push({
        type: "finish",
        finishReason: "stop",
        usage: estimateUsage(this.state.messages, this.state.assistantText),
      });
      this.state.sawFinish = true;
    }
    return output;
  }

  private parseLine(line: string): StreamChunk[] {
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      const chunks = normalizeParsedStreamChunks(this.parseRecord(record, this.state), this.state);
      for (const chunk of chunks) {
        if (chunk.type === "text_delta" && typeof chunk.text === "string" && isVisibleAssistantTextChunk(chunk)) {
          this.state.assistantText += chunk.text;
          this.state.sawVisibleAssistantOutput = true;
        }
        if (chunk.type === "finish") {
          this.state.sawFinish = true;
        }
      }
      return chunks;
    } catch {
      return [];
    }
  }
}

function normalizeParsedStreamChunks(
  chunks: StreamChunk[],
  parserState: JsonLineParserState,
): StreamChunk[] {
  const normalized: StreamChunk[] = [];
  for (const chunk of chunks) {
    if (chunk.type === "state_changed") {
      const explicitState = normalizeAgentStateValue(chunk.state);
      if (!explicitState) continue;
      maybePushStateChange(normalized, parserState, explicitState);
      continue;
    }

    const derivedState = deriveStateFromChunk(chunk);
    if (derivedState) {
      maybePushStateChange(normalized, parserState, derivedState);
    }

    normalized.push(chunk);
  }
  return normalized;
}

function maybePushStateChange(
  output: StreamChunk[],
  parserState: JsonLineParserState,
  state: NormalizedAgentState,
): void {
  if (parserState.lastState === state) return;
  output.push({ type: "state_changed", state });
  parserState.lastState = state;
}

function deriveStateFromChunk(chunk: StreamChunk): NormalizedAgentState | null {
  switch (chunk.type) {
    case "tool_call_start":
      return "acting";
    case "tool_result":
    case "text_delta":
    case "reasoning_delta":
      return "thinking";
    case "finish":
      return "idle";
    default:
      return null;
  }
}

function isVisibleAssistantTextChunk(chunk: StreamChunk): boolean {
  const transcriptVisibility = chunk.transcriptVisibility ?? "visible";
  const streamKind = chunk.streamKind ?? "assistant_output";
  return transcriptVisibility === "visible" && streamKind === "assistant_output";
}
