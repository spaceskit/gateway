import { randomUUID } from "node:crypto";
import type {
  PersonaRepository,
  PersonaRevisionRow,
  PersonaRow,
  ProfileRepository,
  ProfileRevisionRow,
  ProfileRow,
} from "@spaceskit/persistence";
import type { PromptBudgetClass } from "@spaceskit/core";
import type {
  AgentDefinitionSummaryPayload,
  CompiledInstructionSectionPayload,
  CompiledInstructionsPreviewPayload,
  IdentityArchiveAgentDefinitionPayload,
  IdentityArchiveAgentDefinitionResponsePayload,
  IdentityArchivePersonaPayload,
  IdentityArchivePersonaResponsePayload,
  IdentityCreateAgentDefinitionPayload,
  IdentityCreateAgentDefinitionResponsePayload,
  IdentityCreatePersonaPayload,
  IdentityCreatePersonaResponsePayload,
  IdentityPreviewCompiledInstructionsPayload,
  IdentityPreviewCompiledInstructionsResponsePayload,
  IdentityPreviewRuntimeSystemPromptPayload,
  IdentityPreviewRuntimeSystemPromptResponsePayload,
  IdentityPreviewSystemPromptMatrixPayload,
  IdentityPreviewSystemPromptMatrixResponsePayload,
  IdentityUpdateAgentDefinitionPayload,
  IdentityUpdateAgentDefinitionResponsePayload,
  IdentityUpdatePersonaPayload,
  IdentityUpdatePersonaResponsePayload,
  PersonaSummaryPayload,
} from "./internal-payload-types.js";
import {
  DEFAULT_PERSONA_DEFINITION,
  buildPersonaInstructions,
  isMissingPersonaTableError,
  normalizeModelConfig,
  normalizeOptional,
  normalizeRequired,
  normalizeStringArray,
  parseModelConfig,
  parseStringArray,
  personaSchemaUnavailableError,
  toModelConfigPayload,
} from "./gateway-identity-service-helpers.js";
import type { AgentDefinitionRuntimeContext, GatewayIdentityServiceOptions } from "./gateway-identity-service-types.js";
export type { AgentDefinitionRuntimeContext, GatewayIdentityServiceOptions } from "./gateway-identity-service-types.js";

export const DEFAULT_PERSONA_ID = "persona-default";

export class GatewayIdentityService {
  private readonly profiles: ProfileRepository;
  private readonly personas: PersonaRepository;
  private readonly getActiveSkillMarkdownMap?: (skillIds: string[]) => Map<string, string>;
  private readonly getSystemScaffold?: (budgetClass?: PromptBudgetClass) => string;
  private readonly getPolicyAppendices?: () => string;
  private readonly previewRuntimeSystemPromptHandler?: (
    input: IdentityPreviewRuntimeSystemPromptPayload,
  ) => Promise<IdentityPreviewRuntimeSystemPromptResponsePayload>;
  private readonly previewSystemPromptMatrixHandler?: (
    input: IdentityPreviewSystemPromptMatrixPayload,
  ) => Promise<IdentityPreviewSystemPromptMatrixResponsePayload>;
  private readonly defaultPersonaId?: string;

  constructor(options: GatewayIdentityServiceOptions) {
    this.profiles = options.profiles;
    this.personas = options.personas;
    this.getActiveSkillMarkdownMap = options.getActiveSkillMarkdownMap;
    this.getSystemScaffold = options.getSystemScaffold;
    this.getPolicyAppendices = options.getPolicyAppendices;
    this.previewRuntimeSystemPromptHandler = options.previewRuntimeSystemPrompt;
    this.previewSystemPromptMatrixHandler = options.previewSystemPromptMatrix;
    this.defaultPersonaId = options.defaultPersonaId?.trim() || undefined;
  }

