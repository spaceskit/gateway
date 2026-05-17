import type { Logger } from "@spaceskit/observability";

export class GatewayServerDrainState {
  private draining = false;
  private activeTurns = new Set<string>();
  private drainResolve: (() => void) | null = null;

  constructor(private readonly options: {
    logger: Logger | null;
    clientCount: () => number;
  }) {}

  get isDraining(): boolean {
    return this.draining;
  }

  get activeTurnCount(): number {
    return this.activeTurns.size;
  }

  registerActiveTurn(turnId: string): void {
    this.activeTurns.add(turnId);
  }

  completeTurn(turnId: string): void {
    this.activeTurns.delete(turnId);
    if (this.draining && this.activeTurns.size === 0 && this.drainResolve) {
      this.drainResolve();
      this.drainResolve = null;
    }
  }

  reset(): void {
    this.draining = false;
    this.activeTurns.clear();
    this.drainResolve = null;
  }

  async drain(timeoutMs: number = 10000): Promise<void> {
    this.draining = true;
    this.options.logger?.info("Server entering drain mode", {
      timeoutMs,
      clients: this.options.clientCount(),
      activeTurns: this.activeTurns.size,
    });

    if (this.options.clientCount() === 0 && this.activeTurns.size === 0) return;
    if (this.activeTurns.size === 0) return;

    await new Promise<void>((resolve) => {
      this.drainResolve = resolve;
      setTimeout(() => {
        this.drainResolve = null;
        resolve();
      }, timeoutMs);
    });

    this.options.logger?.info("Drain complete", {
      remainingTurns: this.activeTurns.size,
      timedOut: this.activeTurns.size > 0,
    });
  }
}
