import { afterEach, describe, expect, test } from "bun:test";
import { initDatabase } from "../src/database.js";
import { SpaceRepository } from "../src/repositories/spaces.js";
import { SpaceMcpEndpointRepository } from "../src/repositories/space-mcp-endpoints.js";
import { SpaceExternalAgentBindingRepository } from "../src/repositories/space-external-agent-bindings.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
});

function createRepos() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-space-mcp-${crypto.randomUUID()}`,
  });
  dbManagers.push(db);

  const spaces = new SpaceRepository(db.db);
  spaces.create({
    spaceId: "space-main",
    resourceId: "resource:main",
    name: "Main Space",
    spaceType: "space",
    goal: "",
    turnModel: "sequential_all",
  });

  return {
    endpoints: new SpaceMcpEndpointRepository(db.db),
    bindings: new SpaceExternalAgentBindingRepository(db.db),
  };
}

describe("Space MCP repositories", () => {
  test("upserts per-space endpoint and updates health", () => {
    const repos = createRepos();

    const row = repos.endpoints.upsert({
      spaceId: "space-main",
      transport: "sse",
      endpoint: "https://mcp.example/sse",
      argsJson: "[]",
      secretRef: "mcp-secret-ref",
      enabled: true,
    });

    expect(row.space_id).toBe("space-main");
    expect(row.transport).toBe("sse");
    expect(row.enabled).toBe(1);

    const updated = repos.endpoints.updateHealth({
      endpointId: row.endpoint_id,
      healthStatus: "ok",
      healthMessage: "Connected",
      lastConnectedAt: "2026-02-27T00:00:00.000Z",
      lastErrorAt: null,
    });
    expect(updated).toBe(true);
    expect(repos.endpoints.getByEndpointId(row.endpoint_id)?.health_status).toBe("ok");
  });

  test("stores and deletes external agent bindings by assignment key", () => {
    const repos = createRepos();
    const endpoint = repos.endpoints.upsert({
      spaceId: "space-main",
      transport: "sse",
      endpoint: "https://mcp.example/sse",
      enabled: true,
    });

    const binding = repos.bindings.upsert({
      spaceId: "space-main",
      agentId: "agent-ext-1",
      endpointId: endpoint.endpoint_id,
      remoteAgentId: "remote-agent-1",
      displayName: "Remote Agent 1",
    });

    expect(binding.space_id).toBe("space-main");
    expect(binding.agent_id).toBe("agent-ext-1");
    expect(binding.endpoint_id).toBe(endpoint.endpoint_id);
    expect(repos.bindings.listBySpace("space-main").length).toBe(1);

    expect(repos.bindings.delete("space-main", "agent-ext-1")).toBe(true);
    expect(repos.bindings.listBySpace("space-main").length).toBe(0);
  });
});
