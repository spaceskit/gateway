import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CapabilityRegistry, EventBus } from "@spaceskit/core";
import { Logger } from "@spaceskit/observability";
import { LocalExecutableResolver } from "../src/execution/local-executable-resolver.js";
import { InterconnectorCatalogService } from "../src/services/interconnector-catalog-service.js";
import { CliToolService } from "../src/services/cli-tool-service.js";
import { JiraCliBundleService } from "../src/services/jira-cli-bundle-service.js";
import { JIRA_CLI_SKILL_ENTRY_ID } from "../src/seed/jira-cli-skill.js";
import {
  buildJiraCommandArgs,
  runJiraOperation,
} from "../../../scripts/jira-cli-tools/spaces-jira.mjs";
import {
  materializeJiraCliTools,
  resolveDefaultSpacesJiraWrapperPath,
} from "../../../scripts/jira-cli-tools/materialize-jira-cli-tools.mjs";

const tempDirs: string[] = [];
const COMPACT_ISSUE_COLUMNS = "key,summary,status,assignee,reporter,priority,updated";

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("jira cli bundle wrapper", () => {
  test("builds issue list argv with compact bounded defaults", () => {
    expect(buildJiraCommandArgs("issue.list", {
      project: "OPS",
      query: "connector",
      status: ["In Progress", "Done"],
      labels: ["backend"],
      assignee: "alice@example.com",
      limit: 25,
    })).toEqual([
      "--project",
      "OPS",
      "issue",
      "list",
      "connector",
      "--status",
      "In Progress",
      "--status",
      "Done",
      "--assignee",
      "alice@example.com",
      "--label",
      "backend",
      "--paginate",
      "0:25",
      "--plain",
      "--no-headers",
      "--no-truncate",
      "--delimiter",
      "|||",
      "--columns",
      COMPACT_ISSUE_COLUMNS,
    ]);
  });

  test("supports raw detail while rejecting inline ORDER BY and offset pagination", () => {
    expect(buildJiraCommandArgs("issue.list", {
      project: "OPS",
      detail: "raw",
      limit: 5,
      orderBy: "updated",
      reverse: true,
    })).toEqual([
      "--project",
      "OPS",
      "issue",
      "list",
      "--order-by",
      "updated",
      "--reverse",
      "--paginate",
      "0:5",
      "--raw",
    ]);

    expect(() => buildJiraCommandArgs("issue.list", {
      jql: "summary ~ \"connector\" ORDER BY updated DESC",
    })).toThrow("Use `orderBy` and `reverse` instead.");

    expect(() => buildJiraCommandArgs("issue.list", {
      paginate: "10:20",
    })).toThrow("jira-cli 1.7.x offset pagination is unreliable");
  });

  test("passes Jira host config env through to the runner", async () => {
    const root = mkdtempSync(join(tmpdir(), "spaces-jira-env-"));
    tempDirs.push(root);
    const fakeBin = join(root, "bin");
    mkdirSync(fakeBin, { recursive: true });
    const fakeJira = join(fakeBin, "jira");
    writeFileSync(fakeJira, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    chmodSync(fakeJira, 0o755);

    let captured: { executable: string; args: string[]; env: NodeJS.ProcessEnv } | null = null;

    await runJiraOperation({
      operation: "issue.view",
      payload: { issueKey: "OPS-123" },
      env: {
        PATH: fakeBin,
        JIRA_CONFIG_FILE: "/tmp/jira.yml",
        JIRA_API_TOKEN: "secret-token",
      },
    }, {
      runCommand: async (input) => {
        captured = input;
        return {
          exitCode: 0,
          stdout: "{\"key\":\"OPS-123\"}",
          stderr: "",
        };
      },
    });

    expect(captured?.executable).toBe(fakeJira);
    expect(captured?.env.PATH).toBe(fakeBin);
    expect(captured?.env.JIRA_CONFIG_FILE).toBe("/tmp/jira.yml");
    expect(captured?.env.JIRA_API_TOKEN).toBe("secret-token");
  });

  test("normalizes issue mutation output into a refreshed issue payload", async () => {
    const calls: string[][] = [];

    const result = await runJiraOperation({
      operation: "issue.move",
      payload: {
        issueKey: "OPS-123",
        state: "In Progress",
        comment: "Started implementation.",
      },
      env: {
        PATH: "/tmp/fake-bin",
      },
    }, {
      runCommand: async (input) => {
        calls.push(input.args);
        if (calls.length === 1) {
          return {
            exitCode: 0,
            stdout: "transitioned",
            stderr: "",
          };
        }
        return {
          exitCode: 0,
          stdout: "{\"key\":\"OPS-123\",\"fields\":{\"summary\":\"Updated issue\"}}",
          stderr: "",
        };
      },
    });

    expect(calls).toEqual([
      ["issue", "move", "OPS-123", "In Progress", "--comment", "Started implementation."],
      ["issue", "view", "OPS-123", "--raw"],
    ]);
    expect(result.summary).toBe("Moved Jira issue OPS-123 to In Progress.");
    expect((result.data as { key: string }).key).toBe("OPS-123");
  });

  test("surfaces command failures and invalid raw JSON", async () => {
    await expect(runJiraOperation({
      operation: "issue.view",
      payload: { issueKey: "OPS-123" },
      env: { PATH: "/tmp/fake-bin" },
    }, {
      runCommand: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "jira exploded",
      }),
    })).rejects.toThrow("jira exploded");

    await expect(runJiraOperation({
      operation: "issue.view",
      payload: { issueKey: "OPS-123" },
      env: { PATH: "/tmp/fake-bin" },
    }, {
      runCommand: async () => ({
        exitCode: 0,
        stdout: "not-json",
        stderr: "",
      }),
    })).rejects.toThrow("returned invalid JSON output");
  });

  test("parses compact Jira issue list output into summary rows", async () => {
    const result = await runJiraOperation({
      operation: "issue.list",
      payload: {
        project: "OPS",
        limit: 2,
      },
      env: { PATH: "/tmp/fake-bin" },
    }, {
      runCommand: async (input) => {
        expect(input.args).toEqual([
          "--project",
          "OPS",
          "issue",
          "list",
          "--paginate",
          "0:2",
          "--plain",
          "--no-headers",
          "--no-truncate",
          "--delimiter",
          "|||",
          "--columns",
          COMPACT_ISSUE_COLUMNS,
        ]);
        return {
          exitCode: 0,
          stdout: [
            "OPS-1|||First summary|||In Progress|||Alice|||Bob|||High|||2026-04-07 11:00:00",
            "OPS-2|||Second summary|||||||||Carmine|||Low|||2026-04-07 12:00:00",
          ].join("\n"),
          stderr: "",
        };
      },
    });

    expect(result.summary).toBe("Listed Jira issues.");
    expect(result.data).toEqual([
      {
        key: "OPS-1",
        summary: "First summary",
        status: "In Progress",
        assignee: "Alice",
        reporter: "Bob",
        priority: "High",
        updated: "2026-04-07 11:00:00",
      },
      {
        key: "OPS-2",
        summary: "Second summary",
        status: null,
        assignee: null,
        reporter: "Carmine",
        priority: "Low",
        updated: "2026-04-07 12:00:00",
      },
    ]);
    expect(result.refs).toEqual({
      project: "OPS",
      issueKeys: ["OPS-1", "OPS-2"],
    });
  });
});

