import { describe, expect, test } from "bun:test";
import { effectiveToolMatrixFromAccess } from "../src/effective-tool-matrix.js";

describe("effectiveToolMatrixFromAccess", () => {
  test("preserves allowed operations without deny reasons", () => {
    const matrix = effectiveToolMatrixFromAccess({
      spaceId: "space-1",
      agentId: "agent-1",
      policyVersion: "policy-1",
      generatedAt: "2026-04-09T08:00:00.000Z",
      operations: [{
        operationId: "read-file",
        capability: "filesystem.read",
        operation: "read_file",
        providerIds: ["codex"],
        allowed: true,
      }],
    });

    expect(matrix).toEqual({
      spaceId: "space-1",
      agentId: "agent-1",
      policyVersion: "policy-1",
      generatedAt: "2026-04-09T08:00:00.000Z",
      operations: [{
        operationId: "read-file",
        capability: "filesystem.read",
        operation: "read_file",
        providerIds: ["codex"],
        allowed: true,
        denyReasons: [],
      }],
    });
  });

  test("maps denied operations to the denyReasons payload", () => {
    const matrix = effectiveToolMatrixFromAccess({
      spaceId: "space-1",
      policyVersion: "policy-2",
      generatedAt: "2026-04-09T08:05:00.000Z",
      operations: [{
        operationId: "write-file",
        capability: "filesystem.write",
        operation: "write_file",
        providerIds: ["claude"],
        allowed: false,
        escalationAllowed: true,
      }, {
        operationId: "delete-file",
        capability: "filesystem.delete",
        operation: "delete_file",
        providerIds: ["claude"],
        allowed: false,
        denialReasonCode: "policy_denied",
        denialReason: "Deletes are blocked for guests.",
      }],
    });

    expect(matrix.operations).toEqual([
      {
        operationId: "write-file",
        capability: "filesystem.write",
        operation: "write_file",
        providerIds: ["claude"],
        allowed: false,
        denyReasons: [{
          code: "policy_escalation_required",
          message: "This operation requires approval before it can continue.",
        }],
      },
      {
        operationId: "delete-file",
        capability: "filesystem.delete",
        operation: "delete_file",
        providerIds: ["claude"],
        allowed: false,
        denyReasons: [{
          code: "policy_denied",
          message: "Deletes are blocked for guests.",
        }],
      },
    ]);
  });
});
