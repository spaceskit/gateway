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

describe("SpaceConfiguratorService ownership boundaries", () => {
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
