import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SPACES_OP_WRAPPER_VERSION = "0.1.0";
export const OP_CLI_TOOL_SCHEMA_VERSION = 1;
export const OP_CLI_DEFAULT_TIMEOUT_MS = 45_000;
export const OP_CLI_SMALL_OUTPUT_BYTES = 64 * 1024;
export const OP_CLI_MEDIUM_OUTPUT_BYTES = 128 * 1024;
export const OP_CLI_LARGE_OUTPUT_BYTES = 256 * 1024;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const OP_BUNDLE_METADATA = {
  bundleId: "onepassword-cli",
  bundleDisplayName: "1Password CLI",
  bundleDescription: "Gateway-managed 1Password CLI bundle for account, vault, item, user, group, Connect, and secret-read operations.",
};

const OP_GROUP_METADATA = {
  general: {
    toolGroupId: "general",
    toolGroupDisplayName: "General",
  },
  accounts: {
    toolGroupId: "accounts",
    toolGroupDisplayName: "Accounts",
  },
  connect: {
    toolGroupId: "connect",
    toolGroupDisplayName: "Connect",
  },
  documents: {
    toolGroupId: "documents",
    toolGroupDisplayName: "Documents",
  },
  eventsApi: {
    toolGroupId: "events-api",
    toolGroupDisplayName: "Events API",
  },
  groups: {
    toolGroupId: "groups",
    toolGroupDisplayName: "Groups",
  },
  items: {
    toolGroupId: "items",
    toolGroupDisplayName: "Items",
  },
  secrets: {
    toolGroupId: "secrets",
    toolGroupDisplayName: "Secrets",
  },
  serviceAccounts: {
    toolGroupId: "service-accounts",
    toolGroupDisplayName: "Service Accounts",
  },
  users: {
    toolGroupId: "users",
    toolGroupDisplayName: "Users",
  },
  vaults: {
    toolGroupId: "vaults",
    toolGroupDisplayName: "Vaults",
  },
};

