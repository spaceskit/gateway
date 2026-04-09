import { describe, expect, test } from "bun:test";
import type { RuntimeApprovalSelection, RuntimeFeedbackCheckpoint } from "@spaceskit/core";
import { persistFeedbackApprovalSelection } from "../src/services/feedback-approval-grant-bridge.js";

describe("persistFeedbackApprovalSelection", () => {
  const approvalGrant: RuntimeApprovalSelection = {
    mode: "durable",
  };

  const feedbackRequest: RuntimeFeedbackCheckpoint = {
    id: "feedback-1",
    agentId: "agent-1",
    triggerClass: "policy_escalation",
    description: "Need approval",
    options: ["approve", "reject"],
    context: {
      targetKind: "dangerous_capability",
      targetId: "managed_shell",
      requestedCapability: "shell.read",
    },
  };

  test("keeps once approvals in-memory only", () => {
    const accessCalls: Array<Record<string, unknown>> = [];
    const capabilityCalls: Array<Record<string, unknown>> = [];

    const result = persistFeedbackApprovalSelection({
      spaceId: "space-1",
      approvalGrant: { ...approvalGrant, mode: "once" },
      feedbackRequest,
      principalId: "principal-1",
      deviceId: "device-1",
      accessGrantService: {
        grantAccess(input) {
          accessCalls.push(input as unknown as Record<string, unknown>);
          return {} as any;
        },
      } as any,
      gatewayCapabilityAccessService: {
        grantCapability(input) {
          capabilityCalls.push(input as unknown as Record<string, unknown>);
          return {} as any;
        },
      } as any,
    });

    expect(result.persistedAccessGrant).toBe(false);
    expect(result.persistedCapabilityGrant).toBe(false);
    expect(result.persistedToolApprovalGrant).toBe(false);
    expect(result.requestedCapability).toBe("shell.read");
    expect(accessCalls).toHaveLength(0);
    expect(capabilityCalls).toHaveLength(0);
  });

  test("persists both access and capability grants for durable approvals", () => {
    const accessCalls: Array<Record<string, unknown>> = [];
    const capabilityCalls: Array<Record<string, unknown>> = [];

    const result = persistFeedbackApprovalSelection({
      spaceId: "space-1",
      approvalGrant,
      feedbackRequest,
      principalId: "principal-1",
      deviceId: "device-1",
      accessGrantService: {
        grantAccess(input) {
          accessCalls.push(input as unknown as Record<string, unknown>);
          return {} as any;
        },
      } as any,
      gatewayCapabilityAccessService: {
        grantCapability(input) {
          capabilityCalls.push(input as unknown as Record<string, unknown>);
          return {} as any;
        },
      } as any,
    });

    expect(result.persistedAccessGrant).toBe(true);
    expect(result.persistedCapabilityGrant).toBe(true);
    expect(result.persistedToolApprovalGrant).toBe(false);
    expect(accessCalls).toHaveLength(1);
    expect(capabilityCalls).toHaveLength(1);
    expect(accessCalls[0]).toMatchObject({
      principalId: "principal-1",
      deviceId: "device-1",
      spaceId: "space-1",
      targetKind: "dangerous_capability",
      targetId: "managed_shell",
      mode: "durable",
    });
    expect(capabilityCalls[0]).toMatchObject({
      principalId: "principal-1",
      deviceId: "device-1",
      capabilityId: "shell.read",
      source: "feedback_resume",
    });
  });

  test("persists time-window capability grants with an expiry", () => {
    const capabilityCalls: Array<Record<string, unknown>> = [];
    const now = new Date("2026-03-14T10:00:00.000Z");

    persistFeedbackApprovalSelection({
      spaceId: "space-1",
      approvalGrant: {
        ...approvalGrant,
        mode: "time_window",
        ttlSeconds: 60,
      },
      feedbackRequest,
      principalId: "principal-1",
      gatewayCapabilityAccessService: {
        grantCapability(input) {
          capabilityCalls.push(input as unknown as Record<string, unknown>);
          return {} as any;
        },
      } as any,
      now: () => now,
    });

    expect(capabilityCalls).toHaveLength(1);
    expect(capabilityCalls[0]?.expiresAt).toBe("2026-03-14T10:01:00.000Z");
  });

  test("persists tool-selector approvals into both access grants and tool approval grants", () => {
    const accessCalls: Array<Record<string, unknown>> = [];
    const toolApprovalCalls: Array<Record<string, unknown>> = [];

    const result = persistFeedbackApprovalSelection({
      spaceId: "space-1",
      approvalGrant,
      feedbackRequest: {
        ...feedbackRequest,
        context: {
          targetKind: "tool_selector",
          targetId: "tool_operation:shell.smoke-echo",
          toolName: "shell.smoke-echo",
          requestedCapability: "shell.smoke-echo",
        },
      },
      principalId: "principal-1",
      deviceId: "device-1",
      accessGrantService: {
        grantAccess(input) {
          accessCalls.push(input as unknown as Record<string, unknown>);
          return {} as any;
        },
      } as any,
      toolApprovalGrantService: {
        grantApproval(input) {
          toolApprovalCalls.push(input as unknown as Record<string, unknown>);
          return {} as any;
        },
      } as any,
    });

    expect(result.persistedAccessGrant).toBe(true);
    expect(result.persistedCapabilityGrant).toBe(false);
    expect(result.persistedToolApprovalGrant).toBe(true);
    expect(accessCalls[0]).toMatchObject({
      principalId: "principal-1",
      deviceId: "device-1",
      spaceId: "space-1",
      targetKind: "tool_selector",
      targetId: "tool_operation:shell.smoke-echo",
      mode: "durable",
    });
    expect(toolApprovalCalls[0]).toMatchObject({
      principalId: "principal-1",
      deviceId: "device-1",
      spaceId: "space-1",
      toolId: "shell.smoke-echo",
      mode: "durable",
    });
  });
});
