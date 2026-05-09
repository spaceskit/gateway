import { describe, expect, test } from "bun:test";
import { EventBus, type GatewayEvent } from "../src/events/event-bus.js";

function makeEvent(type: string, extra: Record<string, unknown> = {}): GatewayEvent {
  return { type, timestamp: new Date(), ...extra };
}

describe("EventBus", () => {
  test("emit invokes registered handler for matching type", () => {
    const bus = new EventBus();
    const received: GatewayEvent[] = [];
    bus.on("foo.bar", (event) => {
      received.push(event);
    });

    const event = makeEvent("foo.bar", { payload: 1 });
    bus.emit(event);
    bus.emit(makeEvent("other.type"));

    expect(received.length).toBe(1);
    expect(received[0]).toBe(event);
  });

  test("emit invokes wildcard handler for any type", () => {
    const bus = new EventBus();
    const received: string[] = [];
    bus.onAny((event) => {
      received.push(event.type);
    });

    bus.emit(makeEvent("a.one"));
    bus.emit(makeEvent("b.two"));
    bus.emit(makeEvent("c.three"));

    expect(received).toEqual(["a.one", "b.two", "c.three"]);
  });

  test("emit catches handler errors and continues to remaining handlers (silent default)", () => {
    const bus = new EventBus();
    const calls: string[] = [];

    bus.on("evt", () => {
      calls.push("first");
      throw new Error("first boom");
    });
    bus.on("evt", () => {
      calls.push("second");
    });
    bus.onAny(() => {
      calls.push("wild-1");
      throw new Error("wild boom");
    });
    bus.onAny(() => {
      calls.push("wild-2");
    });

    // Should not throw despite handler errors.
    expect(() => bus.emit(makeEvent("evt"))).not.toThrow();
    expect(calls).toEqual(["first", "second", "wild-1", "wild-2"]);
  });

  test("onHandlerError callback fires when keyed handler throws", () => {
    const seen: Array<{ err: unknown; type: string; isWildcard: boolean }> = [];
    const bus = new EventBus({
      onHandlerError: (err, eventType, isWildcard) => {
        seen.push({ err, type: eventType, isWildcard });
      },
    });

    const boom = new Error("keyed boom");
    bus.on("evt.keyed", () => {
      throw boom;
    });

    bus.emit(makeEvent("evt.keyed"));

    expect(seen.length).toBe(1);
    expect(seen[0]?.err).toBe(boom);
    expect(seen[0]?.type).toBe("evt.keyed");
    expect(seen[0]?.isWildcard).toBe(false);
  });

  test("onHandlerError callback fires with isWildcard=true when wildcard handler throws", () => {
    const seen: Array<{ err: unknown; type: string; isWildcard: boolean }> = [];
    const bus = new EventBus({
      onHandlerError: (err, eventType, isWildcard) => {
        seen.push({ err, type: eventType, isWildcard });
      },
    });

    const boom = new Error("wild boom");
    bus.onAny(() => {
      throw boom;
    });

    bus.emit(makeEvent("evt.wild"));

    expect(seen.length).toBe(1);
    expect(seen[0]?.err).toBe(boom);
    expect(seen[0]?.type).toBe("evt.wild");
    expect(seen[0]?.isWildcard).toBe(true);
  });

  test("default (no callback) does NOT write to console.error", () => {
    const bus = new EventBus();
    bus.on("evt.silent", () => {
      throw new Error("keyed boom");
    });
    bus.onAny(() => {
      throw new Error("wild boom");
    });

    const originalError = console.error;
    const errors: unknown[][] = [];
    console.error = ((...args: unknown[]) => {
      errors.push(args);
    }) as typeof console.error;

    try {
      bus.emit(makeEvent("evt.silent"));
    } finally {
      console.error = originalError;
    }

    expect(errors).toEqual([]);
  });
});
