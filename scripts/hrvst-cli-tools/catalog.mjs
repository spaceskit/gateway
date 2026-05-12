import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SPACES_HRVST_WRAPPER_VERSION = "0.1.0";
export const HRVST_CLI_TOOL_SCHEMA_VERSION = 1;
export const HRVST_CLI_DEFAULT_TIMEOUT_MS = 45_000;
export const HRVST_CLI_SMALL_OUTPUT_BYTES = 64 * 1024;
export const HRVST_CLI_MEDIUM_OUTPUT_BYTES = 128 * 1024;
export const HRVST_CLI_LARGE_OUTPUT_BYTES = 256 * 1024;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const HRVST_BUNDLE_METADATA = {
  bundleId: "hrvst-cli",
  bundleDisplayName: "Harvest CLI",
  bundleDescription: "Gateway-managed Harvest CLI bundle for account, client, project, report, time-entry, and user operations.",
};

const HRVST_GROUP_METADATA = {
  alias: {
    toolGroupId: "alias",
    toolGroupDisplayName: "Aliases",
  },
  clients: {
    toolGroupId: "clients",
    toolGroupDisplayName: "Clients",
  },
  company: {
    toolGroupId: "company",
    toolGroupDisplayName: "Company",
  },
  estimates: {
    toolGroupId: "estimates",
    toolGroupDisplayName: "Estimates",
  },
  expenses: {
    toolGroupId: "expenses",
    toolGroupDisplayName: "Expenses",
  },
  invoices: {
    toolGroupId: "invoices",
    toolGroupDisplayName: "Invoices",
  },
  projects: {
    toolGroupId: "projects",
    toolGroupDisplayName: "Projects",
  },
  reports: {
    toolGroupId: "reports",
    toolGroupDisplayName: "Reports",
  },
  roles: {
    toolGroupId: "roles",
    toolGroupDisplayName: "Roles",
  },
  tasks: {
    toolGroupId: "tasks",
    toolGroupDisplayName: "Tasks",
  },
  timeEntries: {
    toolGroupId: "time-entries",
    toolGroupDisplayName: "Time Entries",
  },
  timeTracking: {
    toolGroupId: "time-tracking",
    toolGroupDisplayName: "Time Tracking",
  },
  users: {
    toolGroupId: "users",
    toolGroupDisplayName: "Users",
  },
};

const CRUD_FAMILIES = [
  {
    family: "clients",
    singular: "Client",
    plural: "clients",
    command: ["clients"],
    group: "clients",
  },
  {
    family: "estimates",
    singular: "Estimate",
    plural: "estimates",
    command: ["estimates"],
    group: "estimates",
  },
  {
    family: "expenses",
    singular: "Expense",
    plural: "expenses",
    command: ["expenses"],
    group: "expenses",
  },
  {
    family: "invoices",
    singular: "Invoice",
    plural: "invoices",
    command: ["invoices"],
    group: "invoices",
  },
  {
    family: "projects",
    singular: "Project",
    plural: "projects",
    command: ["projects"],
    group: "projects",
  },
  {
    family: "roles",
    singular: "Role",
    plural: "roles",
    command: ["roles"],
    group: "roles",
  },
  {
    family: "tasks",
    singular: "Task",
    plural: "tasks",
    command: ["tasks"],
    group: "tasks",
  },
  {
    family: "users",
    singular: "User",
    plural: "users",
    command: ["users"],
    group: "users",
  },
];

