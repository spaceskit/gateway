import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CapabilityRegistry, EventBus } from "@spaceskit/core";
import { Logger } from "@spaceskit/observability";
import { LocalExecutableResolver } from "../src/execution/local-executable-resolver.js";
import { CliToolService } from "../src/services/cli-tool-service.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("CliToolService", () => {
  test("scaffolds CLI bundle templates with README guidance", async () => {
    const registry = new CapabilityRegistry(new EventBus());
    const root = mkdtempSync(join(tmpdir(), "spaces-cli-tools-"));
    tempDirs.push(root);

    const service = new CliToolService({
      capabilities: registry,
      logger: new Logger({ service: "cli-tool-test" }),
      gatewayProfile: "external",
      manifestRoot: join(root, "manifests"),
      executableResolver: new LocalExecutableResolver(),
      workspaceService: {
        getWorkspace: async () => {
          throw new Error("unused");
        },
      } as any,
    });

    const scaffold = service.scaffoldTool({
      id: "json-status",
      displayName: "JSON Status",
      description: "Returns structured status details.",
      outputMode: "json",
    });

    expect(scaffold.manifest.schemaVersion).toBe(1);
    expect(scaffold.manifest.maxOutputBytes).toBe(64 * 1024);
    expect(scaffold.manifest.examples?.length).toBeGreaterThanOrEqual(3);
    expect(scaffold.readme).toContain("## Safety");
    expect(scaffold.readme).toContain("## Approval Guidance");
  });

  test("keeps disabled CLI tools loaded but out of the capability registry until enabled", async () => {
    const registry = new CapabilityRegistry(new EventBus());
    const root = mkdtempSync(join(tmpdir(), "spaces-cli-tools-"));
    tempDirs.push(root);

    const service = new CliToolService({
      capabilities: registry,
      logger: new Logger({ service: "cli-tool-test" }),
      gatewayProfile: "external",
      manifestRoot: join(root, "manifests"),
      executableResolver: new LocalExecutableResolver(),
      workspaceService: {
        getWorkspace: async () => {
          throw new Error("unused");
        },
      } as any,
    });

    await service.initialize();
    const tool = await service.registerTool({
      id: "disabled.echo",
      displayName: "Disabled Echo",
      description: "Echoes text when enabled.",
      executable: process.execPath,
      argsTemplate: ["-e", "process.stdout.write('ok')"],
      inputSchema: { type: "object", properties: {} },
      cwdMode: "fixed",
      fixedCwd: root,
      outputMode: "text",
      enabled: false,
    });

    expect(tool.enabled).toBe(false);
    expect(service.listTools().map((entry) => entry.id)).toEqual(["disabled.echo"]);
    expect(registry.getProviders("shell")).toHaveLength(0);

    const updated = await service.setToolEnabled("disabled.echo", true);
    expect(updated).toHaveLength(1);
    expect(updated[0]?.enabled).toBe(true);
    expect(service.getTool("disabled.echo")?.enabled).toBe(true);
    expect(registry.getProviders("shell")).toHaveLength(1);
  });

  test("setToolEnabled flips every tool in the bundle together", async () => {
    const registry = new CapabilityRegistry(new EventBus());
    const root = mkdtempSync(join(tmpdir(), "spaces-cli-tools-"));
    tempDirs.push(root);

    const service = new CliToolService({
      capabilities: registry,
      logger: new Logger({ service: "cli-tool-test" }),
      gatewayProfile: "external",
      manifestRoot: join(root, "manifests"),
      executableResolver: new LocalExecutableResolver(),
      workspaceService: {
        getWorkspace: async () => {
          throw new Error("unused");
        },
      } as any,
    });

    await service.initialize();
    await service.registerTool({
      id: "jira.issue.view",
      displayName: "Jira Issue View",
      description: "View an issue.",
      bundleId: "jira-cli",
      bundleDisplayName: "Jira CLI",
      executable: process.execPath,
      argsTemplate: ["-e", "process.stdout.write('view')"],
      inputSchema: { type: "object", properties: {} },
      cwdMode: "fixed",
      fixedCwd: root,
      outputMode: "text",
    });
    await service.registerTool({
      id: "jira.issue.create",
      displayName: "Jira Issue Create",
      description: "Create an issue.",
      bundleId: "jira-cli",
      bundleDisplayName: "Jira CLI",
      executable: process.execPath,
      argsTemplate: ["-e", "process.stdout.write('create')"],
      inputSchema: { type: "object", properties: {} },
      cwdMode: "fixed",
      fixedCwd: root,
      outputMode: "text",
    });

    expect(registry.getProviders("shell")).toHaveLength(2);

    const disabled = await service.setToolEnabled("jira.issue.view", false);
    expect(disabled.map((tool) => tool.id).sort()).toEqual([
      "jira.issue.create",
      "jira.issue.view",
    ]);
    expect(disabled.every((tool) => tool.enabled === false)).toBe(true);
    expect(registry.getProviders("shell")).toHaveLength(0);

    const reenabled = await service.setToolEnabled("jira.issue.create", true);
    expect(reenabled.every((tool) => tool.enabled === true)).toBe(true);
    expect(registry.getProviders("shell")).toHaveLength(2);
  });

  test("registers external CLI tools into the capability registry and executes in the space root", async () => {
    const registry = new CapabilityRegistry(new EventBus());
    const root = mkdtempSync(join(tmpdir(), "spaces-cli-tools-"));
    tempDirs.push(root);

    const workspaceRoot = join(root, "space-root");
    mkdirSync(workspaceRoot, { recursive: true });

    const service = new CliToolService({
      capabilities: registry,
      logger: new Logger({ service: "cli-tool-test" }),
      gatewayProfile: "external",
      manifestRoot: join(root, "manifests"),
      executableResolver: new LocalExecutableResolver(),
      workspaceService: {
        getWorkspace: async () => ({
          spaceId: "space-1",
          spaceUid: "space-uid-1",
          mode: "folder_bound",
          effectiveWorkspaceRoot: workspaceRoot,
          metaPath: join(workspaceRoot, ".space"),
          logsPath: join(workspaceRoot, ".space", "logs"),
          workPath: join(workspaceRoot, ".space", "work"),
          sharedContextPath: join(workspaceRoot, ".space", "shared-context"),
          scratchpadsPath: join(workspaceRoot, ".space", "scratchpads"),
          layoutVersion: 2,
          gitRepoDetected: false,
          metadataStatus: "ready",
          updatedAt: new Date().toISOString(),
        }),
      } as any,
    });

    await service.initialize();
    const tool = await service.registerTool({
      id: "print-cwd",
      displayName: "Print CWD",
      description: "Print the current working directory.",
      bundleId: "diagnostics",
      bundleDisplayName: "Diagnostics",
      bundleDescription: "Workspace inspection helpers.",
      toolGroupId: "workspace",
      toolGroupDisplayName: "Workspace",
      executable: process.execPath,
      argsTemplate: ["-e", "process.stdout.write(process.cwd())"],
      inputSchema: { type: "object", properties: {} },
      cwdMode: "space_root",
      outputMode: "text",
    });

    expect(tool.requiresApproval).toBe(true);
    expect(tool.resolvedExecutable).toBe(process.execPath);
    expect(tool.bundleId).toBe("diagnostics");
    expect(tool.bundleDisplayName).toBe("Diagnostics");
    expect(tool.bundleDescription).toBe("Workspace inspection helpers.");
    expect(tool.toolGroupId).toBe("workspace");
    expect(tool.toolGroupDisplayName).toBe("Workspace");
    expect(service.listTools().map((entry) => entry.id)).toEqual(["print-cwd"]);

    const result = await registry.invoke(
      {
        capability: "shell",
        operation: "print-cwd",
        args: {},
      },
      { spaceId: "space-1" },
    );

    expect("data" in result && result.data).toBe(realpathSync(workspaceRoot));
  });

  test("rejects CLI tool output that exceeds the configured max size", async () => {
    const registry = new CapabilityRegistry(new EventBus());
    const root = mkdtempSync(join(tmpdir(), "spaces-cli-tools-"));
    tempDirs.push(root);

    const workspaceRoot = join(root, "space-root");
    mkdirSync(workspaceRoot, { recursive: true });

    const service = new CliToolService({
      capabilities: registry,
      logger: new Logger({ service: "cli-tool-test" }),
      gatewayProfile: "external",
      manifestRoot: join(root, "manifests"),
      executableResolver: new LocalExecutableResolver(),
      workspaceService: {
        getWorkspace: async () => ({
          spaceId: "space-1",
          spaceUid: "space-uid-1",
          mode: "folder_bound",
          effectiveWorkspaceRoot: workspaceRoot,
          metaPath: join(workspaceRoot, ".space"),
          logsPath: join(workspaceRoot, ".space", "logs"),
          workPath: join(workspaceRoot, ".space", "work"),
          sharedContextPath: join(workspaceRoot, ".space", "shared-context"),
          scratchpadsPath: join(workspaceRoot, ".space", "scratchpads"),
          layoutVersion: 2,
          gitRepoDetected: false,
          metadataStatus: "ready",
          updatedAt: new Date().toISOString(),
        }),
      } as any,
    });

    await service.initialize();
    await service.registerTool({
      id: "too-chatty",
      displayName: "Too Chatty",
      description: "Print a lot of output.",
      executable: process.execPath,
      argsTemplate: ["-e", "process.stdout.write('x'.repeat(2048))"],
      inputSchema: { type: "object", properties: {} },
      cwdMode: "space_root",
      outputMode: "text",
      maxOutputBytes: 128,
    });

    await expect(registry.invoke(
      {
        capability: "shell",
        operation: "too-chatty",
        args: {},
      },
      { spaceId: "space-1" },
    )).rejects.toMatchObject({
      code: "FAILED_PRECONDITION",
    });
  });

  test("rejects CLI tool registration on embedded gateways", async () => {
    const registry = new CapabilityRegistry(new EventBus());
    const root = mkdtempSync(join(tmpdir(), "spaces-cli-tools-"));
    tempDirs.push(root);

    const service = new CliToolService({
      capabilities: registry,
      logger: new Logger({ service: "cli-tool-test" }),
      gatewayProfile: "embedded",
      manifestRoot: join(root, "manifests"),
      executableResolver: new LocalExecutableResolver(),
      workspaceService: {
        getWorkspace: async () => {
          throw new Error("unused");
        },
      } as any,
    });

    await expect(service.registerTool({
      id: "print-cwd",
      displayName: "Print CWD",
      description: "Print the current working directory.",
      executable: process.execPath,
      argsTemplate: ["-e", "process.stdout.write(process.cwd())"],
      inputSchema: { type: "object", properties: {} },
      cwdMode: "space_root",
      outputMode: "text",
    })).rejects.toMatchObject({
      code: "FAILED_PRECONDITION",
    });
  });
});
