/**
 * EventBus — typed pub/sub for gateway events.
 *
 * All 41+ event types from v1 carry forward (renamed room.* -> space.*).
 * New capability events are added for the multi-provider system.
 */

export interface GatewayEvent {
  type: string;
  timestamp: Date;
  [key: string]: unknown;
}

export type EventHandler = (event: GatewayEvent) => void | Promise<void>;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private wildcardHandlers = new Set<EventHandler>();

  /** Subscribe to a specific event type. */
  on(eventType: string, handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  /** Subscribe to all events. */
  onAny(handler: EventHandler): () => void {
    this.wildcardHandlers.add(handler);
    return () => {
      this.wildcardHandlers.delete(handler);
    };
  }

  /** Emit an event to all matching subscribers. */
  emit(event: GatewayEvent): void {
    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          handler(event);
        } catch (err) {
          console.error(`Event handler error for ${event.type}:`, err);
        }
      }
    }

    for (const handler of this.wildcardHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error(`Wildcard event handler error for ${event.type}:`, err);
      }
    }
  }

  /** Create an async iterable that yields events of a given type. */
  subscribe(eventType: string, signal?: AbortSignal): AsyncIterable<GatewayEvent> {
    const bus = this;
    return {
      [Symbol.asyncIterator]() {
        const queue: GatewayEvent[] = [];
        let resolve: ((value: IteratorResult<GatewayEvent>) => void) | null = null;
        let done = false;

        const unsub = bus.on(eventType, (event) => {
          if (resolve) {
            const r = resolve;
            resolve = null;
            r({ value: event, done: false });
          } else {
            queue.push(event);
          }
        });

        signal?.addEventListener("abort", () => {
          done = true;
          unsub();
          if (resolve) {
            const r = resolve;
            resolve = null;
            r({ value: undefined as any, done: true });
          }
        });

        return {
          next() {
            if (done) return Promise.resolve({ value: undefined as any, done: true });
            if (queue.length > 0) {
              return Promise.resolve({ value: queue.shift()!, done: false });
            }
            return new Promise<IteratorResult<GatewayEvent>>((r) => {
              resolve = r;
            });
          },
          return() {
            done = true;
            unsub();
            return Promise.resolve({ value: undefined as any, done: true });
          },
          [Symbol.asyncIterator]() {
            return this;
          },
        };
      },
    };
  }
}