const REPORT_TOOLS = [
  reportTool({
    id: "hrvst.reports.uninvoiced_report",
    operation: "reports.uninvoiced_report",
    displayName: "Harvest Uninvoiced Report",
    description: "Return the Harvest uninvoiced report for a time window.",
    command: ["reports", "uninvoiced-report"],
  }),
  reportTool({
    id: "hrvst.reports.project_budget_report",
    operation: "reports.project_budget_report",
    displayName: "Harvest Project Budget Report",
    description: "Return the Harvest project budget report.",
    command: ["reports", "project-budget-report"],
  }),
  reportTool({
    id: "hrvst.reports.expense.clients",
    operation: "reports.expense.clients",
    displayName: "Harvest Clients Expense Report",
    description: "Return the Harvest clients expense report for a time window.",
    command: ["reports", "expense-reports", "clients-expense-report"],
  }),
  reportTool({
    id: "hrvst.reports.expense.projects",
    operation: "reports.expense.projects",
    displayName: "Harvest Projects Expense Report",
    description: "Return the Harvest projects expense report for a time window.",
    command: ["reports", "expense-reports", "projects-expense-report"],
  }),
  reportTool({
    id: "hrvst.reports.expense.categories",
    operation: "reports.expense.categories",
    displayName: "Harvest Expense Categories Report",
    description: "Return the Harvest expense categories report for a time window.",
    command: ["reports", "expense-reports", "categories-report"],
  }),
  reportTool({
    id: "hrvst.reports.expense.team",
    operation: "reports.expense.team",
    displayName: "Harvest Team Expense Report",
    description: "Return the Harvest team expense report for a time window.",
    command: ["reports", "expense-reports", "team-expense-report"],
  }),
  reportTool({
    id: "hrvst.reports.time.clients",
    operation: "reports.time.clients",
    displayName: "Harvest Clients Time Report",
    description: "Return the Harvest clients time report for a time window.",
    command: ["reports", "time-reports", "clients-time-report"],
  }),
  reportTool({
    id: "hrvst.reports.time.projects",
    operation: "reports.time.projects",
    displayName: "Harvest Projects Time Report",
    description: "Return the Harvest projects time report for a time window.",
    command: ["reports", "time-reports", "projects-time-report"],
  }),
  reportTool({
    id: "hrvst.reports.time.tasks",
    operation: "reports.time.tasks",
    displayName: "Harvest Tasks Time Report",
    description: "Return the Harvest tasks time report for a time window.",
    command: ["reports", "time-reports", "tasks-time-report"],
  }),
  reportTool({
    id: "hrvst.reports.time.team",
    operation: "reports.time.team",
    displayName: "Harvest Team Time Report",
    description: "Return the Harvest team time report for a time window.",
    command: ["reports", "time-reports", "team-time-report"],
  }),
];

const TIME_ENTRY_TOOLS = [
  defineTool({
    id: "hrvst.time_entries.list",
    operation: "time_entries.list",
    displayName: "Harvest Time Entry List",
    description: "List Harvest time entries.",
    command: ["time-entries", "list"],
    group: "timeEntries",
    supportsJsonOutput: true,
    maxOutputBytes: HRVST_CLI_LARGE_OUTPUT_BYTES,
    examples: [
      example(
        "List running time entries",
        {
          flags: {
            is_running: "true",
            per_page: "50",
          },
        },
      ),
    ],
  }),
  defineTool({
    id: "hrvst.time_entries.get",
    operation: "time_entries.get",
    displayName: "Harvest Time Entry Get",
    description: "Get one Harvest time entry.",
    command: ["time-entries", "get"],
    group: "timeEntries",
    supportsJsonOutput: true,
    examples: [
      example(
        "Get one time entry",
        {
          flags: {
            time_entry_id: "12345",
          },
        },
      ),
    ],
  }),
  defineTool({
    id: "hrvst.time_entries.create",
    operation: "time_entries.create",
    displayName: "Harvest Time Entry Create",
    description: "Create a Harvest time entry using either duration fields or start/end timestamp fields.",
    command: ["time-entries", "create"],
    group: "timeEntries",
    supportsJsonOutput: true,
    maxOutputBytes: HRVST_CLI_MEDIUM_OUTPUT_BYTES,
    examples: [
      example(
        "Create a duration-based time entry",
        {
          flags: {
            project_id: "2001",
            task_id: "3001",
            spent_date: "2026-03-21",
            hours: "2.5",
            notes: "CLI bundle implementation",
          },
        },
      ),
      example(
        "Create a start/end time entry",
        {
          flags: {
            project_id: "2001",
            task_id: "3001",
            spent_date: "2026-03-21",
            started_time: "9:00am",
            ended_time: "11:30am",
          },
        },
      ),
    ],
  }),
  defineTool({
    id: "hrvst.time_entries.restart",
    operation: "time_entries.restart",
    displayName: "Harvest Time Entry Restart",
    description: "Restart a stopped Harvest time entry.",
    command: ["time-entries", "restart"],
    group: "timeEntries",
    supportsJsonOutput: true,
    examples: [
      example(
        "Restart a stopped time entry",
        {
          flags: {
            time_entry_id: "12345",
          },
        },
      ),
    ],
  }),
  defineTool({
    id: "hrvst.time_entries.stop",
    operation: "time_entries.stop",
    displayName: "Harvest Time Entry Stop",
    description: "Stop a running Harvest time entry.",
    command: ["time-entries", "stop"],
    group: "timeEntries",
    supportsJsonOutput: true,
    examples: [
      example(
        "Stop a running time entry",
        {
          flags: {
            time_entry_id: "12345",
          },
        },
      ),
    ],
  }),
  defineTool({
    id: "hrvst.time_entries.update",
    operation: "time_entries.update",
    displayName: "Harvest Time Entry Update",
    description: "Update a Harvest time entry.",
    command: ["time-entries", "update"],
    group: "timeEntries",
    supportsJsonOutput: true,
    maxOutputBytes: HRVST_CLI_MEDIUM_OUTPUT_BYTES,
    examples: [
      example(
        "Update time entry notes",
        {
          flags: {
            time_entry_id: "12345",
            notes: "Updated from Spaces",
          },
        },
      ),
    ],
  }),
  defineTool({
    id: "hrvst.time_entries.delete",
    operation: "time_entries.delete",
    displayName: "Harvest Time Entry Delete",
    description: "Delete a Harvest time entry.",
    command: ["time-entries", "delete"],
    group: "timeEntries",
    supportsJsonOutput: true,
    dangerLevel: "destructive",
    examples: [
      example(
        "Delete a time entry",
        {
          flags: {
            time_entry_id: "12345",
          },
        },
      ),
    ],
  }),
  defineTool({
    id: "hrvst.time_entries.delete_external_reference",
    operation: "time_entries.delete_external_reference",
    displayName: "Harvest Time Entry Delete External Reference",
    description: "Delete the external reference on a Harvest time entry.",
    command: ["time-entries", "delete-external-reference"],
    group: "timeEntries",
    supportsJsonOutput: true,
    dangerLevel: "destructive",
    examples: [
      example(
        "Delete a time entry external reference",
        {
          flags: {
            time_entry_id: "12345",
          },
        },
      ),
    ],
  }),
];

