import type { Logger } from "@spaceskit/observability";
import type { GatewayCoreProfileId } from "@spaceskit/gateway-core";
import type { GatewayLibraryService } from "./gateway-library-service.js";
import type { CliToolHealthStatus, CliToolService } from "./cli-tool-service.js";
import {
  JIRA_CLI_SKILL_ENTRY_ID,
  JIRA_CLI_SKILL_SEED,
} from "../seed/jira-cli-skill.js";
import {
  JIRA_TOOL_DEFINITIONS,
} from "../../../../scripts/jira-cli-tools/catalog.mjs";
import {
  materializeJiraCliTools,
} from "../../../../scripts/jira-cli-tools/materialize-jira-cli-tools.mjs";
import {
  resolveJiraExecutable,
} from "../../../../scripts/jira-cli-tools/spaces-jira.mjs";
import {
  HRVST_TOOL_DEFINITIONS,
} from "../../../../scripts/hrvst-cli-tools/catalog.mjs";
import {
  materializeHrvstCliTools,
} from "../../../../scripts/hrvst-cli-tools/materialize-hrvst-cli-tools.mjs";
import {
  resolveHrvstExecutable,
} from "../../../../scripts/hrvst-cli-tools/spaces-hrvst.mjs";
import {
  OP_TOOL_DEFINITIONS,
} from "../../../../scripts/op-cli-tools/catalog.mjs";
import {
  materializeOpCliTools,
} from "../../../../scripts/op-cli-tools/materialize-op-cli-tools.mjs";
import {
  resolveOpExecutable,
} from "../../../../scripts/op-cli-tools/spaces-op.mjs";
import {
  FRUITMAIL_TOOL_DEFINITIONS,
} from "../../../../scripts/fruitmail-cli-tools/catalog.mjs";
import {
  materializeFruitMailCliTools,
} from "../../../../scripts/fruitmail-cli-tools/materialize-fruitmail-cli-tools.mjs";
import {
  resolveFruitMailExecutable,
} from "../../../../scripts/fruitmail-cli-tools/spaces-fruitmail.mjs";

export type InterconnectorAvailabilityStatus = "active" | "degraded" | "inactive";

export interface InterconnectorCatalogBundleHealth {
  healthStatus: CliToolHealthStatus;
  healthMessage?: string;
}

export interface InterconnectorCatalogBundleStatus extends InterconnectorCatalogBundleHealth {
  bundleId: string;
  bundleDisplayName: string;
  bundleDescription?: string;
  availabilityStatus: InterconnectorAvailabilityStatus;
  detected: boolean;
  executablePath?: string;
  installHint?: string;
  toolIds: string[];
  toolCount: number;
  managedEnabled: boolean;
  updatedAt: string;
}

export interface InterconnectorCatalogBundleSyncResult extends InterconnectorCatalogBundleStatus {
  removedToolIds: string[];
}

export interface InterconnectorCatalogBundleSyncContext {
  enabled: boolean;
  gatewayProfile: GatewayCoreProfileId;
  manifestRoot: string;
  logger: Logger;
  cliToolService?: CliToolService | null;
  gatewayLibraryService?: GatewayLibraryService | null;
}

export interface InterconnectorCatalogBundleDefinition {
  bundleId: string;
  bundleDisplayName: string;
  bundleDescription?: string;
  toolIds: string[];
  installHint?: string;
  sync: (context: InterconnectorCatalogBundleSyncContext) => Promise<InterconnectorCatalogBundleSyncResult>;
}

const JIRA_INSTALL_HINT = "Install `jira` on the gateway host and make it resolvable, then rescan CLI Tools.";
const JIRA_BUNDLE_ID = "jira-cli";
const JIRA_BUNDLE_DISPLAY_NAME = "Jira CLI";
const JIRA_BUNDLE_DESCRIPTION = "Gateway-managed Jira CLI bundle for account discovery plus project, board, release, epic, sprint, and issue operations.";
const HRVST_INSTALL_HINT = "Install `hrvst-cli` on the gateway host, authenticate it with `hrvst login`, then rescan CLI Tools.";
const HRVST_BUNDLE_ID = "hrvst-cli";
const HRVST_BUNDLE_DISPLAY_NAME = "Harvest CLI";
const HRVST_BUNDLE_DESCRIPTION = "Gateway-managed Harvest CLI bundle for account, client, project, report, time-entry, and user operations.";
const OP_INSTALL_HINT = "Install 1Password CLI (`op`) on the gateway host, authenticate it, then rescan CLI Tools.";
const OP_BUNDLE_ID = "onepassword-cli";
const OP_BUNDLE_DISPLAY_NAME = "1Password CLI";
const OP_BUNDLE_DESCRIPTION = "Gateway-managed 1Password CLI bundle for account, vault, item, user, group, Connect, and secret-read operations.";
const FRUITMAIL_INSTALL_HINT = "Install fruitmail (`npm install -g apple-mail-search-cli`), grant Full Disk Access to your terminal, then rescan CLI Tools.";
const FRUITMAIL_BUNDLE_ID = "fruitmail-cli";
const FRUITMAIL_BUNDLE_DISPLAY_NAME = "Apple Mail (fruitmail)";
const FRUITMAIL_BUNDLE_DESCRIPTION = "Gateway-managed fruitmail CLI bundle for Apple Mail search, message retrieval, and email sending via the local Mail.app database.";