  ensureDefaultPersona(personaId = this.defaultPersonaId ?? DEFAULT_PERSONA_ID): PersonaSummaryPayload {
    const existing = this.withPersonaSchemaGuard(() => this.personas.getById(personaId));
    if (!existing) {
      this.withPersonaSchemaGuard(() => {
        this.personas.create({
          ...DEFAULT_PERSONA_DEFINITION,
          personaId,
          constraints: [...DEFAULT_PERSONA_DEFINITION.constraints],
          isDefault: true,
          source: "system",
        });
      });
      return this.getPersona(personaId)!;
    }

    if (existing.archived === 1) {
      this.withPersonaSchemaGuard(() => {
        this.personas.restore(personaId);
      });
    }

    const repaired = this.withPersonaSchemaGuard(() => this.personas.getById(personaId));
    const activeRevision = this.withPersonaSchemaGuard(() => this.personas.getActiveRevision(personaId));
    if (!repaired || !activeRevision) {
      throw personaSchemaUnavailableError();
    }

    const needsUpdate = repaired.name !== DEFAULT_PERSONA_DEFINITION.name
      || repaired.description !== DEFAULT_PERSONA_DEFINITION.description
      || repaired.is_default !== 1
      || activeRevision.tone !== DEFAULT_PERSONA_DEFINITION.tone
      || activeRevision.style !== DEFAULT_PERSONA_DEFINITION.style
      || activeRevision.emotional_layer !== DEFAULT_PERSONA_DEFINITION.emotionalLayer
      || activeRevision.instructions !== DEFAULT_PERSONA_DEFINITION.instructions
      || JSON.stringify(parseStringArray(activeRevision.constraints_json))
        !== JSON.stringify(DEFAULT_PERSONA_DEFINITION.constraints);

    if (needsUpdate) {
      this.withPersonaSchemaGuard(() => {
        this.personas.update({
          personaId,
          name: DEFAULT_PERSONA_DEFINITION.name,
          description: DEFAULT_PERSONA_DEFINITION.description,
          tone: DEFAULT_PERSONA_DEFINITION.tone,
          style: DEFAULT_PERSONA_DEFINITION.style,
          emotionalLayer: DEFAULT_PERSONA_DEFINITION.emotionalLayer,
          constraints: [...DEFAULT_PERSONA_DEFINITION.constraints],
          instructions: DEFAULT_PERSONA_DEFINITION.instructions,
          isDefault: true,
          source: "system",
        });
      });
    }

    return this.getPersona(personaId)!;
  }

  listAgentDefinitions(includeArchived = false): AgentDefinitionSummaryPayload[] {
    return this.profiles
      .list({ includeArchived })
      .map((row) => this.toAgentDefinitionPayload(row, this.profiles.getActiveRevision(row.profile_id)));
  }

  getAgentDefinition(agentDefinitionId: string): AgentDefinitionSummaryPayload | null {
    const row = this.profiles.getById(normalizeRequired(agentDefinitionId, "agentDefinitionId"));
    if (!row) return null;
    return this.toAgentDefinitionPayload(row, this.profiles.getActiveRevision(row.profile_id));
  }

  createAgentDefinition(
    input: IdentityCreateAgentDefinitionPayload,
  ): IdentityCreateAgentDefinitionResponsePayload {
    const agentDefinitionId = normalizeOptional(input.agentDefinitionId) ?? `agent-definition-${randomUUID()}`;
    if (this.profiles.getById(agentDefinitionId)) {
      throw { code: "ALREADY_EXISTS", message: `Agent Definition already exists: ${agentDefinitionId}` };
    }

    const personaId = this.resolvePersonaId(input.personaId);
    const created = this.profiles.create({
      profileId: agentDefinitionId,
      personaId,
      name: normalizeRequired(input.name, "name"),
      description: normalizeOptional(input.description),
      personalityPrompt: normalizeOptional(input.instructions),
      defaultSkillIds: normalizeStringArray(input.defaultSkillIds),
      providerHint: normalizeOptional(input.providerHint),
      modelConfig: normalizeModelConfig(input.modelConfig),
      isDefault: input.isDefault,
      source: "manual",
    });

    return {
      agentDefinition: this.toAgentDefinitionPayload(
        created,
        this.profiles.getActiveRevision(agentDefinitionId),
      ),
      created: true,
    };
  }

