import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SPACES_PEEKABOO_WRAPPER_VERSION = "0.1.0";
export const PEEKABOO_CLI_TOOL_SCHEMA_VERSION = 1;
export const PEEKABOO_CLI_DEFAULT_TIMEOUT_MS = 45_000;
export const PEEKABOO_CLI_SMALL_OUTPUT_BYTES = 64 * 1024;
export const PEEKABOO_CLI_MEDIUM_OUTPUT_BYTES = 128 * 1024;
export const PEEKABOO_CLI_LARGE_OUTPUT_BYTES = 512 * 1024;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const PEEKABOO_BUNDLE_METADATA = {
  bundleId: "peekaboo-cli",
  bundleDisplayName: "Peekaboo CLI",
  bundleDescription: "Gateway-managed Peekaboo CLI bundle for macOS screen capture, UI maps, and approval-gated desktop automation.",
};

const PEEKABOO_GROUP_METADATA = {
  permissions: {
    toolGroupId: "permissions",
    toolGroupDisplayName: "Permissions",
  },
  capture: {
    toolGroupId: "capture",
    toolGroupDisplayName: "Capture",
  },
  discovery: {
    toolGroupId: "discovery",
    toolGroupDisplayName: "Discovery",
  },
  actions: {
    toolGroupId: "actions",
    toolGroupDisplayName: "Actions",
  },
  windows: {
    toolGroupId: "windows",
    toolGroupDisplayName: "Windows",
  },
  apps: {
    toolGroupId: "apps",
    toolGroupDisplayName: "Apps",
  },
  menus: {
    toolGroupId: "menus",
    toolGroupDisplayName: "Menus",
  },
  dialogs: {
    toolGroupId: "dialogs",
    toolGroupDisplayName: "Dialogs",
  },
  spaces: {
    toolGroupId: "spaces",
    toolGroupDisplayName: "Spaces",
  },
  dock: {
    toolGroupId: "dock",
    toolGroupDisplayName: "Dock",
  },
};

export const PEEKABOO_TOOL_DEFINITIONS = [
  defineTool({
    id: "peekaboo.permissions.status",
    operation: "permissions.status",
    displayName: "Peekaboo Permissions Status",
    description: "Inspect Screen Recording, Accessibility, and event-synthesizing permissions for Peekaboo.",
    command: ["permissions", "status"],
    group: "permissions",
    maxOutputBytes: PEEKABOO_CLI_SMALL_OUTPUT_BYTES,
    examples: [example("Check Peekaboo permissions", {})],
  }),
  defineTool({
    id: "peekaboo.see",
    operation: "see",
    displayName: "Peekaboo See",
    description: "Capture the current macOS UI, extract accessibility metadata, and optionally save annotated screenshots.",
    command: ["see"],
    group: "capture",
    maxOutputBytes: PEEKABOO_CLI_LARGE_OUTPUT_BYTES,
    instructions: discoveryInstructions("Use this tool before issuing Peekaboo click/type commands so element IDs and snapshot IDs are fresh."),
    examples: [
      example("Capture Safari UI metadata", {
        flags: {
          app: "Safari",
        },
        presentFlags: ["annotate"],
      }),
    ],
  }),
  defineTool({
    id: "peekaboo.image",
    operation: "image",
    displayName: "Peekaboo Image",
    description: "Save raw PNG/JPG captures of screens, windows, or menu bar regions.",
    command: ["image"],
    group: "capture",
    maxOutputBytes: PEEKABOO_CLI_LARGE_OUTPUT_BYTES,
    examples: [
      example("Capture a Retina screen image", {
        flags: {
          mode: "screen",
          path: "/tmp/peekaboo-screen.png",
        },
        presentFlags: ["retina"],
      }),
    ],
  }),
  ...listTools(),
  ...actionTools(),
  ...windowTools(),
  ...appTools(),
  ...menuTools(),
  ...menubarTools(),
  ...dialogTools(),
  ...spaceTools(),
  ...dockTools(),
];

