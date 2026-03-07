import { describe, expect, test } from "bun:test";
import {
  TERM_MAPPINGS,
  getTerm,
  getTermMap,
} from "../../src/terminology/terminology.js";

describe("TERM_MAPPINGS", () => {
  test("has expected length (12 entries)", () => {
    expect(TERM_MAPPINGS).toHaveLength(12);
  });

  test("each entry has key, consumer, and advanced strings", () => {
    for (const m of TERM_MAPPINGS) {
      expect(typeof m.key).toBe("string");
      expect(m.key.length).toBeGreaterThan(0);
      expect(typeof m.consumer).toBe("string");
      expect(m.consumer.length).toBeGreaterThan(0);
      expect(typeof m.advanced).toBe("string");
      expect(m.advanced.length).toBeGreaterThan(0);
    }
  });

  test("all keys are unique", () => {
    const keys = TERM_MAPPINGS.map((m) => m.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });
});

describe("getTerm", () => {
  test("gateway -> consumer = Server", () => {
    expect(getTerm("gateway", "consumer")).toBe("Server");
  });

  test("gateway -> advanced = Gateway", () => {
    expect(getTerm("gateway", "advanced")).toBe("Gateway");
  });

  test("agent -> consumer = Assistant", () => {
    expect(getTerm("agent", "consumer")).toBe("Assistant");
  });

  test("agent -> advanced = Agent", () => {
    expect(getTerm("agent", "advanced")).toBe("Agent");
  });

  test("principal -> consumer = User", () => {
    expect(getTerm("principal", "consumer")).toBe("User");
  });

  test("principal -> advanced = Principal", () => {
    expect(getTerm("principal", "advanced")).toBe("Principal");
  });

  test("noise_transport -> consumer = Encrypted Connection", () => {
    expect(getTerm("noise_transport", "consumer")).toBe("Encrypted Connection");
  });

  test("invite -> consumer = Invitation", () => {
    expect(getTerm("invite", "consumer")).toBe("Invitation");
  });

  test("invite -> advanced = Share Invite", () => {
    expect(getTerm("invite", "advanced")).toBe("Share Invite");
  });

  test("unknown key returns the key itself as fallback", () => {
    expect(getTerm("nonexistent_key", "consumer")).toBe("nonexistent_key");
    expect(getTerm("nonexistent_key", "advanced")).toBe("nonexistent_key");
  });

  test("empty string key returns empty string", () => {
    expect(getTerm("", "consumer")).toBe("");
    expect(getTerm("", "advanced")).toBe("");
  });
});

describe("getTermMap", () => {
  test("consumer map has all keys with consumer values", () => {
    const map = getTermMap("consumer");
    expect(Object.keys(map)).toHaveLength(TERM_MAPPINGS.length);

    expect(map["gateway"]).toBe("Server");
    expect(map["space"]).toBe("Space");
    expect(map["agent"]).toBe("Assistant");
    expect(map["profile"]).toBe("Personality");
    expect(map["capability"]).toBe("Skill");
    expect(map["connector"]).toBe("Integration");
    expect(map["orchestrator"]).toBe("Coordinator");
    expect(map["turn_model"]).toBe("Response Style");
    expect(map["resource"]).toBe("Device");
    expect(map["principal"]).toBe("User");
    expect(map["noise_transport"]).toBe("Encrypted Connection");
    expect(map["invite"]).toBe("Invitation");
  });

  test("advanced map has all keys with advanced values", () => {
    const map = getTermMap("advanced");
    expect(Object.keys(map)).toHaveLength(TERM_MAPPINGS.length);

    expect(map["gateway"]).toBe("Gateway");
    expect(map["space"]).toBe("Space");
    expect(map["agent"]).toBe("Agent");
    expect(map["profile"]).toBe("Agent Profile");
    expect(map["capability"]).toBe("Capability");
    expect(map["connector"]).toBe("Connector");
    expect(map["orchestrator"]).toBe("Orchestrator");
    expect(map["turn_model"]).toBe("Turn Model");
    expect(map["resource"]).toBe("Resource");
    expect(map["principal"]).toBe("Principal");
    expect(map["noise_transport"]).toBe("Noise Transport");
    expect(map["invite"]).toBe("Share Invite");
  });

  test("returned map is a fresh object each call", () => {
    const map1 = getTermMap("consumer");
    const map2 = getTermMap("consumer");
    expect(map1).not.toBe(map2);
    expect(map1).toEqual(map2);
  });
});
