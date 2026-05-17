import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";
import type { CapabilityProvider, CapabilityPolicyContext } from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import type { GatewayCoreProfileId } from "@spaceskit/gateway-core";
import { LocalExecutableResolver } from "../execution/local-executable-resolver.js";
import type { SpaceWorkspaceService } from "./space-workspace-service.js";
import { executeCliTool, renderArgs } from "./cli-tool-execution.js";
import { CliToolServiceError } from "./cli-tool-service-error.js";
import {
  buildDefaultReadme,
  CLI_TOOL_SCHEMA_VERSION,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  defaultExamples,
  defaultInputSchema,
  defaultInstructions,
} from "./cli-tool-service-defaults.js";
import {
  normalizeId,
  normalizeOptionalString,
  normalizeRequiredString,
  parseOutputMode,
  summarizeReadme,
} from "./cli-tool-service-normalizers.js";
import {
  manifestRecordFromTool,
  materializeCliToolManifest,
  providerIdForTool,
  readCliToolManifest,
} from "./cli-tool-service-manifests.js";
import type {
  CliToolHealthStatus,
  CliToolInvocationPreview,
  CliToolManifestRecord,
  CliToolScaffoldResult,
  RegisteredCliTool,
  RegisterCliToolInput,
} from "./cli-tool-service-types.js";

export { CliToolServiceError } from "./cli-tool-service-error.js";
export type {
  CliToolCwdMode,
  CliToolDangerLevel,
  CliToolExampleRecord,
  CliToolHealthStatus,
  CliToolInvocationPreview,
  CliToolManifestRecord,
  CliToolOutputMode,
  CliToolScaffoldResult,
  RegisteredCliTool,
  RegisterCliToolInput,
} from "./cli-tool-service-types.js";

interface RegisteredProvider {
  tool: RegisteredCliTool;
  provider: CapabilityProvider;
}

export interface CliToolServiceOptions {
  capabilities: {
    register: (provider: CapabilityProvider, handler: {
      invoke: (
        operation: string,
        args: Record<string, unknown>,
        context?: CapabilityPolicyContext,
      ) => Promise<unknown>;
    }) => void;
    deregister: (providerId: string) => void;
  };
  logger: Logger;
  gatewayProfile: GatewayCoreProfileId;
  manifestRoot: string;
  executableResolver: LocalExecutableResolver;
  workspaceService: SpaceWorkspaceService;
}

export class CliToolService {
  private readonly manifestRoot: string;
  private readonly loaded = new Map<string, RegisteredCliTool>();
  private readonly activeProviders = new Map<string, RegisteredProvider>();

  constructor(private readonly options: CliToolServiceOptions) {
    this.manifestRoot = resolvePath(options.manifestRoot);
  }

  async initialize(): Promise<void> {
    // Load and register CLI tools on all profiles.
    // On embedded profile, the approval gate in ToolAccessPolicyService
    // handles the shell.execute hard-block — tools are visible and executable
    // only after user approval.
    await mkdir(this.manifestRoot, { recursive: true });
    await this.loadFromManifestRoot();
  }

  listTools(): RegisteredCliTool[] {
    return Array.from(this.loaded.values())
      .sort((lhs, rhs) => lhs.id.localeCompare(rhs.id));
  }

  getTool(toolIdRaw: string): RegisteredCliTool | null {
    const toolId = normalizeId(toolIdRaw, "toolId");
    return this.loaded.get(toolId) ?? null;
  }

  async reloadFromManifestRoot(): Promise<RegisteredCliTool[]> {
    this.assertExternalProfile();
    await mkdir(this.manifestRoot, { recursive: true });
    await this.unregisterAllInternal();
    this.loaded.clear();
    return this.loadFromManifestRoot();
  }

  setToolHealth(
    toolIdRaw: string,
    input: {
      healthStatus: CliToolHealthStatus;
      healthMessage?: string;
    },
  ): RegisteredCliTool | null {
    const toolId = normalizeId(toolIdRaw, "toolId");
    const existing = this.loaded.get(toolId);
    if (!existing) {
      return null;
    }

    const nextTool: RegisteredCliTool = {
      ...existing,
      healthStatus: input.healthStatus,
      healthMessage: normalizeOptionalString(input.healthMessage),
    };
    this.loaded.set(toolId, nextTool);
    const activeProvider = this.activeProviders.get(toolId);
    if (activeProvider) {
      this.activeProviders.set(toolId, {
        ...activeProvider,
        tool: nextTool,
      });
    }
    return nextTool;
  }

