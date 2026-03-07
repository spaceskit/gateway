/**
 * Example Spaceskit sandbox runtime module.
 *
 * Wire it with:
 *   SPACESKIT_SANDBOX_RUNTIME_MODULE=./docs/examples/sandbox-runtime-module.mjs bun run dev:external
 *
 * Replace this template with your real sandbox executor.
 * This deny-by-default sample only demonstrates the required module interface.
 */

/**
 * @param {{
 *   providerId: string;
 *   providerSource: string;
 *   capability: string;
 *   operation: string;
 *   args: Record<string, unknown>;
 *   requiresShell: boolean;
 *   requiresNetwork: boolean;
 *   filesystemWrite: boolean;
 *   spaceId?: string;
 *   principalId?: string;
 *   deviceId?: string;
 *   agentId?: string;
 *   executionOrigin?: string;
 * }} input
 */
export async function invokeInSandbox(input) {
  const op = `${input.capability}.${input.operation}`;
  throw new Error(
    `Sandbox runtime template invoked for ${op}. Replace docs/examples/sandbox-runtime-module.mjs with your real sandbox runtime.`,
  );
}

