import { describe, expect, test } from "bun:test";
import { createContext } from "./gateway-admin-service-test-helpers.js";

describe("DefaultGatewayAdminService provider policies", () => {
  test("rejects host login auth mode for direct Anthropic API provider", () => {
    const ctx = createContext();
    try {
      expect(() => ctx.admin.setProviderConfig({
        providerId: "anthropic",
        model: "claude-sonnet-4-5",
        authMode: "host_login",
      })).toThrow();
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("surfaces Anthropic as a hosted provider with seeded Claude model options", async () => {
    const ctx = createContext();
    try {
      const configured = ctx.admin.setProviderConfig({
        providerId: "anthropic",
        model: "claude-sonnet-4-5",
        apiKey: "sk-ant-runtime",
      });

      expect(configured.providerId).toBe("anthropic");
      expect(configured.model).toBe("anthropic/claude-sonnet-4-5");
      expect(configured.hasApiKey).toBe(true);

      const catalogs = await ctx.admin.listProviderCatalogs({ providerId: "anthropic" });
      expect(catalogs).toHaveLength(1);
      expect(catalogs[0]).toMatchObject({
        providerId: "anthropic",
        displayName: "Anthropic",
        group: "cloud",
        integrationClass: "cloud",
        requiresApiKey: true,
        hasApiKey: true,
      });
      expect(catalogs[0]?.installHint).toContain("ANTHROPIC_API_KEY");
      expect(catalogs[0]?.models.map((entry) => entry.id)).toEqual([
        "anthropic/claude-sonnet-4-5",
        "anthropic/claude-opus-4-5",
        "anthropic/claude-haiku-4-5",
      ]);
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });

  test("lists and rescans supported interconnectors through the catalog service", async () => {
    const bundles = [
      {
        bundleId: "jira-cli",
        bundleDisplayName: "Jira CLI",
        bundleDescription: "Gateway-managed Jira CLI bundle.",
        availabilityStatus: "inactive",
        detected: false,
        executablePath: null,
        installHint: "Install `jira` and rescan CLI Tools.",
        toolIds: ["jira.issue.view", "jira.issue.create"],
        toolCount: 2,
        managedEnabled: true,
        healthStatus: "unknown",
        healthMessage: "Jira CLI is not detected on this gateway.",
        updatedAt: "2026-03-09T10:00:00Z",
      },
    ];

    let rescanCalls = 0;
    const ctx = createContext({
      interconnectorCatalogService: {
        listBundles: () => bundles,
        rescan: async () => {
          rescanCalls += 1;
          return { interconnectors: bundles };
        },
      },
    });

    try {
      expect(ctx.admin.listInterconnectors()).toEqual(bundles);
      await expect(ctx.admin.rescanInterconnectors()).resolves.toEqual(bundles);
      expect(rescanCalls).toBe(1);
    } finally {
      ctx.db.close();
      ctx.restoreEnv();
    }
  });
});
