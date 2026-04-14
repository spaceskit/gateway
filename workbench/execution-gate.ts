export class WorkbenchExecutionGate {
  private ownerId: string | null = null;
  private readonly listeners = new Set<() => void>();

  tryAcquire(ownerId: string): boolean {
    if (this.ownerId && this.ownerId !== ownerId) {
      return false;
    }
    this.ownerId = ownerId;
    this.emit();
    return true;
  }

  release(ownerId: string): void {
    if (this.ownerId !== ownerId) {
      return;
    }
    this.ownerId = null;
    this.emit();
  }

  isHeldBy(ownerId: string): boolean {
    return this.ownerId === ownerId;
  }

  isBusy(): boolean {
    return this.ownerId !== null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