describe("jira cli bundle materializer", () => {
  test("writes ready-to-load manifest bundles with absolute wrapper paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "spaces-jira-bundle-"));
    tempDirs.push(root);

    const result = await materializeJiraCliTools({
      targetDir: join(root, "cli-tools"),
    });

    expect(result.toolCount).toBe(22);
    const wrapperPath = resolveDefaultSpacesJiraWrapperPath();
    const issueViewManifest = JSON.parse(
      readFileSync(join(result.targetDir, "jira.issue.view", "manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    const sprintCloseManifest = JSON.parse(
      readFileSync(join(result.targetDir, "jira.sprint.close", "manifest.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(issueViewManifest.executable).toBe(wrapperPath);
    expect(issueViewManifest.resolvedExecutable).toBe(wrapperPath);
    expect(issueViewManifest.argsTemplate).toEqual(["--op", "issue.view", "--payload", "{{payload}}"]);
    expect(issueViewManifest.outputMode).toBe("json");
    expect(issueViewManifest.cwdMode).toBe("fixed");
    expect(issueViewManifest.bundleId).toBe("jira-cli");
    expect(issueViewManifest.bundleDisplayName).toBe("Jira CLI");
    expect(issueViewManifest.toolGroupId).toBe("issues");
    expect(issueViewManifest.toolGroupDisplayName).toBe("Issues");
    expect(sprintCloseManifest.dangerLevel).toBe("destructive");
    expect(sprintCloseManifest.toolGroupId).toBe("sprints");
    expect(readFileSync(join(result.targetDir, "jira.issue.view", "README.md"), "utf8")).toContain(
      "Host Jira Configuration",
    );
  });
});

describe("jira cli bundle integration with CliToolService", () => {
  test("loads materialized manifests, exposes shell tools, and invokes the wrapper through a fake jira binary", async () => {
    const root = mkdtempSync(join(tmpdir(), "spaces-jira-runtime-"));
    tempDirs.push(root);

    const fakeBin = join(root, "bin");
    mkdirSync(fakeBin, { recursive: true });
    const fakeJira = join(fakeBin, "jira");
    writeFileSync(fakeJira, [
      "#!/usr/bin/env bash",
      "set -eu",
      "if [ \"$1\" = \"issue\" ] && [ \"$2\" = \"view\" ] && [ \"$3\" = \"OPS-123\" ] && [ \"$4\" = \"--raw\" ]; then",
      "  printf '{\"key\":\"OPS-123\",\"fields\":{\"summary\":\"Fake Jira issue\"}}'",
      "  exit 0",
      "fi",
      "printf 'unsupported command: %s\\n' \"$*\" >&2",
      "exit 1",
      "",
    ].join("\n"), "utf8");
    chmodSync(fakeJira, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${previousPath ?? ""}`;

    try {
      const manifestRoot = join(root, "cli-tools");
      await materializeJiraCliTools({
        targetDir: manifestRoot,
      });

      const registry = new CapabilityRegistry(new EventBus());
      const service = new CliToolService({
        capabilities: registry,
        logger: new Logger({ service: "jira-cli-tool-test" }),
        gatewayProfile: "external",
        manifestRoot,
        executableResolver: new LocalExecutableResolver(),
        workspaceService: {
          getWorkspace: async () => {
            throw new Error("fixed cwd tools should not request a workspace");
          },
        } as any,
      });

      await service.initialize();

      const tool = service.getTool("jira.issue.view");
      expect(tool?.requiresApproval).toBe(true);
      expect(tool?.available).toBe(true);
      expect(tool?.bundleId).toBe("jira-cli");
      expect(tool?.bundleDisplayName).toBe("Jira CLI");
      expect(tool?.toolGroupId).toBe("issues");

      const result = await registry.invoke(
        {
          capability: "shell",
          operation: "jira.issue.view",
          args: {
            payload: {
              issueKey: "OPS-123",
            },
          },
        },
      );

      expect("data" in result && result.data).toBeTruthy();
      const envelope = "data" in result ? result.data as Record<string, unknown> : {};
      expect(envelope.ok).toBe(true);
      expect(envelope.operation).toBe("issue.view");
      expect((envelope.data as Record<string, unknown>).key).toBe("OPS-123");
    } finally {
      process.env.PATH = previousPath;
    }
  });

  test("keeps Jira bundles unavailable on embedded gateways", async () => {
    const root = mkdtempSync(join(tmpdir(), "spaces-jira-embedded-"));
    tempDirs.push(root);

    const manifestRoot = join(root, "cli-tools");
    await materializeJiraCliTools({
      targetDir: manifestRoot,
    });

    const registry = new CapabilityRegistry(new EventBus());
    const service = new CliToolService({
      capabilities: registry,
      logger: new Logger({ service: "jira-cli-tool-test" }),
      gatewayProfile: "embedded",
      manifestRoot,
      executableResolver: new LocalExecutableResolver(),
      workspaceService: {
        getWorkspace: async () => {
          throw new Error("unused");
        },
      } as any,
    });

    await service.initialize();
    // CLI tools are now loaded on embedded profile for approval-gated visibility
    const tools = service.listTools();
    expect(tools.length).toBeGreaterThan(0);
    const jiraTools = tools.filter(t => t.id.startsWith("jira."));
    expect(jiraTools.length).toBeGreaterThan(0);
  });

  test("invokes compact and raw jira issue list modes through CliToolService", async () => {
    const root = mkdtempSync(join(tmpdir(), "spaces-jira-list-runtime-"));
    tempDirs.push(root);

    const fakeBin = join(root, "bin");
    mkdirSync(fakeBin, { recursive: true });
    const fakeJira = join(fakeBin, "jira");
    writeFileSync(fakeJira, [
      "#!/usr/bin/env bash",
      "set -eu",
      "if [ \"$1\" = \"issue\" ] && [ \"$2\" = \"list\" ] && [ \"$3\" = \"--paginate\" ] && [ \"$4\" = \"0:40\" ] && [ \"$5\" = \"--plain\" ]; then",
      "  for i in $(seq 1 40); do",
      "    printf 'OPS-%s|||Summary %s|||In Progress|||Alice|||Bob|||High|||2026-04-07 11:00:%02d\\n' \"$i\" \"$i\" \"$i\"",
      "  done",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"issue\" ] && [ \"$2\" = \"list\" ] && [ \"$3\" = \"--paginate\" ] && [ \"$4\" = \"0:2\" ] && [ \"$5\" = \"--raw\" ]; then",
      "  printf '[{\"key\":\"OPS-1\",\"fields\":{\"summary\":\"Raw one\"}},{\"key\":\"OPS-2\",\"fields\":{\"summary\":\"Raw two\"}}]'",
      "  exit 0",
      "fi",
      "printf 'unsupported command: %s\\n' \"$*\" >&2",
      "exit 1",
      "",
    ].join("\n"), "utf8");
    chmodSync(fakeJira, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${previousPath ?? ""}`;

    try {
      const manifestRoot = join(root, "cli-tools");
      await materializeJiraCliTools({
        targetDir: manifestRoot,
      });

      const registry = new CapabilityRegistry(new EventBus());
      const service = new CliToolService({
        capabilities: registry,
        logger: new Logger({ service: "jira-cli-tool-test" }),
        gatewayProfile: "external",
        manifestRoot,
        executableResolver: new LocalExecutableResolver(),
        workspaceService: {
          getWorkspace: async () => {
            throw new Error("fixed cwd tools should not request a workspace");
          },
        } as any,
      });

      await service.initialize();

      const compact = await registry.invoke(
        {
          capability: "shell",
          operation: "jira.issue.list",
          args: {
            payload: {
              limit: 40,
            },
          },
        },
      );
      const compactEnvelope = "data" in compact ? compact.data as Record<string, unknown> : {};
      const compactData = compactEnvelope.data as Array<Record<string, unknown>>;
      expect(compactEnvelope.ok).toBe(true);
      expect(compactData).toHaveLength(40);
      expect(compactData[0]).toEqual({
        key: "OPS-1",
        summary: "Summary 1",
        status: "In Progress",
        assignee: "Alice",
        reporter: "Bob",
        priority: "High",
        updated: "2026-04-07 11:00:01",
      });

      const raw = await registry.invoke(
        {
          capability: "shell",
          operation: "jira.issue.list",
          args: {
            payload: {
              detail: "raw",
              limit: 2,
            },
          },
        },
      );
      const rawEnvelope = "data" in raw ? raw.data as Record<string, unknown> : {};
      expect(rawEnvelope.ok).toBe(true);
      expect(rawEnvelope.operation).toBe("issue.list");
      expect((rawEnvelope.data as Array<Record<string, unknown>>)).toHaveLength(2);
    } finally {
      process.env.PATH = previousPath;
    }
  });
});

describe("managed jira cli bundle service", () => {
  test("auto-registers jira tools and marks them degraded when auth fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "spaces-jira-managed-"));
    tempDirs.push(root);

    const fakeBin = join(root, "bin");
    mkdirSync(fakeBin, { recursive: true });
    const fakeJira = join(fakeBin, "jira");
    writeFileSync(fakeJira, [
      "#!/usr/bin/env bash",
      "set -eu",
      "if [ \"$1\" = \"--version\" ]; then",
      "  printf 'jira-cli 1.0.0'",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"me\" ]; then",
      "  printf 'jira auth missing\\n' >&2",
      "  exit 1",
      "fi",
      "printf 'unsupported command: %s\\n' \"$*\" >&2",
      "exit 1",
      "",
    ].join("\n"), "utf8");
    chmodSync(fakeJira, 0o755);

    const previousExplicit = process.env.SPACES_JIRA_EXECUTABLE;
    process.env.SPACES_JIRA_EXECUTABLE = fakeJira;

    const savedSkills: Array<Record<string, unknown>> = [];
    try {
      const manifestRoot = join(root, "cli-tools");
      const registry = new CapabilityRegistry(new EventBus());
      const cliToolService = new CliToolService({
        capabilities: registry,
        logger: new Logger({ service: "jira-cli-tool-test" }),
        gatewayProfile: "external",
        manifestRoot,
        executableResolver: new LocalExecutableResolver(),
        workspaceService: {
          getWorkspace: async () => {
            throw new Error("fixed cwd tools should not request a workspace");
          },
        } as any,
      });
      const jiraService = new JiraCliBundleService({
        enabled: true,
        gatewayProfile: "external",
        manifestRoot,
        logger: new Logger({ service: "jira-cli-tool-test" }),
        cliToolService,
        gatewayLibraryService: {
          saveSkill: (input: Record<string, unknown>) => {
            savedSkills.push(input);
            return { entry: { entryId: input.entryId }, created: true };
          },
          getEntry: () => null,
          setEntryEnabled: () => ({ entry: { entryId: JIRA_CLI_SKILL_ENTRY_ID } }),
        } as any,
      });

      const startup = await jiraService.prepareStartup();
      expect(startup.detected).toBe(true);
      expect(startup.toolIds).toContain("jira.issue.view");

      await cliToolService.initialize();
      await jiraService.applyHealth();

      const tool = cliToolService.getTool("jira.issue.view");
      expect(tool?.healthStatus).toBe("degraded");
      expect(tool?.healthMessage).toContain("jira auth missing");
      expect(savedSkills[0]?.entryId).toBe(JIRA_CLI_SKILL_ENTRY_ID);
    } finally {
      if (previousExplicit === undefined) {
        delete process.env.SPACES_JIRA_EXECUTABLE;
      } else {
        process.env.SPACES_JIRA_EXECUTABLE = previousExplicit;
      }
    }
  });

  test("rescans jira tools without resurrecting a disabled manifest", async () => {
    const root = mkdtempSync(join(tmpdir(), "spaces-jira-managed-rescan-"));
    tempDirs.push(root);

    const fakeBin = join(root, "bin");
    mkdirSync(fakeBin, { recursive: true });
    const fakeJira = join(fakeBin, "jira");
    writeFileSync(fakeJira, [
      "#!/usr/bin/env bash",
      "set -eu",
      "if [ \"$1\" = \"--version\" ]; then",
      "  printf 'jira-cli 1.0.0'",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"me\" ]; then",
      "  printf '{\"name\":\"jira-user\"}'",
      "  exit 0",
      "fi",
      "printf 'unsupported command: %s\\n' \"$*\" >&2",
      "exit 1",
      "",
    ].join("\n"), "utf8");
    chmodSync(fakeJira, 0o755);

    const previousExplicit = process.env.SPACES_JIRA_EXECUTABLE;
    const previousHrvst = process.env.SPACES_HRVST_EXECUTABLE;
    const previousOp = process.env.SPACES_OP_EXECUTABLE;
    process.env.SPACES_JIRA_EXECUTABLE = fakeJira;
    process.env.SPACES_HRVST_EXECUTABLE = join(root, "missing-hrvst");
    process.env.SPACES_OP_EXECUTABLE = join(root, "missing-op");

    let skillDisabled = false;
    try {
      const manifestRoot = join(root, "cli-tools");
      const jiraManifestPath = join(manifestRoot, "jira.issue.view", "manifest.json");
      const registry = new CapabilityRegistry(new EventBus());
      const cliToolService = new CliToolService({
        capabilities: registry,
        logger: new Logger({ service: "jira-cli-tool-test" }),
        gatewayProfile: "external",
        manifestRoot,
        executableResolver: new LocalExecutableResolver(),
        workspaceService: {
          getWorkspace: async () => {
            throw new Error("fixed cwd tools should not request a workspace");
          },
        } as any,
      });

      await cliToolService.registerTool({
        id: "custom.echo",
        displayName: "Custom Echo",
        description: "Custom tool.",
        executable: process.execPath,
        argsTemplate: ["-e", "process.stdout.write('ok')"],
        inputSchema: { type: "object", properties: {} },
        cwdMode: "fixed",
        fixedCwd: root,
        outputMode: "text",
      });

      const jiraService = new JiraCliBundleService({
        enabled: true,
        gatewayProfile: "external",
        manifestRoot,
        logger: new Logger({ service: "jira-cli-tool-test" }),
        cliToolService,
        gatewayLibraryService: {
          saveSkill: () => ({ entry: { entryId: JIRA_CLI_SKILL_ENTRY_ID }, created: true }),
          getEntry: () => ({ entryId: JIRA_CLI_SKILL_ENTRY_ID }),
          setEntryEnabled: (input: { enabled: boolean }) => {
            skillDisabled = input.enabled === false;
            return { entry: { entryId: JIRA_CLI_SKILL_ENTRY_ID } };
          },
        } as any,
      });

      await jiraService.prepareStartup();
      await cliToolService.initialize();
      await jiraService.applyHealth();
      await cliToolService.setToolEnabled("jira.issue.view", false);
      expect(cliToolService.getTool("jira.issue.view")).not.toBeNull();
      expect(cliToolService.getTool("jira.issue.view")?.enabled).toBe(false);
      expect(cliToolService.getTool("custom.echo")).not.toBeNull();
      expect(JSON.parse(readFileSync(jiraManifestPath, "utf8")).enabled).toBe(false);

      await rm(fakeJira, { force: true });
      const rescan = await jiraService.rescan();
      expect(rescan.interconnectors.find((bundle) => bundle.bundleId === "jira-cli")?.detected).toBe(false);
      expect(rescan.removedToolIds).toEqual([]);
      expect(cliToolService.getTool("jira.issue.view")).not.toBeNull();
      expect(cliToolService.getTool("jira.issue.view")?.enabled).toBe(false);
      expect(cliToolService.getTool("custom.echo")).not.toBeNull();
      expect(skillDisabled).toBe(true);
      expect(JSON.parse(readFileSync(jiraManifestPath, "utf8")).enabled).toBe(false);
    } finally {
      if (previousExplicit === undefined) {
        delete process.env.SPACES_JIRA_EXECUTABLE;
      } else {
        process.env.SPACES_JIRA_EXECUTABLE = previousExplicit;
      }
      if (previousHrvst === undefined) {
        delete process.env.SPACES_HRVST_EXECUTABLE;
      } else {
        process.env.SPACES_HRVST_EXECUTABLE = previousHrvst;
      }
      if (previousOp === undefined) {
        delete process.env.SPACES_OP_EXECUTABLE;
      } else {
        process.env.SPACES_OP_EXECUTABLE = previousOp;
      }
    }
  });
});

describe("interconnector catalog service", () => {
  test("materializes jira tools from the registry and reports active health", async () => {
    const root = mkdtempSync(join(tmpdir(), "spaces-interconnector-registry-"));
    tempDirs.push(root);

    const fakeBin = join(root, "bin");
    mkdirSync(fakeBin, { recursive: true });
    const fakeJira = join(fakeBin, "jira");
    writeFileSync(fakeJira, [
      "#!/usr/bin/env bash",
      "set -eu",
      "if [ \"$1\" = \"--version\" ]; then",
      "  printf 'jira-cli 1.0.0'",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"me\" ]; then",
      "  printf '{\"name\":\"jira-user\"}'",
      "  exit 0",
      "fi",
      "printf 'unsupported command: %s\\n' \"$*\" >&2",
      "exit 1",
      "",
    ].join("\n"), "utf8");
    chmodSync(fakeJira, 0o755);

    const previousExplicit = process.env.SPACES_JIRA_EXECUTABLE;
    const previousHrvst = process.env.SPACES_HRVST_EXECUTABLE;
    const previousOp = process.env.SPACES_OP_EXECUTABLE;
    process.env.SPACES_JIRA_EXECUTABLE = fakeJira;
    process.env.SPACES_HRVST_EXECUTABLE = join(root, "missing-hrvst");
    process.env.SPACES_OP_EXECUTABLE = join(root, "missing-op");

    try {
      const manifestRoot = join(root, "cli-tools");
      const registry = new CapabilityRegistry(new EventBus());
      const cliToolService = new CliToolService({
        capabilities: registry,
        logger: new Logger({ service: "interconnector-catalog-test" }),
        gatewayProfile: "external",
        manifestRoot,
        executableResolver: new LocalExecutableResolver(),
        workspaceService: {
          getWorkspace: async () => {
            throw new Error("fixed cwd tools should not request a workspace");
          },
        } as any,
      });
      const interconnectorCatalogService = new InterconnectorCatalogService({
        enabled: true,
        gatewayProfile: "external",
        manifestRoot,
        logger: new Logger({ service: "interconnector-catalog-test" }),
        cliToolService,
      });

      const startup = await interconnectorCatalogService.prepareStartup();
      expect(startup.detected).toBe(true);
      expect(startup.bundleIds).toContain("jira-cli");
      expect(startup.interconnectors.find((entry) => entry.bundleId === "jira-cli")?.toolCount).toBe(22);

      await cliToolService.initialize();
      await interconnectorCatalogService.applyHealth();

      const tool = cliToolService.getTool("jira.issue.view");
      expect(tool?.healthStatus).toBe("ok");
      expect(tool?.healthMessage).toBeUndefined();

      const bundle = interconnectorCatalogService.listBundles().find((entry) => entry.bundleId === "jira-cli");
      expect(bundle?.availabilityStatus).toBe("active");
      expect(bundle?.detected).toBe(true);
      expect(bundle?.executablePath).toBe(fakeJira);
      expect(bundle?.installHint).toContain("Install `jira`");
    } finally {
      if (previousExplicit === undefined) {
        delete process.env.SPACES_JIRA_EXECUTABLE;
      } else {
        process.env.SPACES_JIRA_EXECUTABLE = previousExplicit;
      }
      if (previousHrvst === undefined) {
        delete process.env.SPACES_HRVST_EXECUTABLE;
      } else {
        process.env.SPACES_HRVST_EXECUTABLE = previousHrvst;
      }
      if (previousOp === undefined) {
        delete process.env.SPACES_OP_EXECUTABLE;
      } else {
        process.env.SPACES_OP_EXECUTABLE = previousOp;
      }
    }
  });
});
