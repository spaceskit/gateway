import { describe, expect, test } from "bun:test";
import {
  capabilityRequestFromInvocation,
  capabilityGrantsFromIds,
  createGatewayCoreState,
  evaluateCapabilityRequest,
  grantCapability,
} from "../src/index.js";

describe("gateway-core policy enforcement", () => {
  test("defaults to prompt for ungranted capability requests", () => {
    const state = createGatewayCoreState({ profileId: "embedded" });
    const request = capabilityRequestFromInvocation("calendar", "getEvents");
    const decision = evaluateCapabilityRequest(state, request);

    expect(request.capabilityId).toBe("calendar.read");
    expect(decision.decision).toBe("prompt");
    expect(decision.currentLevel).toBe("none");
  });

  test("allows a granted capability", () => {
    let state = createGatewayCoreState({ profileId: "embedded" });
    state = grantCapability(state, {
      capabilityId: "lists.read",
      level: "read",
      grantedBy: "test",
    });

    const decision = evaluateCapabilityRequest(
      state,
      capabilityRequestFromInvocation("lists", "list_items"),
    );

    expect(decision.decision).toBe("allow");
    expect(decision.currentLevel).toBe("read");
  });

  test("denies hard-blocked capabilities in embedded profile", () => {
    const state = createGatewayCoreState({ profileId: "embedded" });
    const decision = evaluateCapabilityRequest(
      state,
      capabilityRequestFromInvocation("shell", "run"),
    );

    expect(decision.decision).toBe("deny");
  });

  test("normalizes startup grants and rejects unknown aliases", () => {
    const parsed = capabilityGrantsFromIds([
      "calendar.read",
      "email.write",
      "speech.execute",
      "lists.read",
      "bad-grant",
    ]);

    expect(parsed.grants.map((grant) => grant.capabilityId)).toEqual([
      "calendar.read",
      "email.write",
      "speech.execute",
      "lists.read",
    ]);
    expect(parsed.invalid).toEqual(["bad-grant"]);
  });

  test("maps MCP operations to execute level deterministically", () => {
    const request = capabilityRequestFromInvocation("mcp", "list_tools");
    expect(request.level).toBe("execute");
    expect(request.capabilityId).toBe("mcp.execute");
  });
});
