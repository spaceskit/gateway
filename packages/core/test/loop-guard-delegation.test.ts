import { describe, expect, test } from "bun:test";
import { validateDelegation } from "../src/agents/delegation-validation.js";
import type { DelegationRequest } from "../src/agents/delegation-validation.js";

function makeRequest(overrides: Partial<DelegationRequest> = {}): DelegationRequest {
  return {
    targetAgentId: "agent-b",
    task: "do something",
    delegatingAgentId: "agent-a",
    delegatingSpaceId: "space-1",
    lineageId: "lineage-abc",
    hopCount: 0,
    ...overrides,
  };
}

describe("validateDelegation", () => {
  test("returns allowed:true for valid hops within limit", () => {
    const result = validateDelegation(makeRequest({ hopCount: 2 }), 5);
    expect(result.allowed).toBe(true);
    expect(result.rejection).toBeUndefined();
    expect(result.gate).toBeUndefined();
  });

  test("returns allowed:true when hopCount is one below maxHops", () => {
    const result = validateDelegation(makeRequest({ hopCount: 4 }), 5);
    expect(result.allowed).toBe(true);
  });

  test("returns gate:loop_guard when hopCount equals maxHops", () => {
    const result = validateDelegation(makeRequest({ hopCount: 5 }), 5);
    expect(result.allowed).toBe(false);
    expect(result.gate).toBe("loop_guard");
    expect(result.gateDescription).toContain("maximum hop count (5)");
    expect(result.gateDescription).toContain("lineage-abc");
    expect(result.rejection).toBeUndefined();
  });

  test("returns gate:loop_guard when hopCount exceeds maxHops", () => {
    const result = validateDelegation(makeRequest({ hopCount: 10 }), 5);
    expect(result.allowed).toBe(false);
    expect(result.gate).toBe("loop_guard");
    expect(result.gateDescription).toContain("maximum hop count (5)");
  });

  test("returns hard rejection for self-delegation", () => {
    const result = validateDelegation(
      makeRequest({ targetAgentId: "agent-a", delegatingAgentId: "agent-a" }),
      5,
    );
    expect(result.allowed).toBe(false);
    expect(result.rejection).toBe("Delegation rejected: agent cannot delegate to itself");
    expect(result.gate).toBeUndefined();
  });

  test("self-delegation rejection takes priority over hop limit", () => {
    const result = validateDelegation(
      makeRequest({ targetAgentId: "agent-a", delegatingAgentId: "agent-a", hopCount: 10 }),
      5,
    );
    expect(result.allowed).toBe(false);
    expect(result.rejection).toBeDefined();
    // Should be hard rejection, not a soft gate
    expect(result.gate).toBeUndefined();
  });

  test("returns allowed:true with maxHops of 0 and hopCount of 0 triggers gate", () => {
    const result = validateDelegation(makeRequest({ hopCount: 0 }), 0);
    expect(result.allowed).toBe(false);
    expect(result.gate).toBe("loop_guard");
  });

  test("gateDescription includes lineageId for traceability", () => {
    const result = validateDelegation(
      makeRequest({ hopCount: 3, lineageId: "trace-xyz-789" }),
      3,
    );
    expect(result.allowed).toBe(false);
    expect(result.gate).toBe("loop_guard");
    expect(result.gateDescription).toContain("trace-xyz-789");
  });
});
