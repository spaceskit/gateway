import type { PromptBudgetClass } from "@spaceskit/core";
import type { PersonaRepository, ProfileModelConfig, ProfileRepository } from "@spaceskit/persistence";
import type {
  IdentityPreviewRuntimeSystemPromptPayload,
  IdentityPreviewRuntimeSystemPromptResponsePayload,
  IdentityPreviewSystemPromptMatrixPayload,
  IdentityPreviewSystemPromptMatrixResponsePayload,
} from "./internal-payload-types.js";

export interface AgentDefinitionRuntimeContext {
  agentDefinitionId: string;
  personaId?: string;
  agentInstructions: string;
  personaInstructions: string;
  defaultSkillIds: string[];
  providerHint?: string;
  modelId?: string;
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

