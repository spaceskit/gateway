import { describe, expect, test } from "bun:test";
import {
  AgentPresetRepository,
  initDatabase,
  SpaceTemplateRepository,
} from "@spaceskit/persistence";
import { SpaceConfiguratorService } from "../src/services/space-configurator-service.js";

function createContext() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-space-configurator-${crypto.randomUUID()}`,
  });

  const spaces = new Map<string, any>();
  const spaceAdminService = {
    createSpace: async (input: any) => {
      const now = new Date().toISOString();
      const space = {
        id: input.spaceId ?? `space-${crypto.randomUUID()}`,
        resourceId: input.resourceId,
        name: input.name,
        goal: input.goal,
        turnModel: input.turnModel ?? "primary_only",
        agents: (input.initialAgents ?? []).map((agent: any, index: number) => ({
          spaceId: input.spaceId ?? "space-new",
          agentId: agent.agentId,
          profileId: agent.profileId,
          role: agent.role ?? "participant",
          turnOrder: agent.turnOrder ?? index,
          isPrimary: agent.isPrimary ?? false,
          assignedAt: now,
        })),
        capabilities: [],
        capabilityOverrides: {},
        visibility: input.visibility ?? "shared",
        createdAt: now,
        updatedAt: now,
      };
      spaces.set(space.id, space);
      return space;
    },
    getSpace: async (spaceId: string) => spaces.get(spaceId) ?? null,
    listAgentAssignments: async (spaceId: string) => spaces.get(spaceId)?.agents ?? [],
    addAgent: async (input: any) => {
      const space = spaces.get(input.spaceId);
      if (!space) {
        throw new Error(`Space not found: ${input.spaceId}`);
      }
      const assignment = {
        spaceId: input.spaceId,
        agentId: input.agentId,
        profileId: input.profileId,
        role: input.role ?? "participant",
        turnOrder: input.turnOrder ?? space.agents.length,
        isPrimary: input.isPrimary ?? false,
        assignedAt: new Date().toISOString(),
      };
      space.agents.push(assignment);
      space.updatedAt = new Date().toISOString();
      return assignment;
    },
  };

  return {
    db,
    templates: new SpaceTemplateRepository(db.db),
    agentPresets: new AgentPresetRepository(db.db),
    spaceAdminService,
  };
}

function seedSystemTemplate(context: ReturnType<typeof createContext>) {
  context.templates.upsertWithNewRevision({
    templateId: "archetype/research",
    ownerPrincipalId: "system",
    name: "Research Team",
    description: "Coordinator plans research tasks, workers investigate in parallel.",
    spaceConfigJson: JSON.stringify({
      schemaVersion: 1,
      communicationMode: "chat_first",
      turnModel: "primary_only",
      baseAgents: [
        {
          agentId: "coordinator",
          profileId: "archetype/research-coordinator",
          role: "global_coordinator",
          turnOrder: 0,
          isPrimary: true,
        },
        {
          agentId: "researcher-1",
          profileId: "archetype/researcher",
          role: "participant",
          turnOrder: 1,
          isPrimary: false,
        },
      ],
      agentPresetIds: [],
      tags: ["research", "system"],
      metadata: {
        createdBy: "system",
        source: "system",
        category: "team_pattern",
        complexityTier: "advanced",
        icon: "magnifyingglass.circle.fill",
        featured: false,
        sortOrder: 100,
      },
    }),
  });
}

describe("SpaceConfiguratorService ownership boundaries", () => {
  test("resolves system placeholder agents to the gateway default profile and materializes user-owned copies", async () => {
    const context = createContext();
    try {
      context.templates.upsertWithNewRevision({
        templateId: "quickstart/default-main",
        ownerPrincipalId: "system",
        name: "Default Main Agent",
        description: "Managed single-agent starter bound to the gateway default profile.",
        spaceConfigJson: JSON.stringify({
          schemaVersion: 1,
          communicationMode: "chat_first",
          turnModel: "primary_only",
          baseAgents: [
            {
              agentId: "assistant",
              profileBinding: "gateway_default_main",
              role: "participant",
              turnOrder: 0,
              isPrimary: true,
            },
          ],
          agentPresetIds: [],
          tags: ["quickstart", "system"],
          metadata: {
            createdBy: "system",
            source: "system",
            category: "quick_start",
          },
        }),
      });

      const service = new SpaceConfiguratorService({
        templates: context.templates,
        agentPresets: context.agentPresets,
        spaceAdminService: context.spaceAdminService as any,
        defaultProfileId: "profile-main",
        defaultAgentId: "agent-main",
      });

      const listed = service.listTemplates({}, "principal-owner");
      const fetched = listed.find((template) => template.templateId === "quickstart/default-main");
      expect(fetched?.agentDefinitions[0]?.profileBinding).toBe("gateway_default_main");
      expect(fetched?.agentDefinitions[0]?.profileId).toBe("profile-main");

      const preview = service.previewTemplate(
        { templateId: "quickstart/default-main", resourceId: "resource-preview" },
        "principal-owner",
      );
      expect(preview.resolved.initialAgents[0]?.profileBinding).toBe("gateway_default_main");
      expect(preview.resolved.initialAgents[0]?.profileId).toBe("profile-main");

      const created = await service.createFromTemplate(
        {
          templateId: "quickstart/default-main",
          resourceId: "resource-default-main",
          name: "Default Main Space",
        },
        "principal-owner",
      );
      expect(created.space.agents[0]?.profileId).toBe("profile-main");

      const saved = await service.saveTemplate({
        title: "My Default Main Copy",
        principalId: "principal-owner",
        baseAgents: preview.resolved.initialAgents,
      });

      const userTemplate = service.getTemplate(
        { templateId: saved.template.templateId },
        "principal-owner",
      );
      expect(userTemplate.agentDefinitions[0]?.profileBinding).toBe("explicit");
      expect(userTemplate.agentDefinitions[0]?.profileId).toBe("profile-main");
    } finally {
      context.db.close();
    }
  });

  test("scopes user presets to the owning principal", async () => {
    const context = createContext();
    try {
      const service = new SpaceConfiguratorService({
        templates: context.templates,
        agentPresets: context.agentPresets,
        spaceAdminService: context.spaceAdminService as any,
        defaultProfileId: "profile-main",
        defaultAgentId: "agent-main",
      });

      const saved = await service.saveTemplate({
        title: "Owner Template",
        principalId: "principal-owner",
      });
      const ownerPresetId = `user.template.${saved.template.templateId}`;

      const ownerPresets = service.listPresets({}, "principal-owner");
      expect(ownerPresets.some((preset) => preset.presetId === ownerPresetId)).toBe(true);

      const otherPresets = service.listPresets({}, "principal-other");
      expect(otherPresets.some((preset) => preset.presetId === ownerPresetId)).toBe(false);

      expect(() =>
        service.previewTemplate(
          { templateId: saved.template.templateId },
          "principal-other",
        )).toThrow("not accessible");
    } finally {
      context.db.close();
    }
  });

  test("prevents a different principal from overwriting an owned template", async () => {
    const context = createContext();
    try {
      const service = new SpaceConfiguratorService({
        templates: context.templates,
        agentPresets: context.agentPresets,
        spaceAdminService: context.spaceAdminService as any,
        defaultProfileId: "profile-main",
        defaultAgentId: "agent-main",
      });

      const saved = await service.saveTemplate({
        title: "Owner Template",
        principalId: "principal-owner",
      });

      await expect(service.saveTemplate({
        templateId: saved.template.templateId,
        title: "Hijack Attempt",
        principalId: "principal-other",
      })).rejects.toThrow("owned by another principal");
    } finally {
      context.db.close();
    }
  });

  test("lists, reads, and archives owner-scoped managed templates", async () => {
    const context = createContext();
    try {
      const service = new SpaceConfiguratorService({
        templates: context.templates,
        agentPresets: context.agentPresets,
        spaceAdminService: context.spaceAdminService as any,
        defaultProfileId: "profile-main",
        defaultAgentId: "agent-main",
      });

      const saved = await service.saveTemplate({
        title: "Coding Planning Pair",
        communicationMode: "async_notes",
        baseAgents: [
          {
            agentId: "planner",
            profileId: "agent-definition-coding-planner-v1",
            role: "participant",
            turnOrder: 0,
            isPrimary: true,
          },
          {
            agentId: "critic",
            profileId: "agent-definition-coding-critic-v1",
            role: "participant",
            turnOrder: 1,
            isPrimary: false,
          },
        ],
        principalId: "principal-owner",
      });

      const listed = service.listTemplates({}, "principal-owner");
      expect(listed.map((template) => template.templateId)).toContain(saved.template.templateId);
      expect(listed[0]?.conversationTopology).toBe("shared_team_chat");
      expect(listed[0]?.turnModel).toBe("sequential_all");

      const fetched = service.getTemplate(
        { templateId: saved.template.templateId },
        "principal-owner",
      );
      expect(fetched.agentDefinitions.map((agent) => agent.agentId)).toEqual(["planner", "critic"]);

      const archived = service.archiveTemplate(
        { templateId: saved.template.templateId },
        "principal-owner",
      );
      expect(archived.archived).toBe(true);
      expect(archived.template.status).toBe("archived");

      expect(
        service.listTemplates({}, "principal-owner").some((template) => template.templateId == saved.template.templateId),
      ).toBe(false);
      expect(
        service.listTemplates({ includeArchived: true }, "principal-owner")
          .some((template) => template.templateId == saved.template.templateId && template.status == "archived"),
      ).toBe(true);
    } finally {
      context.db.close();
    }
  });

  test("allows principals to read and create spaces from system templates", async () => {
    const context = createContext();
    try {
      seedSystemTemplate(context);
      const service = new SpaceConfiguratorService({
        templates: context.templates,
        agentPresets: context.agentPresets,
        spaceAdminService: context.spaceAdminService as any,
        defaultProfileId: "profile-main",
        defaultAgentId: "agent-main",
      });

      // System templates are included by default
      const listed = service.listTemplates({}, "principal-owner");
      expect(listed.map((template) => template.templateId)).toContain("archetype/research");
      // Explicitly excluding system templates hides them
      expect(service.listTemplates({ includeSystem: false }, "principal-owner").map((template) => template.templateId))
        .not.toContain("archetype/research");

      const fetched = service.getTemplate(
        { templateId: "archetype/research" },
        "principal-owner",
      );
      expect(fetched.templateId).toBe("archetype/research");

      const preview = service.previewTemplate(
        { templateId: "archetype/research", resourceId: "resource-preview" },
        "principal-other",
      );
      expect(preview.template.templateId).toBe("archetype/research");
      expect(preview.resolved.initialAgents.map((agent) => agent.agentId)).toEqual([
        "coordinator",
        "researcher-1",
      ]);

      const created = await service.createFromTemplate(
        {
          templateId: "archetype/research",
          resourceId: "resource-system-template",
          name: "System Template Space",
        },
        "principal-third",
      );
      expect(created.template.templateId).toBe("archetype/research");
      expect(created.space.name).toBe("System Template Space");
      expect(created.space.agents.map((agent) => agent.agentId)).toEqual([
        "coordinator",
        "researcher-1",
      ]);
    } finally {
      context.db.close();
    }
  });

  test("keeps system templates immutable for non-system principals", async () => {
    const context = createContext();
    try {
      seedSystemTemplate(context);
      const service = new SpaceConfiguratorService({
        templates: context.templates,
        agentPresets: context.agentPresets,
        spaceAdminService: context.spaceAdminService as any,
        defaultProfileId: "profile-main",
        defaultAgentId: "agent-main",
      });

      expect(() =>
        service.archiveTemplate(
          { templateId: "archetype/research" },
          "principal-owner",
        )).toThrow("not accessible");

      await expect(service.saveTemplate({
        templateId: "archetype/research",
        title: "Research Team Override",
        principalId: "principal-owner",
      })).rejects.toThrow("owned by another principal");
    } finally {
      context.db.close();
    }
  });

  test("scopes user agent presets to owner and supports archive flow", async () => {
    const context = createContext();
    try {
      const service = new SpaceConfiguratorService({
        templates: context.templates,
        agentPresets: context.agentPresets,
        spaceAdminService: context.spaceAdminService as any,
        defaultProfileId: "profile-main",
        defaultAgentId: "agent-main",
      });

      const saved = await service.saveAgentPreset({
        title: "Owner Agent Preset",
        principalId: "principal-owner",
        defaultAgents: [
          {
            agentId: "agent-owner",
            profileId: "profile-owner",
            role: "global_coordinator",
            turnOrder: 0,
            isPrimary: true,
          },
        ],
      });

      const ownerPresetId = saved.preset.presetId;
      expect(ownerPresetId.startsWith("user.agent.")).toBe(true);

      const ownerPresets = service.listPresets({ kind: "agent", source: "user" }, "principal-owner");
      expect(ownerPresets.some((preset) => preset.presetId === ownerPresetId)).toBe(true);

      const otherPresets = service.listPresets({ kind: "agent", source: "user" }, "principal-other");
      expect(otherPresets.some((preset) => preset.presetId === ownerPresetId)).toBe(false);

      expect(() => service.getPreset(ownerPresetId, "principal-other")).toThrow("Preset not found");

      const archived = await service.archiveAgentPreset({
        presetId: ownerPresetId.replace("user.agent.", ""),
        principalId: "principal-owner",
      });
      expect(archived.archived).toBe(true);

      const ownerAfterArchive = service.listPresets({ kind: "agent", source: "user" }, "principal-owner");
      expect(ownerAfterArchive.some((preset) => preset.presetId === ownerPresetId)).toBe(false);
    } finally {
      context.db.close();
    }
  });
});