  updateAgentDefinition(
    input: IdentityUpdateAgentDefinitionPayload,
  ): IdentityUpdateAgentDefinitionResponsePayload {
    const existing = this.profiles.getById(normalizeRequired(input.agentDefinitionId, "agentDefinitionId"));
    if (!existing) {
      throw { code: "NOT_FOUND", message: `Agent Definition not found: ${input.agentDefinitionId}` };
    }

    const updated = this.profiles.update({
      profileId: input.agentDefinitionId,
      personaId: input.personaId === undefined ? existing.persona_id : this.resolvePersonaId(input.personaId),
      name: input.name,
      description: input.description,
      personalityPrompt: input.instructions,
      defaultSkillIds: input.defaultSkillIds,
      providerHint: input.providerHint,
      modelConfig: normalizeModelConfig(input.modelConfig),
      isDefault: input.isDefault,
      source: "manual",
    });

    return {
      agentDefinition: this.toAgentDefinitionPayload(updated.profile, updated.revision),
      newRevision: updated.revision.revision,
    };
  }

  archiveAgentDefinition(
    input: IdentityArchiveAgentDefinitionPayload,
  ): IdentityArchiveAgentDefinitionResponsePayload {
    const existing = this.profiles.getById(normalizeRequired(input.agentDefinitionId, "agentDefinitionId"));
    if (!existing) {
      throw { code: "NOT_FOUND", message: `Agent Definition not found: ${input.agentDefinitionId}` };
    }

    this.profiles.archive(input.agentDefinitionId);
    const archived = this.profiles.getById(input.agentDefinitionId)!;
    return {
      agentDefinition: this.toAgentDefinitionPayload(
        archived,
        this.profiles.getActiveRevision(input.agentDefinitionId),
      ),
      archived: archived.archived === 1,
    };
  }

  listPersonas(includeArchived = false): PersonaSummaryPayload[] {
    return this.withPersonaSchemaGuard(() => this.personas.list({ includeArchived }))
      .map((row) =>
        this.toPersonaPayload(
          row,
          this.withPersonaSchemaGuard(() => this.personas.getActiveRevision(row.persona_id)),
        )
      );
  }

  getPersona(personaId: string): PersonaSummaryPayload | null {
    const row = this.withPersonaSchemaGuard(() =>
      this.personas.getById(normalizeRequired(personaId, "personaId"))
    );
    if (!row) return null;
    return this.toPersonaPayload(
      row,
      this.withPersonaSchemaGuard(() => this.personas.getActiveRevision(row.persona_id)),
    );
  }

  createPersona(input: IdentityCreatePersonaPayload): IdentityCreatePersonaResponsePayload {
    const personaId = normalizeOptional(input.personaId) ?? `persona-${randomUUID()}`;
    if (this.withPersonaSchemaGuard(() => this.personas.getById(personaId))) {
      throw { code: "ALREADY_EXISTS", message: `Persona already exists: ${personaId}` };
    }

    const created = this.withPersonaSchemaGuard(() => this.personas.create({
      personaId,
      name: normalizeRequired(input.name, "name"),
      description: normalizeOptional(input.description),
      tone: normalizeOptional(input.tone),
      style: normalizeOptional(input.style),
      emotionalLayer: normalizeOptional(input.emotionalLayer),
      constraints: normalizeStringArray(input.constraints),
      instructions: normalizeOptional(input.instructions),
      isDefault: input.isDefault,
      source: "manual",
    }));

    return {
      persona: this.toPersonaPayload(
        created,
        this.withPersonaSchemaGuard(() => this.personas.getActiveRevision(personaId)),
      ),
      created: true,
    };
  }

