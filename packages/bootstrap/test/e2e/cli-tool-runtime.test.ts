import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AccessGrantRepository,
  GatewayCapabilityGrantRepository,
  ToolApprovalGrantRepository,
} from "@spaceskit/persistence";
import { startGateway } from "../../src/index.js";
import { AccessGrantService } from "../../src/services/access-grant-service.js";
import { persistFeedbackApprovalSelection } from "../../src/services/feedback-approval-grant-bridge.js";
import { ToolApprovalGrantService } from "../../src/services/tool-approval-grant-service.js";
import {
  GatewayClient,
  generateAuthKeyPair,
} from "../../../../../client-ts/src/gateway-client.ts";
import { E2E_TIMEOUT, randomPort, removeDbArtifacts, waitForAuth } from "./harness.js";

describe("external CLI tool runtime", () => {
  test("supports scaffold/register/invoke/list-grants/revoke/remove over a real external gateway", {
    timeout: E2E_TIMEOUT,
  }, async () => {
    const port = randomPort();
    const dbPath = join(tmpdir(), `spaceskit-cli-runtime-${crypto.randomUUID()}.db`);
    const fixedCwd = mkdtempSync(join(tmpdir(), "spaceskit-cli-runtime-cwd-"));
    const previousMasterKey = Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY;

    let instance: Awaited<ReturnType<typeof startGateway>> | null = null;
    let client: GatewayClient | null = null;

    try {
      Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY = "test-cli-runtime-master-key";
      instance = await startGateway({
        port,
        host: "127.0.0.1",
        dbPath,
        logLevel: "error",
        gatewayProfile: "external",
        archFreezeEnforced: false,
        httpPrincipalAuthHs256Secret: "test-cli-runtime-http-secret",
        runtimeGeneration: "e2e_cli_tool_runtime",
        mainSpaceId: `main-space-${crypto.randomUUID().slice(0, 8)}`,
        mainProfileId: `main-profile-${crypto.randomUUID().slice(0, 8)}`,
        mainAgentId: `main-agent-${crypto.randomUUID().slice(0, 8)}`,
      });

      const keyPair = await generateAuthKeyPair();
      const deviceId = `cli-runtime-device-${crypto.randomUUID().slice(0, 8)}`;
      client = new GatewayClient({
        url: `ws://127.0.0.1:${port}`,
        reconnect: false,
        requestTimeoutMs: 10_000,
        deviceId,
        devicePublicKey: keyPair.publicKeyBase64,
      });
      client.setAuthKeyPair(keyPair);
      await client.connect();
      await waitForAuth(client);

      const scaffolded = await client.scaffoldTool({
        id: "smoke-echo",
        displayName: "Smoke Echo",
        description: "Returns a deterministic text payload.",
        outputMode: "text",
      });
      expect(scaffolded.manifest.id).toBe("smoke-echo");
      expect(scaffolded.readme).toContain("## Safety");

      const registered = await client.registerTool({
        ...scaffolded.manifest,
        executable: process.execPath,
        argsTemplate: ["-e", "process.stdout.write('cli smoke ok')"],
        inputSchema: { type: "object", properties: {} },
        cwdMode: "fixed",
        fixedCwd,
        outputMode: "text",
      });
      expect(registered.id).toBe("smoke-echo");
      expect(registered.resolvedExecutable).toBe(process.execPath);

      const listed = await client.listTools();
      expect(listed.map((tool) => tool.id)).toContain("smoke-echo");

      const fetched = await client.getTool("smoke-echo");
      expect(fetched?.fixedCwd).toBe(fixedCwd);

      const capabilityGrantRepo = new GatewayCapabilityGrantRepository(instance.db!.db);
      capabilityGrantRepo.upsert({
        principalId: keyPair.publicKeyBase64,
        deviceId,
        capabilityId: "shell.read",
        level: "read",
        source: "test_seed",
        reason: "Seeded by external CLI runtime smoke test.",
        grantedBy: keyPair.publicKeyBase64,
      });

      const invoked = await instance.capabilities.invoke(
        {
          capability: "shell",
          operation: "smoke-echo",
          args: {},
        },
        {
          principalId: keyPair.publicKeyBase64,
          deviceId,
        },
      );
      expect("data" in invoked && invoked.data).toBe("cli smoke ok");

      const accessGrantRepo = new AccessGrantRepository(instance.db!.db);
      persistFeedbackApprovalSelection({
        spaceId: "space-smoke",
        approvalGrant: { mode: "durable" },
        feedbackRequest: {
          id: "feedback-cli-tool-smoke",
          agentId: "agent-smoke",
          triggerClass: "policy_escalation",
          description: "Allow shell.smoke-echo",
          options: ["approve", "reject"],
          context: {
            targetKind: "tool_selector",
            targetId: "tool_operation:shell.smoke-echo",
            toolName: "shell.smoke-echo",
            requestedCapability: "shell.smoke-echo",
          },
        },
        principalId: keyPair.publicKeyBase64,
        deviceId,
        accessGrantService: new AccessGrantService({
          repository: accessGrantRepo,
        }),
        toolApprovalGrantService: new ToolApprovalGrantService({
          repository: new ToolApprovalGrantRepository(instance.db!.db),
        }),
      });

      const grants = await client.listToolApprovalGrants();
      expect(
        grants.some((grant) =>
          grant.toolId === "shell.smoke-echo"
            && grant.spaceId === "space-smoke"
            && grant.deviceId === deviceId),
      ).toBe(true);

      const revokeResult = await client.revokeToolApprovalGrant({
        spaceId: "space-smoke",
        toolId: "shell.smoke-echo",
      });
      expect(revokeResult.revoked).toBe(true);
      expect(accessGrantRepo.listEffective({
        principalId: keyPair.publicKeyBase64,
        deviceId,
        spaceId: "space-smoke",
        targetKind: "tool_selector",
        targetIds: ["tool_operation:shell.smoke-echo"],
      })).toHaveLength(0);

      const revoked = await client.listToolApprovalGrants({
        includeRevoked: true,
        spaceId: "space-smoke",
        toolId: "shell.smoke-echo",
      });
      expect(revoked[0]?.revokedAt).toBeDefined();

      const removed = await client.removeTool("smoke-echo");
      expect(removed).toBe(true);
      expect(await client.getTool("smoke-echo")).toBeNull();
    } finally {
      try {
        await client?.disconnect();
      } catch {}
      try {
        await instance?.shutdown();
      } catch {}
      rmSync(fixedCwd, { recursive: true, force: true });
      removeDbArtifacts(dbPath);
      if (previousMasterKey === undefined) {
        delete Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY;
      } else {
        Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY = previousMasterKey;
      }
    }
  });
});