const TIME_TRACKING_TOOLS = [
  defineTool({
    id: "hrvst.time_tracking.log",
    operation: "time_tracking.log",
    displayName: "Harvest Log Time",
    description: "Log Harvest time for a project/task selection.",
    command: ["log"],
    group: "timeTracking",
    supportsJsonOutput: false,
    argumentNames: ["hours", "alias"],
    minArguments: 1,
    maxArguments: 2,
    examples: [
      example(
        "Log time with direct ids",
        {
          arguments: ["2.5"],
          flags: {
            project_id: "2001",
            task_id: "3001",
            notes: "Release work",
          },
        },
      ),
    ],
  }),
  defineTool({
    id: "hrvst.time_tracking.start",
    operation: "time_tracking.start",
    displayName: "Harvest Start Timer",
    description: "Start a Harvest timer for a project/task selection.",
    command: ["start"],
    group: "timeTracking",
    supportsJsonOutput: false,
    argumentNames: ["alias"],
    minArguments: 0,
    maxArguments: 1,
    examples: [
      example(
        "Start a timer with direct ids",
        {
          flags: {
            project_id: "2001",
            task_id: "3001",
            notes: "Investigating bundle auth",
          },
        },
      ),
    ],
  }),
  defineTool({
    id: "hrvst.time_tracking.note",
    operation: "time_tracking.note",
    displayName: "Harvest Timer Note",
    description: "Append or overwrite notes on the current Harvest timer.",
    command: ["note"],
    group: "timeTracking",
    supportsJsonOutput: false,
    examples: [
      example(
        "Overwrite timer notes",
        {
          flags: {
            notes: "Handed off to QA",
          },
          presentFlags: ["overwrite"],
        },
      ),
    ],
  }),
  defineTool({
    id: "hrvst.time_tracking.stop",
    operation: "time_tracking.stop",
    displayName: "Harvest Stop Timer",
    description: "Stop the current Harvest timer.",
    command: ["stop"],
    group: "timeTracking",
    supportsJsonOutput: false,
    examples: [
      example(
        "Stop the current timer",
        {
          flags: {
            notes: "Stopped from Spaces",
          },
        },
      ),
    ],
  }),
];