  updatePersona(input: IdentityUpdatePersonaPayload): IdentityUpdatePersonaResponsePayload {
    const existing = this.withPersonaSchemaGuard(() =>
      this.personas.getById(normalizeRequired(input.personaId, "personaId"))
    );
    if (!existing) {
      throw { code: "NOT_FOUND", message: `Persona not found: ${input.personaId}` };
    }

    const updated = this.withPersonaSchemaGuard(() => this.personas.update({
      personaId: input.personaId,
      name: input.name,
      description: input.description,
      tone: input.tone,
      style: input.style,
      emotionalLayer: input.emotionalLayer,
      constraints: input.constraints,
      instructions: input.instructions,
      isDefault: input.isDefault,
      source: "manual",
    }));

    return {
      persona: this.toPersonaPayload(updated.persona, updated.revision),
      newRevision: updated.revision.revision,
    };
  }

  archivePersona(input: IdentityArchivePersonaPayload): IdentityArchivePersonaResponsePayload {
    const existing = this.withPersonaSchemaGuard(() =>
      this.personas.getById(normalizeRequired(input.personaId, "personaId"))
    );
    if (!existing) {
      throw { code: "NOT_FOUND", message: `Persona not found: ${input.personaId}` };
    }

    this.withPersonaSchemaGuard(() => {
      this.personas.archive(input.personaId);
    });
    const archived = this.withPersonaSchemaGuard(() => this.personas.getById(input.personaId))!;
    return {
      persona: this.toPersonaPayload(
        archived,
        this.withPersonaSchemaGuard(() => this.personas.getActiveRevision(input.personaId)),
      ),
      archived: archived.archived === 1,
    };
  }

  loadAgentDefinitionRuntime(agentDefinitionIdRaw?: string): AgentDefinitionRuntimeContext | null {
    const agentDefinitionId = normalizeOptional(agentDefinitionIdRaw);
    if (!agentDefinitionId) return null;

    const row = this.profiles.getById(agentDefinitionId);
    if (!row || row.archived === 1) {
      return null;
    }

    const revision = this.profiles.getActiveRevision(agentDefinitionId);
    const modelConfig = parseModelConfig(revision?.model_config_json);
    const preferredModelId = modelConfig.preferredModels[0];
    const persona = row.persona_id
      ? this.withPersonaSchemaGuard(() => this.personas.getById(row.persona_id))
      : undefined;
    const personaRevision = persona
      ? this.withPersonaSchemaGuard(() => this.personas.getActiveRevision(persona.persona_id))
      : undefined;

    return {
      agentDefinitionId,
      personaId: row.persona_id.trim() || undefined,
      agentInstructions: revision?.personality_prompt?.trim() || "",
      personaInstructions: buildPersonaInstructions(personaRevision),
      defaultSkillIds: parseStringArray(revision?.default_skill_set_ids_json),
      providerHint: revision?.provider_hint?.trim() || undefined,
      modelId: preferredModelId,
      modelConfig,
    };
  }

