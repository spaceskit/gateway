/**
 * Resolve the path to the gateway MCP bridge stdio script.
 *
 * The script lives in @spaceskit/mcp-runtime and is resolved via the
 * workspace package link. Returns undefined if the script is not found
 * (e.g., mcp-runtime not installed or running outside the monorepo).
 */

import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

let cachedPath: string | undefined | null = null;

export function resolveMcpBridgeScriptPath(): string | undefined {
  if (cachedPath !== null) return cachedPath ?? undefined;

  // Try resolving relative to this file's package (core → mcp-runtime sibling)
  const candidates = [
    // Monorepo workspace: packages/mcp-runtime/src/gateway-mcp-bridge-stdio.ts
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../../mcp-runtime/src/gateway-mcp-bridge-stdio.ts"),
    // Fallback: node_modules resolution
    tryResolveFromNodeModules(),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      cachedPath = candidate;
      return candidate;
    }
  }

  cachedPath = undefined;
  return undefined;
}

function tryResolveFromNodeModules(): string | undefined {
  try {
    // Try to find the package entry and derive the script path
    const mcpRuntimeDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../mcp-runtime");
    const scriptPath = resolve(mcpRuntimeDir, "src/gateway-mcp-bridge-stdio.ts");
    return existsSync(scriptPath) ? scriptPath : undefined;
  } catch {
    return undefined;
  }
}
