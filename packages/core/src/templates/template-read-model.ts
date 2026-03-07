/**
 * Space template read model — app-friendly views and validation.
 * Pure functions — no I/O, no logging.
 */

import type { SpaceTemplate } from "../spaces/space-templates.js";

// ---------------------------------------------------------------------------
// Read Model
// ---------------------------------------------------------------------------

export type TemplateCommunicationMode = "async_notes" | "chat_first" | "structured_handoff";

export interface SpaceTemplateReadModel {
  templateId: string;
  name: string;
  description: string;
  agentCount: number;
  communicationMode: TemplateCommunicationMode;
  tags: string[];
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface TemplateApplyResult {
  spaceId: string;
  templateId: string;
  agentsAdded: string[]; // agentIds
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface TemplateValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateTemplateForApply(
  template: SpaceTemplate,
  existingSpaceNames: string[],
): TemplateValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!template.name || template.name.trim().length === 0) {
    errors.push("Template name is required");
  }

  if (!template.agents || template.agents.length === 0) {
    errors.push("Template must define at least one agent");
  }

  if (template.agents) {
    // Check for duplicate agent agentIds
    const agentIds = template.agents.map((a) => a.agentId);
    const dupes = agentIds.filter((id, i) => agentIds.indexOf(id) !== i);
    if (dupes.length > 0) {
      errors.push(`Duplicate agent agentIds: ${[...new Set(dupes)].join(", ")}`);
    }

    // Check at least one primary agent
    const hasPrimary = template.agents.some((a) => a.isPrimary);
    if (!hasPrimary) {
      warnings.push("Template has no primary agent — first agent will be used as primary");
    }
  }

  // Check name collision with existing spaces
  if (template.name && existingSpaceNames.includes(template.name.trim())) {
    warnings.push(`A space named "${template.name.trim()}" already exists — a suffix will be added`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

export interface ToTemplateReadModelOptions {
  communicationMode?: TemplateCommunicationMode;
  status?: "active" | "archived";
  createdAt?: string;
  updatedAt?: string;
}

export function toTemplateReadModel(
  template: SpaceTemplate,
  options: ToTemplateReadModelOptions = {},
): SpaceTemplateReadModel {
  const now = new Date().toISOString();
  return {
    templateId: template.templateId,
    name: template.name,
    description: template.description ?? "",
    agentCount: template.agents?.length ?? 0,
    communicationMode: options.communicationMode ?? "chat_first",
    tags: template.tags ?? [],
    status: options.status ?? "active",
    createdAt: options.createdAt ?? now,
    updatedAt: options.updatedAt ?? now,
  };
}
