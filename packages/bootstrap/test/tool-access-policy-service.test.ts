import { describe, expect, test } from "bun:test";
import {
  AccessGrantRepository,
  AuditEventsRepository,
  GatewayCapabilityGrantRepository,
  SafetyProfileRepository,
  SpaceParticipantRepository,
  SpaceRepository,
  SpaceShareInviteRepository,
  ToolAccessPolicyRepository,
  initDatabase,
} from "@spaceskit/persistence";
import { CapabilityRegistry, EventBus } from "@spaceskit/core";
import { GatewayCapabilityAccessService } from "../src/services/gateway-capability-access-service.js";
import { SpaceSharingService } from "../src/services/space-sharing-service.js";
import { ToolAccessPolicyService } from "../src/services/tool-access-policy-service.js";

function createContext() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-tool-access-policy-${crypto.randomUUID()}`,
  });
  const capabilities = new CapabilityRegistry(new EventBus());
  const spaces = new SpaceRepository(db.db);
  const participants = new SpaceParticipantRepository(db.db);
  const invites = new SpaceShareInviteRepository(db.db);
  const auditRepo = new AuditEventsRepository(db.db);
  const toolPolicies = new ToolAccessPolicyRepository(db.db);
  const safetyProfiles = new SafetyProfileRepository(db.db);
  const accessGrants = new AccessGrantRepository(db.db);
  const gatewayCapabilityGrantRepo = new GatewayCapabilityGrantRepository(db.db);

  spaces.create({
    spaceId: "space-main",
    resourceId: "resource-main",
    spaceType: "space",
    name: "Main Space",
    goal: "",
    turnModel: "sequential_all",
    configJson: JSON.stringify({
      spaceUid: "11111111-1111-1111-8111-111111111111",
    }),
  });

  capabilities.register(
    {
      id: "apple-reminders-eventkit",
      name: "Apple Reminders",
      source: "adapter",
      capabilityType: "lists",
      operations: ["listLists", "create_list"],
      available: true,
    },
    { invoke: async () => ({ ok: true }) },
  );

  capabilities.register(
    {
      id: "shell-local",
      name: "Jira CLI",
      source: "builtin",
      capabilityType: "shell",
      operations: ["jira.me", "run"],
      available: true,
    },
    { invoke: async () => ({ ok: true }) },
  );

  const gatewayCapabilityAccessService = new GatewayCapabilityAccessService({
    repository: gatewayCapabilityGrantRepo,
    profileId: "embedded",
    now: () => new Date("2026-03-12T09:00:00.000Z"),
  });

  const spaceSharingService = new SpaceSharingService({
    invites,
    participants,
    spaces,
    now: () => new Date("2026-03-12T09:00:00.000Z"),
  });

  const service = new ToolAccessPolicyService({
    capabilities,
    spaceAdminService: {
      getSpace: async () => ({
        id: "space-main",
        agents: [
          {
            agentId: "main-agent",
            isPrimary: true,
            profileId: "profile-main",
          },
          {
            agentId: "helper-agent",
            isPrimary: false,
            profileId: "profile-helper",
          },
        ],
      }),
    } as any,
    toolPolicies,
    safetyProfiles,
    accessGrants,
    gatewayCapabilityAccessService,
    gatewayProfileId: "embedded",
    spaceSharingService,
    cliToolService: {
      getTool: (toolId: string) => toolId === "jira.me"
        ? { id: toolId, bundleId: "jira-cli" }
        : undefined,
    },
    auditRepo,
    now: () => new Date("2026-03-12T09:00:00.000Z"),
  });

  const setParticipant = (
    principalId: string,
    mode: "read_only" | "collaborator",
    joinedViaInviteId?: string,
  ) => {
    if (joinedViaInviteId && !invites.getById(joinedViaInviteId)) {
      invites.create({
        inviteId: joinedViaInviteId,
        spaceId: "space-main",
        issuedByPrincipalId: "principal-owner",
        mode,
        tokenHash: `token-${joinedViaInviteId}`,
      });
    }
    participants.upsert({
      participantId: `participant-${principalId}`,
      spaceId: "space-main",
      principalId,
      mode,
      joinedViaInviteId: joinedViaInviteId ?? null,
    });
  };

  return {
    db,
    service,
    toolPolicies,
    accessGrants,
    auditRepo,
    setParticipant,
  };
}

describe("ToolAccessPolicyService", () => {
  test("owner default bypasses gateway grants for safe non-dangerous tools", async () => {
    const context = createContext();
    try {
      context.setParticipant("principal-owner", "collaborator");

      const decision = await context.service.evaluateToolAccess({
        spaceId: "space-main",
        agentId: "helper-agent",
        principalId: "principal-owner",
        executionOrigin: "owner",
        capability: "lists",
        operation: "create_list",
      });

      expect(decision.allowed).toBe(true);
      expect(decision.requiresApproval).toBeFalsy();

      const matrix = await context.service.getEffectiveToolAccess({
        spaceId: "space-main",
        agentId: "helper-agent",
        principalId: "principal-owner",
        executionOrigin: "owner",
      });

      expect(matrix.operations.find((entry) => entry.operationId === "lists.create_list")).toMatchObject({
        allowed: true,
      });
    } finally {
      context.db.close();
    }
  });

  test("default mode still requires explicit grants for callers without owner or guest context", async () => {
    const context = createContext();
    try {
      const decision = await context.service.evaluateToolAccess({
        spaceId: "space-main",
        agentId: "helper-agent",
        capability: "lists",
        operation: "create_list",
      });

      expect(decision.allowed).toBe(false);
      expect(decision.requiresApproval).toBeFalsy();
      expect(decision.reasonCode).toBe("gateway_capability_not_granted");
    } finally {
      context.db.close();
    }
  });

  test("implicit owner in an unshared space keeps full_access behavior without a participant row", async () => {
    const context = createContext();
    try {
      const matrix = await context.service.getEffectiveToolAccess({
        spaceId: "space-main",
        agentId: "helper-agent",
        principalId: "principal-owner",
        accessMode: "full_access",
      });

      const capabilityIds = ["managed_shell", "arbitrary_shell", "filesystem_escape", "approval_bypass"] as const;
      for (const capId of capabilityIds) {
        const entry = matrix.dangerousCapabilities.find((c) => c.capabilityId === capId);
        expect(entry?.enabled).toBe(true);
      }

      const decision = await context.service.evaluateToolAccess({
        spaceId: "space-main",
        agentId: "helper-agent",
        principalId: "principal-owner",
        accessMode: "full_access",
        capability: "shell",
        operation: "jira.me",
      });

      expect(decision.allowed).toBe(true);
      expect(decision.requiresApproval).toBeFalsy();
    } finally {
      context.db.close();
    }
  });

  test("existing spaces default guest access preset to collaborator", async () => {
    const context = createContext();
    try {
      context.setParticipant("principal-guest", "collaborator", "invite-1");

      const policy = context.service.getToolPolicy({
        scopeType: "space",
        scopeId: "space-main",
      });
      expect(policy.guestAccessPreset).toBe("collaborator");

      const decision = await context.service.evaluateToolAccess({
        spaceId: "space-main",
        agentId: "helper-agent",
        principalId: "principal-guest",
        executionOrigin: "guest",
        capability: "lists",
        operation: "create_list",
      });

      expect(decision.allowed).toBe(true);
    } finally {
      context.db.close();
    }
  });

  test("guest read_only preset allows safe reads but blocks writes", async () => {
    const context = createContext();
    try {
      context.setParticipant("principal-guest", "collaborator", "invite-1");
      context.service.updateToolPolicy({
        scopeType: "space",
        scopeId: "space-main",
        guestAccessPreset: "read_only",
        updatedBy: "principal-owner",
      });

      const readDecision = await context.service.evaluateToolAccess({
        spaceId: "space-main",
        agentId: "helper-agent",
        principalId: "principal-guest",
        executionOrigin: "guest",
        capability: "lists",
        operation: "listLists",
      });
      expect(readDecision.allowed).toBe(true);

      const writeDecision = await context.service.evaluateToolAccess({
        spaceId: "space-main",
        agentId: "helper-agent",
        principalId: "principal-guest",
        executionOrigin: "guest",
        capability: "lists",
        operation: "create_list",
      });
      expect(writeDecision.allowed).toBe(false);
      expect(writeDecision.requiresApproval).toBeFalsy();
      expect(writeDecision.reasonCode).toBe("guest_access_preset_denied");
    } finally {
      context.db.close();
    }
  });

  test("participant read_only invite mode overrides collaborator guest preset", async () => {
    const context = createContext();
    try {
      context.setParticipant("principal-guest", "read_only", "invite-1");
      context.service.updateToolPolicy({
        scopeType: "space",
        scopeId: "space-main",
        guestAccessPreset: "collaborator",
        updatedBy: "principal-owner",
      });

      const decision = await context.service.evaluateToolAccess({
        spaceId: "space-main",
        agentId: "helper-agent",
        principalId: "principal-guest",
        executionOrigin: "guest",
        capability: "lists",
        operation: "create_list",
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reasonCode).toBe("guest_access_preset_denied");
    } finally {
      context.db.close();
    }
  });

  test("owner default does not unlock dangerous capabilities", async () => {
    const context = createContext();
    try {
      context.setParticipant("principal-owner", "collaborator");

      const matrix = await context.service.getEffectiveToolAccess({
        spaceId: "space-main",
        agentId: "main-agent",
        principalId: "principal-owner",
        executionOrigin: "owner",
      });

      const capabilityIds = ["managed_shell", "arbitrary_shell", "filesystem_escape", "approval_bypass"] as const;
      for (const capId of capabilityIds) {
        const entry = matrix.dangerousCapabilities.find((c) => c.capabilityId === capId);
        expect(entry?.enabled).toBe(false);
      }

      const decision = await context.service.evaluateToolAccess({
        spaceId: "space-main",
        agentId: "main-agent",
        principalId: "principal-owner",
        executionOrigin: "owner",
        capability: "shell",
        operation: "jira.me",
      });
      expect(decision.allowed).toBe(false);
      expect(decision.requiresApproval).toBeFalsy();
      expect(decision.reasonCode).toBe("dangerous_access_requires_owner_full_access");
    } finally {
      context.db.close();
    }
  });

  test("owner full_access keeps dangerous-capability behavior", async () => {
    const context = createContext();
    try {
      context.setParticipant("principal-owner", "collaborator");

      const matrix = await context.service.getEffectiveToolAccess({
        spaceId: "space-main",
        agentId: "helper-agent",
        principalId: "principal-owner",
        executionOrigin: "owner",
        accessMode: "full_access",
      });

      const capabilityIds = ["managed_shell", "arbitrary_shell", "filesystem_escape", "approval_bypass"] as const;
      for (const capId of capabilityIds) {
        const entry = matrix.dangerousCapabilities.find((c) => c.capabilityId === capId);
        expect(entry?.enabled).toBe(true);
        expect(entry?.source).toBe("turn_access_mode");
      }

      const decision = await context.service.evaluateToolAccess({
        spaceId: "space-main",
        agentId: "helper-agent",
        principalId: "principal-owner",
        executionOrigin: "owner",
        accessMode: "full_access",
        capability: "shell",
        operation: "jira.me",
      });
      expect(decision.allowed).toBe(true);
    } finally {
      context.db.close();
    }
  });

  test("authenticated principal without participant is treated as implicit owner for full_access", async () => {
    const context = createContext();
    try {
      const matrix = await context.service.getEffectiveToolAccess({
        spaceId: "space-main",
        agentId: "helper-agent",
        principalId: "principal-owner",
        accessMode: "full_access",
      });

      const capabilityIds = ["managed_shell", "arbitrary_shell", "filesystem_escape", "approval_bypass"] as const;
      for (const capId of capabilityIds) {
        const entry = matrix.dangerousCapabilities.find((c) => c.capabilityId === capId);
        expect(entry?.enabled).toBe(true);
        expect(entry?.source).toBe("turn_access_mode");
      }

      const decision = await context.service.evaluateToolAccess({
        spaceId: "space-main",
        agentId: "helper-agent",
        principalId: "principal-owner",
        accessMode: "full_access",
        capability: "shell",
        operation: "jira.me",
      });

      expect(decision.allowed).toBe(true);
    } finally {
      context.db.close();
    }
  });

  test("guest full_access is clamped to default and never enables dangerous capabilities", async () => {
    const context = createContext();
    try {
      context.setParticipant("principal-guest", "collaborator", "invite-1");

      const matrix = await context.service.getEffectiveToolAccess({
        spaceId: "space-main",
        agentId: "helper-agent",
        principalId: "principal-guest",
        executionOrigin: "guest",
        accessMode: "full_access",
      });

      const capabilityIds = ["managed_shell", "arbitrary_shell", "filesystem_escape", "approval_bypass"] as const;
      for (const capId of capabilityIds) {
        const entry = matrix.dangerousCapabilities.find((c) => c.capabilityId === capId);
        expect(entry?.enabled).toBe(false);
      }

      const decision = await context.service.evaluateToolAccess({
        spaceId: "space-main",
        agentId: "helper-agent",
        principalId: "principal-guest",
        executionOrigin: "guest",
        accessMode: "full_access",
        capability: "shell",
        operation: "jira.me",
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reasonCode).toBe("guest_access_preset_denied");
    } finally {
      context.db.close();
    }
  });

  test("tool policy round-trips guestAccessPreset", async () => {
    const context = createContext();
    try {
      const updated = context.service.updateToolPolicy({
        scopeType: "space",
        scopeId: "space-main",
        guestAccessPreset: "read_only",
        updatedBy: "principal-owner",
      });

      expect(updated.guestAccessPreset).toBe("read_only");
      expect(context.service.getToolPolicy({
        scopeType: "space",
        scopeId: "space-main",
      }).guestAccessPreset).toBe("read_only");
    } finally {
      context.db.close();
    }
  });

  test("space policy can require approval for concierge injected tools", async () => {
    const context = createContext();
    try {
      context.service.updateToolPolicy({
        scopeType: "space",
        scopeId: "space-main",
        rules: [
          {
            selectorKind: "tool_operation",
            selectorId: "concierge.request_user_input",
            state: "disabled",
          },
        ],
        updatedBy: "principal-owner",
      });

      const decision = await context.service.evaluateInjectedToolAccess({
        spaceId: "space-main",
        agentId: "helper-agent",
        principalId: "principal-owner",
        toolName: "concierge.request_user_input",
      });

      expect(decision.allowed).toBe(false);
      expect(decision.requiresApproval).toBe(true);
      expect(decision.reasonCode).toBe("policy_escalation_required");
      expect(decision.approvalContext).toMatchObject({
        targetId: "tool_operation:concierge.request_user_input",
        selectorKind: "tool_operation",
        selectorId: "concierge.request_user_input",
      });
    } finally {
      context.db.close();
    }
  });
});
