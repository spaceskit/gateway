import type {
  ModelMessage,
  StreamChunk,
  ToolCall,
} from "@spaceskit/core";

export interface CliStreamParser {
  push(chunk: string): StreamChunk[];
  finish(): StreamChunk[];
}

export type NormalizedAgentState = "idle" | "thinking" | "acting" | "needs_feedback" | "errored";

export interface JsonLineParserState {
  readonly messages: ModelMessage[];
  readonly toolCalls: Map<string, ToolCall>;
  readonly emittedToolStarts: Set<string>;
  assistantText: string;
  sawFinish: boolean;
  lastState: NormalizedAgentState | null;
  sawVisibleAssistantOutput: boolean;
  latestCompletedAgentMessage?: string;
}

export type JsonLineRecordParser = (
  record: Record<string, unknown>,
  state: JsonLineParserState,
) => StreamChunk[];
