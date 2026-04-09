export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private resolvers: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    if (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift();
      resolver?.({ value, done: false });
      return;
    }
    this.queue.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift();
      resolver?.({ value: undefined as T, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.queue.length > 0) {
          const value = this.queue.shift() as T;
          return Promise.resolve({ value, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as T, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve);
        });
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined as T, done: true });
      },
    };
  }
}

export async function sleepWithAbort(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (delayMs <= 0) return !signal.aborted;
  if (signal.aborted) return false;

  return await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(true);
    }, delayMs);

    const onAbort = () => {
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}
