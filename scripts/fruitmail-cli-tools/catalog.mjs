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
    outputHint: "Returns email body as plain text.",
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
    outputHint: "Returns send confirmation.",
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
