import {
  GatewayClient,
  generateAuthKeyPair,
} from "../client.js";
import type { Layer, ScenarioContext } from "./index.js";

async function makeClient(wsUrl: string): Promise<GatewayClient> {
  const keyPair = await generateAuthKeyPair();
  const client = new GatewayClient({
    url: wsUrl,
    reconnect: false,
    requestTimeoutMs: 10_000,
    deviceId: `bench-orch-${crypto.randomUUID().slice(0, 8)}`,
    devicePublicKey: keyPair.publicKeyBase64,
  });
  client.setAuthKeyPair(keyPair);
  await client.connect();

  const start = Date.now();
  while (Date.now() - start < 5000) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      await client.ping();
      return client;
    } catch {
      // Not ready yet
    }
  }
  throw new Error("Auth timeout");
}

export const orchestrationLayer: Layer = {
  name: "orchestration",
  scenarios: [
    {
      name: "multi-agent-space-creation",
      run: async (ctx: ScenarioContext) => {
        const client = await makeClient(ctx.wsUrl);
        try {
          // Create an agent definition for the orchestration agents.
          const profileResult = await client.createAgentDefinition({
            name: "Orch Test Agent",
            instructions: "You are a test orchestration agent.",
          });
          const profileId = profileResult.agentDefinition.agentDefinitionId;

          // Create multi-agent space
          const space = await client.createSpace({
            name: "bench-orch-test",
            resourceId: `resource:bench-${crypto.randomUUID().slice(0, 8)}`,
            goal: "Multi-agent orchestration test",
            turnModel: "sequential_all",
            initialAgents: [
              {
                agentId: `orch-primary-${crypto.randomUUID().slice(0, 8)}`,
                profileId,
                role: "global_coordinator" as const,
                isPrimary: true,
              },
              {
                agentId: `orch-worker-${crypto.randomUUID().slice(0, 8)}`,
                profileId,
                role: "participant" as const,
                isPrimary: false,
              },
            ],
          });

          if (!space.id) {
            throw new Error("Multi-agent space creation failed");
          }
          if (space.agents.length < 2) {
            throw new Error(
              `Expected 2+ agents, got ${space.agents.length}`,
            );
          }
        } finally {
          await client.disconnect();
        }
      },
    },
    {
      name: "multi-agent-turn-ack",
      run: async (ctx: ScenarioContext) => {
        const client = await makeClient(ctx.wsUrl);
        try {
          const profileResult = await client.createAgentDefinition({
            name: "Orch Turn Agent",
            instructions: "You are a test agent.",
          });
          const profileId = profileResult.agentDefinition.agentDefinitionId;

          const space = await client.createSpace({
            name: "bench-orch-turn",
            resourceId: `resource:bench-${crypto.randomUUID().slice(0, 8)}`,
            goal: "Turn execution in multi-agent space",
            turnModel: "sequential_all",
            initialAgents: [
              {
                agentId: `orch-a-${crypto.randomUUID().slice(0, 8)}`,
                profileId,
                role: "participant" as const,
                isPrimary: true,
              },
              {
                agentId: `orch-b-${crypto.randomUUID().slice(0, 8)}`,
                profileId,
                role: "participant" as const,
                isPrimary: false,
              },
            ],
          });

          await client.subscribe([space.id]);

          const result = await client.executeTurn(
            space.spaceUid ?? space.id,
            "orchestration test message",
          );
          if (!result.turnId) {
            throw new Error("executeTurn did not return a turnId");
          }
        } finally {
          await client.disconnect();
        }
      },
    },
  ],
};