export const HRVST_TOOL_DEFINITIONS = [
  defineTool({
    id: "hrvst.alias.list",
    operation: "alias.list",
    displayName: "Harvest Alias List",
    description: "List Harvest aliases for quick time tracking.",
    command: ["alias", "list"],
    group: "alias",
    supportsJsonOutput: false,
    maxOutputBytes: HRVST_CLI_MEDIUM_OUTPUT_BYTES,
    examples: [
      example("List aliases", {}),
    ],
  }),
  defineTool({
    id: "hrvst.alias.create",
    operation: "alias.create",
    displayName: "Harvest Alias Create",
    description: "Create a Harvest alias for a project and task assignment.",
    command: ["alias", "create"],
    group: "alias",
    supportsJsonOutput: false,
    argumentNames: ["alias"],
    minArguments: 1,
    maxArguments: 1,
    examples: [
      example(
        "Create an alias",
        {
          arguments: ["ops-bundle"],
        },
      ),
    ],
  }),
  defineTool({
    id: "hrvst.alias.delete",
    operation: "alias.delete",
    displayName: "Harvest Alias Delete",
    description: "Delete a Harvest alias.",
    command: ["alias", "delete"],
    group: "alias",
    supportsJsonOutput: false,
    dangerLevel: "destructive",
    argumentNames: ["alias"],
    minArguments: 1,
    maxArguments: 1,
    examples: [
      example(
        "Delete an alias",
        {
          arguments: ["ops-bundle"],
        },
      ),
    ],
  }),
  ...buildCrudTools(),
  defineTool({
    id: "hrvst.company.get",
    operation: "company.get",
    displayName: "Harvest Company Get",
    description: "Get the Harvest company for the authenticated user.",
    command: ["company", "get"],
    group: "company",
    supportsJsonOutput: true,
    maxOutputBytes: HRVST_CLI_MEDIUM_OUTPUT_BYTES,
    examples: [
      example("Get company details", {}),
    ],
  }),
  ...REPORT_TOOLS,
  ...TIME_ENTRY_TOOLS,
  ...TIME_TRACKING_TOOLS,
  defineTool({
    id: "hrvst.users.me",
    operation: "users.me",
    displayName: "Harvest User Me",
    description: "Get the currently authenticated Harvest user.",
    command: ["users", "me"],
    group: "users",
    supportsJsonOutput: true,
    examples: [
      example("Get the current Harvest user", {}),
    ],
  }),
];

export function getHarvestToolDefinitionByOperation(operation) {
  const normalized = typeof operation === "string" ? operation.trim() : "";
  return HRVST_TOOL_DEFINITIONS.find((tool) => tool.operation === normalized) ?? null;
}

export function resolveDefaultSpacesHrvstWrapperPath() {
  return resolve(SCRIPT_DIR, "spaces-hrvst.mjs");
}

export function buildHrvstCliManifest(tool, input = {}) {
  const wrapperPath = resolveRequiredAbsolutePath(
    input.wrapperPath ?? resolveDefaultSpacesHrvstWrapperPath(),
    "wrapperPath",
  );
  const fixedCwd = resolveRequiredAbsolutePath(input.fixedCwd ?? dirname(wrapperPath), "fixedCwd");
  const now = input.now ?? new Date().toISOString();
  const enabled = input.enabled ?? true;
  const existingManifest =
    input.existingManifest && typeof input.existingManifest === "object" ? input.existingManifest : null;
  const existingCreatedAt =
    existingManifest && typeof existingManifest.createdAt === "string" && existingManifest.createdAt
      ? existingManifest.createdAt
      : null;
  const existingUpdatedAt =
    existingManifest && typeof existingManifest.updatedAt === "string" && existingManifest.updatedAt
      ? existingManifest.updatedAt
      : null;
  const createdAt = existingCreatedAt ?? now;

  const candidate = {
    schemaVersion: HRVST_CLI_TOOL_SCHEMA_VERSION,
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
    createdAt,
    updatedAt: now,
  };

  if (existingUpdatedAt !== null) {
    const candidateForCompare = canonicalizeForCompare(candidate);
    const existingForCompare = canonicalizeForCompare(existingManifest);
    if (candidateForCompare === existingForCompare) {
      candidate.updatedAt = existingUpdatedAt;
    }
  }

  return candidate;
}

function canonicalizeForCompare(value) {
  return JSON.stringify(deepSortKeys({ ...value, updatedAt: "" }));
}

function deepSortKeys(value) {
  if (Array.isArray(value)) return value.map(deepSortKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = deepSortKeys(value[k]);
    return out;
  }
  return value;
}

