import type { GatewayCapabilityDefinition, GatewayCoreProfile, GatewayCoreProfileId } from "./types.js";

export const DEFAULT_CAPABILITY_CATALOG: GatewayCapabilityDefinition[] = [
  {
    id: "lists.read",
    description: "Read list items (for example reminders and tasks).",
  },
  {
    id: "lists.write",
    description: "Create or update list items.",
  },
  {
    id: "calendar.read",
    description: "Read calendar events from user-approved accounts.",
  },
  {
    id: "calendar.write",
    description: "Create or edit calendar events.",
  },
  {
    id: "notes.read",
    description: "Read notes content and metadata.",
  },
  {
    id: "notes.write",
    description: "Create or edit notes.",
  },
  {
    id: "contacts.read",
    description: "Read contacts and address book metadata.",
  },
  {
    id: "contacts.write",
    description: "Create or update contacts.",
  },
  {
    id: "messaging.read",
    description: "Read inbound channel messages and conversation metadata.",
  },
  {
    id: "messaging.write",
    description: "Send outbound channel messages where routing policy allows.",
  },
  {
    id: "files.read",
    description: "Read user-selected files and folders.",
  },
  {
    id: "files.write",
    description: "Write or update user-selected files.",
  },
  {
    id: "clipboard.read",
    description: "Read clipboard values.",
  },
  {
    id: "clipboard.write",
    description: "Write clipboard values.",
  },
  {
    id: "browser.read",
    description: "Read browser state or metadata from integrated providers.",
  },
  {
    id: "browser.write",
    description: "Perform browser write actions (for example form fill or tab control).",
  },
  {
    id: "media.read",
    description: "Read media library metadata.",
  },
  {
    id: "media.write",
    description: "Create or update media artifacts.",
  },
  {
    id: "health.read",
    description: "Read health data from permitted sources.",
  },
  {
    id: "health.write",
    description: "Write health data where platform policy allows.",
  },
  {
    id: "speech.execute",
    description: "Run speech and audio session operations.",
  },
  {
    id: "notifications.write",
    description: "Create local or remote notifications.",
  },
  {
    id: "shortcuts.execute",
    description: "Run platform shortcuts and automations.",
  },
  {
    id: "email.read",
    description: "Read user mailbox metadata and messages.",
  },
  {
    id: "email.write",
    description: "Send or mutate email data where providers allow.",
  },
  {
    id: "model.inference",
    description: "Call the configured default model runtime.",
  },
  {
    id: "model.custom",
    description: "Use custom model runtimes and BYO endpoints.",
  },
  {
    id: "gateway.multi",
    description: "Connect and coordinate with multiple gateways.",
  },
  {
    id: "mcp.execute",
    description: "Invoke MCP tools and servers.",
  },
  {
    id: "shell.execute",
    description: "Execute local shell commands.",
  },
  {
    id: "plugin.dynamic-load",
    description: "Load dynamic third-party executable extensions.",
  },
];

export const EMBEDDED_GATEWAY_PROFILE: GatewayCoreProfile = {
  id: "embedded",
  name: "Embedded (App Store-safe)",
  description: "Sandbox-first profile for gateways embedded in Apple app bundles.",
  appStoreCompatible: true,
  sandboxRequired: true,
  allowsDynamicExecutableCode: false,
  allowsMultiGateway: false,
  hardBlockedCapabilities: [
    "gateway.multi",
    "shell.execute",
    "model.custom",
    "mcp.execute",
    "plugin.dynamic-load",
  ],
};

export const EXTERNAL_GATEWAY_PROFILE: GatewayCoreProfile = {
  id: "external",
  name: "External (Website/Developer)",
  description: "Advanced profile for externally installed gateways.",
  appStoreCompatible: false,
  sandboxRequired: false,
  allowsDynamicExecutableCode: true,
  allowsMultiGateway: true,
  hardBlockedCapabilities: [],
};

export function getGatewayCoreProfile(profileId: GatewayCoreProfileId): GatewayCoreProfile {
  const source = profileId === "external" ? EXTERNAL_GATEWAY_PROFILE : EMBEDDED_GATEWAY_PROFILE;
  return {
    ...source,
    hardBlockedCapabilities: [...source.hardBlockedCapabilities],
  };
}