export const OP_TOOL_DEFINITIONS = [
  defineTool({
    id: "op.whoami",
    operation: "whoami",
    displayName: "1Password Who Am I",
    description: "Show the current 1Password account and user identity.",
    command: ["whoami"],
    group: "general",
    prefersJsonOutput: true,
    examples: [
      example("Show the active 1Password identity", {}),
    ],
  }),
  defineTool({
    id: "op.read",
    operation: "read",
    displayName: "1Password Read Secret",
    description: "Read a secret or field value from 1Password using a secret reference.",
    command: ["read"],
    group: "secrets",
    argumentNames: ["secret-reference"],
    minArguments: 1,
    maxArguments: 1,
    examples: [
      example(
        "Read a database password",
        {
          arguments: ["op://Engineering/db/password"],
        },
      ),
    ],
  }),
  ...buildTopLevelTools({
    baseGroup: "accounts",
    baseCommand: ["account"],
    prefix: "account",
    singular: "Account",
    tools: [
      { name: "add", displayName: "1Password Account Add", description: "Add a 1Password account to this device manually.", prefersJsonOutput: false },
      { name: "forget", displayName: "1Password Account Forget", description: "Forget a 1Password account on this device.", prefersJsonOutput: false, dangerLevel: "destructive" },
      { name: "get", displayName: "1Password Account Get", description: "Get details about one configured 1Password account.", prefersJsonOutput: true, argumentNames: ["account"] },
      { name: "list", displayName: "1Password Account List", description: "List configured 1Password accounts on this device.", prefersJsonOutput: true },
    ],
  }),
  ...buildTopLevelTools({
    baseGroup: "documents",
    baseCommand: ["document"],
    prefix: "document",
    singular: "Document",
    tools: [
      { name: "create", displayName: "1Password Document Create", description: "Create a document item in 1Password.", prefersJsonOutput: false, supportsStdin: true },
      { name: "delete", displayName: "1Password Document Delete", description: "Delete a 1Password document.", prefersJsonOutput: false, dangerLevel: "destructive", argumentNames: ["document"] },
      { name: "edit", displayName: "1Password Document Edit", description: "Edit a 1Password document.", prefersJsonOutput: false, supportsStdin: true, argumentNames: ["document"] },
      { name: "get", displayName: "1Password Document Get", description: "Get a 1Password document or write it to a file via flags.", prefersJsonOutput: false, argumentNames: ["document"] },
      { name: "list", displayName: "1Password Document List", description: "List 1Password documents.", prefersJsonOutput: true },
    ],
  }),
  defineTool({
    id: "op.events_api.create",
    operation: "events_api.create",
    displayName: "1Password Events API Create",
    description: "Create a 1Password Events API integration token.",
    command: ["events-api", "create"],
    group: "eventsApi",
    examples: [
      example(
        "Create an Events API integration",
        {
          flags: {
            name: "Spaces Audit",
            expires_in: "1h",
          },
        },
      ),
    ],
  }),
  ...buildTopLevelTools({
    baseGroup: "groups",
    baseCommand: ["group"],
    prefix: "group",
    singular: "Group",
    tools: [
      { name: "create", displayName: "1Password Group Create", description: "Create a 1Password group.", prefersJsonOutput: true },
      { name: "delete", displayName: "1Password Group Delete", description: "Delete a 1Password group.", prefersJsonOutput: false, dangerLevel: "destructive", argumentNames: ["group"] },
      { name: "edit", displayName: "1Password Group Edit", description: "Edit a 1Password group.", prefersJsonOutput: true, argumentNames: ["group"] },
      { name: "get", displayName: "1Password Group Get", description: "Get a 1Password group.", prefersJsonOutput: true, argumentNames: ["group"] },
      { name: "list", displayName: "1Password Group List", description: "List 1Password groups.", prefersJsonOutput: true },
    ],
  }),
  ...buildNestedTools({
    baseGroup: "groups",
    prefix: "group.user",
    commandPrefix: ["group", "user"],
    tools: [
      { name: "grant", displayName: "1Password Group User Grant", description: "Add a user to a 1Password group.", argumentNames: ["group", "user"] },
      { name: "list", displayName: "1Password Group User List", description: "List users in a 1Password group.", prefersJsonOutput: true, argumentNames: ["group"] },
      { name: "revoke", displayName: "1Password Group User Revoke", description: "Remove a user from a 1Password group.", argumentNames: ["group", "user"], dangerLevel: "destructive" },
    ],
  }),
  ...buildTopLevelTools({
    baseGroup: "items",
    baseCommand: ["item"],
    prefix: "item",
    singular: "Item",
    tools: [
      { name: "create", displayName: "1Password Item Create", description: "Create a 1Password item.", prefersJsonOutput: true, supportsStdin: true },
      { name: "delete", displayName: "1Password Item Delete", description: "Delete a 1Password item.", prefersJsonOutput: false, dangerLevel: "destructive", argumentNames: ["item"] },
      { name: "edit", displayName: "1Password Item Edit", description: "Edit a 1Password item.", prefersJsonOutput: true, supportsStdin: true, argumentNames: ["item"] },
      { name: "get", displayName: "1Password Item Get", description: "Get a 1Password item.", prefersJsonOutput: true, argumentNames: ["item"] },
      { name: "list", displayName: "1Password Item List", description: "List 1Password items.", prefersJsonOutput: true },
      { name: "share", displayName: "1Password Item Share", description: "Create or manage a share link for a 1Password item.", prefersJsonOutput: false, argumentNames: ["item"] },
    ],
  }),
  ...buildTopLevelTools({
    baseGroup: "serviceAccounts",
    baseCommand: ["service-account"],
    prefix: "service_account",
    singular: "Service Account",
    tools: [
      { name: "create", displayName: "1Password Service Account Create", description: "Create a 1Password service account.", prefersJsonOutput: false },
      { name: "ratelimit", displayName: "1Password Service Account Rate Limit", description: "Get rate limit usage for a 1Password service account.", prefersJsonOutput: false, argumentNames: ["service-account"] },
    ],
  }),
  ...buildTopLevelTools({
    baseGroup: "users",
    baseCommand: ["user"],
    prefix: "user",
    singular: "User",
    tools: [
      { name: "confirm", displayName: "1Password User Confirm", description: "Confirm a 1Password user.", prefersJsonOutput: false, argumentNames: ["user"] },
      { name: "delete", displayName: "1Password User Delete", description: "Delete a 1Password user and all their data.", prefersJsonOutput: false, dangerLevel: "destructive", argumentNames: ["user"] },
      { name: "edit", displayName: "1Password User Edit", description: "Edit a 1Password user.", prefersJsonOutput: true, argumentNames: ["user"] },
      { name: "get", displayName: "1Password User Get", description: "Get one 1Password user.", prefersJsonOutput: true, argumentNames: ["user"] },
      { name: "list", displayName: "1Password User List", description: "List 1Password users.", prefersJsonOutput: true },
      { name: "provision", displayName: "1Password User Provision", description: "Provision a 1Password user.", prefersJsonOutput: true },
      { name: "reactivate", displayName: "1Password User Reactivate", description: "Reactivate a suspended 1Password user.", prefersJsonOutput: false, argumentNames: ["user"] },
      { name: "suspend", displayName: "1Password User Suspend", description: "Suspend a 1Password user.", prefersJsonOutput: false, dangerLevel: "destructive", argumentNames: ["user"] },
    ],
  }),
  defineTool({
    id: "op.user.recovery.begin",
    operation: "user.recovery.begin",
    displayName: "1Password User Recovery Begin",
    description: "Begin user recovery for one or more 1Password users.",
    command: ["user", "recovery", "begin"],
    group: "users",
    argumentNames: ["user", "additional-users"],
    minArguments: 1,
    examples: [
      example(
        "Begin recovery for one user",
        {
          arguments: ["alice@example.com"],
        },
      ),
    ],
  }),
  ...buildTopLevelTools({
    baseGroup: "vaults",
    baseCommand: ["vault"],
    prefix: "vault",
    singular: "Vault",
    tools: [
      { name: "create", displayName: "1Password Vault Create", description: "Create a 1Password vault.", prefersJsonOutput: true },
      { name: "delete", displayName: "1Password Vault Delete", description: "Delete a 1Password vault.", prefersJsonOutput: false, dangerLevel: "destructive", argumentNames: ["vault"] },
      { name: "edit", displayName: "1Password Vault Edit", description: "Edit a 1Password vault.", prefersJsonOutput: true, argumentNames: ["vault"] },
      { name: "get", displayName: "1Password Vault Get", description: "Get one 1Password vault.", prefersJsonOutput: true, argumentNames: ["vault"] },
      { name: "list", displayName: "1Password Vault List", description: "List 1Password vaults.", prefersJsonOutput: true },
    ],
  }),
  ...buildNestedTools({
    baseGroup: "vaults",
    prefix: "vault.group",
    commandPrefix: ["vault", "group"],
    tools: [
      { name: "grant", displayName: "1Password Vault Group Grant", description: "Grant a group access to a 1Password vault.", argumentNames: ["vault", "group"] },
      { name: "list", displayName: "1Password Vault Group List", description: "List groups with access to a 1Password vault.", prefersJsonOutput: true, argumentNames: ["vault"] },
      { name: "revoke", displayName: "1Password Vault Group Revoke", description: "Revoke a group's access to a 1Password vault.", argumentNames: ["vault", "group"], dangerLevel: "destructive" },
    ],
  }),
  ...buildNestedTools({
    baseGroup: "vaults",
    prefix: "vault.user",
    commandPrefix: ["vault", "user"],
    tools: [
      { name: "grant", displayName: "1Password Vault User Grant", description: "Grant a user access to a 1Password vault.", argumentNames: ["vault", "user"] },
      { name: "list", displayName: "1Password Vault User List", description: "List users with access to a 1Password vault.", prefersJsonOutput: true, argumentNames: ["vault"] },
      { name: "revoke", displayName: "1Password Vault User Revoke", description: "Revoke a user's access to a 1Password vault.", argumentNames: ["vault", "user"], dangerLevel: "destructive" },
    ],
  }),
  ...buildNestedTools({
    baseGroup: "connect",
    prefix: "connect.group",
    commandPrefix: ["connect", "group"],
    tools: [
      { name: "grant", displayName: "1Password Connect Group Grant", description: "Grant a group access to manage Secrets Automation." },
      { name: "revoke", displayName: "1Password Connect Group Revoke", description: "Revoke a group's access to manage Secrets Automation.", dangerLevel: "destructive" },
    ],
  }),
  ...buildNestedTools({
    baseGroup: "connect",
    prefix: "connect.server",
    commandPrefix: ["connect", "server"],
    tools: [
      { name: "create", displayName: "1Password Connect Server Create", description: "Create a 1Password Connect server and credentials file.", prefersJsonOutput: false },
      { name: "delete", displayName: "1Password Connect Server Delete", description: "Delete a 1Password Connect server.", prefersJsonOutput: false, dangerLevel: "destructive", argumentNames: ["server"] },
      { name: "edit", displayName: "1Password Connect Server Edit", description: "Rename a 1Password Connect server.", prefersJsonOutput: false, argumentNames: ["server"] },
      { name: "get", displayName: "1Password Connect Server Get", description: "Get one 1Password Connect server.", prefersJsonOutput: true, argumentNames: ["server"] },
      { name: "list", displayName: "1Password Connect Server List", description: "List 1Password Connect servers.", prefersJsonOutput: true },
    ],
  }),
  ...buildNestedTools({
    baseGroup: "connect",
    prefix: "connect.token",
    commandPrefix: ["connect", "token"],
    tools: [
      { name: "create", displayName: "1Password Connect Token Create", description: "Issue a token for a 1Password Connect server.", prefersJsonOutput: false },
      { name: "delete", displayName: "1Password Connect Token Delete", description: "Delete a 1Password Connect server token.", prefersJsonOutput: false, dangerLevel: "destructive", argumentNames: ["token"] },
      { name: "edit", displayName: "1Password Connect Token Edit", description: "Rename a 1Password Connect server token.", prefersJsonOutput: false, argumentNames: ["token"] },
      { name: "list", displayName: "1Password Connect Token List", description: "List 1Password Connect tokens.", prefersJsonOutput: true },
    ],
  }),
  ...buildNestedTools({
    baseGroup: "connect",
    prefix: "connect.vault",
    commandPrefix: ["connect", "vault"],
    tools: [
      { name: "grant", displayName: "1Password Connect Vault Grant", description: "Grant a Connect server access to a 1Password vault.", argumentNames: ["server", "vault"] },
      { name: "revoke", displayName: "1Password Connect Vault Revoke", description: "Revoke a Connect server's access to a 1Password vault.", argumentNames: ["server", "vault"], dangerLevel: "destructive" },
    ],
  }),
];

