import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startGateway } from "../src/index.js";

function randomPort(): number {
  return 25_000 + Math.floor(Math.random() * 10_000);
}

function removeDbArtifacts(dbPath: string): void {
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
}

describe("built-in MCP admin bootstrap integration", () => {
  test("main admin MCP enablement no longer blocks non-MCP orchestrator commands", async () => {
    const dbPath = join(tmpdir(), `spaceskit-builtin-mcp-admin-${crypto.randomUUID()}.db`);
    const previousGatewayProfile = Bun.env.SPACESKIT_GATEWAY_PROFILE;
    let gateway: Awaited<ReturnType<typeof startGateway>> | null = null;

    try {
      Bun.env.SPACESKIT_GATEWAY_PROFILE = "embedded";
      gateway = await startGateway({
        port: randomPort(),
        host: "127.0.0.1",
        dbPath,
        logLevel: "error",
        runtimeGeneration: "test_builtin_mcp_admin_non_control_commands",
        mainAdminMcpEnabled: true,
        mainSpaceId: "main-space-test",
        mainSpaceName: "Main Space Test",
        mainProfileId: "main-profile-test",
        mainAgentId: "main-agent-test",
      });

      const result = await gateway.orchestratorCommandService!.submitCommand({
        commandType: "add_agent",
        targetSpaceId: "main-space-test",
        payload: {
          agentId: "secondary-agent",
          profileId: "main-profile-test",
        },
      });

      expect(result.status).toBe("completed");
      expect(result.result?.assignment).toBeDefined();
    } finally {
      try {
        await gateway?.shutdown();
      } catch {}
      removeDbArtifacts(dbPath);
      if (previousGatewayProfile === undefined) {
        delete Bun.env.SPACESKIT_GATEWAY_PROFILE;
      } else {
        Bun.env.SPACESKIT_GATEWAY_PROFILE = previousGatewayProfile;
      }
    }
  });
});