  previewCompiledInstructions(
    input: IdentityPreviewCompiledInstructionsPayload,
  ): IdentityPreviewCompiledInstructionsResponsePayload {
    const runtime = this.loadAgentDefinitionRuntime(input.agentDefinitionId);
    if (!runtime) {
      throw { code: "NOT_FOUND", message: `Agent Definition not found: ${input.agentDefinitionId}` };
    }

    const skillMarkdownMap = this.getActiveSkillMarkdownMap?.(runtime.defaultSkillIds) ?? new Map<string, string>();
    const skillContent = runtime.defaultSkillIds
      .map((skillId) => skillMarkdownMap.get(skillId)?.trim() ?? "")
      .filter(Boolean)
      .join("\n\n");
    const sections: CompiledInstructionSectionPayload[] = [
      {
        key: "system_scaffold",
        title: "System Scaffold",
        content: this.getSystemScaffold?.("full")?.trim() ?? "",
      },
      {
        key: "persona",
        title: "Persona",
        content: runtime.personaInstructions.trim(),
      },
      {
        key: "agent_definition",
        title: "Agent Definition",
        content: runtime.agentInstructions.trim(),
      },
      {
        key: "skills",
        title: "Skills",
        content: skillContent,
      },
      {
        key: "policy_appendices",
        title: "Policy Appendices",
        content: this.getPolicyAppendices?.()?.trim() ?? "",
      },
      {
        key: "workspace_context",
        title: "Workspace Context",
        content: normalizeOptional(input.workspaceContext) ?? "",
      },
    ];

    const compiledText = sections
      .map((section) => section.content.trim())
      .filter(Boolean)
      .join("\n\n");

    const preview: CompiledInstructionsPreviewPayload = {
      agentDefinitionId: runtime.agentDefinitionId,
      personaId: runtime.personaId,
      sections,
      compiledText,
      generatedAt: new Date().toISOString(),
    };

    return { preview };
  }

  async previewRuntimeSystemPrompt(
    input: IdentityPreviewRuntimeSystemPromptPayload,
  ): Promise<IdentityPreviewRuntimeSystemPromptResponsePayload> {
    if (!this.previewRuntimeSystemPromptHandler) {
      throw { code: "FAILED_PRECONDITION", message: "Runtime system prompt preview is unavailable" };
    }
    return this.previewRuntimeSystemPromptHandler(input);
  }

  async previewSystemPromptMatrix(
    input: IdentityPreviewSystemPromptMatrixPayload,
  ): Promise<IdentityPreviewSystemPromptMatrixResponsePayload> {
    if (!this.previewSystemPromptMatrixHandler) {
      throw { code: "FAILED_PRECONDITION", message: "System prompt matrix preview is unavailable" };
    }
    return this.previewSystemPromptMatrixHandler(input);
  }

  private resolvePersonaId(personaIdRaw?: string): string {
    const personaId = normalizeOptional(personaIdRaw) ?? this.ensureDefaultPersona().personaId;
    const persona = this.withPersonaSchemaGuard(() => this.personas.getById(personaId));
    if (!persona || persona.archived === 1) {
      throw { code: "INVALID_ARGUMENT", message: `Persona not found: ${personaId}` };
    }
    return personaId;
  }

  private withPersonaSchemaGuard<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (isMissingPersonaTableError(error)) {
        throw personaSchemaUnavailableError();
      }
      throw error;
    }
  }

  private toAgentDefinitionPayload(
    row: ProfileRow,
    revision: ProfileRevisionRow | undefined,
  ): AgentDefinitionSummaryPayload {
    return {
      agentDefinitionId: row.profile_id,
      personaId: row.persona_id.trim() || undefined,
      name: row.name,
      description: row.description,
      instructions: revision?.personality_prompt ?? "",
      defaultSkillIds: parseStringArray(revision?.default_skill_set_ids_json),
      providerHint: normalizeOptional(revision?.provider_hint),
      modelConfig: toModelConfigPayload(parseModelConfig(revision?.model_config_json)),
      isDefault: row.is_default === 1,
      status: row.archived === 1 ? "archived" : "active",
      activeRevision: row.active_revision,
      source: revision?.source ?? "manual",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toPersonaPayload(
    row: PersonaRow,
    revision: PersonaRevisionRow | undefined,
  ): PersonaSummaryPayload {
    return {
      personaId: row.persona_id,
      name: row.name,
      description: row.description,
      tone: normalizeOptional(revision?.tone),
      style: normalizeOptional(revision?.style),
      emotionalLayer: normalizeOptional(revision?.emotional_layer),
      constraints: parseStringArray(revision?.constraints_json),
      instructions: buildPersonaInstructions(revision),
      isDefault: row.is_default === 1,
      status: row.archived === 1 ? "archived" : "active",
      activeRevision: row.active_revision,
      source: revision?.source ?? "manual",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