export const INTERCONNECTOR_CATALOG_BUNDLE_DEFINITIONS: InterconnectorCatalogBundleDefinition[] = [
  {
    bundleId: JIRA_BUNDLE_ID,
    bundleDisplayName: JIRA_BUNDLE_DISPLAY_NAME,
    bundleDescription: JIRA_BUNDLE_DESCRIPTION,
    toolIds: JIRA_TOOL_DEFINITIONS.map((tool) => tool.id),
    installHint: JIRA_INSTALL_HINT,
    sync: async (context) => syncJiraCatalogBundle(context),
  },
  {
    bundleId: HRVST_BUNDLE_ID,
    bundleDisplayName: HRVST_BUNDLE_DISPLAY_NAME,
    bundleDescription: HRVST_BUNDLE_DESCRIPTION,
    toolIds: HRVST_TOOL_DEFINITIONS.map((tool) => tool.id),
    installHint: HRVST_INSTALL_HINT,
    sync: async (context) => syncHrvstCatalogBundle(context),
  },
  {
    bundleId: OP_BUNDLE_ID,
    bundleDisplayName: OP_BUNDLE_DISPLAY_NAME,
    bundleDescription: OP_BUNDLE_DESCRIPTION,
    toolIds: OP_TOOL_DEFINITIONS.map((tool) => tool.id),
    installHint: OP_INSTALL_HINT,
    sync: async (context) => syncOpCatalogBundle(context),
  },
  {
    bundleId: FRUITMAIL_BUNDLE_ID,
    bundleDisplayName: FRUITMAIL_BUNDLE_DISPLAY_NAME,
    bundleDescription: FRUITMAIL_BUNDLE_DESCRIPTION,
    toolIds: FRUITMAIL_TOOL_DEFINITIONS.map((tool: { id: string }) => tool.id),
    installHint: FRUITMAIL_INSTALL_HINT,
    sync: async (context) => syncFruitMailCatalogBundle(context),
  },
];

async function syncJiraCatalogBundle(
  context: InterconnectorCatalogBundleSyncContext,
): Promise<InterconnectorCatalogBundleSyncResult> {
  return syncManagedCliBundle(context, {
    bundleId: JIRA_BUNDLE_ID,
    bundleDisplayName: JIRA_BUNDLE_DISPLAY_NAME,
    bundleDescription: JIRA_BUNDLE_DESCRIPTION,
    toolIds: JIRA_TOOL_DEFINITIONS.map((tool) => tool.id),
    installHint: JIRA_INSTALL_HINT,
    detectExecutable: detectJiraExecutable,
    materialize: async (manifestRoot) => {
      await materializeJiraCliTools({ targetDir: manifestRoot });
    },
    probeArgs: ["me"],
    probeTimeoutMs: 2_000,
    probeFailureMessage: "Jira CLI detected, but `jira me` failed.",
    onAvailabilityChange: async (enabled) => {
      await syncJiraSkill(enabled, context.gatewayLibraryService, context.logger);
    },
  });
}

async function syncHrvstCatalogBundle(
  context: InterconnectorCatalogBundleSyncContext,
): Promise<InterconnectorCatalogBundleSyncResult> {
  return syncManagedCliBundle(context, {
    bundleId: HRVST_BUNDLE_ID,
    bundleDisplayName: HRVST_BUNDLE_DISPLAY_NAME,
    bundleDescription: HRVST_BUNDLE_DESCRIPTION,
    toolIds: HRVST_TOOL_DEFINITIONS.map((tool) => tool.id),
    installHint: HRVST_INSTALL_HINT,
    detectExecutable: detectHrvstExecutable,
    materialize: async (manifestRoot) => {
      await materializeHrvstCliTools({ targetDir: manifestRoot });
    },
    probeArgs: ["users", "me", "--output", "json"],
    probeTimeoutMs: 2_000,
    probeFailureMessage: "Harvest CLI detected, but `hrvst users me --output json` failed.",
  });
}