export function buildHrvstCliToolReadme(tool) {
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
    `- Harvest CLI mapping: \`${tool.commandHint}\``,
    "",
    "## Host Harvest Configuration",
    "- Install `hrvst-cli` on the external gateway host and verify it works outside Spaces.",
    "- Authenticate the host once with `hrvst login` before starting the gateway.",
    "- Keep any required Harvest OAuth/session state available to the gateway host user.",
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
    "- Tools that support `--output json` return parsed Harvest JSON in `data`.",
    "- Text-oriented commands return normalized text data in `data.text`.",
    "",
    "## Approval Guidance",
    "- Keep explicit human approval enabled for every Harvest tool.",
    "- Treat delete-style tools with extra care because they can remove Harvest data.",
    "",
  ].join("\n");
}

function buildCrudTools() {
  return CRUD_FAMILIES.flatMap((family) => [
    defineTool({
      id: `hrvst.${family.family}.list`,
      operation: `${family.family}.list`,
      displayName: `Harvest ${family.singular} List`,
      description: `List Harvest ${family.plural}.`,
      command: [...family.command, "list"],
      group: family.group,
      supportsJsonOutput: true,
      maxOutputBytes: HRVST_CLI_LARGE_OUTPUT_BYTES,
      examples: [
        example(
          `List ${family.plural}`,
          {
            flags: {
              page: "all",
            },
          },
        ),
      ],
    }),
    defineTool({
      id: `hrvst.${family.family}.get`,
      operation: `${family.family}.get`,
      displayName: `Harvest ${family.singular} Get`,
      description: `Get one Harvest ${family.singular.toLowerCase()}.`,
      command: [...family.command, "get"],
      group: family.group,
      supportsJsonOutput: true,
      maxOutputBytes: HRVST_CLI_MEDIUM_OUTPUT_BYTES,
      examples: [
        example(
          `Get one ${family.singular.toLowerCase()}`,
          {
            flags: {
              [`${singularToFlag(family.singular)}_id`]: "12345",
            },
          },
        ),
      ],
    }),
    defineTool({
      id: `hrvst.${family.family}.create`,
      operation: `${family.family}.create`,
      displayName: `Harvest ${family.singular} Create`,
      description: `Create a Harvest ${family.singular.toLowerCase()}.`,
      command: [...family.command, "create"],
      group: family.group,
      supportsJsonOutput: true,
      maxOutputBytes: HRVST_CLI_MEDIUM_OUTPUT_BYTES,
      examples: [
        example(
          `Create a ${family.singular.toLowerCase()}`,
          familyCreateExample(family.family),
        ),
      ],
    }),
    defineTool({
      id: `hrvst.${family.family}.update`,
      operation: `${family.family}.update`,
      displayName: `Harvest ${family.singular} Update`,
      description: `Update a Harvest ${family.singular.toLowerCase()}.`,
      command: [...family.command, "update"],
      group: family.group,
      supportsJsonOutput: true,
      maxOutputBytes: HRVST_CLI_MEDIUM_OUTPUT_BYTES,
      examples: [
        example(
          `Update a ${family.singular.toLowerCase()}`,
          familyUpdateExample(family.family, family.singular),
        ),
      ],
    }),
    defineTool({
      id: `hrvst.${family.family}.delete`,
      operation: `${family.family}.delete`,
      displayName: `Harvest ${family.singular} Delete`,
      description: `Delete a Harvest ${family.singular.toLowerCase()}.`,
      command: [...family.command, "delete"],
      group: family.group,
      supportsJsonOutput: true,
      dangerLevel: "destructive",
      examples: [
        example(
          `Delete a ${family.singular.toLowerCase()}`,
          {
            flags: {
              [`${singularToFlag(family.singular)}_id`]: "12345",
            },
          },
        ),
      ],
    }),
  ]);
}

function reportTool(input) {
  return defineTool({
    ...input,
    group: "reports",
    supportsJsonOutput: true,
    maxOutputBytes: HRVST_CLI_LARGE_OUTPUT_BYTES,
    examples: [
      example(
        `Run ${input.displayName.toLowerCase()}`,
        {
          flags: {
            from: "2026-03-01",
            to: "2026-03-21",
            page: "all",
          },
        },
      ),
    ],
  });
}

