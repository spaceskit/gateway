import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { spawn } from "node:child_process";
import type { CapabilityProvider, CapabilityPolicyContext } from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import type { GatewayCoreProfileId } from "@spaceskit/gateway-core";
import { LocalExecutableResolver } from "../execution/local-executable-resolver.js";
import type { SpaceWorkspaceService } from "./space-workspace-service.js";

export type CliToolCwdMode = "space_root" | "fixed";
export type CliToolOutputMode = "text" | "json";
export type CliToolDangerLevel = "standard" | "destructive";
export type CliToolHealthStatus = "unknown" | "ok" | "degraded";

export interface CliToolExampleRecord {
  name: string;
  description?: string;
  arguments: Record<string, unknown>;
  expectedOutput?: string;
}

export interface CliToolManifestRecord {
  schemaVersion: number;
  id: string;
  displayName: string;
  description: string;
  bundleId?: string;
  bundleDisplayName?: string;
  bundleDescription?: string;
  toolGroupId?: string;
  toolGroupDisplayName?: string;
  executable: string;
  resolvedExecutable: string;
  argsTemplate: string[];
  inputSchema: Record<string, unknown>;
  instructions?: string;
  examples: CliToolExampleRecord[];
  timeoutMs: number;
  maxOutputBytes: number;
  cwdMode: CliToolCwdMode;
  fixedCwd?: string;
  outputMode: CliToolOutputMode;
  dangerLevel: CliToolDangerLevel;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterCliToolInput {
  schemaVersion?: number;
  id: string;
  displayName: string;
  description: string;
  bundleId?: string;
  bundleDisplayName?: string;
  bundleDescription?: string;
  toolGroupId?: string;
  toolGroupDisplayName?: string;
  executable: string;
  argsTemplate: string[];
  inputSchema: Record<string, unknown>;
  instructions?: string;
  examples?: CliToolExampleRecord[];
  timeoutMs?: number;
  maxOutputBytes?: number;
  cwdMode: CliToolCwdMode;
  fixedCwd?: string;
  outputMode: CliToolOutputMode;
  dangerLevel?: CliToolDangerLevel;
  readme?: string;
  enabled?: boolean;
}

export interface RegisteredCliTool extends CliToolManifestRecord {
  providerId: string;
  available: boolean;
  healthStatus: CliToolHealthStatus;
  healthMessage?: string;
  manifestPath: string;
  readmePath?: string;
  readmeContent?: string;
  requiresApproval: boolean;
}

export interface CliToolScaffoldResult {
  manifest: RegisterCliToolInput;
  readme: string;
}

export interface CliToolInvocationPreview {
  toolId: string;
  displayName: string;
  description: string;
  bundleId?: string;
  bundleDisplayName?: string;
  bundleDescription?: string;
  toolGroupId?: string;
  toolGroupDisplayName?: string;
  executable: string;
  resolvedExecutable: string;
  renderedArgs: string[];
  cwdMode: CliToolCwdMode;
  workingDirectory?: string;
  outputMode: CliToolOutputMode;
  dangerLevel: CliToolDangerLevel;
  timeoutMs: number;
  maxOutputBytes: number;
  instructions?: string;
  readmeSummary?: string;
  readmeContent?: string;
}

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

const CLI_TOOL_SCHEMA_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

export class CliToolServiceError extends Error {
  readonly code:
    | "INVALID_ARGUMENT"
    | "NOT_FOUND"
    | "FAILED_PRECONDITION";

  constructor(code: CliToolServiceError["code"], message: string) {
    super(message);
    this.code = code;
  }
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
      await writeFile(manifestPath, `${JSON.stringify(this.manifestRecordFromTool(nextTool), null, 2)}\n`, "utf8");

      await this.unregisterToolInternal(tool.id);
      if (nextTool.enabled) {
        await this.registerToolProvider(nextTool);
      }
      updatedTools.push(nextTool);
    }