async function syncOpCatalogBundle(
  context: InterconnectorCatalogBundleSyncContext,
): Promise<InterconnectorCatalogBundleSyncResult> {
  return syncManagedCliBundle(context, {
    bundleId: OP_BUNDLE_ID,
    bundleDisplayName: OP_BUNDLE_DISPLAY_NAME,
    bundleDescription: OP_BUNDLE_DESCRIPTION,
    toolIds: OP_TOOL_DEFINITIONS.map((tool) => tool.id),
    installHint: OP_INSTALL_HINT,
    detectExecutable: detectOpExecutable,
    materialize: async (manifestRoot) => {
      await materializeOpCliTools({ targetDir: manifestRoot });
    },
    probeArgs: ["whoami", "--format", "json"],
    probeTimeoutMs: 2_000,
    probeFailureMessage: "1Password CLI detected, but `op whoami --format json` failed.",
  });
}

async function syncFruitMailCatalogBundle(
  context: InterconnectorCatalogBundleSyncContext,
): Promise<InterconnectorCatalogBundleSyncResult> {
  return syncManagedCliBundle(context, {
    bundleId: FRUITMAIL_BUNDLE_ID,
    bundleDisplayName: FRUITMAIL_BUNDLE_DISPLAY_NAME,
    bundleDescription: FRUITMAIL_BUNDLE_DESCRIPTION,
    toolIds: FRUITMAIL_TOOL_DEFINITIONS.map((tool: { id: string }) => tool.id),
    installHint: FRUITMAIL_INSTALL_HINT,
    detectExecutable: detectFruitMailExecutable,
    materialize: async (manifestRoot) => {
      await materializeFruitMailCliTools({ targetDir: manifestRoot });
    },
    probeArgs: ["stats"],
    probeTimeoutMs: 5_000,
    probeFailureMessage: "fruitmail detected, but `fruitmail stats` failed. Grant Full Disk Access to your terminal in System Settings.",
  });
}

function detectFruitMailExecutable(): { detected: true; executablePath: string } | { detected: false; healthMessage: string } {
  const path = resolveFruitMailExecutable();
  if (path) {
    return { detected: true, executablePath: path };
  }
  return { detected: false, healthMessage: "fruitmail not found. Install with: npm install -g apple-mail-search-cli" };
}

async function syncManagedCliBundle(
  context: InterconnectorCatalogBundleSyncContext,
  input: {
    bundleId: string;
    bundleDisplayName: string;
    bundleDescription: string;
    toolIds: string[];
    installHint: string;
    detectExecutable: () => { detected: true; executablePath: string } | { detected: false; healthMessage: string };
    materialize: (manifestRoot: string) => Promise<void>;
    probeArgs: string[];
    probeTimeoutMs: number;
    probeFailureMessage: string;
    onAvailabilityChange?: (enabled: boolean) => Promise<void>;
  },
): Promise<InterconnectorCatalogBundleSyncResult> {
  const now = new Date().toISOString();
  const managedEnabled = context.enabled;

  if (!managedEnabled) {
    await input.onAvailabilityChange?.(false);
    return buildInactiveBundleResult(input, {
      managedEnabled: false,
      updatedAt: now,
      healthMessage: `Managed ${input.bundleDisplayName} bundle is disabled for this gateway.`,
    });
  }

  const detection = input.detectExecutable();
  if (!detection.detected) {
    await input.onAvailabilityChange?.(false);
    return buildInactiveBundleResult(input, {
      managedEnabled: true,
      updatedAt: now,
      healthMessage: detection.healthMessage,
    });
  }

  await input.materialize(context.manifestRoot);
  await input.onAvailabilityChange?.(true);

  const health = await probeExecutableHealth({
    executablePath: detection.executablePath,
    args: input.probeArgs,
    timeoutMs: input.probeTimeoutMs,
    failureMessage: input.probeFailureMessage,
  });
  const availabilityStatus: InterconnectorAvailabilityStatus = health.healthStatus === "ok"
    ? "active"
    : "degraded";

  return {
    bundleId: input.bundleId,
    bundleDisplayName: input.bundleDisplayName,
    bundleDescription: input.bundleDescription,
    availabilityStatus,
    detected: true,
    executablePath: detection.executablePath,
    healthStatus: health.healthStatus,
    healthMessage: health.healthMessage,
    installHint: input.installHint,
    toolIds: input.toolIds,
    toolCount: input.toolIds.length,
    managedEnabled: true,
    updatedAt: now,
    removedToolIds: [],
  };
}