export function getPeekabooToolDefinitionByOperation(operation) {
  const normalized = typeof operation === "string" ? operation.trim() : "";
  return PEEKABOO_TOOL_DEFINITIONS.find((tool) => tool.operation === normalized) ?? null;
}

export function resolveDefaultSpacesPeekabooWrapperPath() {
  return resolve(SCRIPT_DIR, "spaces-peekaboo.mjs");
}

export function buildPeekabooCliManifest(tool, input = {}) {
  const wrapperPath = resolveRequiredAbsolutePath(
    input.wrapperPath ?? resolveDefaultSpacesPeekabooWrapperPath(),
    "wrapperPath",
  );
  const fixedCwd = resolveRequiredAbsolutePath(input.fixedCwd ?? dirname(wrapperPath), "fixedCwd");
  const now = input.now ?? new Date().toISOString();
  const enabled = input.enabled ?? true;
  return {
    schemaVersion: PEEKABOO_CLI_TOOL_SCHEMA_VERSION,
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

export function buildPeekabooCliToolReadme(tool) {
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
    `- Peekaboo CLI mapping: \`${tool.commandHint}\``,
    "",
    "## Host Peekaboo Configuration",
    "- Install Peekaboo on the external gateway host: `brew install steipete/tap/peekaboo`.",
    "- Grant Screen Recording and Accessibility permissions for the host process that launches Peekaboo.",
    "- Verify `peekaboo permissions status --json` works outside Spaces before relying on this managed bundle.",
    "- Set `SPACES_PEEKABOO_EXECUTABLE` if the binary is not resolvable from PATH or common macOS install directories.",
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
    "- Peekaboo JSON output is parsed into `data`; text output is normalized into `data.text`.",
    "",
    "## Approval Guidance",
    "- Keep explicit human approval enabled for every Peekaboo tool.",
    "- Capture and discovery commands can expose screen contents and should be treated as sensitive reads.",
    "- Desktop-driving and state-changing commands are marked destructive because they can click, type, move windows, switch apps, or dismiss dialogs.",
    "",
  ].join("\n");
}

function listTools() {
  return [
    defineTool({
      id: "peekaboo.list.apps",
      operation: "list.apps",
      displayName: "Peekaboo List Apps",
      description: "List running or known macOS applications visible to Peekaboo.",
      command: ["list", "apps"],
      group: "discovery",
      instructions: discoveryInstructions("Use this tool to find target app names before capture or automation."),
      examples: [example("List applications", {})],
    }),
    defineTool({
      id: "peekaboo.list.windows",
      operation: "list.windows",
      displayName: "Peekaboo List Windows",
      description: "List macOS windows available for Peekaboo capture and automation.",
      command: ["list", "windows"],
      group: "discovery",
      instructions: discoveryInstructions("Use this tool to find target window IDs or titles before window-specific commands."),
      examples: [example("List Safari windows", { flags: { app: "Safari" } })],
    }),
    defineTool({
      id: "peekaboo.list.screens",
      operation: "list.screens",
      displayName: "Peekaboo List Screens",
      description: "List displays available to Peekaboo.",
      command: ["list", "screens"],
      group: "discovery",
      instructions: discoveryInstructions("Use this tool to identify screen indexes before screen captures or pointer movement."),
      examples: [example("List screens", {})],
    }),
    defineTool({
      id: "peekaboo.list.menubar",
      operation: "list.menubar",
      displayName: "Peekaboo List Menu Bar",
      description: "List menu bar extras visible to Peekaboo.",
      command: ["list", "menubar"],
      group: "discovery",
      instructions: discoveryInstructions("Use this tool to inspect menu bar targets before clicking menu extras."),
      examples: [example("List menu bar extras", {})],
    }),
    defineTool({
      id: "peekaboo.list.permissions",
      operation: "list.permissions",
      displayName: "Peekaboo List Permissions",
      description: "List macOS permission state for Peekaboo automation surfaces.",
      command: ["list", "permissions"],
      group: "permissions",
      maxOutputBytes: PEEKABOO_CLI_SMALL_OUTPUT_BYTES,
      instructions: discoveryInstructions("Use this tool to inspect permissions before troubleshooting Peekaboo capture or automation."),
      examples: [example("List permissions", {})],
    }),
  ];
}

function actionTools() {
  return [
    defineTool({
      id: "peekaboo.click",
      operation: "click",
      displayName: "Peekaboo Click",
      description: "Click a UI element, fuzzy text target, or coordinate through Peekaboo.",
      command: ["click"],
      group: "actions",
      dangerLevel: "destructive",
      examples: [example("Click a button by element ID", { arguments: ["Submit"], flags: { app: "Safari" } })],
    }),
    defineTool({
      id: "peekaboo.type",
      operation: "type",
      displayName: "Peekaboo Type",
      description: "Send text or control keys to a target app/window through Peekaboo.",
      command: ["type"],
      group: "actions",
      dangerLevel: "destructive",
      examples: [example("Type into Terminal", { arguments: ["status report ready"], flags: { app: "Terminal" } })],
    }),
    defineTool({
      id: "peekaboo.hotkey",
      operation: "hotkey",
      displayName: "Peekaboo Hotkey",
      description: "Send one keyboard shortcut chord through Peekaboo.",
      command: ["hotkey"],
      group: "actions",
      dangerLevel: "destructive",
      examples: [example("Send Command-L to Safari", { arguments: ["cmd,l"], flags: { app: "Safari" } })],
    }),
    defineTool({
      id: "peekaboo.press",
      operation: "press",
      displayName: "Peekaboo Press",
      description: "Send special key presses or repeated key sequences through Peekaboo.",
      command: ["press"],
      group: "actions",
      dangerLevel: "destructive",
      examples: [example("Press Return", { arguments: ["return"] })],
    }),
    defineTool({
      id: "peekaboo.paste",
      operation: "paste",
      displayName: "Peekaboo Paste",
      description: "Set clipboard content, paste it, and restore clipboard state through Peekaboo.",
      command: ["paste"],
      group: "actions",
      dangerLevel: "destructive",
      examples: [example("Paste text", { arguments: ["hello"], flags: { app: "TextEdit" } })],
    }),
    defineTool({
      id: "peekaboo.scroll",
      operation: "scroll",
      displayName: "Peekaboo Scroll",
      description: "Scroll a target view or element through Peekaboo.",
      command: ["scroll"],
      group: "actions",
      dangerLevel: "destructive",
      examples: [example("Scroll down", { flags: { direction: "down", amount: 4, app: "Safari" } })],
    }),
    defineTool({
      id: "peekaboo.drag",
      operation: "drag",
      displayName: "Peekaboo Drag",
      description: "Drag between elements, coordinates, or Dock destinations through Peekaboo.",
      command: ["drag"],
      group: "actions",
      dangerLevel: "destructive",
      examples: [example("Drag between coordinates", { flags: { from: "10,10", to: "200,200" } })],
    }),
    defineTool({
      id: "peekaboo.move",
      operation: "move",
      displayName: "Peekaboo Move Pointer",
      description: "Move the cursor to coordinates, element centers, or screen center through Peekaboo.",
      command: ["move"],
      group: "actions",
      dangerLevel: "destructive",
      examples: [example("Move pointer to screen center", { flags: { to: "center" } })],
    }),
  ];
}

function windowTools() {
  return [
    commandTool("window.list", "Peekaboo Window List", "List windows known to Peekaboo.", ["window", "list"], "windows", "standard"),
    commandTool("window.focus", "Peekaboo Window Focus", "Focus a target window through Peekaboo.", ["window", "focus"], "windows", "destructive"),
    commandTool("window.close", "Peekaboo Window Close", "Close a target window through Peekaboo.", ["window", "close"], "windows", "destructive"),
    commandTool("window.minimize", "Peekaboo Window Minimize", "Minimize a target window through Peekaboo.", ["window", "minimize"], "windows", "destructive"),
    commandTool("window.maximize", "Peekaboo Window Maximize", "Maximize a target window through Peekaboo.", ["window", "maximize"], "windows", "destructive"),
    commandTool("window.move", "Peekaboo Window Move", "Move a target window through Peekaboo.", ["window", "move"], "windows", "destructive"),
    commandTool("window.resize", "Peekaboo Window Resize", "Resize a target window through Peekaboo.", ["window", "resize"], "windows", "destructive"),
    commandTool("window.set_bounds", "Peekaboo Window Set Bounds", "Set target window bounds through Peekaboo.", ["window", "set-bounds"], "windows", "destructive"),
  ];
}

function appTools() {
  return [
    commandTool("app.list", "Peekaboo App List", "List applications through Peekaboo.", ["app", "list"], "apps", "standard"),
    commandTool("app.launch", "Peekaboo App Launch", "Launch an application through Peekaboo.", ["app", "launch"], "apps", "destructive"),
    commandTool("app.quit", "Peekaboo App Quit", "Quit an application through Peekaboo.", ["app", "quit"], "apps", "destructive"),
    commandTool("app.relaunch", "Peekaboo App Relaunch", "Relaunch an application through Peekaboo.", ["app", "relaunch"], "apps", "destructive"),
    commandTool("app.hide", "Peekaboo App Hide", "Hide an application through Peekaboo.", ["app", "hide"], "apps", "destructive"),
    commandTool("app.unhide", "Peekaboo App Unhide", "Unhide an application through Peekaboo.", ["app", "unhide"], "apps", "destructive"),
    commandTool("app.switch", "Peekaboo App Switch", "Switch to an application through Peekaboo.", ["app", "switch"], "apps", "destructive"),
  ];
}

function menuTools() {
  return [
    commandTool("menu.list", "Peekaboo Menu List", "List menus for an application through Peekaboo.", ["menu", "list"], "menus", "standard"),
    commandTool("menu.list_all", "Peekaboo Menu List All", "List all menus for an application through Peekaboo.", ["menu", "list-all"], "menus", "standard"),
    commandTool("menu.click", "Peekaboo Menu Click", "Click an application menu item through Peekaboo.", ["menu", "click"], "menus", "destructive"),
    commandTool("menu.click_extra", "Peekaboo Menu Extra Click", "Click a menu extra through Peekaboo.", ["menu", "click-extra"], "menus", "destructive"),
  ];
}

function menubarTools() {
  return [
    commandTool("menubar.list", "Peekaboo Menubar List", "List status-bar items through Peekaboo.", ["menubar", "list"], "menus", "standard"),
    commandTool("menubar.click", "Peekaboo Menubar Click", "Click a status-bar item through Peekaboo.", ["menubar", "click"], "menus", "destructive"),
  ];
}

function dialogTools() {
  return [
    commandTool("dialog.list", "Peekaboo Dialog List", "List system dialogs through Peekaboo.", ["dialog", "list"], "dialogs", "standard"),
    commandTool("dialog.click", "Peekaboo Dialog Click", "Click a system dialog control through Peekaboo.", ["dialog", "click"], "dialogs", "destructive"),
    commandTool("dialog.input", "Peekaboo Dialog Input", "Type into a system dialog through Peekaboo.", ["dialog", "input"], "dialogs", "destructive"),
    commandTool("dialog.file", "Peekaboo Dialog File", "Choose a file in a system dialog through Peekaboo.", ["dialog", "file"], "dialogs", "destructive"),
    commandTool("dialog.dismiss", "Peekaboo Dialog Dismiss", "Dismiss a system dialog through Peekaboo.", ["dialog", "dismiss"], "dialogs", "destructive"),
  ];
}

function spaceTools() {
  return [
    commandTool("space.list", "Peekaboo Space List", "List macOS Spaces through Peekaboo.", ["space", "list"], "spaces", "standard"),
    commandTool("space.switch", "Peekaboo Space Switch", "Switch macOS Spaces through Peekaboo.", ["space", "switch"], "spaces", "destructive"),
    commandTool("space.move_window", "Peekaboo Space Move Window", "Move a window between macOS Spaces through Peekaboo.", ["space", "move-window"], "spaces", "destructive"),
  ];
}

function dockTools() {
  return [
    commandTool("dock.list", "Peekaboo Dock List", "List Dock items through Peekaboo.", ["dock", "list"], "dock", "standard"),
    commandTool("dock.launch", "Peekaboo Dock Launch", "Launch a Dock item through Peekaboo.", ["dock", "launch"], "dock", "destructive"),
    commandTool("dock.right_click", "Peekaboo Dock Right Click", "Right-click a Dock item through Peekaboo.", ["dock", "right-click"], "dock", "destructive"),
    commandTool("dock.hide", "Peekaboo Dock Hide", "Hide the Dock through Peekaboo.", ["dock", "hide"], "dock", "destructive"),
    commandTool("dock.show", "Peekaboo Dock Show", "Show the Dock through Peekaboo.", ["dock", "show"], "dock", "destructive"),
  ];
}

function commandTool(operation, displayName, description, command, group, dangerLevel) {
  return defineTool({
    id: `peekaboo.${operation}`,
    operation,
    displayName,
    description,
    command,
    group,
    dangerLevel,
    instructions: operation.endsWith(".list")
      ? discoveryInstructions(`Use this tool to inspect ${displayName.replace(/^Peekaboo /, "").toLowerCase()} before acting.`)
      : undefined,
    examples: [example(displayName, {})],
  });
}

function defineTool(input) {
  const groupMetadata = PEEKABOO_GROUP_METADATA[input.group];
  const operation = input.operation;
  return {
    id: input.id,
    operation,
    displayName: input.displayName,
    description: input.description,
    command: [...input.command],
    bundleId: PEEKABOO_BUNDLE_METADATA.bundleId,
    bundleDisplayName: PEEKABOO_BUNDLE_METADATA.bundleDisplayName,
    bundleDescription: PEEKABOO_BUNDLE_METADATA.bundleDescription,
    toolGroupId: groupMetadata?.toolGroupId,
    toolGroupDisplayName: groupMetadata?.toolGroupDisplayName,
    commandHint: buildCommandHint(["peekaboo", ...input.command]),
    instructions: input.instructions
      ?? "Use this tool for Peekaboo CLI operations only after the gateway host has the required macOS permissions.",
    payloadSchema: genericPayloadSchema(),
    examples: input.examples ?? [example(input.displayName, {})],
    dangerLevel: input.dangerLevel ?? "standard",
    timeoutMs: input.timeoutMs ?? PEEKABOO_CLI_DEFAULT_TIMEOUT_MS,
    maxOutputBytes: input.maxOutputBytes ?? PEEKABOO_CLI_MEDIUM_OUTPUT_BYTES,
    supportsJsonOutput: true,
  };
}

function discoveryInstructions(suffix) {
  return `${suffix} This discovery read is not query-bounded, so keep it targeted and operator-driven.`;
}

function buildCommandHint(command) {
  return command.join(" ");
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

function genericPayloadSchema() {
  return objectPayloadSchema({
    arguments: {
      type: "array",
      description: "Optional extra positional arguments to append after the Peekaboo subcommand.",
      items: {
        type: "string",
      },
    },
    flags: flagsObjectProperty(
      "Optional Peekaboo flags. Use raw CLI flag keys such as `app`, `window-title`, `snapshot`, `coords`, `path`, or `mode`.",
    ),
    presentFlags: {
      type: "array",
      description: "Optional flag names rendered without values, for example `annotate`, `retina`, `foreground`, or `return`.",
      items: {
        type: "string",
      },
    },
    stdin: stringProperty("Optional stdin payload forwarded to the Peekaboo CLI command."),
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
