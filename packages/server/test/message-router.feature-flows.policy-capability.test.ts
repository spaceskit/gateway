import { describe, expect, test } from "bun:test";
import { MessageTypes } from "../src/protocol.js";
import { makeClient, makeMessage, makeRouter } from "./message-router.feature-flows-test-helpers.js";

describe("MessageRouter feature handlers", () => {
  test("routes usage.get_snapshot", async () => {
    const router = makeRouter({
      usageSnapshotService: {
        getSnapshot: () => ({
          computedAt: new Date().toISOString(),
          currency: "USD",
          windows: {
            last5h: { inputTokens: 1, outputTokens: 2, totalTokens: 3, spentUsd: 0.01 },
            last7d: { inputTokens: 1, outputTokens: 2, totalTokens: 3, spentUsd: 0.01 },
            last30d: { inputTokens: 1, outputTokens: 2, totalTokens: 3, spentUsd: 0.01 },
            lifetime: { inputTokens: 1, outputTokens: 2, totalTokens: 3, spentUsd: 0.01 },
          },
          budget: {
            softCapUsd: 20,
            hardCapUsd: 50,
            warningThreshold: 0.8,
            spentUsd: 0.01,
            leftUsd: 49.99,
          },
          providerUsage: [],
        }),
      },
    });

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.USAGE_GET_SNAPSHOT, {}),
    );

    expect(response?.type).toBe(MessageTypes.USAGE_GET_SNAPSHOT);
    expect((response?.payload as any).snapshot.currency).toBe("USD");
  });

  test("routes gateway.get_policy and gateway.update_policy", async () => {
    let updated = false;
    const router = makeRouter({
      gatewayPolicyService: {
        getPolicy: () => ({
          allowedCapabilityTypes: [],
          deniedCapabilityTypes: [],
          allowedSkillIds: [],
          deniedSkillIds: [],
          globalFlags: {},
          updatedAt: new Date().toISOString(),
        }),
        updatePolicy: (_patch: any) => {
          updated = true;
          return {
            allowedCapabilityTypes: ["calendar"],
            deniedCapabilityTypes: [],
            allowedSkillIds: [],
            deniedSkillIds: [],
            globalFlags: { crossSpaceRequiresApproval: true },
            updatedAt: new Date().toISOString(),
          };
        },
      },
    });

    const getResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.GATEWAY_GET_POLICY, {}),
    );
    expect(getResponse?.type).toBe(MessageTypes.GATEWAY_GET_POLICY);

    const updateResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.GATEWAY_UPDATE_POLICY, {
        globalFlags: { crossSpaceRequiresApproval: true },
      }),
    );

    expect(updateResponse?.type).toBe(MessageTypes.GATEWAY_UPDATE_POLICY);
    expect(updated).toBe(true);
  });

  test("routes gateway capability grant management for authenticated principal", async () => {
    const grants: any[] = [];
    const router = makeRouter({
      gatewayCapabilityAccessService: {
        listCapabilityGrants: () => grants,
        grantCapability: (input: any) => {
          const grant = {
            principalId: input.principalId,
            deviceId: input.deviceId ?? "device-1",
            capabilityId: "calendar.read",
            level: "read",
            source: "runtime_api",
            reason: input.reason ?? "",
            grantedBy: input.grantedBy,
            grantedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          grants.push(grant);
          return grant;
        },
        revokeCapability: () => ({
          revoked: true,
          capabilityId: "calendar.read",
          principalId: "principal-1",
          deviceId: "device-1",
        }),
      },
    });

    const listResponse = await router.handle(
      makeClient({ publicKey: "principal-1", deviceId: "device-1" }),
      makeMessage(MessageTypes.GATEWAY_LIST_CAPABILITY_GRANTS, {}),
    );
    expect(listResponse?.type).toBe(MessageTypes.GATEWAY_LIST_CAPABILITY_GRANTS);

    const grantResponse = await router.handle(
      makeClient({ publicKey: "principal-1", deviceId: "device-1" }),
      makeMessage(MessageTypes.GATEWAY_GRANT_CAPABILITY, {
        capabilityId: "calendar.read",
        reason: "Needed for agenda lookups.",
      }),
    );
    expect(grantResponse?.type).toBe(MessageTypes.GATEWAY_GRANT_CAPABILITY);
    expect((grantResponse?.payload as any).grant.capabilityId).toBe("calendar.read");

    const revokeResponse = await router.handle(
      makeClient({ publicKey: "principal-1", deviceId: "device-1" }),
      makeMessage(MessageTypes.GATEWAY_REVOKE_CAPABILITY, {
        capabilityId: "calendar.read",
      }),
    );
    expect(revokeResponse?.type).toBe(MessageTypes.GATEWAY_REVOKE_CAPABILITY);
    expect((revokeResponse?.payload as any).revoked).toBe(true);
  });

  test("rejects capability grant access for other principal", async () => {
    const router = makeRouter({
      gatewayCapabilityAccessService: {
        listCapabilityGrants: () => [],
        grantCapability: () => ({}),
        revokeCapability: () => ({
          revoked: false,
          capabilityId: "calendar.read",
          principalId: "other-principal",
          deviceId: "device-1",
        }),
      },
    });

    const response = await router.handle(
      makeClient({ publicKey: "principal-1", deviceId: "device-1" }),
      makeMessage(MessageTypes.GATEWAY_GRANT_CAPABILITY, {
        principalId: "other-principal",
        capabilityId: "calendar.read",
      }),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("PERMISSION_DENIED");
  });
});