  async previewInvocation(
    toolIdRaw: string,
    args: Record<string, unknown>,
    context?: { spaceId?: string },
  ): Promise<CliToolInvocationPreview | null> {
    const tool = this.getTool(toolIdRaw);
    if (!tool) {
      return null;
    }

    const workingDirectory = await this.resolvePreviewWorkingDirectory(tool, context?.spaceId);
    return {
      toolId: tool.id,
      displayName: tool.displayName,
      description: tool.description,
      bundleId: tool.bundleId,
      bundleDisplayName: tool.bundleDisplayName,
      bundleDescription: tool.bundleDescription,
      toolGroupId: tool.toolGroupId,
      toolGroupDisplayName: tool.toolGroupDisplayName,
      executable: tool.executable,
      resolvedExecutable: tool.resolvedExecutable,
      renderedArgs: renderArgs(tool.argsTemplate, args),
      cwdMode: tool.cwdMode,
      workingDirectory,
      outputMode: tool.outputMode,
      dangerLevel: tool.dangerLevel,
      timeoutMs: tool.timeoutMs,
      maxOutputBytes: tool.maxOutputBytes,
      instructions: tool.instructions,
      readmeSummary: summarizeReadme(tool.readmeContent, tool.description),
      readmeContent: tool.readmeContent,
    };
  }

  scaffoldTool(input: Pick<RegisterCliToolInput, "id" | "displayName" | "description" | "outputMode">): CliToolScaffoldResult {
    const id = normalizeId(input.id, "id");
    const displayName = normalizeRequiredString(input.displayName, "displayName");
    const description = normalizeRequiredString(input.description, "description");
    const outputMode = parseOutputMode(input.outputMode);

    const manifest: RegisterCliToolInput = {
      schemaVersion: CLI_TOOL_SCHEMA_VERSION,
      id,
      displayName,
      description,
      executable: "/absolute/path/to/binary",
      argsTemplate: outputMode === "json"
        ? ["--input", "{{payload}}"]
        : ["{{query}}"],
      inputSchema: defaultInputSchema(outputMode),
      instructions: defaultInstructions(displayName, outputMode),
      examples: defaultExamples(outputMode),
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
      cwdMode: "space_root",
      outputMode,
      dangerLevel: "standard",
      enabled: true,
    };

    return {
      manifest,
      readme: buildDefaultReadme(manifest),
    };
  }

