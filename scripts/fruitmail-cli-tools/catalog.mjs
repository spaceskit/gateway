import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SPACES_FRUITMAIL_WRAPPER_VERSION = "0.1.0";
export const FRUITMAIL_CLI_TOOL_SCHEMA_VERSION = 1;
export const FRUITMAIL_CLI_DEFAULT_TIMEOUT_MS = 30_000;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FRUITMAIL_BUNDLE_METADATA = {
  bundleId: "fruitmail-cli",
  bundleDisplayName: "Apple Mail (fruitmail)",
  bundleDescription: "Gateway-managed fruitmail CLI bundle for Apple Mail search, message retrieval, and email sending via the local Mail.app database.",
};

function stringProperty(description) {
  return { type: "string", description };
}
function integerProperty(description, extra = {}) {
  return { type: "integer", description, ...extra };
}
function booleanProperty(description) {
  return { type: "boolean", description };
}

const COMMON_OUTPUT_HINTS = "Returns JSON output.";
const COMMON_OUTPUT_MODE = "json";
const DEFAULT_MAX_OUTPUT_BYTES = 131_072;

export const FRUITMAIL_TOOL_DEFINITIONS = [
  {
    id: "shell.fruitmail.stats",
    toolName: "shell.fruitmail.stats",
    displayName: "Mail Stats",
    description: "Get Apple Mail database statistics: total messages, unread, deleted, and attachment counts.",
    ...FRUITMAIL_BUNDLE_METADATA,
    toolGroupId: "general",
    toolGroupDisplayName: "General",
    inputSchema: {
      type: "object",
      properties: {},
    },
    outputMode: COMMON_OUTPUT_MODE,
    outputHint: COMMON_OUTPUT_HINTS,
    schemaVersion: FRUITMAIL_CLI_TOOL_SCHEMA_VERSION,
    wrapperVersion: SPACES_FRUITMAIL_WRAPPER_VERSION,
    wrapperScriptPath: resolve(SCRIPT_DIR, "spaces-fruitmail.mjs"),
  },
  {
    id: "shell.fruitmail.recent",
    toolName: "shell.fruitmail.recent",
    displayName: "Recent Emails",
    description: "List recent emails from Apple Mail. Returns subject, sender, date, and mailbox for each message.",
    ...FRUITMAIL_BUNDLE_METADATA,
    toolGroupId: "messages",
    toolGroupDisplayName: "Messages",
    inputSchema: {
      type: "object",
      properties: {
        days: integerProperty("Number of days to look back. Defaults to 7.", { minimum: 1 }),
        limit: integerProperty("Maximum number of results. Defaults to 20.", { minimum: 1 }),
      },
    },
    outputMode: COMMON_OUTPUT_MODE,
    outputHint: COMMON_OUTPUT_HINTS,
    schemaVersion: FRUITMAIL_CLI_TOOL_SCHEMA_VERSION,
    wrapperVersion: SPACES_FRUITMAIL_WRAPPER_VERSION,
    wrapperScriptPath: resolve(SCRIPT_DIR, "spaces-fruitmail.mjs"),
  },
  {
    id: "shell.fruitmail.search",
    toolName: "shell.fruitmail.search",
    displayName: "Search Emails",
    description: "Search Apple Mail with filters: subject, sender, recipient, unread, attachments, date range.",
    ...FRUITMAIL_BUNDLE_METADATA,
    toolGroupId: "messages",
    toolGroupDisplayName: "Messages",
    inputSchema: {
      type: "object",
      properties: {
        subject: stringProperty("Search by subject text."),
        sender: stringProperty("Search by sender email address."),
        to: stringProperty("Search by recipient email address."),
        fromName: stringProperty("Search by sender display name."),
        unread: booleanProperty("Only show unread emails."),
        read: booleanProperty("Only show read emails."),
        days: integerProperty("Days lookback window. Defaults to 7.", { minimum: 1 }),
        hasAttachment: booleanProperty("Only show emails with attachments."),
        attachmentType: stringProperty("Filter by attachment file extension (e.g., pdf, xlsx)."),
        limit: integerProperty("Maximum number of results. Defaults to 20.", { minimum: 1 }),
      },
    },
    outputMode: COMMON_OUTPUT_MODE,
    outputHint: COMMON_OUTPUT_HINTS,
    schemaVersion: FRUITMAIL_CLI_TOOL_SCHEMA_VERSION,
    wrapperVersion: SPACES_FRUITMAIL_WRAPPER_VERSION,
    wrapperScriptPath: resolve(SCRIPT_DIR, "spaces-fruitmail.mjs"),
  },
  {
    id: "shell.fruitmail.body",
    toolName: "shell.fruitmail.body",
    displayName: "Read Email Body",
    description: "Read the full body content of an email by its message ID. Returns plain text content.",
    ...FRUITMAIL_BUNDLE_METADATA,
    toolGroupId: "messages",
    toolGroupDisplayName: "Messages",
    inputSchema: {
      type: "object",
      properties: {
        messageId: stringProperty("The message ID (ROWID) from a previous search result."),
      },
      required: ["messageId"],
    },
    outputMode: COMMON_OUTPUT_MODE,
    outputHint: "Returns JSON output containing the email body text.",
    schemaVersion: FRUITMAIL_CLI_TOOL_SCHEMA_VERSION,
    wrapperVersion: SPACES_FRUITMAIL_WRAPPER_VERSION,
    wrapperScriptPath: resolve(SCRIPT_DIR, "spaces-fruitmail.mjs"),
  },
  {
    id: "shell.fruitmail.unread",
    toolName: "shell.fruitmail.unread",
    displayName: "Unread Emails",
    description: "List all unread emails from Apple Mail.",
    ...FRUITMAIL_BUNDLE_METADATA,
    toolGroupId: "messages",
    toolGroupDisplayName: "Messages",
    inputSchema: {
      type: "object",
      properties: {
        limit: integerProperty("Maximum number of results. Defaults to 20.", { minimum: 1 }),
      },
    },
    outputMode: COMMON_OUTPUT_MODE,
    outputHint: COMMON_OUTPUT_HINTS,
    schemaVersion: FRUITMAIL_CLI_TOOL_SCHEMA_VERSION,
    wrapperVersion: SPACES_FRUITMAIL_WRAPPER_VERSION,
    wrapperScriptPath: resolve(SCRIPT_DIR, "spaces-fruitmail.mjs"),
  },
  {
    id: "shell.fruitmail.send",
    toolName: "shell.fruitmail.send",
    displayName: "Send Email",
    description: "Send an email via the macOS mail command. No additional permissions required.",
    ...FRUITMAIL_BUNDLE_METADATA,
    toolGroupId: "send",
    toolGroupDisplayName: "Send",
    inputSchema: {
      type: "object",
      properties: {
        to: stringProperty("Recipient email address."),
        subject: stringProperty("Email subject line."),
        body: stringProperty("Email body text."),
        cc: stringProperty("Optional CC recipient email address."),
      },
      required: ["to", "subject", "body"],
    },
    outputMode: COMMON_OUTPUT_MODE,
    outputHint: "Returns JSON send confirmation.",
    schemaVersion: FRUITMAIL_CLI_TOOL_SCHEMA_VERSION,
    wrapperVersion: SPACES_FRUITMAIL_WRAPPER_VERSION,
    wrapperScriptPath: resolve(SCRIPT_DIR, "spaces-fruitmail.mjs"),
  },
];

