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
    deviceId: `bench-mcp-${crypto.randomUUID().slice(0, 8)}`,
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

export const mcpToolsLayer: Layer = {
  name: "mcp-tools",
  scenarios: [
    {
      name: "adapter-echo-invoke",
      run: async (ctx: ScenarioContext) => {
        const client = await makeClient(ctx.wsUrl);
        try {
          // Wait briefly for adapter registration to propagate
          await new Promise((r) => setTimeout(r, 200));

          const result = await client.invokeCapability(
            "lists",
            "echo",
            { message: "workbench-test" },
            "bench.echo",
          );
          if (!result) {
            throw new Error("invokeCapability returned no result");
          }
          const data =
            (result as unknown as Record<string, unknown>).data ?? result;
          const echoed = (data as Record<string, unknown>).echoed as
            | Record<string, unknown>
            | undefined;
          if (!echoed || echoed.message !== "workbench-test") {
            throw new Error(
              `Expected echoed message, got: ${JSON.stringify(data)}`,
            );
          }
        } finally {
          await client.disconnect();
        }
      },
    },
    {
      name: "adapter-delay-invoke",
      run: async (ctx: ScenarioContext) => {
        const client = await makeClient(ctx.wsUrl);
        try {
          await new Promise((r) => setTimeout(r, 200));

          const result = await client.invokeCapability(
            "lists",
            "delay",
            { ms: 50 },
            "bench.echo",
          );
          if (!result) {
            throw new Error("invokeCapability returned no result");
          }
          const data =
            (result as unknown as Record<string, unknown>).data ?? result;
          if ((data as Record<string, unknown>).delayed !== 50) {
            throw new Error(
              `Expected delayed: 50, got: ${JSON.stringify(data)}`,
            );
          }
        } finally {
          await client.disconnect();
        }
      },
    },
  ],
};
