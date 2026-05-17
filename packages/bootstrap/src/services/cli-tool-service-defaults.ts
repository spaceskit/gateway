import type {
  CliToolExampleRecord,
  CliToolOutputMode,
  RegisterCliToolInput,
} from "./cli-tool-service-types.js";

export const CLI_TOOL_SCHEMA_VERSION = 1;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

export function defaultInputSchema(outputMode: CliToolOutputMode): Record<string, unknown> {
  const payloadProperty = outputMode === "json"
    ? {
      payload: {
        type: "string",
        description: "JSON or text payload forwarded to the tool.",
      },
    }
    : {
      query: {
        type: "string",
        description: "Plain-text request forwarded to the tool.",
      },
    };
  return {
    type: "object",
    properties: payloadProperty,
    additionalProperties: true,
  };
}

export function defaultInstructions(displayName: string, outputMode: CliToolOutputMode): string {
  return outputMode === "json"
    ? `Use ${displayName} when structured JSON output is needed. Prefer the documented arguments and avoid speculative fields.`
    : `Use ${displayName} for focused external command execution. Keep arguments minimal and expect plain-text output.`;
}

export function defaultExamples(outputMode: CliToolOutputMode): CliToolExampleRecord[] {
  if (outputMode === "json") {
    return [
      {
        name: "Basic JSON call",
        description: "Demonstrates a structured request payload.",
        arguments: { payload: "{\"query\":\"status\"}" },
        expectedOutput: "{\"status\":\"ok\"}",
      },
      {
        name: "Alternate text contract",
        description: "If this tool is switched to text output mode, the equivalent success response is plain text.",
        arguments: { payload: "{\"query\":\"status\"}" },
        expectedOutput: "ok",
      },
      {
        name: "Failure example",
        description: "Shows the tool surfacing an execution or validation failure.",
        arguments: { payload: "{\"query\":\"bad-input\"}" },
        expectedOutput: "{\"error\":\"invalid request\"}",
      },
    ];
  }

  return [
    {
      name: "Basic text call",
      description: "Demonstrates a plain-text request payload.",
      arguments: { query: "status" },
      expectedOutput: "ok",
    },
    {
      name: "Alternate JSON contract",
      description: "If this tool is switched to json output mode, the equivalent success response is structured JSON.",
      arguments: { query: "status" },
      expectedOutput: "{\"status\":\"ok\"}",
    },
    {
      name: "Failure example",
      description: "Shows the tool surfacing an execution or validation failure.",
      arguments: { query: "bad-input" },
      expectedOutput: "invalid request",
    },
  ];
}

export function buildDefaultReadme(manifest: RegisterCliToolInput): string {
  const outputExample = manifest.outputMode == "json"
    ? "{\"status\":\"ok\"}"
    : "ok";
  return [
    `# ${manifest.displayName}`,
    "",
    "## Purpose",
    manifest.description,
    "",
    "## Safety",
    "This tool executes a local binary on the external gateway. Misconfiguration can modify files, expose secrets, or cause data loss.",
    "",
    "## Executable Requirements",
    "- Replace the placeholder executable path with an absolute path or resolvable binary name.",
    "- Verify the command works outside Spaces before registering it.",
    "",
    "## Inputs",
    "- Keep the JSON schema aligned with the arguments expected by the executable.",
    "",
    "## Examples",
    "```json",
    JSON.stringify(manifest.examples ?? defaultExamples(manifest.outputMode ?? "text"), null, 2),
    "```",
    "",
    "## Output Contract",
    `- Expected output mode: \`${manifest.outputMode}\``,
    `- Example output: \`${outputExample}\``,
    "",
    "## Failure Modes",
    "- Non-zero exit codes surface as tool failures.",
    "- Invalid JSON output is rejected when output mode is `json`.",
    "- Output larger than the configured maximum is rejected.",
    "",
    "## Approval Guidance",
    "- Default posture should remain explicit human approval.",
    "- Use time-bounded or space-scoped approvals only for well-understood tools.",
    "",
  ].join("\n");
}
