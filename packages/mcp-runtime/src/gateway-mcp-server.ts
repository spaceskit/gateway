#!/usr/bin/env bun
/**
 * Standalone stdio MCP server for Claude Code ↔ Spaceskit Gateway.
 *
 * Connects to a gateway via WebSocket using the client-ts SDK,
 * then exposes gateway operations as MCP tools over stdio.
 *
 * Usage:
 *   claude mcp add spaceskit-gateway -- bun run gateway/packages/mcp-runtime/src/gateway-mcp-server.ts
 *
 * Environment variables:
 *   GATEWAY_URL                    - WebSocket URL (default: ws://127.0.0.1:9320)
 *   GATEWAY_AUTH_PRIVATE_KEY_BASE64 - Base64 PKCS8 Ed25519 private key (optional, for remote gateways)
 *   GATEWAY_AUTH_PUBLIC_KEY_BASE64  - Base64 raw Ed25519 public key (optional, for remote gateways)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GatewayClient, generateAuthKeyPair } from "@spaceskit/client";
import { registerAllTools } from "./tools/tool-registry.js";

const GATEWAY_URL = process.env.GATEWAY_URL || "ws://127.0.0.1:9320";
const PRIVATE_KEY_B64 = process.env.GATEWAY_AUTH_PRIVATE_KEY_BASE64;
const PUBLIC_KEY_B64 = process.env.GATEWAY_AUTH_PUBLIC_KEY_BASE64;

async function importAuthKeyPair(): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyBase64: string;
}> {
  if (!PRIVATE_KEY_B64 || !PUBLIC_KEY_B64) {
    // Generate ephemeral keypair for local/embedded gateways
    return generateAuthKeyPair();
  }

  const privateKeyBytes = Uint8Array.from(atob(PRIVATE_KEY_B64), (c) => c.charCodeAt(0));
  const publicKeyBytes = Uint8Array.from(atob(PUBLIC_KEY_B64), (c) => c.charCodeAt(0));

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes,
    { name: "Ed25519" } as any,
    false,
    ["sign"],
  );
  const publicKey = await crypto.subtle.importKey(
    "raw",
    publicKeyBytes,
    { name: "Ed25519" } as any,
    true,
    ["verify"],
  );

  return { privateKey, publicKey, publicKeyBase64: PUBLIC_KEY_B64 };
}

async function main(): Promise<void> {
  const keyPair = await importAuthKeyPair();

  // Connect to gateway with device identity (required by embedded gateways
  // with SPACESKIT_REQUIRE_EXPLICIT_DEVICE_AUTH=true).
  const deviceId = `mcp-bridge-${Date.now()}`;
  const client = new GatewayClient({
    url: GATEWAY_URL,
    clientType: "mcp-bridge",
    clientVersion: "1.0.0",
    deviceId,
    devicePublicKey: keyPair.publicKeyBase64,
  });
  client.setAuthKeyPair(keyPair);

  await client.connect();
  console.error(`[spaceskit-mcp] WebSocket open to ${GATEWAY_URL}`);

  // Wait for auth challenge-response to complete.
  // connect() resolves on socket open, but auth is async.
  let authenticated = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((r) => setTimeout(r, 150));
    try {
      await client.listSpaces({ limit: 1 });
      authenticated = true;
      break;
    } catch {
      // Auth not ready yet, retry
    }
  }
  if (!authenticated) {
    console.error("[spaceskit-mcp] Failed to authenticate with gateway after 6s");
    process.exit(1);
  }
  console.error("[spaceskit-mcp] Authenticated with gateway");

  // Create MCP server with stdio transport — only after auth succeeds
  const server = new McpServer({
    name: "spaceskit-gateway",
    version: "1.0.0",
  });

  registerAllTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[spaceskit-mcp] MCP server running via stdio");

  // Cleanup on exit
  process.on("SIGINT", async () => {
    await client.disconnect();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await client.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[spaceskit-mcp] Fatal:", err);
  process.exit(1);
});
