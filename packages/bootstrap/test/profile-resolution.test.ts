import { describe, expect, test } from "bun:test";
import { resolveGatewayProfile } from "../src/index.js";

describe("resolveGatewayProfile", () => {
  test("explicit embedded + non-9320 port → embedded, explicit_env", () => {
    const result = resolveGatewayProfile("embedded", 9999);
    expect(result.profile).toBe("embedded");
    expect(result.profileSource).toBe("explicit_env");
  });

  test("explicit external + port 9320 → external, explicit_env", () => {
    const result = resolveGatewayProfile("external", 9320);
    expect(result.profile).toBe("external");
    expect(result.profileSource).toBe("explicit_env");
  });

  test("no explicit profile + port 9320 → embedded, port_inferred", () => {
    const result = resolveGatewayProfile(undefined, 9320);
    expect(result.profile).toBe("embedded");
    expect(result.profileSource).toBe("port_inferred");
  });

  test("no explicit profile + non-9320 port → external, port_inferred", () => {
    const result = resolveGatewayProfile(undefined, 8080);
    expect(result.profile).toBe("external");
    expect(result.profileSource).toBe("port_inferred");
  });

  test("handles whitespace and casing in profile string", () => {
    const result = resolveGatewayProfile("  Embedded  ", 9999);
    expect(result.profile).toBe("embedded");
    expect(result.profileSource).toBe("explicit_env");
  });
});