function buildInactiveBundleResult(
  input: {
    bundleId: string;
    bundleDisplayName: string;
    bundleDescription: string;
    toolIds: string[];
    installHint: string;
  },
  status: {
    managedEnabled: boolean;
    updatedAt: string;
    healthMessage: string;
  },
): InterconnectorCatalogBundleSyncResult {
  return {
    bundleId: input.bundleId,
    bundleDisplayName: input.bundleDisplayName,
    bundleDescription: input.bundleDescription,
    availabilityStatus: "inactive",
    detected: false,
    healthStatus: "unknown",
    healthMessage: status.healthMessage,
    installHint: input.installHint,
    toolIds: input.toolIds,
    toolCount: input.toolIds.length,
    managedEnabled: status.managedEnabled,
    updatedAt: status.updatedAt,
    removedToolIds: [],
  };
}

function detectJiraExecutable():
  | { detected: true; executablePath: string }
  | { detected: false; healthMessage: string } {
  try {
    return {
      detected: true,
      executablePath: resolveJiraExecutable(process.env),
    };
  } catch (error) {
    return {
      detected: false,
      healthMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

function detectHrvstExecutable():
  | { detected: true; executablePath: string }
  | { detected: false; healthMessage: string } {
  try {
    return {
      detected: true,
      executablePath: resolveHrvstExecutable(process.env),
    };
  } catch (error) {
    return {
      detected: false,
      healthMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

function detectOpExecutable():
  | { detected: true; executablePath: string }
  | { detected: false; healthMessage: string } {
  try {
    return {
      detected: true,
      executablePath: resolveOpExecutable(process.env),
    };
  } catch (error) {
    return {
      detected: false,
      healthMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

async function syncJiraSkill(
  enabled: boolean,
  gatewayLibraryService: GatewayLibraryService | null | undefined,
  logger: Logger,
): Promise<void> {
  if (!gatewayLibraryService) {
    return;
  }

  try {
    if (enabled) {
      gatewayLibraryService.saveSkill({
        entryId: JIRA_CLI_SKILL_ENTRY_ID,
        skillId: JIRA_CLI_SKILL_ENTRY_ID,
        name: JIRA_CLI_SKILL_SEED.name,
        description: JIRA_CLI_SKILL_SEED.description,
        contentMarkdown: JIRA_CLI_SKILL_SEED.contentMarkdown,
        sourceKind: "installed",
        sourceRef: JIRA_CLI_SKILL_SEED.sourceRef,
        tags: [...JIRA_CLI_SKILL_SEED.tags],
        enabled: true,
        status: "enabled",
      });
      return;
    }

    const existing = gatewayLibraryService.getEntry(JIRA_CLI_SKILL_ENTRY_ID, false);
    if (existing) {
      gatewayLibraryService.setEntryEnabled({
        entryId: JIRA_CLI_SKILL_ENTRY_ID,
        enabled: false,
      });
    }
  } catch (error) {
    logger.warn("Failed syncing Jira CLI library skill", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function probeExecutableHealth(input: {
  executablePath: string;
  args: string[];
  timeoutMs: number;
  failureMessage: string;
}): Promise<InterconnectorCatalogBundleHealth> {
  try {
    const result = await runProbe({
      executable: input.executablePath,
      args: input.args,
      timeoutMs: input.timeoutMs,
    });
    if (result.exitCode === 0) {
      return { healthStatus: "ok" };
    }
    return {
      healthStatus: "degraded",
      healthMessage: normalizeProbeMessage(result.stderr || result.stdout)
        ?? input.failureMessage,
    };
  } catch (error) {
    return {
      healthStatus: "degraded",
      healthMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runProbe(input: {
  executable: string;
  args: string[];
  timeoutMs: number;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { spawn } = await import("node:child_process");

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(input.executable, input.args, {
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 250).unref();
    }, input.timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        rejectPromise(new Error("Managed CLI health probe timed out."));
        return;
      }
      resolvePromise({
        exitCode: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      });
    });
  });
}

function normalizeProbeMessage(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