export function getFruitMailToolDefinitionByOperation(operation) {
  const normalized = operation.trim().toLowerCase();
  return FRUITMAIL_TOOL_DEFINITIONS.find(
    (tool) => tool.toolName === `shell.fruitmail.${normalized}` || tool.id === `shell.fruitmail.${normalized}`,
  );
}

export function resolveDefaultSpacesFruitMailWrapperPath() {
  return resolve(SCRIPT_DIR, "spaces-fruitmail.mjs");
}

export function buildFruitMailCliManifest(tool, input = {}) {
  const wrapperPath = resolveRequiredAbsolutePath(
    input.wrapperPath ?? resolveDefaultSpacesFruitMailWrapperPath(),
    "wrapperPath",
  );
  const fixedCwd = resolveRequiredAbsolutePath(input.fixedCwd ?? dirname(wrapperPath), "fixedCwd");
  const now = input.now ?? new Date().toISOString();
  const enabled = input.enabled ?? true;

  return {
    schemaVersion: tool.schemaVersion,
    id: tool.id,
    displayName: tool.displayName,
    description: tool.description,
    bundleId: tool.bundleId,
    bundleDisplayName: tool.bundleDisplayName,
    bundleDescription: tool.bundleDescription,
    toolGroupId: tool.toolGroupId,
    toolGroupDisplayName: tool.toolGroupDisplayName,
    executable: wrapperPath,
    resolvedExecutable: wrapperPath,
    argsTemplate: [extractOperation(tool.id), "{{payload}}"],
    inputSchema: wrapPayloadSchema(tool.inputSchema),
    instructions: buildFruitMailInstructions(tool),
    examples: buildFruitMailExamples(tool),
    timeoutMs: FRUITMAIL_CLI_DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    cwdMode: "fixed",
    fixedCwd,
    outputMode: tool.outputMode,
    dangerLevel: "standard",
    enabled,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildFruitMailCliToolReadme(tool) {
  const payloadProperties = tool.inputSchema?.properties ?? {};
  const required = new Set(tool.inputSchema?.required ?? []);
  const payloadLines = Object.entries(payloadProperties).map(([name, schema]) => {
    const description = typeof schema?.description === "string" ? schema.description : "See the manifest schema.";
    const requirement = required.has(name) ? "required" : "optional";
    return `- \`${name}\` (${requirement}): ${description}`;
  });

  return [
    `# ${tool.displayName}`,
    "",
    "## Purpose",
    tool.description,
    "",
    "## Wrapper Operation",
    `- Tool id: \`${tool.id}\``,
    `- Wrapper operation: \`${extractOperation(tool.id)}\``,
    "",
    "## Host Apple Mail Configuration",
    "- Install `apple-mail-search-cli` (`fruitmail`) on the external gateway host.",
    "- Confirm the host user can access the local Mail.app database before starting the gateway.",
    "- Keep Mail.app signed in and fully synced for the account data you expect to query.",
    "",
    "## Payload",
    ...(payloadLines.length > 0 ? payloadLines : ["- This tool does not require any payload fields."]),
    "",
    "## Output Contract",
    "- The wrapper always emits JSON.",
    `- Output mode: \`${tool.outputMode}\``,
    `- Output hint: ${tool.outputHint}`,
  ].join("\n");
}

function wrapPayloadSchema(inputSchema) {
  return {
    type: "object",
    properties: {
      payload: {
        ...inputSchema,
        description: "Structured FruitMail request payload.",
      },
    },
    additionalProperties: false,
  };
}

function buildFruitMailInstructions(tool) {
  return `Use ${tool.displayName} for Apple Mail operations only after the gateway host can run the fruitmail CLI successfully outside Spaces.`;
}

function buildFruitMailExamples(tool) {
  const operation = extractOperation(tool.id);
  switch (operation) {
    case "stats":
      return [
        {
          name: "Read mailbox statistics",
          arguments: { payload: {} },
          expectedOutput: "{\"ok\":true,\"operation\":\"stats\",\"data\":{\"total_messages\":42}}",
        },
      ];
    case "recent":
      return [
        {
          name: "List recent emails",
          arguments: { payload: { days: 3, limit: 10 } },
          expectedOutput: "{\"ok\":true,\"operation\":\"recent\",\"data\":[]}",
        },
      ];
    case "search":
      return [
        {
          name: "Search unread emails by sender",
          arguments: { payload: { sender: "alerts@example.com", unread: true, limit: 10 } },
          expectedOutput: "{\"ok\":true,\"operation\":\"search\",\"data\":[]}",
        },
      ];
    case "body":
      return [
        {
          name: "Read one message body",
          arguments: { payload: { messageId: "12345" } },
          expectedOutput: "{\"ok\":true,\"operation\":\"body\",\"data\":\"Email body text\"}",
        },
      ];
    case "unread":
      return [
        {
          name: "List unread emails",
          arguments: { payload: { limit: 20 } },
          expectedOutput: "{\"ok\":true,\"operation\":\"unread\",\"data\":[]}",
        },
      ];
    case "send":
      return [
        {
          name: "Send an email",
          arguments: { payload: { to: "team@example.com", subject: "Status", body: "All green." } },
          expectedOutput: "{\"ok\":true,\"operation\":\"send\",\"data\":{\"to\":\"team@example.com\"}}",
        },
      ];
    default:
      return [];
  }
}

function extractOperation(toolId) {
  return toolId.replace("shell.fruitmail.", "");
}

function resolveRequiredAbsolutePath(value, field) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error(`${field} is required.`);
  }
  return resolve(normalized);
}
