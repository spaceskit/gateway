import { describe, expect, test } from "bun:test";
import type { ToolDefinition } from "../../src/agents/model-provider.js";
import {
  buildMediatedToolPrompt,
  buildToolUsageGuidance,
} from "../../src/agents/agent-runtime-tools.js";
import {
  parseFencedToolCalls,
  stripFencedToolCallBlocks,
} from "../../src/agents/mediated-tool-calls.js";

const TOOL_DEFS: ToolDefinition[] = [
  {
    name: "lists.listLists",
    description: "List reminder lists.",
    inputSchema: { type: "object", properties: { targetProvider: { type: "string" } } },
  },
  {
    name: "lists.completeItem",
    description: "Mark a reminder done.",
    inputSchema: { type: "object", properties: { itemId: { type: "string" } } },
  },
  {
    name: "lists.updateItem",
    description: "Update a reminder.",
    inputSchema: { type: "object", properties: { itemId: { type: "string" }, isCompleted: { type: "boolean" } } },
  },
  {
    name: "calendar.listCalendars",
    description: "List calendars.",
    inputSchema: { type: "object", properties: { targetProvider: { type: "string" } } },
  },
];

describe("agent runtime tool guidance", () => {
  test("native guidance mentions reminder completion and calendar discovery", () => {
    const guidance = buildToolUsageGuidance(TOOL_DEFS);

    expect(guidance).toContain("call 'lists.listLists' first when listId is unknown");
    expect(guidance).toContain("Use 'lists.completeItem' to mark a reminder done");
    expect(guidance).toContain("use 'lists.updateItem' for general edits or to reopen with isCompleted: false");
    expect(guidance).toContain("call 'calendar.listCalendars' first when calendarId is unknown");
  });

  test("mediated guidance mentions reminder completion and calendar discovery", () => {
    const prompt = buildMediatedToolPrompt(TOOL_DEFS);

    expect(prompt).toContain("```tool_call");
    expect(prompt).toContain("\"name\": \"tool_name\"");
    expect(prompt).toContain("After the gateway executes the tools");
    expect(prompt).toContain("Use 'lists.completeItem' to mark a reminder done");
    expect(prompt).toContain("use 'lists.updateItem' for general edits or to reopen with isCompleted: false");
    expect(prompt).toContain("call 'calendar.listCalendars' first when calendarId is unknown");
  });

  test("parses fenced mediated tool calls and filters unknown tools", () => {
    const toolCalls = parseFencedToolCalls(`
Thinking.

\`\`\`tool_call
{"name":"lists.listLists","arguments":{"targetProvider":"apple"}}
\`\`\`

\`\`\`tool_call
{"name":"files.read","arguments":{"path":"README.md"}}
\`\`\`
`, {
      allowedToolNames: new Set(["lists.listLists"]),
      idFactory: () => "tool-call-1",
    });

    expect(toolCalls).toEqual([{
      id: "tool-call-1",
      name: "lists.listLists",
      arguments: { targetProvider: "apple" },
    }]);
  });

  test("strips fenced mediated tool calls from assistant text", () => {
    const stripped = stripFencedToolCallBlocks(`
I will check that now.

\`\`\`tool_call
{"name":"lists.listLists","arguments":{}}
\`\`\`

After that I will summarize the result.
`);

    expect(stripped).toBe("I will check that now.\n\nAfter that I will summarize the result.");
  });
});
