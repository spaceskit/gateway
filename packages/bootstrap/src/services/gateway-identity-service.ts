import { randomUUID } from "node:crypto";
import type {
  PersonaRepository,
  PersonaRevisionRow,
  PersonaRow,
  ProfileModelConfig,
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
  ProfileModelConfigPayload,
} from "./internal-payload-types.js";

export interface AgentDefinitionRuntimeContext {
  agentDefinitionId: string;
  personaId?: string;
  agentInstructions: string;
  personaInstructions: string;
  defaultSkillIds: string[];
  providerHint?: string;
  modelHint?: string;
  modelConfig?: ProfileModelConfig;
}

export interface GatewayIdentityServiceOptions {
  profiles: ProfileRepository;
  personas: PersonaRepository;
  getActiveSkillMarkdownMap?: (skillIds: string[]) => Map<string, string>;
  getSystemScaffold?: (budgetClass?: PromptBudgetClass) => string;
  getPolicyAppendices?: () => string;
  previewRuntimeSystemPrompt?: (
    input: IdentityPreviewRuntimeSystemPromptPayload,
  ) => Promise<IdentityPreviewRuntimeSystemPromptResponsePayload>;
  previewSystemPromptMatrix?: (
    input: IdentityPreviewSystemPromptMatrixPayload,
  ) => Promise<IdentityPreviewSystemPromptMatrixResponsePayload>;
  defaultPersonaId?: string;
}

export const DEFAULT_PERSONA_ID = "persona-default";

const DEFAULT_PERSONA_DEFINITION = {
  personaId: DEFAULT_PERSONA_ID,
  name: "Focused Guide",
  description: "Clear, calm, direct guidance with restrained emotion.",
  tone: "Direct and clear.",
  style: "Concise, structured, and practical.",
  emotionalLayer: "Steady and supportive without excess chatter.",
  constraints: [
    "Do not invent facts.",
    "State assumptions when needed.",
    "Prefer simple explanations before advanced detail.",
    "When citing tool results, reference the specific tool and its output.",
    "Use markdown formatting when structure aids clarity, but do not over-format short answers.",
  ],
  instructions:
    "Be warm enough to feel human, but stay precise and task-focused. Answer questions directly before elaborating. When given a command, confirm what you will do, then do it.",
} as const;

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
      modelHint: normalizeOptional(input.modelHint),
      modelConfig: normalizeModelConfig(input.modelConfig, input.modelHint),
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
      modelHint: input.modelHint,
      modelConfig: normalizeModelConfig(input.modelConfig, input.modelHint),
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
    const modelConfig = parseModelConfig(revision?.model_config_json, revision?.model_hint);
    const preferredModelHint = modelConfig.preferredModels[0] || revision?.model_hint?.trim() || undefined;
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
      modelHint: preferredModelHint,
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
      modelHint: normalizeOptional(parseModelConfig(revision?.model_config_json, revision?.model_hint).preferredModels[0])
        ?? normalizeOptional(revision?.model_hint),
      modelConfig: toModelConfigPayload(parseModelConfig(revision?.model_config_json, revision?.model_hint)),
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

function buildPersonaInstructions(revision: PersonaRevisionRow | undefined): string {
  if (!revision) return "";
  const constraints = parseStringArray(revision.constraints_json);
  const parts: string[] = [];
  if (revision.tone.trim()) {
    parts.push(`Tone: ${revision.tone.trim()}`);
  }
  if (revision.style.trim()) {
    parts.push(`Style: ${revision.style.trim()}`);
  }
  if (revision.emotional_layer.trim()) {
    parts.push(`Emotional Layer: ${revision.emotional_layer.trim()}`);
  }
  if (constraints.length > 0) {
    parts.push(`Constraints:\n${constraints.map((constraint) => `- ${constraint}`).join("\n")}`);
  }
  if (revision.instructions.trim()) {
    parts.push(revision.instructions.trim());
  }
  return parts.join("\n\n");
}

function normalizeOptional(value: string | undefined | null): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized;
}

function normalizeRequired(value: string | undefined | null, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw { code: "INVALID_ARGUMENT", message: `${field} is required` };
  }
  return normalized;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean),
  ));
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return normalizeStringArray(parsed);
  } catch {
    return [];
  }
}

function normalizeModelConfig(
  input: ProfileModelConfigPayload | undefined,
  modelHint?: string,
): ProfileModelConfig | undefined {
  if (!input && !normalizeOptional(modelHint)) {
    return undefined;
  }
  const preferredModels = normalizeStringArray(input?.preferredModels);
  if (preferredModels.length === 0 && normalizeOptional(modelHint)) {
    preferredModels.push(normalizeOptional(modelHint)!);
  }
  const fallbackModels = normalizeStringArray(input?.fallbackModels);
  const constraints = input?.constraints && typeof input.constraints === "object"
    ? input.constraints
    : undefined;
  return {
    preferredModels,
    ...(fallbackModels.length > 0 ? { fallbackModels } : {}),
    ...(constraints ? { constraints } : {}),
  };
}

function parseModelConfig(
  raw: string | null | undefined,
  legacyModelHint?: string,
): ProfileModelConfig {
  if (raw?.trim()) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return normalizeModelConfig({
        preferredModels: normalizeStringArray(parsed.preferredModels),
        fallbackModels: normalizeStringArray(parsed.fallbackModels),
        constraints: parsed.constraints && typeof parsed.constraints === "object"
          ? parsed.constraints as Record<string, unknown>
          : undefined,
      }, legacyModelHint) ?? { preferredModels: [] };
    } catch {
      // Fall through to legacy hint.
    }
  }

  return normalizeModelConfig(undefined, legacyModelHint) ?? { preferredModels: [] };
}

function toModelConfigPayload(modelConfig: ProfileModelConfig | undefined): ProfileModelConfigPayload | undefined {
  if (!modelConfig) return undefined;
  return {
    preferredModels: normalizeStringArray(modelConfig.preferredModels),
    fallbackModels: normalizeStringArray(modelConfig.fallbackModels),
    ...(modelConfig.constraints ? { constraints: modelConfig.constraints } : {}),
  };
}

function isMissingPersonaTableError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";
  return message.includes("no such table: personas")
    || message.includes("no such table: persona_revisions");
}

function personaSchemaUnavailableError(): { code: "FAILED_PRECONDITION"; message: string } {
  return {
    code: "FAILED_PRECONDITION",
    message: "Gateway persona schema is unavailable. Restart on the upgraded gateway build to repair identity storage.",
  };
}
