/**
 * Space Templates — declarative YAML/JSON space blueprints.
 *
 * Pre-configured space definitions with agent assignments, turn models,
 * and capability requirements. Templates can be validated, stored,
 * and instantiated into live spaces.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema (Zod validation)
// ---------------------------------------------------------------------------

export const SpaceTemplateAgentSchema = z.object({
  agentId: z.string(),
  profileId: z.string().optional(),
  profileBinding: z.enum(["explicit", "gateway_default_main"]).optional(),
  role: z.string().optional(),
  isPrimary: z.boolean().optional().default(false),
  securityOverrides: z.record(z.unknown()).optional(),
});

export const SpaceTemplateCapabilitySchema = z.object({
  capabilityType: z.string(),
  providerId: z.string().optional(),
  required: z.boolean().optional().default(true),
});

export const SpaceTemplateSchema = z.object({
  templateId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  version: z.number().default(1),
  turnModel: z.enum([
    "sequential_all",
    "primary_only",
    "first_success",
    "round_robin",
    "parallel_race",
    "debate_synthesis",
    "adaptive_auto",
  ]),
  agents: z.array(SpaceTemplateAgentSchema).min(1),
  capabilities: z.array(SpaceTemplateCapabilitySchema).optional().default([]),
  /** Default goal text (can be overridden on instantiation). */
  defaultGoal: z.string().optional(),
  /** Space-level rules. */
  rules: z.array(z.string()).optional().default([]),
  /** Metadata for categorization. */
  tags: z.array(z.string()).optional().default([]),
  metadata: z.record(z.unknown()).optional(),
});

export type SpaceTemplate = z.infer<typeof SpaceTemplateSchema>;
export type SpaceTemplateAgent = z.infer<typeof SpaceTemplateAgentSchema>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a template definition. Returns errors if invalid.
 */
export function validateTemplate(template: unknown): { valid: boolean; errors: string[] } {
  const result = SpaceTemplateSchema.safeParse(template);
  if (result.success) return { valid: true, errors: [] };

  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

// ---------------------------------------------------------------------------
// Template instantiation
// ---------------------------------------------------------------------------

export interface SpaceFromTemplateOptions {
  template: SpaceTemplate;
  spaceId: string;
  resourceId: string;
  goalOverride?: string;
  agentOverrides?: Record<string, Partial<SpaceTemplateAgent>>;
}

/**
 * Create a SpaceConfig-compatible object from a template.
 */
export function instantiateTemplate(options: SpaceFromTemplateOptions): Record<string, unknown> {
  const { template, spaceId, resourceId, goalOverride, agentOverrides } = options;

  const agents = template.agents.map((agent) => {
    const override = agentOverrides?.[agent.agentId] ?? {};
    return { ...agent, ...override };
  });

  return {
    id: spaceId,
    resourceId,
    name: template.name,
    goal: goalOverride ?? template.defaultGoal,
    turnModel: template.turnModel,
    agents,
    capabilities: template.capabilities,
    rules: template.rules,
    visibility: "shared",
    metadata: {
      ...template.metadata,
      templateId: template.templateId,
      templateVersion: template.version,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
