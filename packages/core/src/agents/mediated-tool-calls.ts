import { randomUUID } from "node:crypto";
import type { ToolCall } from "./model-provider.js";

const TOOL_CALL_FENCE = "```tool_call";
const TOOL_CALL_FENCE_END = "```";

export interface ParseFencedToolCallsOptions {
  allowedToolNames?: Iterable<string>;
  idFactory?: () => string;
}

export function parseFencedToolCalls(
  text: string,
  options: ParseFencedToolCallsOptions = {},
): ToolCall[] {
  const toolCalls: ToolCall[] = [];
  const allowedToolNames = options.allowedToolNames
    ? new Set(Array.from(options.allowedToolNames, (name) => name.trim()).filter((name) => name.length > 0))
    : null;
  const createId = options.idFactory ?? (() => `tc_${randomUUID().slice(0, 8)}`);

  let searchFrom = 0;
  while (searchFrom < text.length) {
    const fenceStart = text.indexOf(TOOL_CALL_FENCE, searchFrom);
    if (fenceStart === -1) break;

    const jsonStart = fenceStart + TOOL_CALL_FENCE.length;
    const fenceEnd = text.indexOf(TOOL_CALL_FENCE_END, jsonStart);
    if (fenceEnd === -1) break;

    const jsonStr = text.slice(jsonStart, fenceEnd).trim();
    searchFrom = fenceEnd + TOOL_CALL_FENCE_END.length;

    try {
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
      if (!name) continue;
      if (allowedToolNames && !allowedToolNames.has(name)) continue;
      toolCalls.push({
        id: createId(),
        name,
        arguments: asRecord(parsed.arguments) ?? {},
      });
    } catch {
      // Skip malformed fenced blocks and continue scanning.
    }
  }

  return toolCalls;
}

export function stripFencedToolCallBlocks(text: string): string {
  let result = text;
  let searchFrom = 0;

  while (searchFrom < result.length) {
    const fenceStart = result.indexOf(TOOL_CALL_FENCE, searchFrom);
    if (fenceStart === -1) break;

    const fenceEnd = result.indexOf(TOOL_CALL_FENCE_END, fenceStart + TOOL_CALL_FENCE.length);
    if (fenceEnd === -1) break;

    result = result.slice(0, fenceStart) + result.slice(fenceEnd + TOOL_CALL_FENCE_END.length);
    searchFrom = fenceStart;
  }

  return result
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
