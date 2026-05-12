import { describe, expect, test } from "bun:test";
import { MessageTypes } from "../src/protocol.js";
import { makeClient, makeMessage, makeRouter } from "./message-router.feature-flows-test-helpers.js";

describe("MessageRouter feature handlers", () => {
  test("routes connector control-plane operations", async () => {
    const connector = {
      connectorId: "whatsapp-cloud:acct_deadbeef:support",
      familyId: "whatsapp-cloud",
      displayName: "Support",
      accountFingerprintHash: "deadbeef",
      labelSlug: "support",
      status: "active",
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const router = makeRouter({
      connectorAdminService: {
        listConnectorFamilies: () => [{
          familyId: "whatsapp-cloud",
          displayName: "WhatsApp",
          kind: "channel",
          runtime: "connector",
          trustClass: "external_only",
          embeddedEnabled: false,
          capabilityTypes: ["messaging", "notifications"],
          features: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
        listConnectors: () => [connector],
        upsertConnector: () => connector,
        removeConnector: () => ({ removed: true }),
        listConnectorBindings: () => [],
        upsertConnectorBinding: () => ({
          bindingId: "binding-1",
          connectorId: connector.connectorId,
          bindingType: "outbound_action",
          selector: {},
          targetType: "main_orchestrator",
          allowedActions: ["notify"],
          capabilityTypes: ["notifications"],
          priority: 100,
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        removeConnectorBinding: () => ({ removed: true }),
        getConnectorPolicy: () => ({
          scopeType: "global",
          scopeId: "*",
          requestsPerMinute: 60,
          burst: 60,
          disabled: false,
          updatedBy: "test",
          updatedAt: new Date().toISOString(),
        }),
        updateConnectorPolicy: () => ({
          scopeType: "global",
          scopeId: "*",
          requestsPerMinute: 60,
          burst: 60,
          disabled: false,
          updatedBy: "test",
          updatedAt: new Date().toISOString(),
        }),
        testConnector: () => ({
          ok: true,
          connector,
        }),
      },
    });

    const listFamilies = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.GATEWAY_LIST_CONNECTOR_FAMILIES, {}),
    );
    expect(listFamilies?.type).toBe(MessageTypes.GATEWAY_LIST_CONNECTOR_FAMILIES);

    const listConnectors = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.GATEWAY_LIST_CONNECTORS, {}),
    );
    expect(listConnectors?.type).toBe(MessageTypes.GATEWAY_LIST_CONNECTORS);

    const upsertConnector = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.GATEWAY_UPSERT_CONNECTOR, {
        familyId: "whatsapp-cloud",
        displayName: "Support",
        accountFingerprint: "acc",
        label: "Support",
      }),
    );
    expect(upsertConnector?.type).toBe(MessageTypes.GATEWAY_UPSERT_CONNECTOR);

    const testConnector = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.GATEWAY_TEST_CONNECTOR, {
        connectorId: connector.connectorId,
      }),
    );
    expect(testConnector?.type).toBe(MessageTypes.GATEWAY_TEST_CONNECTOR);
    expect((testConnector?.payload as any).ok).toBe(true);
  });

  test("handles Apple Mail inbound connector events", async () => {
    const connector = {
      connectorId: "apple-mail-mailkit:managed:gateway-1",
      familyId: "apple-mail-mailkit",
      displayName: "Apple Mail",
      accountFingerprintHash: "managed",
      labelSlug: "built-in",
      status: "active",
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const router = makeRouter({
      connectorAdminService: {
        resolveInboundRoute: () => ({
          route: "main_fallback",
          targetType: "main_orchestrator",
          targetSpaceId: "main-space",
        }),
      },
      gatewayPolicyService: {
        getPolicy: () => ({
          globalFlags: {
            integrations: {
              appleMail: {
                enabled: true,
                contentBlockerRules: [],
                securityMode: "pass_through",
              },
            },
          },
        }),
      },
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-mail-1" }),
        resumeFeedback: async () => {},
      },
    });

    const response = await router.handle(
      makeClient({ clientType: "mail_extension" }),
      makeMessage(MessageTypes.CONNECTOR_SUBMIT_INBOUND_EVENT, {
        connectorId: connector.connectorId,
        eventType: "compose_send",
        selector: {
          accountId: "apple-mail",
          messageId: "message-1",
        },
        snapshot: {
          subject: "Draft update",
        },
      }),
    );

    expect(response?.type).toBe(MessageTypes.CONNECTOR_INBOUND_EVENT_RESULT);
    expect(response?.payload).toMatchObject({
      ok: true,
      turnId: "turn-mail-1",
      route: {
        route: "main_fallback",
        targetType: "main_orchestrator",
        targetSpaceId: "main-space",
      },
      directives: {
        integrationEnabled: true,
        securityMode: "pass_through",
        allowSend: true,
      },
    });
  });

  test("rejects unknown capability types during adapter registration", async () => {
    const router = makeRouter();

    const response = await router.handle(
      makeClient({ clientType: "adapter" }),
      makeMessage(MessageTypes.CAPABILITIES_REGISTER, {
        providers: [{
          id: "provider-1",
          name: "Bad Provider",
          source: "adapter",
          capabilityType: "not_real",
          operations: ["ping"],
        }],
      }),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
    expect((response?.payload as any).message.toLowerCase()).toContain("unknown capability type");
  });

  test("preserves RATE_LIMITED error codes from routed services", async () => {
    const router = makeRouter({
      connectorAdminService: {
        listConnectors: () => {
          const error = new Error("Connector rate limit exceeded") as Error & { code?: string };
          error.code = "RATE_LIMITED";
          throw error;
        },
      },
    });

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.GATEWAY_LIST_CONNECTORS, {}),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("RATE_LIMITED");
    expect((response?.payload as any).message).toContain("rate limit");
  });

  test("preserves CIRCUIT_OPEN error codes from routed services", async () => {
    const router = makeRouter({
      connectorAdminService: {
        listConnectors: () => {
          const error = new Error("Connector circuit is open") as Error & { code?: string };
          error.code = "CIRCUIT_OPEN";
          throw error;
        },
      },
    });

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.GATEWAY_LIST_CONNECTORS, {}),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("CIRCUIT_OPEN");
    expect((response?.payload as any).message).toContain("circuit");
  });
});