export function getOpToolDefinitionByOperation(operation) {
  const normalized = typeof operation === "string" ? operation.trim() : "";
  return OP_TOOL_DEFINITIONS.find((tool) => tool.operation === normalized) ?? null;
}

export function resolveDefaultSpacesOpWrapperPath() {
  return resolve(SCRIPT_DIR, "spaces-op.mjs");
}

export function buildOpCliManifest(tool, input = {}) {
  const wrapperPath = resolveRequiredAbsolutePath(
    input.wrapperPath ?? resolveDefaultSpacesOpWrapperPath(),
    "wrapperPath",
  );
  const fixedCwd = resolveRequiredAbsolutePath(input.fixedCwd ?? dirname(wrapperPath), "fixedCwd");
  const now = input.now ?? new Date().toISOString();
  const enabled = input.enabled ?? true;
  return {
    schemaVersion: OP_CLI_TOOL_SCHEMA_VERSION,
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
    argsTemplate: ["--op", tool.operation, "--payload", "{{payload}}"],
    inputSchema: wrapPayloadSchema(tool.payloadSchema),
    instructions: tool.instructions,
    examples: tool.examples,
    timeoutMs: tool.timeoutMs,
    maxOutputBytes: tool.maxOutputBytes,
    cwdMode: "fixed",
    fixedCwd,
    outputMode: "json",
    dangerLevel: tool.dangerLevel,
    enabled,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildOpCliToolReadme(tool) {
  const payloadProperties = tool.payloadSchema.properties ?? {};
  const required = new Set(tool.payloadSchema.required ?? []);
  const payloadLines = Object.entries(payloadProperties).map(([name, schema]) => {
    const description = typeof schema.description === "string" ? schema.description : "See the manifest schema.";
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
    `- Wrapper operation: \`${tool.operation}\``,
    `- 1Password CLI mapping: \`${tool.commandHint}\``,
    "",
    "## Host 1Password Configuration",
    "- Install 1Password CLI on the external gateway host and verify it works outside Spaces.",
    "- Authenticate the host once with the 1Password desktop app integration, a manual account, or a service account before starting the gateway.",
    "- Keep any required `OP_ACCOUNT`, `OP_SESSION`, or service-account environment configuration available to the gateway host user.",
    "",
    "## Payload",
    ...(payloadLines.length > 0 ? payloadLines : ["- This tool does not require any payload fields."]),
    "",
    "## Example Payloads",
    "```json",
    JSON.stringify(tool.examples.map((exampleRecord) => exampleRecord.arguments), null, 2),
    "```",
    "",
    "## Output Contract",
    "- The wrapper always emits JSON.",
    "- Success shape: `{ ok, operation, summary, data?, refs? }`.",
    "- Tools that support `--format json` return parsed 1Password JSON in `data`.",
    "- Secret reads and text-oriented commands return normalized text data in `data.text`.",
    "",
    "## Approval Guidance",
    "- Keep explicit human approval enabled for every 1Password tool.",
    "- Treat revoke/delete/forget/suspend operations with extra care.",
    "- Secret-returning tools stay approval-gated and should only be used when the destination and purpose are clear.",
    "",
  ].join("\n");
}

function buildTopLevelTools(input) {
  return input.tools.map((tool) => defineTool({
    id: `op.${input.prefix}.${normalizeName(tool.name)}`,
    operation: `${input.prefix}.${normalizeName(tool.name)}`,
    displayName: tool.displayName,
    description: tool.description,
    command: [...input.baseCommand, tool.name],
    group: input.baseGroup,
    prefersJsonOutput: tool.prefersJsonOutput ?? false,
    dangerLevel: tool.dangerLevel ?? "standard",
    argumentNames: tool.argumentNames ?? [],
    minArguments: Array.isArray(tool.argumentNames) ? tool.argumentNames.length : 0,
    supportsStdin: tool.supportsStdin ?? false,
    examples: [
      example(
        tool.displayName,
        opExamplePayload(input.prefix, tool.name, tool.argumentNames ?? []),
      ),
    ],
  }));
}

function buildNestedTools(input) {
  return input.tools.map((tool) => defineTool({
    id: `op.${input.prefix}.${normalizeName(tool.name)}`,
    operation: `${input.prefix}.${normalizeName(tool.name)}`,
    displayName: tool.displayName,
    description: tool.description,
    command: [...input.commandPrefix, tool.name],
    group: input.baseGroup,
    prefersJsonOutput: tool.prefersJsonOutput ?? false,
    dangerLevel: tool.dangerLevel ?? "standard",
    argumentNames: tool.argumentNames ?? [],
    minArguments: Array.isArray(tool.argumentNames) ? tool.argumentNames.length : 0,
    supportsStdin: tool.supportsStdin ?? false,
    examples: [
      example(
        tool.displayName,
        opExamplePayload(input.prefix, tool.name, tool.argumentNames ?? []),
      ),
    ],
  }));
}

function opExamplePayload(prefix, name, argumentNames) {
  const argumentsPayload = argumentNames.map((argumentName) => exampleValueForArgument(argumentName));
  const base = argumentsPayload.length > 0 ? { arguments: argumentsPayload } : {};
  if (prefix === "item" && (name === "create" || name === "edit")) {
    return {
      ...base,
      arguments: name === "create"
        ? ["Login", "title=Spaces Gateway", "username=operator@example.com"]
        : [argumentsPayload[0] ?? "Item", "title=Updated Title"],
    };
  }
  if (prefix === "document" && (name === "create" || name === "edit")) {
    return {
      ...base,
      stdin: "example-document-payload",
      flags: {
        file_name: "bundle.txt",
      },
    };
  }
  if (prefix === "account" && name === "add") {
    return {
      flags: {
        address: "my.1password.com",
        email: "operator@example.com",
        secret_key: "A3-EXAMPLE-SECRET-KEY",
      },
    };
  }
  if (prefix === "read") {
    return {
      arguments: ["op://Engineering/db/password"],
    };
  }
  return base;
}

function exampleValueForArgument(name) {
  switch (name) {
    case "account":
      return "my.1password.com";
    case "group":
      return "Developers";
    case "user":
      return "alice@example.com";
    case "vault":
      return "Engineering";
    case "item":
      return "Database Credentials";
    case "document":
      return "Design Spec";
    case "server":
      return "Spaces Connect";
    case "token":
      return "Spaces Connect Token";
    case "service-account":
      return "spaces-prod";
    case "secret-reference":
      return "op://Engineering/db/password";
    default:
      return name;
  }
}

function defineTool(input) {
  const groupMetadata = OP_GROUP_METADATA[input.group];
  const argumentNames = Array.isArray(input.argumentNames) ? input.argumentNames : [];
  const minArguments = typeof input.minArguments === "number" ? input.minArguments : 0;
  return {
    id: input.id,
    operation: input.operation,
    displayName: input.displayName,
    description: input.description,
    command: [...input.command],
    bundleId: OP_BUNDLE_METADATA.bundleId,
    bundleDisplayName: OP_BUNDLE_METADATA.bundleDisplayName,
    bundleDescription: OP_BUNDLE_METADATA.bundleDescription,
    toolGroupId: groupMetadata?.toolGroupId,
    toolGroupDisplayName: groupMetadata?.toolGroupDisplayName,
    commandHint: buildCommandHint(["op", ...input.command], argumentNames, minArguments),
    instructions: input.instructions
      ?? "Use this tool only after the gateway host is already authenticated to 1Password.",
    payloadSchema: genericPayloadSchema(argumentNames, {
      minArguments,
      supportsStdin: input.supportsStdin ?? false,
    }),
    examples: input.examples ?? [example(input.displayName, {})],
    dangerLevel: input.dangerLevel ?? "standard",
    timeoutMs: input.timeoutMs ?? OP_CLI_DEFAULT_TIMEOUT_MS,
    maxOutputBytes: input.maxOutputBytes ?? (input.prefersJsonOutput ? OP_CLI_LARGE_OUTPUT_BYTES : OP_CLI_MEDIUM_OUTPUT_BYTES),
    prefersJsonOutput: input.prefersJsonOutput ?? false,
    minArguments,
    argumentNames,
  };
}

function normalizeName(value) {
  return value.replace(/-/g, "_");
}

function buildCommandHint(command, argumentNames, minArguments) {
  const parts = [...command];
  for (let index = 0; index < argumentNames.length; index += 1) {
    const name = argumentNames[index];
    const required = index < minArguments;
    parts.push(required ? `<${name}>` : `[${name}]`);
  }
  return parts.join(" ");
}

function wrapPayloadSchema(payloadSchema) {
  return {
    type: "object",
    properties: {
      payload: payloadSchema,
    },
    additionalProperties: false,
  };
}

function genericPayloadSchema(argumentNames, options = {}) {
  const minArguments = typeof options.minArguments === "number" ? options.minArguments : 0;
  const properties = {
    arguments: {
      type: "array",
      description: argumentNames.length > 0
        ? `Ordered positional arguments after the subcommand: ${argumentNames.join(", ")}.`
        : "Optional extra positional arguments to append after the subcommand.",
      items: {
        type: "string",
      },
      ...(minArguments > 0 ? { minItems: minArguments } : {}),
    },
    flags: flagsObjectProperty(
      "Optional 1Password flags. Use raw CLI flag keys such as `vault`, `account`, `expires-in`, or `out-file`.",
    ),
    presentFlags: {
      type: "array",
      description: "Optional flag names that should be rendered without values, for example `archive`.",
      items: {
        type: "string",
      },
    },
    ...(options.supportsStdin === true
      ? {
        stdin: stringProperty("Optional stdin payload forwarded to the 1Password CLI command."),
      }
      : {}),
  };
  return objectPayloadSchema(properties, {
    required: minArguments > 0 ? ["arguments"] : [],
  });
}

function example(name, payload) {
  return {
    name,
    arguments: { payload },
  };
}

function objectPayloadSchema(properties, options = {}) {
  return {
    type: "object",
    properties,
    additionalProperties: false,
    ...(Array.isArray(options.required) && options.required.length > 0
      ? { required: options.required }
      : {}),
  };
}

function flagsObjectProperty(description) {
  const scalarSchema = {
    anyOf: [
      { type: "string" },
      { type: "number" },
      { type: "integer" },
      { type: "boolean" },
    ],
  };
  return {
    type: "object",
    description,
    additionalProperties: {
      anyOf: [
        scalarSchema,
        {
          type: "array",
          items: scalarSchema,
        },
      ],
    },
  };
}

function stringProperty(description) {
  return {
    type: "string",
    description,
  };
}

function resolveRequiredAbsolutePath(value, field) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error(`${field} is required.`);
  }
  return resolve(normalized);
}