    return updatedTools;
  }

  private async materializeManifest(input: RegisterCliToolInput): Promise<CliToolManifestRecord> {
    const schemaVersion = normalizeSchemaVersion(input.schemaVersion);
    const id = normalizeId(input.id, "id");
    const displayName = normalizeRequiredString(input.displayName, "displayName");
    const description = normalizeRequiredString(input.description, "description");
    const bundleId = normalizeOptionalString(input.bundleId);
    const bundleDisplayName = bundleId ? normalizeOptionalString(input.bundleDisplayName) : undefined;
    const bundleDescription = bundleId ? normalizeOptionalString(input.bundleDescription) : undefined;
    const toolGroupId = bundleId ? normalizeOptionalString(input.toolGroupId) : undefined;
    const toolGroupDisplayName = bundleId && toolGroupId
      ? normalizeOptionalString(input.toolGroupDisplayName)
      : undefined;
    const executable = normalizeRequiredString(input.executable, "executable");
    const argsTemplate = normalizeArgsTemplate(input.argsTemplate);
    const cwdMode = parseCwdMode(input.cwdMode);
    const fixedCwd = cwdMode === "fixed"
      ? normalizeAbsolutePath(input.fixedCwd, "fixedCwd")
      : undefined;
    const outputMode = parseOutputMode(input.outputMode);
    const timeoutMs = normalizeTimeout(input.timeoutMs);
    const maxOutputBytes = normalizeMaxOutputBytes(input.maxOutputBytes);
    const inputSchema = normalizeInputSchema(input.inputSchema);
    const instructions = normalizeOptionalString(input.instructions) ?? defaultInstructions(displayName, outputMode);
    const examples = normalizeExamples(input.examples, outputMode);
    const dangerLevel = parseDangerLevel(input.dangerLevel);
    const enabled = input.enabled ?? this.loaded.get(id)?.enabled ?? true;

    const resolved = await this.options.executableResolver.resolveAsync({
      cacheKey: `cli-tool:${id}`,
      commands: [executable],
      versionProbe: { args: ["--version"], timeoutMs: 750 },
      manualPath: isAbsolute(executable) ? executable : undefined,
    });
    if (!resolved.path) {
      throw new CliToolServiceError(
        "FAILED_PRECONDITION",
        resolved.error
          ? `Failed resolving CLI tool executable: ${resolved.error}`
          : `Failed resolving CLI tool executable: ${executable}`,
      );
    }

    const now = new Date().toISOString();
    const existing = this.loaded.get(id);
    return {
      schemaVersion,
      id,
      displayName,
      description,
      bundleId,
      bundleDisplayName,
      bundleDescription,
      toolGroupId,
      toolGroupDisplayName,
      executable,
      resolvedExecutable: resolved.path,
      argsTemplate,
      inputSchema,
      instructions,
      examples,
      timeoutMs,
      maxOutputBytes,
      cwdMode,
      fixedCwd,
      outputMode,
      dangerLevel,
      enabled,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
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
        const manifest = await this.readManifest(manifestPath);
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

  private manifestRecordFromTool(tool: RegisteredCliTool): CliToolManifestRecord {
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
      executable: tool.executable,
      resolvedExecutable: tool.resolvedExecutable,
      argsTemplate: [...tool.argsTemplate],
      inputSchema: { ...tool.inputSchema },
      instructions: tool.instructions,
      examples: tool.examples.map((example) => ({ ...example, arguments: { ...example.arguments } })),
      timeoutMs: tool.timeoutMs,
      maxOutputBytes: tool.maxOutputBytes,
      cwdMode: tool.cwdMode,
      fixedCwd: tool.fixedCwd,
      outputMode: tool.outputMode,
      dangerLevel: tool.dangerLevel,
      enabled: tool.enabled,
      createdAt: tool.createdAt,
      updatedAt: tool.updatedAt,
    };
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

  private async readManifest(path: string): Promise<CliToolManifestRecord> {
    const raw = JSON.parse(await readFile(path, "utf8")) as Partial<CliToolManifestRecord>;
    const outputMode = parseOutputMode(raw.outputMode);
    return {
      schemaVersion: normalizeSchemaVersion(raw.schemaVersion),
      id: normalizeId(raw.id, "id"),
      displayName: normalizeRequiredString(raw.displayName, "displayName"),
      description: normalizeRequiredString(raw.description, "description"),
      bundleId: normalizeOptionalString(raw.bundleId),
      bundleDisplayName: normalizeOptionalString(raw.bundleDisplayName),
      bundleDescription: normalizeOptionalString(raw.bundleDescription),
      toolGroupId: normalizeOptionalString(raw.toolGroupId),
      toolGroupDisplayName: normalizeOptionalString(raw.toolGroupDisplayName),
      executable: normalizeRequiredString(raw.executable, "executable"),
      resolvedExecutable: normalizeAbsolutePath(raw.resolvedExecutable, "resolvedExecutable"),
      argsTemplate: normalizeArgsTemplate(raw.argsTemplate),
      inputSchema: normalizeInputSchema(raw.inputSchema),
      instructions: normalizeOptionalString(raw.instructions),
      examples: normalizeExamples(raw.examples, outputMode),
      timeoutMs: normalizeTimeout(raw.timeoutMs),
      maxOutputBytes: normalizeMaxOutputBytes(raw.maxOutputBytes),
      cwdMode: parseCwdMode(raw.cwdMode),
      fixedCwd: raw.cwdMode === "fixed"
        ? normalizeAbsolutePath(raw.fixedCwd, "fixedCwd")
        : undefined,
      outputMode,
      dangerLevel: parseDangerLevel(raw.dangerLevel),
      enabled: raw.enabled ?? true,
      createdAt: normalizeIsoTimestamp(raw.createdAt) ?? new Date().toISOString(),
      updatedAt: normalizeIsoTimestamp(raw.updatedAt) ?? new Date().toISOString(),
    };
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

async function executeCliTool(input: {
  executable: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  outputMode: CliToolOutputMode;
  logger: Logger;
  toolId: string;
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.executable, input.args, {
      cwd: input.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let outputOverflow = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 250).unref();
    }, input.timeoutMs);

    const onChunk = (chunk: string, target: "stdout" | "stderr") => {
      if (target === "stdout") {
        stdout += chunk;
      } else {
        stderr += chunk;
      }
      if (Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(stderr, "utf8") > input.maxOutputBytes) {
        outputOverflow = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 250).unref();
      }
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      onChunk(chunk, "stdout");
    });
    child.stderr?.on("data", (chunk: string) => {
      onChunk(chunk, "stderr");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new CliToolServiceError(
          "FAILED_PRECONDITION",
          `CLI tool ${input.toolId} timed out after ${input.timeoutMs}ms.`,
        ));
        return;
      }
      if (outputOverflow) {
        reject(new CliToolServiceError(
          "FAILED_PRECONDITION",
          `CLI tool ${input.toolId} exceeded max output size (${input.maxOutputBytes} bytes).`,
        ));
        return;
      }
      if (code !== 0) {
        reject(new CliToolServiceError(
          "FAILED_PRECONDITION",
          stderr.trim() || `CLI tool ${input.toolId} exited with code ${code}.`,
        ));
        return;
      }
      const trimmed = stdout.trim();
      if (input.outputMode === "json") {
        try {
          resolve(trimmed ? JSON.parse(trimmed) : {});
          return;
        } catch (error) {
          input.logger.warn("Failed parsing CLI tool JSON output", {
            toolId: input.toolId,
            message: error instanceof Error ? error.message : String(error),
          });
          reject(new CliToolServiceError(
            "FAILED_PRECONDITION",
            `CLI tool ${input.toolId} returned invalid JSON output.`,
          ));
          return;
        }
      }
      resolve(trimmed);
    });
  });
}

