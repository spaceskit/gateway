import { describe, expect, test } from "bun:test";
import { Logger } from "@spaceskit/observability";
import {
  initDatabase,
  AuditEventsRepository,
  ConnectorFamilyRepository,
  ConnectorInstanceRepository,
  ConnectorBindingRepository,
  ConnectorPolicyRepository,
  ConnectorSecretRefRepository,
} from "@spaceskit/persistence";
import { ConnectorAdminError, ConnectorAdminService } from "../src/services/connector-admin-service.js";

function createService(profile: "embedded" | "external") {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-connectors-${crypto.randomUUID()}`,
  });
  const auditRepo = new AuditEventsRepository(db.db);

  const service = new ConnectorAdminService({
    logger: new Logger({ minLevel: "error", module: "connector-test" }),
    gatewayProfile: profile,
    auditRepo,
    familyRepo: new ConnectorFamilyRepository(db.db),
    instanceRepo: new ConnectorInstanceRepository(db.db),
    bindingRepo: new ConnectorBindingRepository(db.db),
    policyRepo: new ConnectorPolicyRepository(db.db),
    secretRefRepo: new ConnectorSecretRefRepository(db.db),
    defaultTargetSpaceId: "main-space",
    enableWhatsappFamily: true,
    enableDiscordFamily: true,
  });

  return { db, service, auditRepo };
}

describe("ConnectorAdminService", () => {
  test("embedded profile rejects external-only families", () => {
    const ctx = createService("embedded");
    try {
      expect(() => {
        ctx.service.upsertConnector({
          familyId: "whatsapp-cloud",
          displayName: "WhatsApp Support",
          accountFingerprint: "business-account-1",
          label: "Support",
        });
      }).toThrow("embedded profile");
    } finally {
      ctx.db.close();
    }
  });

  test("routes inbound by best selector match with fallback", () => {
    const ctx = createService("external");
    try {
      const connector = ctx.service.upsertConnector({
        familyId: "whatsapp-cloud",
        displayName: "WA Team",
        accountFingerprint: "wa-account-1",
        label: "Team",
      });

      ctx.service.upsertConnectorBinding({
        connectorId: connector.connectorId,
        bindingType: "inbound_route",
        selector: {},
        targetType: "space_orchestrator",
        targetSpaceId: "space-default",
        priority: 100,
      });

      ctx.service.upsertConnectorBinding({
        connectorId: connector.connectorId,
        bindingType: "inbound_route",
        selector: { accountId: "acct-1", chatId: "chat-1" },
        targetType: "space_orchestrator",
        targetSpaceId: "space-chat-1",
        priority: 50,
      });

      const exact = ctx.service.resolveInboundRoute({
        connectorId: connector.connectorId,
        selector: { accountId: "acct-1", chatId: "chat-1" },
      });
      expect(exact.route).toBe("binding");
      expect(exact.targetSpaceId).toBe("space-chat-1");

      const fallback = ctx.service.resolveInboundRoute({
        connectorId: connector.connectorId,
        selector: { accountId: "acct-1", chatId: "chat-2" },
      });
      expect(fallback.route).toBe("binding");
      expect(fallback.targetSpaceId).toBe("space-default");
    } finally {
      ctx.db.close();
    }
  });

  test("rejects selector keys outside default family schema", () => {
    const ctx = createService("external");
    try {
      const connector = ctx.service.upsertConnector({
        familyId: "whatsapp-cloud",
        displayName: "WA Team",
        accountFingerprint: "wa-account-schema",
        label: "Schema",
      });

      expect(() => {
        ctx.service.upsertConnectorBinding({
          connectorId: connector.connectorId,
          bindingType: "inbound_route",
          selector: { unsupportedKey: "nope" },
          targetType: "space_orchestrator",
          targetSpaceId: "space-schema",
        });
      }).toThrow("Unsupported selector key");
    } finally {
      ctx.db.close();
    }
  });

  test("publishes selector schemas in connector family features", () => {
    const ctx = createService("external");
    try {
      const families = ctx.service.listConnectorFamilies();
      const whatsapp = families.find((family) => family.familyId === "whatsapp-cloud");
      expect(whatsapp).toBeDefined();

      const selectorSchemas = (whatsapp?.features as Record<string, unknown>).selectorSchemas as
        | Record<string, { allowedKeys?: string[] }>
        | undefined;
      expect(selectorSchemas).toBeDefined();
      expect(selectorSchemas?.inbound_route?.allowedKeys).toContain("chatId");
      expect(selectorSchemas?.outbound_action?.allowedKeys).toContain("phoneNumberId");

      const appleMail = families.find((family) => family.familyId === "apple-mail-mailkit");
      const appleMailSchemas = (appleMail?.features as Record<string, unknown>).selectorSchemas as
        | Record<string, { allowedKeys?: string[] }>
        | undefined;
      expect(appleMail?.kind).toBe("hybrid");
      expect(appleMail?.capabilityTypes).toEqual(["email"]);
      expect(appleMailSchemas?.inbound_route?.allowedKeys).toContain("messageId");
    } finally {
      ctx.db.close();
    }
  });

  test("send_message is denied by default when only notify is enabled", () => {
    const ctx = createService("external");
    try {
      const connector = ctx.service.upsertConnector({
        familyId: "discord-bot",
        displayName: "Discord Community",
        accountFingerprint: "discord-account-1",
        label: "Community",
      });

      ctx.service.upsertConnectorBinding({
        connectorId: connector.connectorId,
        bindingType: "outbound_action",
        selector: {},
        targetType: "main_orchestrator",
        allowedActions: ["notify"],
      });

      const sendDecision = ctx.service.enforceOutbound({
        connectorId: connector.connectorId,
        action: "send_message",
      });
      expect(sendDecision.allowed).toBe(false);

      const notifyDecision = ctx.service.enforceOutbound({
        connectorId: connector.connectorId,
        action: "notify",
      });
      expect(notifyDecision.allowed).toBe(true);
    } finally {
      ctx.db.close();
    }
  });

  test("per-instance disable blocks only targeted connector", () => {
    const ctx = createService("external");
    try {
      const primary = ctx.service.upsertConnector({
        familyId: "whatsapp-cloud",
        displayName: "Primary WA",
        accountFingerprint: "wa-account-primary",
        label: "Primary",
      });
      const secondary = ctx.service.upsertConnector({
        familyId: "whatsapp-cloud",
        displayName: "Secondary WA",
        accountFingerprint: "wa-account-secondary",
        label: "Secondary",
      });

      for (const connector of [primary, secondary]) {
        ctx.service.upsertConnectorBinding({
          connectorId: connector.connectorId,
          bindingType: "outbound_action",
          selector: {},
          targetType: "main_orchestrator",
          allowedActions: ["notify"],
        });
      }

      ctx.service.updateConnectorPolicy({
        scopeType: "instance",
        scopeId: primary.connectorId,
        disabled: true,
        disableReason: "maintenance",
        updatedBy: "test",
      });

      const blocked = ctx.service.enforceOutbound({
        connectorId: primary.connectorId,
        action: "notify",
      });
      expect(blocked.allowed).toBe(false);
      expect(blocked.reason?.toLowerCase()).toContain("maintenance");

      const allowed = ctx.service.enforceOutbound({
        connectorId: secondary.connectorId,
        action: "notify",
      });
      expect(allowed.allowed).toBe(true);
    } finally {
      ctx.db.close();
    }
  });

  test("instance rate limits are isolated", () => {
    const ctx = createService("external");
    try {
      const a = ctx.service.upsertConnector({
        familyId: "discord-bot",
        displayName: "Discord A",
        accountFingerprint: "discord-a",
        label: "A",
      });
      const b = ctx.service.upsertConnector({
        familyId: "discord-bot",
        displayName: "Discord B",
        accountFingerprint: "discord-b",
        label: "B",
      });

      for (const connector of [a, b]) {
        ctx.service.upsertConnectorBinding({
          connectorId: connector.connectorId,
          bindingType: "outbound_action",
          selector: {},
          targetType: "main_orchestrator",
          allowedActions: ["notify"],
        });

        ctx.service.updateConnectorPolicy({
          scopeType: "instance",
          scopeId: connector.connectorId,
          requestsPerMinute: 1,
          burst: 1,
          updatedBy: "test",
        });
      }

      const firstA = ctx.service.enforceOutbound({ connectorId: a.connectorId, action: "notify" });
      expect(firstA.allowed).toBe(true);

      expect(() => {
        ctx.service.enforceOutbound({ connectorId: a.connectorId, action: "notify" });
      }).toThrow(ConnectorAdminError);

      const firstB = ctx.service.enforceOutbound({ connectorId: b.connectorId, action: "notify" });
      expect(firstB.allowed).toBe(true);
    } finally {
      ctx.db.close();
    }
  });

  test("policy updates and outbound attempts are audited", () => {
    const ctx = createService("external");
    try {
      const connector = ctx.service.upsertConnector({
        familyId: "discord-bot",
        displayName: "Discord Audit",
        accountFingerprint: "discord-audit",
        label: "Audit",
      });

      ctx.service.upsertConnectorBinding({
        connectorId: connector.connectorId,
        bindingType: "outbound_action",
        selector: {},
        targetType: "main_orchestrator",
        allowedActions: ["notify"],
      });

      ctx.service.updateConnectorPolicy({
        scopeType: "instance",
        scopeId: connector.connectorId,
        disabled: true,
        disableReason: "ops-maintenance",
        updatedBy: "ops-user",
      });

      const denied = ctx.service.enforceOutbound({
        connectorId: connector.connectorId,
        action: "notify",
      });
      expect(denied.allowed).toBe(false);

      const events = ctx.auditRepo.list(50);
      expect(events.some((event) => event.event_type === "connector.policy.updated")).toBe(true);
      expect(events.some((event) => event.event_type === "connector.policy.disabled")).toBe(true);
      expect(events.some((event) => event.event_type === "connector.outbound.denied")).toBe(true);
    } finally {
      ctx.db.close();
    }
  });
});
