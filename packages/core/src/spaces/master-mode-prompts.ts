import type { TurnModelConfig } from "./types.js";

export interface MasterModePromptTemplates {
  planner: string;
  guest: string;
  peerReview: string;
  synthesis: string;
}

export interface MasterModePromptTemplateOverrides {
  masterPlannerPromptTemplate?: string;
  guestAgentPromptTemplate?: string;
  peerReviewPromptTemplate?: string;
  masterSynthesisPromptTemplate?: string;
}

export const DEFAULT_MASTER_PLANNER_PROMPT_TEMPLATE = [
  "You are the master orchestrator.",
  "Plan delegation for guests and return strict JSON only.",
  "Use this exact schema:",
  "{\"globalInstruction\":\"string\",\"guestInstructions\":{\"<guest_agent_id>\":\"string\"}}",
  "Do not include markdown, prose, or code fences.",
  "",
  "User input:",
  "{{user_input}}",
  "",
  "Guests (ordered):",
  "{{guest_list}}",
].join("\n");

export const DEFAULT_GUEST_AGENT_PROMPT_TEMPLATE = [
  "You are a guest agent receiving direction from the master orchestrator.",
  "Original user input:",
  "{{user_input}}",
  "",
  "Global instruction from master:",
  "{{global_instruction}}",
  "",
  "Your guest agent id:",
  "{{guest_agent_id}}",
  "",
  "Your delegated task:",
  "{{guest_instruction}}",
  "",
  "Return a concise report for master synthesis.",
].join("\n");

export const DEFAULT_PEER_REVIEW_PROMPT_TEMPLATE = [
  "You are a reviewer agent performing strict peer review.",
  "Output strict JSON only with this schema:",
  "{\"reviewerAgentId\":\"string\",\"targetAgentId\":\"string\",\"verdict\":\"approve|needs_revision|conflict\",\"issues\":[\"string\"],\"confidence\":0.0,\"notes\":\"string\"}",
  "Do not include markdown, prose, or code fences.",
  "",
  "Original user input:",
  "{{user_input}}",
  "",
  "Global instruction from master:",
  "{{global_instruction}}",
  "",
  "Reviewer agent id:",
  "{{reviewer_agent_id}}",
  "",
  "Target agent id:",
  "{{target_agent_id}}",
  "",
  "Target report:",
  "{{target_report}}",
].join("\n");

export const DEFAULT_MASTER_SYNTHESIS_PROMPT_TEMPLATE = [
  "You are the master orchestrator and must produce the single final user-facing answer.",
  "Original user input:",
  "{{user_input}}",
  "",
  "Guest roster:",
  "{{guest_list}}",
  "",
  "Guest reports:",
  "{{guest_reports}}",
  "",
  "Peer-review outcomes:",
  "{{peer_review_results}}",
  "",
  "Resolve conflicts explicitly and produce one coherent final answer.",
].join("\n");

export function resolveMasterModePromptTemplates(
  spaceConfig: TurnModelConfig | undefined,
  globalOverrides: MasterModePromptTemplateOverrides,
): MasterModePromptTemplates {
  return {
    planner: pickTemplate(
      spaceConfig?.masterPlannerPromptTemplate,
      globalOverrides.masterPlannerPromptTemplate,
      DEFAULT_MASTER_PLANNER_PROMPT_TEMPLATE,
    ),
    guest: pickTemplate(
      spaceConfig?.guestAgentPromptTemplate,
      globalOverrides.guestAgentPromptTemplate,
      DEFAULT_GUEST_AGENT_PROMPT_TEMPLATE,
    ),
    peerReview: pickTemplate(
      spaceConfig?.peerReviewPromptTemplate,
      globalOverrides.peerReviewPromptTemplate,
      DEFAULT_PEER_REVIEW_PROMPT_TEMPLATE,
    ),
    synthesis: pickTemplate(
      spaceConfig?.masterSynthesisPromptTemplate,
      globalOverrides.masterSynthesisPromptTemplate,
      DEFAULT_MASTER_SYNTHESIS_PROMPT_TEMPLATE,
    ),
  };
}

export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] ?? "" : match;
  });
}

function pickTemplate(...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed.length > 0) return candidate;
  }
  return "";
}