function renderArgs(template: string[], args: Record<string, unknown>): string[] {
  return template.map((entry) =>
    entry.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
      const value = args[key];
      if (value === undefined || value === null) {
        return "";
      }
      if (typeof value === "string") {
        return value;
      }
      return JSON.stringify(value);
    }),
  );
}

function providerIdForTool(toolId: string): string {
  return `cli-tool-${toolId}`;
}

function defaultInputSchema(outputMode: CliToolOutputMode): Record<string, unknown> {
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

function defaultInstructions(displayName: string, outputMode: CliToolOutputMode): string {
  return outputMode === "json"
    ? `Use ${displayName} when structured JSON output is needed. Prefer the documented arguments and avoid speculative fields.`
    : `Use ${displayName} for focused external command execution. Keep arguments minimal and expect plain-text output.`;
}

function defaultExamples(outputMode: CliToolOutputMode): CliToolExampleRecord[] {
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

function buildDefaultReadme(manifest: RegisterCliToolInput): string {
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

function normalizeId(value: unknown, field: string): string {
  const normalized = normalizeRequiredString(value, field)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    throw new CliToolServiceError("INVALID_ARGUMENT", `${field} must contain at least one identifier character.`);
  }
  return normalized;
}

function normalizeRequiredString(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new CliToolServiceError("INVALID_ARGUMENT", `${field} is required.`);
  }
  return normalized;
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

function normalizeAbsolutePath(value: unknown, field: string): string {
  const normalized = normalizeRequiredString(value, field);
  if (!isAbsolute(normalized)) {
    throw new CliToolServiceError("INVALID_ARGUMENT", `${field} must be an absolute path.`);
  }
  return resolvePath(normalized);
}

function normalizeArgsTemplate(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CliToolServiceError("INVALID_ARGUMENT", "argsTemplate must be a non-empty string array.");
  }
  return value.map((entry, index) => normalizeRequiredString(entry, `argsTemplate[${index}]`));
}

function normalizeInputSchema(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliToolServiceError("INVALID_ARGUMENT", "inputSchema must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function normalizeExamples(
  value: unknown,
  outputMode: CliToolOutputMode,
): CliToolExampleRecord[] {
  if (value === undefined || value === null) {
    return defaultExamples(outputMode);
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new CliToolServiceError("INVALID_ARGUMENT", "examples must be an array when provided.");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new CliToolServiceError("INVALID_ARGUMENT", `examples[${index}] must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    return {
      name: normalizeRequiredString(record.name, `examples[${index}].name`),
      description: normalizeOptionalString(record.description),
      arguments: normalizeInputSchema(record.arguments),
      expectedOutput: normalizeOptionalString(record.expectedOutput),
    };
  });
}

function parseCwdMode(value: unknown): CliToolCwdMode {
  if (value === "space_root" || value === "fixed") {
    return value;
  }
  throw new CliToolServiceError("INVALID_ARGUMENT", "cwdMode must be \"space_root\" or \"fixed\".");
}

function parseOutputMode(value: unknown): CliToolOutputMode {
  if (value === "text" || value === "json") {
    return value;
  }
  throw new CliToolServiceError("INVALID_ARGUMENT", "outputMode must be \"text\" or \"json\".");
}

function parseDangerLevel(value: unknown): CliToolDangerLevel {
  if (value === undefined || value === null || value === "standard") {
    return "standard";
  }
  if (value === "destructive") {
    return "destructive";
  }
  throw new CliToolServiceError("INVALID_ARGUMENT", "dangerLevel must be \"standard\" or \"destructive\".");
}

function normalizeSchemaVersion(value: unknown): number {
  const schemaVersion = typeof value === "number" ? Math.trunc(value) : CLI_TOOL_SCHEMA_VERSION;
  if (schemaVersion !== CLI_TOOL_SCHEMA_VERSION) {
    throw new CliToolServiceError(
      "INVALID_ARGUMENT",
      `schemaVersion must be ${CLI_TOOL_SCHEMA_VERSION}.`,
    );
  }
  return schemaVersion;
}

function normalizeTimeout(value: unknown): number {
  const timeout = typeof value === "number" ? value : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new CliToolServiceError("INVALID_ARGUMENT", "timeoutMs must be a positive number.");
  }
  return Math.trunc(timeout);
}

function normalizeMaxOutputBytes(value: unknown): number {
  const maxOutputBytes = typeof value === "number" ? value : DEFAULT_MAX_OUTPUT_BYTES;
  if (!Number.isFinite(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new CliToolServiceError("INVALID_ARGUMENT", "maxOutputBytes must be a positive number.");
  }
  return Math.trunc(maxOutputBytes);
}

function normalizeIsoTimestamp(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

function summarizeReadme(
  readmeContent: string | undefined,
  fallbackDescription: string,
): string | undefined {
  const normalized = normalizeOptionalString(readmeContent);
  if (!normalized) {
    return normalizeOptionalString(fallbackDescription);
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  return lines[0] ?? normalizeOptionalString(fallbackDescription);
}
