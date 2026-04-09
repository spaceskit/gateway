import { describe, expect, test } from "bun:test";
import {
  BUILTIN_MCP_ADMIN_TOOL_NAMES,
  buildBuiltinMcpAdminRuntimeMetadata,
  resolveBuiltinMcpAdminPolicy,
} from "../src/services/builtin-mcp-admin-policy.js";

describe("builtin MCP admin policy", () => {
  test("seeds legacy defaults from bootstrap enablement when no stored policy exists", () => {
    const policy = resolveBuiltinMcpAdminPolicy({
      globalFlags: {},
      bootstrapDefaultEnabled: true,
    });

    expect(policy.enabled).toBe(true);
    expect(policy.allowTargetSpaceOverride).toBe(true);
    expect(policy.allowedTools).toEqual([...BUILTIN_MCP_ADMIN_TOOL_NAMES]);
  });

  test("uses disabled defaults when bootstrap flag is off and no stored policy exists", () => {
    const policy = resolveBuiltinMcpAdminPolicy({
      globalFlags: {},
      bootstrapDefaultEnabled: false,
    });

    expect(policy.enabled).toBe(false);
    expect(policy.allowTargetSpaceOverride).toBe(false);
    expect(policy.allowedTools).toEqual([...BUILTIN_MCP_ADMIN_TOOL_NAMES]);
  });

  test("stored policy overrides bootstrap defaults and filters unknown tools", () => {
    const policy = resolveBuiltinMcpAdminPolicy({
      globalFlags: {
        mcpAdmin: {
          enabled: true,
          allowTargetSpaceOverride: false,
          allowedTools: [
            "spaces.admin.list_spaces",
            "spaces.admin.create_skill",
            "spaces.admin.unknown",
          ],
        },
      },
      bootstrapDefaultEnabled: true,
    });

    expect(policy.enabled).toBe(true);
    expect(policy.allowTargetSpaceOverride).toBe(false);
    expect(policy.allowedTools).toEqual([
      "spaces.admin.list_spaces",
      "spaces.admin.create_skill",
    ]);
  });

  test("builds strict runtime metadata when signed auth is enforced", () => {
    const metadata = buildBuiltinMcpAdminRuntimeMetadata({
      globalFlags: undefined,
      bootstrapDefaultEnabled: true,
      gatewayProfile: "external",
      strictHttpPrincipalAuth: true,
      tokenIssuerAvailable: true,
      defaultTargetSpaceId: "main-space",
    });

    expect(metadata.effectiveEnabled).toBe(true);
    expect(metadata.authMode).toBe("strict");
    expect(metadata.tokenIssuerAvailable).toBe(true);
    expect(metadata.defaultTargetSpaceId).toBe("main-space");
  });

  test("marks embedded gateways without HTTP principal support as unavailable", () => {
    const metadata = buildBuiltinMcpAdminRuntimeMetadata({
      globalFlags: undefined,
      bootstrapDefaultEnabled: false,
      gatewayProfile: "embedded",
      strictHttpPrincipalAuth: false,
      tokenIssuerAvailable: false,
      defaultTargetSpaceId: "main-space",
    });

    expect(metadata.authMode).toBe("unavailable");
  });
});
