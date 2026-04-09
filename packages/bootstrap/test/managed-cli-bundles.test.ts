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
import {
  HRVST_TOOL_DEFINITIONS,
} from "../../../scripts/hrvst-cli-tools/catalog.mjs";
import {
  buildHrvstCommandArgs,
  runHrvstOperation,
} from "../../../scripts/hrvst-cli-tools/spaces-hrvst.mjs";
import {
  materializeHrvstCliTools,
  resolveDefaultSpacesHrvstWrapperPath,
} from "../../../scripts/hrvst-cli-tools/materialize-hrvst-cli-tools.mjs";
import {
  OP_TOOL_DEFINITIONS,
} from "../../../scripts/op-cli-tools/catalog.mjs";
import {
  buildOpCommandArgs,
  runOpOperation,
} from "../../../scripts/op-cli-tools/spaces-op.mjs";
import {
  materializeOpCliTools,
  resolveDefaultSpacesOpWrapperPath,
} from "../../../scripts/op-cli-tools/materialize-op-cli-tools.mjs";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("harvest cli bundle wrapper", () => {
  test("builds report argv with flag values and forced json output", () => {
    expect(buildHrvstCommandArgs("reports.time.team", {
      flags: {
        from: "2026-03-01",
        to: "2026-03-21",
        per_page: "200",
      },
    })).toEqual([
      "reports",
      "time-reports",
      "team-time-report",
      "--from",
      "2026-03-01",
      "--to",
      "2026-03-21",
      "--per_page",
      "200",
      "--output",
      "json",
    ]);
  });

  test("passes Harvest host config env through to the runner", async () => {
    const root = mkdtempSync(join(tmpdir(), "spaces-hrvst-env-"));
    tempDirs.push(root);
    const fakeBin = join(root, "bin");
    mkdirSync(fakeBin, { recursive: true });
    const fakeHrvst = join(fakeBin, "hrvst");
    writeFileSync(fakeHrvst, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    chmodSync(fakeHrvst, 0o755);

    let captured: { executable: string; args: string[]; env: NodeJS.ProcessEnv } | null = null;

    await runHrvstOperation({
      operation: "users.me",
      payload: {},
      env: {
        PATH: fakeBin,
        HARVEST_ACCOUNT_ID: "acct-1",
      },
    }, {
      runCommand: async (input) => {
        captured = input;
        return {
          exitCode: 0,
          stdout: "{\"id\":1,\"first_name\":\"Alex\"}",
          stderr: "",
        };
      },
    });

    expect(captured?.executable).toBe(fakeHrvst);
    expect(captured?.env.PATH).toBe(fakeBin);
    expect(captured?.env.HARVEST_ACCOUNT_ID).toBe("acct-1");
  });
});

describe("harvest cli bundle materializer", () => {
  test("writes ready-to-load manifest bundles with absolute wrapper paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "spaces-hrvst-bundle-"));
    tempDirs.push(root);

    const result = await materializeHrvstCliTools({
      targetDir: join(root, "cli-tools"),
    });

    expect(result.toolCount).toBe(HRVST_TOOL_DEFINITIONS.length);
    const wrapperPath = resolveDefaultSpacesHrvstWrapperPath();
    const usersMeManifest = JSON.parse(
      readFileSync(join(result.targetDir, "hrvst.users.me", "manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    const deleteManifest = JSON.parse(
      readFileSync(join(result.targetDir, "hrvst.projects.delete", "manifest.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(usersMeManifest.executable).toBe(wrapperPath);
    expect(usersMeManifest.argsTemplate).toEqual(["--op", "users.me", "--payload", "{{payload}}"]);
    expect(usersMeManifest.bundleId).toBe("hrvst-cli");
    expect(usersMeManifest.bundleDisplayName).toBe("Harvest CLI");
    expect(usersMeManifest.toolGroupId).toBe("users");
    expect(deleteManifest.dangerLevel).toBe("destructive");
    expect(readFileSync(join(result.targetDir, "hrvst.users.me", "README.md"), "utf8")).toContain(
      "Host Harvest Configuration",
    );
  });
});

describe("harvest cli bundle integration with CliToolService", () => {
  test("loads materialized manifests and invokes the wrapper through a fake hrvst binary", async () => {
    const root = mkdtempSync(join(tmpdir(), "spaces-hrvst-runtime-"));
    tempDirs.push(root);

    const fakeBin = join(root, "bin");
    mkdirSync(fakeBin, { recursive: true });
    const fakeHrvst = join(fakeBin, "hrvst");
    writeFileSync(fakeHrvst, [
      "#!/usr/bin/env bash",
      "set -eu",
      "if [ \"$1\" = \"users\" ] && [ \"$2\" = \"me\" ] && [ \"$3\" = \"--output\" ] && [ \"$4\" = \"json\" ]; then",
      "  printf '{\"id\":1,\"first_name\":\"Alex\"}'",
      "  exit 0",
      "fi",
      "printf 'unsupported command: %s\\n' \"$*\" >&2",
      "exit 1",
      "",
    ].join("\n"), "utf8");
    chmodSync(fakeHrvst, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${previousPath ?? ""}`;

    try {
      const manifestRoot = join(root, "cli-tools");
      await materializeHrvstCliTools({
        targetDir: manifestRoot,
      });

      const registry = new CapabilityRegistry(new EventBus());
      const service = new CliToolService({
        capabilities: registry,
        logger: new Logger({ service: "hrvst-cli-tool-test" }),
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

      const tool = service.getTool("hrvst.users.me");
      expect(tool?.requiresApproval).toBe(true);
      expect(tool?.available).toBe(true);
      expect(tool?.bundleId).toBe("hrvst-cli");

      const result = await registry.invoke(
        {
          capability: "shell",
          operation: "hrvst.users.me",
          args: {
            payload: {},
          },
        },
      );

      expect("data" in result && result.data).toBeTruthy();
      const envelope = "data" in result ? result.data as Record<string, unknown> : {};
      expect(envelope.ok).toBe(true);
      expect(envelope.operation).toBe("users.me");
      expect((envelope.data as Record<string, unknown>).id).toBe(1);
    } finally {
      process.env.PATH = previousPath;
    }
  });
});

describe("1password cli bundle wrapper", () => {
  test("builds vault list argv with forced json output", () => {
    expect(buildOpCommandArgs("vault.list", {})).toEqual([
      "vault",
      "list",
      "--format",
      "json",
    ]);
  });

  test("passes stdin through to 1Password commands", async () => {
    const root = mkdtempSync(join(tmpdir(), "spaces-op-env-"));
    tempDirs.push(root);
    const fakeBin = join(root, "bin");
    mkdirSync(fakeBin, { recursive: true });
    const fakeOp = join(fakeBin, "op");
    writeFileSync(fakeOp, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    chmodSync(fakeOp, 0o755);

    let captured: { executable: string; args: string[]; stdin?: string } | null = null;

    await runOpOperation({
      operation: "document.create",
      payload: {
        stdin: "document-payload",
      },
      env: {
        PATH: fakeBin,
      },
    }, {
      runCommand: async (input) => {
        captured = input;
        return {
          exitCode: 0,
          stdout: "created document",
          stderr: "",
        };
      },
    });

    expect(captured?.executable).toBe(fakeOp);
    expect(captured?.stdin).toBe("document-payload");
    expect(captured?.args).toEqual(["document", "create"]);
  });
});

describe("1password cli bundle materializer", () => {
  test("writes ready-to-load manifest bundles with absolute wrapper paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "spaces-op-bundle-"));
    tempDirs.push(root);

    const result = await materializeOpCliTools({
      targetDir: join(root, "cli-tools"),
    });

    expect(result.toolCount).toBe(OP_TOOL_DEFINITIONS.length);
    const wrapperPath = resolveDefaultSpacesOpWrapperPath();
    const whoamiManifest = JSON.parse(
      readFileSync(join(result.targetDir, "op.whoami", "manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    const deleteManifest = JSON.parse(
      readFileSync(join(result.targetDir, "op.vault.delete", "manifest.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(whoamiManifest.executable).toBe(wrapperPath);
    expect(whoamiManifest.argsTemplate).toEqual(["--op", "whoami", "--payload", "{{payload}}"]);
    expect(whoamiManifest.bundleId).toBe("onepassword-cli");
    expect(whoamiManifest.bundleDisplayName).toBe("1Password CLI");
    expect(whoamiManifest.toolGroupId).toBe("general");
    expect(deleteManifest.dangerLevel).toBe("destructive");
    expect(readFileSync(join(result.targetDir, "op.whoami", "README.md"), "utf8")).toContain(
      "Host 1Password Configuration",
    );
  });
});

describe("1password cli bundle integration with CliToolService", () => {
  test("loads materialized manifests and invokes the wrapper through a fake op binary", async () => {
    const root = mkdtempSync(join(tmpdir(), "spaces-op-runtime-"));
    tempDirs.push(root);

    const fakeBin = join(root, "bin");
    mkdirSync(fakeBin, { recursive: true });
    const fakeOp = join(fakeBin, "op");
    writeFileSync(fakeOp, [
      "#!/usr/bin/env bash",
      "set -eu",
      "if [ \"$1\" = \"whoami\" ] && [ \"$2\" = \"--format\" ] && [ \"$3\" = \"json\" ]; then",
      "  printf '{\"user_uuid\":\"user-1\",\"account_uuid\":\"acct-1\"}'",
      "  exit 0",
      "fi",
      "printf 'unsupported command: %s\\n' \"$*\" >&2",
      "exit 1",
      "",
    ].join("\n"), "utf8");
    chmodSync(fakeOp, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${previousPath ?? ""}`;

    try {
      const manifestRoot = join(root, "cli-tools");
      await materializeOpCliTools({
        targetDir: manifestRoot,
      });

      const registry = new CapabilityRegistry(new EventBus());
      const service = new CliToolService({
        capabilities: registry,
        logger: new Logger({ service: "op-cli-tool-test" }),
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

      const tool = service.getTool("op.whoami");
      expect(tool?.requiresApproval).toBe(true);
      expect(tool?.available).toBe(true);
      expect(tool?.bundleId).toBe("onepassword-cli");

      const result = await registry.invoke(
        {
          capability: "shell",
          operation: "op.whoami",
          args: {
            payload: {},
          },
        },
      );

      expect("data" in result && result.data).toBeTruthy();
      const envelope = "data" in result ? result.data as Record<string, unknown> : {};
      expect(envelope.ok).toBe(true);
      expect(envelope.operation).toBe("whoami");
      expect((envelope.data as Record<string, unknown>).account_uuid).toBe("acct-1");
    } finally {
      process.env.PATH = previousPath;
    }
  });
});

describe("interconnector catalog service", () => {
  test("materializes jira, harvest, and 1password tools from the registry and reports active health", async () => {
    const root = mkdtempSync(join(tmpdir(), "spaces-interconnector-registry-all-"));
    tempDirs.push(root);

    const fakeBin = join(root, "bin");
    mkdirSync(fakeBin, { recursive: true });
    const fakeJira = join(fakeBin, "jira");
    const fakeHrvst = join(fakeBin, "hrvst");
    const fakeOp = join(fakeBin, "op");

    writeFileSync(fakeJira, [
      "#!/usr/bin/env bash",
      "set -eu",
      "if [ \"$1\" = \"me\" ]; then",
      "  printf '{\"name\":\"jira-user\"}'",
      "  exit 0",
      "fi",
      "printf 'unsupported command: %s\\n' \"$*\" >&2",
      "exit 1",
      "",
    ].join("\n"), "utf8");
    writeFileSync(fakeHrvst, [
      "#!/usr/bin/env bash",
      "set -eu",
      "if [ \"$1\" = \"users\" ] && [ \"$2\" = \"me\" ] && [ \"$3\" = \"--output\" ] && [ \"$4\" = \"json\" ]; then",
      "  printf '{\"id\":1}'",
      "  exit 0",
      "fi",
      "printf 'unsupported command: %s\\n' \"$*\" >&2",
      "exit 1",
      "",
    ].join("\n"), "utf8");
    writeFileSync(fakeOp, [
      "#!/usr/bin/env bash",
      "set -eu",
      "if [ \"$1\" = \"whoami\" ] && [ \"$2\" = \"--format\" ] && [ \"$3\" = \"json\" ]; then",
      "  printf '{\"account_uuid\":\"acct-1\"}'",
      "  exit 0",
      "fi",
      "printf 'unsupported command: %s\\n' \"$*\" >&2",
      "exit 1",
      "",
    ].join("\n"), "utf8");
    chmodSync(fakeJira, 0o755);
    chmodSync(fakeHrvst, 0o755);
    chmodSync(fakeOp, 0o755);

    const previousJira = process.env.SPACES_JIRA_EXECUTABLE;
    const previousHrvst = process.env.SPACES_HRVST_EXECUTABLE;
    const previousOp = process.env.SPACES_OP_EXECUTABLE;
    process.env.SPACES_JIRA_EXECUTABLE = fakeJira;
    process.env.SPACES_HRVST_EXECUTABLE = fakeHrvst;
    process.env.SPACES_OP_EXECUTABLE = fakeOp;

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
      expect(startup.bundleIds).toContain("hrvst-cli");
      expect(startup.bundleIds).toContain("onepassword-cli");
      expect(startup.bundleIds).toContain("fruitmail-cli");
      expect(startup.toolCount).toBe(
        22 + HRVST_TOOL_DEFINITIONS.length + OP_TOOL_DEFINITIONS.length + 6,
      );

      await cliToolService.initialize();
      await interconnectorCatalogService.applyHealth();

      expect(cliToolService.getTool("jira.issue.view")?.healthStatus).toBe("ok");
      expect(cliToolService.getTool("hrvst.users.me")?.healthStatus).toBe("ok");
      expect(cliToolService.getTool("op.whoami")?.healthStatus).toBe("ok");

      const bundles = interconnectorCatalogService.listBundles();
      expect(bundles.find((bundle) => bundle.bundleId === "jira-cli")?.availabilityStatus).toBe("active");
      expect(bundles.find((bundle) => bundle.bundleId === "hrvst-cli")?.availabilityStatus).toBe("active");
      expect(bundles.find((bundle) => bundle.bundleId === "onepassword-cli")?.availabilityStatus).toBe("active");
      expect(bundles.find((bundle) => bundle.bundleId === "hrvst-cli")?.installHint)
        .toContain("hrvst-cli");
      expect(bundles.find((bundle) => bundle.bundleId === "onepassword-cli")?.installHint)
        .toContain("1Password CLI");
    } finally {
      if (previousJira === undefined) {
        delete process.env.SPACES_JIRA_EXECUTABLE;
      } else {
        process.env.SPACES_JIRA_EXECUTABLE = previousJira;
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
