import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/index.js";

async function withEnv(
  overrides: Record<string, string | undefined>,
  run: () => void | Promise<void>,
) {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(overrides)) {
    previous.set(key, Bun.env[key]);
    const nextValue = overrides[key];
    if (nextValue === undefined) {
      delete Bun.env[key];
    } else {
      Bun.env[key] = nextValue;
    }
  }
  try {
    await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete Bun.env[key];
      } else {
        Bun.env[key] = value;
      }
    }
  }
}

describe("bootstrap config env parsing", () => {
  test("defaults apple foundation provider flag to host capability for embedded profile", async () => {
    await withEnv({
      SPACESKIT_GATEWAY_PROFILE: "embedded",
      SPACESKIT_ENABLE_APPLE_FOUNDATION_PROVIDER: undefined,
    }, () => {
      const config = loadConfig();
      expect(config.enableAppleFoundationProvider).toBe(process.platform === "darwin" && process.arch === "arm64");
    });
  });

  test("defaults apple foundation provider flag to host capability for external profile", async () => {
    await withEnv({
      SPACESKIT_GATEWAY_PROFILE: "external",
      SPACESKIT_ENABLE_APPLE_FOUNDATION_PROVIDER: undefined,
    }, () => {
      const config = loadConfig();
      expect(config.enableAppleFoundationProvider).toBe(process.platform === "darwin" && process.arch === "arm64");
    });
  });

  test("parses SPACESKIT_ENABLE_APPLE_FOUNDATION_PROVIDER=true", async () => {
    await withEnv({ SPACESKIT_ENABLE_APPLE_FOUNDATION_PROVIDER: "true" }, () => {
      const config = loadConfig();
      expect(config.enableAppleFoundationProvider).toBe(true);
    });
  });

  test("parses SPACESKIT_ENABLE_APPLE_FOUNDATION_PROVIDER=1", async () => {
    await withEnv({ SPACESKIT_ENABLE_APPLE_FOUNDATION_PROVIDER: "1" }, () => {
      const config = loadConfig();
      expect(config.enableAppleFoundationProvider).toBe(true);
    });
  });

  test("parses SPACESKIT_ENABLE_APPLE_FOUNDATION_PROVIDER=yes", async () => {
    await withEnv({ SPACESKIT_ENABLE_APPLE_FOUNDATION_PROVIDER: "yes" }, () => {
      const config = loadConfig();
      expect(config.enableAppleFoundationProvider).toBe(true);
    });
  });

  test("falls back to host-capability default for invalid SPACESKIT_ENABLE_APPLE_FOUNDATION_PROVIDER values", async () => {
    await withEnv({
      SPACESKIT_GATEWAY_PROFILE: "external",
      SPACESKIT_ENABLE_APPLE_FOUNDATION_PROVIDER: "enabled",
    }, () => {
      const config = loadConfig();
      expect(config.enableAppleFoundationProvider).toBe(process.platform === "darwin" && process.arch === "arm64");
    });
  });

  test("forces HTTP principal auth strict mode for external profile when HS256 secret is configured", async () => {
    await withEnv({
      SPACESKIT_GATEWAY_PROFILE: "external",
      SPACESKIT_HTTP_PRINCIPAL_AUTH_STRICT: undefined,
      SPACESKIT_HTTP_PRINCIPAL_AUTH_HS256_SECRET: "test-secret",
    }, () => {
      const config = loadConfig();
      expect(config.gatewayProfile).toBe("external");
      expect(config.httpPrincipalAuthStrict).toBe(true);
      expect(config.httpPrincipalAuthStrictExplicitDisable).toBe(false);
    });
  });

  test("keeps strict HTTP principal auth enabled for external profile even when secret is missing", async () => {
    await withEnv({
      SPACESKIT_GATEWAY_PROFILE: "external",
      SPACESKIT_HTTP_PRINCIPAL_AUTH_STRICT: undefined,
      SPACESKIT_HTTP_PRINCIPAL_AUTH_HS256_SECRET: undefined,
    }, () => {
      const config = loadConfig();
      expect(config.gatewayProfile).toBe("external");
      expect(config.httpPrincipalAuthStrict).toBe(true);
      expect(config.httpPrincipalAuthHs256Secret).toBeUndefined();
    });
  });

  test("defaults SPACESKIT_AGENT_SESSION_REPLACEMENT_V1 to true", async () => {
    await withEnv({ SPACESKIT_AGENT_SESSION_REPLACEMENT_V1: undefined }, () => {
      const config = loadConfig();
      expect(config.agentSessionReplacementEnabled).toBe(true);
    });
  });

  test("parses SPACESKIT_AGENT_SESSION_REPLACEMENT_V1=false", async () => {
    await withEnv({ SPACESKIT_AGENT_SESSION_REPLACEMENT_V1: "false" }, () => {
      const config = loadConfig();
      expect(config.agentSessionReplacementEnabled).toBe(false);
    });
  });

  test("records explicit strict-auth disable attempts on external profile but keeps strict mode enabled", async () => {
    await withEnv({
      SPACESKIT_GATEWAY_PROFILE: "external",
      SPACESKIT_HTTP_PRINCIPAL_AUTH_STRICT: "false",
      SPACESKIT_HTTP_PRINCIPAL_AUTH_HS256_SECRET: "test-secret",
    }, () => {
      const config = loadConfig();
      expect(config.httpPrincipalAuthStrict).toBe(true);
      expect(config.httpPrincipalAuthStrictExplicitDisable).toBe(true);
    });
  });

  test("keeps strict HTTP principal auth disabled by default for embedded profile", async () => {
    await withEnv({
      SPACESKIT_GATEWAY_PROFILE: "embedded",
      SPACESKIT_HTTP_PRINCIPAL_AUTH_STRICT: undefined,
      SPACESKIT_HTTP_PRINCIPAL_AUTH_HS256_SECRET: "test-secret",
    }, () => {
      const config = loadConfig();
      expect(config.gatewayProfile).toBe("embedded");
      expect(config.httpPrincipalAuthStrict).toBe(false);
      expect(config.httpPrincipalAuthStrictExplicitDisable).toBe(false);
    });
  });

  test("uses explicit SPACESKIT_SPACES_ROOT when provided", async () => {
    await withEnv({
      SPACESKIT_GATEWAY_PROFILE: "embedded",
      SPACESKIT_SPACES_ROOT: "/tmp/custom-spaces-root",
    }, () => {
      const config = loadConfig();
      expect(config.spacesRoot).toBe("/tmp/custom-spaces-root");
    });
  });

  test("defaults managed spaces root to ~/Documents/Spaces for embedded macOS gateways", async () => {
    await withEnv({
      SPACESKIT_GATEWAY_PROFILE: "embedded",
      SPACESKIT_SPACES_ROOT: undefined,
      SPACESKIT_DB_PATH: undefined,
    }, () => {
      const config = loadConfig();
      expect(config.spacesRoot).toBe(join(homedir(), "Documents", "Spaces"));
    });
  });

  test("defaults managed spaces root from the DB location for external gateways", async () => {
    await withEnv({
      SPACESKIT_GATEWAY_PROFILE: "external",
      SPACESKIT_SPACES_ROOT: undefined,
      SPACESKIT_DB_PATH: "/tmp/spaceskit-external/gateway.db",
    }, () => {
      const config = loadConfig();
      expect(config.spacesRoot).toBe("/tmp/spaceskit-external/spaces");
    });
  });

  test("defaults concierge resource id to canonical hidden backing-space prefix", async () => {
    await withEnv({
      SPACESKIT_GATEWAY_PROFILE: "embedded",
      SPACESKIT_CONCIERGE_SPACE_ID: "concierge-space-custom",
      SPACESKIT_CONCIERGE_RESOURCE_ID: undefined,
    }, () => {
      const config = loadConfig();
      expect(config.conciergeSpaceResourceId).toBe("system.concierge.backing-space.concierge-space-custom");
    });
  });
});
