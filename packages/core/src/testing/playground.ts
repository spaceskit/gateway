/**
 * GatewayPlayground — Interactive REPL for Spaceskit — POST-MVP STUB
 *
 * This module provides the interfaces for the interactive playground.
 * Implementation deferred to post-MVP. See STATUS.md for details.
 *
 * TODO: Implement after MVP
 * - CLI REPL with /connect, /disconnect, /turn, /subscribe, /feedback, /spaces, /health
 * - ANSI color-coded output
 * - WebSocket client for gateway interaction
 * - CLI argument parsing (--url, --client-type, --verbose)
 */

/**
 * Configuration for the playground
 */
export interface PlaygroundOptions {
  /** WebSocket gateway URL (e.g. "ws://localhost:8080") */
  gatewayUrl: string;
  /** Optional client type identifier */
  clientType?: string;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * GatewayPlayground — stub implementation.
 * TODO: Implement after MVP.
 */
export class GatewayPlayground {
  constructor(_options: PlaygroundOptions) {
    // Post-MVP
  }

  async start(): Promise<void> {
    throw new Error("GatewayPlayground is a post-MVP stub. Not yet implemented.");
  }

  async stop(): Promise<void> {
    // no-op
  }
}

/**
 * Main entry point for CLI usage — stub.
 */
export async function main(_args: string[]): Promise<void> {
  throw new Error("GatewayPlayground is a post-MVP stub. Not yet implemented.");
}