  async registerTool(input: RegisterCliToolInput): Promise<RegisteredCliTool> {
    this.assertExternalProfile();
    const manifest = await this.materializeManifest(input);
    const toolDir = join(this.manifestRoot, manifest.id);
    const manifestPath = join(toolDir, "manifest.json");
    const normalizedReadme = normalizeOptionalString(input.readme);
    const readmePath = normalizedReadme ? join(toolDir, "README.md") : undefined;

    await mkdir(toolDir, { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    if (readmePath && normalizedReadme) {
      await writeFile(readmePath, `${normalizedReadme}\n`, "utf8");
    } else {
      await rm(join(toolDir, "README.md"), { force: true }).catch(() => {});
    }

    await this.unregisterToolInternal(manifest.id);
    return this.registerManifest(manifest, manifestPath);
  }

  async removeTool(toolIdRaw: string): Promise<boolean> {
    this.assertExternalProfile();
    const toolId = normalizeId(toolIdRaw, "toolId");
    const toolDir = join(this.manifestRoot, toolId);
    const existed = this.loaded.has(toolId) || existsSync(toolDir);
    await this.unregisterToolInternal(toolId);
    this.loaded.delete(toolId);
    await rm(toolDir, { recursive: true, force: true });
    return existed;
  }

  async setToolEnabled(toolIdRaw: string, enabled: boolean): Promise<RegisteredCliTool[]> {
    this.assertExternalProfile();
    const toolId = normalizeId(toolIdRaw, "toolId");
    const representative = this.loaded.get(toolId);
    if (!representative) {
      throw new CliToolServiceError("NOT_FOUND", `CLI tool not found: ${toolId}`);
    }

    const bundleIdentity = representative.bundleId?.trim() || representative.id;
    const matchingTools = Array.from(this.loaded.values())
      .filter((tool) => (tool.bundleId?.trim() || tool.id) === bundleIdentity)
      .sort((lhs, rhs) => {
        const leftId = lhs.id?.trim() || lhs.bundleId?.trim() || "";
        const rightId = rhs.id?.trim() || rhs.bundleId?.trim() || "";
        return leftId.localeCompare(rightId);
      });

    const updatedAt = new Date().toISOString();
    const updatedTools: RegisteredCliTool[] = [];
    for (const tool of matchingTools) {
      const nextTool: RegisteredCliTool = {
        ...tool,
        enabled,
        updatedAt,
      };
      this.loaded.set(tool.id, nextTool);

      const toolDir = dirname(tool.manifestPath);
      const manifestPath = join(toolDir, "manifest.json");
      await writeFile(manifestPath, `${JSON.stringify(manifestRecordFromTool(nextTool), null, 2)}\n`, "utf8");

      await this.unregisterToolInternal(tool.id);
      if (nextTool.enabled) {
        await this.registerToolProvider(nextTool);
      }
      updatedTools.push(nextTool);
    }

    return updatedTools;
  }

  private async materializeManifest(input: RegisterCliToolInput): Promise<CliToolManifestRecord> {
    return materializeCliToolManifest(input, {
      loaded: this.loaded,
      executableResolver: this.options.executableResolver,
    });
  }

  private async registerManifest(
    manifest: CliToolManifestRecord,
    manifestPath: string,
  ): Promise<RegisteredCliTool> {
    const providerId = providerIdForTool(manifest.id);
    const readmePath = existsSync(join(dirname(manifestPath), "README.md"))
      ? join(dirname(manifestPath), "README.md")
      : undefined;
    const readmeContent = readmePath ? await readFile(readmePath, "utf8").catch(() => undefined) : undefined;
    const tool: RegisteredCliTool = {
      ...manifest,
      providerId,
      available: true,
      healthStatus: "unknown",
      healthMessage: undefined,
      manifestPath,
      readmePath,
      readmeContent: normalizeOptionalString(readmeContent),
      requiresApproval: true,
    };

    this.loaded.set(manifest.id, tool);
    await this.unregisterToolInternal(manifest.id);
    if (tool.enabled) {
      await this.registerToolProvider(tool);
    }
    return tool;
  }

  private async unregisterToolInternal(toolId: string): Promise<void> {
    const existing = this.activeProviders.get(toolId);
    if (!existing) return;
    this.options.capabilities.deregister(existing.provider.id);
    this.activeProviders.delete(toolId);
  }

  private async registerToolProvider(tool: RegisteredCliTool): Promise<void> {
    const provider: CapabilityProvider = {
      id: providerIdForTool(tool.id),
      name: tool.displayName,
      source: "builtin",
      capabilityType: "shell",
      operations: [tool.id],
      available: true,
      lastHealthCheck: new Date(),
    };

    this.options.capabilities.register(provider, {
      invoke: async (_operation, args, context) => this.invokeTool(tool, args, context),
    });
    this.activeProviders.set(tool.id, { tool, provider });
  }

  private async unregisterAllInternal(): Promise<void> {
    const toolIds = Array.from(this.activeProviders.keys());
    for (const toolId of toolIds) {
      await this.unregisterToolInternal(toolId);
    }
  }

  private async loadFromManifestRoot(): Promise<RegisteredCliTool[]> {
    const entries = await readdir(this.manifestRoot, { withFileTypes: true }).catch(() => []);
    const loaded: RegisteredCliTool[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(this.manifestRoot, entry.name, "manifest.json");
      if (!existsSync(manifestPath)) continue;
      try {
        const manifest = await readCliToolManifest(manifestPath);
        loaded.push(await this.registerManifest(manifest, manifestPath));
      } catch (error) {
        this.options.logger.warn("Failed loading CLI tool manifest", {
          manifestPath,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return loaded;
  }

  private async invokeTool(
    tool: RegisteredCliTool,
    args: Record<string, unknown>,
    context?: CapabilityPolicyContext,
  ): Promise<unknown> {
    if (!tool.enabled) {
      throw new CliToolServiceError(
        "FAILED_PRECONDITION",
        `CLI tool ${tool.id} is disabled.`,
      );
    }
    const argv = renderArgs(tool.argsTemplate, args);
    const cwd = await this.resolveWorkingDirectory(tool, context);
    return executeCliTool({
      executable: tool.resolvedExecutable,
      args: argv,
      cwd,
      timeoutMs: tool.timeoutMs,
      maxOutputBytes: tool.maxOutputBytes,
      outputMode: tool.outputMode,
      logger: this.options.logger,
      toolId: tool.id,
    });
  }

  private async resolveWorkingDirectory(
    tool: RegisteredCliTool,
    context?: CapabilityPolicyContext,
  ): Promise<string | undefined> {
    if (tool.cwdMode === "fixed") {
      return tool.fixedCwd;
    }
    const spaceId = context?.spaceId?.trim();
    if (!spaceId) {
      throw new CliToolServiceError(
        "FAILED_PRECONDITION",
        `CLI tool ${tool.id} requires a space workspace context.`,
      );
    }
    const workspace = await this.options.workspaceService.getWorkspace(spaceId);
    return workspace.effectiveWorkspaceRoot;
  }

  private async resolvePreviewWorkingDirectory(
    tool: RegisteredCliTool,
    spaceId?: string,
  ): Promise<string | undefined> {
    if (tool.cwdMode === "fixed") {
      return tool.fixedCwd;
    }
    const normalizedSpaceId = normalizeOptionalString(spaceId);
    if (!normalizedSpaceId) {
      return undefined;
    }
    const workspace = await this.options.workspaceService.getWorkspace(normalizedSpaceId);
    return workspace.effectiveWorkspaceRoot;
  }

  private isExternalProfile(): boolean {
    return this.options.gatewayProfile === "external";
  }

  private assertExternalProfile(): void {
    if (!this.isExternalProfile()) {
      throw new CliToolServiceError(
        "FAILED_PRECONDITION",
        "CLI tools are only supported on external gateways.",
      );
    }
  }
}