function familyCreateExample(family) {
  switch (family) {
    case "clients":
      return {
        flags: {
          name: "Spaces Operator Team",
          is_active: "true",
        },
      };
    case "estimates":
      return {
        flags: {
          client_id: "2001",
          name: "Gateway CLI rollout",
        },
      };
    case "expenses":
      return {
        flags: {
          project_id: "2001",
          expense_category_id: "3001",
          spent_date: "2026-03-21",
          total_cost: "42.50",
        },
      };
    case "invoices":
      return {
        flags: {
          client_id: "2001",
          subject: "March implementation work",
        },
      };
    case "projects":
      return {
        flags: {
          client_id: "2001",
          name: "CLI bundle expansion",
          is_billable: "true",
          bill_by: "Project",
          budget_by: "project",
        },
      };
    case "roles":
      return {
        flags: {
          name: "Platform Engineer",
        },
      };
    case "tasks":
      return {
        flags: {
          name: "Gateway runtime hardening",
          billable_by_default: "true",
        },
      };
    case "users":
      return {
        flags: {
          first_name: "Alex",
          last_name: "Operator",
          email: "alex@example.com",
        },
      };
    default:
      return {};
  }
}

function familyUpdateExample(family, singular) {
  const idFlag = `${singularToFlag(singular)}_id`;
  switch (family) {
    case "clients":
      return {
        flags: {
          [idFlag]: "12345",
          name: "Updated client name",
        },
      };
    case "projects":
      return {
        flags: {
          [idFlag]: "12345",
          notes: "Updated from Spaces",
        },
      };
    case "users":
      return {
        flags: {
          [idFlag]: "12345",
          first_name: "Updated",
        },
      };
    default:
      return {
        flags: {
          [idFlag]: "12345",
        },
      };
  }
}

function singularToFlag(value) {
  return value.toLowerCase().replace(/\s+/g, "_");
}

function defineTool(input) {
  const groupMetadata = HRVST_GROUP_METADATA[input.group];
  const argumentNames = Array.isArray(input.argumentNames) ? input.argumentNames : [];
  const minArguments = typeof input.minArguments === "number" ? input.minArguments : 0;
  const maxArguments = typeof input.maxArguments === "number" ? input.maxArguments : argumentNames.length || undefined;
  return {
    id: input.id,
    operation: input.operation,
    displayName: input.displayName,
    description: input.description,
    command: [...input.command],
    bundleId: HRVST_BUNDLE_METADATA.bundleId,
    bundleDisplayName: HRVST_BUNDLE_METADATA.bundleDisplayName,
    bundleDescription: HRVST_BUNDLE_METADATA.bundleDescription,
    toolGroupId: groupMetadata?.toolGroupId,
    toolGroupDisplayName: groupMetadata?.toolGroupDisplayName,
    commandHint: buildCommandHint(["hrvst", ...input.command], argumentNames, minArguments),
    instructions: input.instructions
      ?? "Use this tool for Harvest CLI operations only after the gateway host is authenticated to Harvest.",
    payloadSchema: genericPayloadSchema(argumentNames, {
      minArguments,
      maxArguments,
      supportsStdin: input.supportsStdin ?? false,
    }),
    examples: input.examples ?? [example(`Run ${input.displayName.toLowerCase()}`, {})],
    dangerLevel: input.dangerLevel ?? "standard",
    timeoutMs: input.timeoutMs ?? HRVST_CLI_DEFAULT_TIMEOUT_MS,
    maxOutputBytes: input.maxOutputBytes ?? HRVST_CLI_MEDIUM_OUTPUT_BYTES,
    supportsJsonOutput: input.supportsJsonOutput ?? false,
    minArguments,
    maxArguments,
    argumentNames,
  };
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
  const maxArguments = typeof options.maxArguments === "number" ? options.maxArguments : undefined;
  const argumentDescription = argumentNames.length > 0
    ? `Ordered positional arguments after the subcommand: ${argumentNames.join(", ")}.`
    : "Optional extra positional arguments to append after the subcommand.";
  const properties = {
    arguments: {
      type: "array",
      description: argumentDescription,
      items: {
        type: "string",
      },
      ...(minArguments > 0 ? { minItems: minArguments } : {}),
      ...(typeof maxArguments === "number" ? { maxItems: maxArguments } : {}),
    },
    flags: flagsObjectProperty(
      "Optional Harvest flags. Use raw CLI flag keys such as `project_id`, `page`, or `external_reference[id]`.",
    ),
    presentFlags: {
      type: "array",
      description: "Optional flag names that should be rendered without values, for example `editor`.",
      items: {
        type: "string",
      },
    },
    ...(options.supportsStdin === true
      ? {
        stdin: stringProperty("Optional stdin payload forwarded to the Harvest CLI command."),
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
