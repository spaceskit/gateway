/**
 * Archetype Templates — built-in space templates and agent profiles seeded
 * during gateway bootstrap.
 *
 * These are real SpaceTemplate + AgentProfile records that users can browse,
 * customize, and clone. They provide the 5 core orchestration patterns:
 * research, analysis, discussion, debate, coding.
 */

import type { CreateProfileInput, ProfileModelConfig } from "@spaceskit/persistence";
import type {
  CapabilityTier,
  ArchetypeId,
  TierProviderHints,
} from "@spaceskit/core";

// ---------------------------------------------------------------------------
// Profile seed definitions
// ---------------------------------------------------------------------------

export interface ArchetypeProfileSeed {
  profileId: string;
  name: string;
  description: string;
  personalityPrompt: string;
  canModerate: boolean;
  providerHint: string;
  modelHint: string;
  preferredTier: CapabilityTier;
  modelConfig?: ProfileModelConfig;
}

const COORDINATOR_PROMPT_BASE = [
  "You are a team coordinator responsible for planning, delegating, and synthesizing work.",
  "When given a task:",
  "1. Break it into clear sub-tasks with specific instructions for each team member.",
  "2. Assign work based on agent capabilities and the task requirements.",
  "3. After receiving worker reports, synthesize a coherent final answer.",
  "4. Highlight key findings, conflicts, and confidence levels.",
  "5. When the task is fully complete, include [TASK_COMPLETE] at the end of your synthesis.",
].join("\n");

export const ARCHETYPE_PROFILES: readonly ArchetypeProfileSeed[] = [
  // -- Coordinators --
  {
    profileId: "archetype/research-coordinator",
    name: "Research Coordinator",
    description: "Plans research tasks, assigns investigators, and synthesizes findings.",
    personalityPrompt: [
      COORDINATOR_PROMPT_BASE,
      "",
      "You specialize in research and investigation. Focus on:",
      "- Identifying the most important questions to answer.",
      "- Assigning researchers to cover different angles.",
      "- Cross-referencing findings for consistency.",
      "- Producing a well-sourced, comprehensive synthesis.",
    ].join("\n"),
    canModerate: true,
    providerHint: "anthropic",
    modelHint: "",
    preferredTier: "advanced",
  },
  {
    profileId: "archetype/analysis-coordinator",
    name: "Analysis Coordinator",
    description: "Decomposes analysis into sub-tasks and consolidates analytical findings.",
    personalityPrompt: [
      COORDINATOR_PROMPT_BASE,
      "",
      "You specialize in structured analysis. Focus on:",
      "- Breaking complex questions into measurable sub-questions.",
      "- Assigning analysts to specific data domains.",
      "- Identifying patterns, outliers, and confidence intervals.",
      "- Producing clear, evidence-based conclusions.",
    ].join("\n"),
    canModerate: true,
    providerHint: "anthropic",
    modelHint: "",
    preferredTier: "advanced",
  },
  {
    profileId: "archetype/debate-synthesizer",
    name: "Debate Synthesizer",
    description: "Moderates debates and produces balanced conclusions.",
    personalityPrompt: [
      COORDINATOR_PROMPT_BASE,
      "",
      "You specialize in debate moderation and synthesis. Focus on:",
      "- Ensuring each side presents their strongest arguments.",
      "- Identifying valid points from all positions.",
      "- Highlighting areas of genuine agreement and disagreement.",
      "- Producing a balanced conclusion that acknowledges tradeoffs.",
    ].join("\n"),
    canModerate: true,
    providerHint: "anthropic",
    modelHint: "",
    preferredTier: "advanced",
  },
  // -- Workers --
  {
    profileId: "archetype/researcher",
    name: "Researcher",
    description: "Investigates assigned topics and produces detailed reports.",
    personalityPrompt: [
      "You are a research specialist working as part of a team.",
      "When given a research assignment:",
      "1. Investigate the topic thoroughly using available tools and knowledge.",
      "2. Organize your findings with clear structure and evidence.",
      "3. Note confidence levels and knowledge gaps.",
      "4. Produce a concise internal report for the coordinator.",
    ].join("\n"),
    canModerate: false,
    providerHint: "",
    modelHint: "",
    preferredTier: "standard",
  },
  {
    profileId: "archetype/analyst",
    name: "Analyst",
    description: "Performs focused analysis on assigned data or topics.",
    personalityPrompt: [
      "You are an analytical specialist working as part of a team.",
      "When given an analysis assignment:",
      "1. Examine the data or topic systematically.",
      "2. Identify patterns, trends, and anomalies.",
      "3. Quantify findings where possible.",
      "4. Produce a concise analytical report for the coordinator.",
    ].join("\n"),
    canModerate: false,
    providerHint: "",
    modelHint: "",
    preferredTier: "standard",
  },
  {
    profileId: "archetype/discussant",
    name: "Discussant",
    description: "Participates in group discussions, building on others' ideas.",
    personalityPrompt: [
      "You are a discussion participant in a collaborative group.",
      "During discussions:",
      "1. Read and build on what others have said.",
      "2. Offer unique perspectives and challenge assumptions constructively.",
      "3. Keep your contributions focused and substantive.",
      "4. Seek consensus where possible while noting genuine disagreements.",
    ].join("\n"),
    canModerate: false,
    providerHint: "",
    modelHint: "",
    preferredTier: "standard",
  },
  {
    profileId: "archetype/debater",
    name: "Debater",
    description: "Argues a position with evidence and reasoning.",
    personalityPrompt: [
      "You are a debater assigned to argue a specific position.",
      "During debates:",
      "1. Present your strongest arguments with evidence and reasoning.",
      "2. Anticipate and address counterarguments.",
      "3. Acknowledge valid points from the other side while defending your position.",
      "4. Be persuasive but intellectually honest.",
    ].join("\n"),
    canModerate: false,
    providerHint: "",
    modelHint: "",
    preferredTier: "standard",
  },
  {
    profileId: "archetype/developer",
    name: "Developer",
    description: "Collaborates on coding tasks in a shared workspace.",
    personalityPrompt: [
      "You are a developer working in a collaborative coding team.",
      "During implementation tasks:",
      "1. Write clean, well-structured code following project conventions.",
      "2. Review and build on teammates' contributions.",
      "3. Identify potential issues and suggest improvements.",
      "4. Keep your contributions focused on the assigned scope.",
    ].join("\n"),
    canModerate: false,
    providerHint: "",
    modelHint: "",
    preferredTier: "advanced",
  },
  // -- Concierge --
  {
    profileId: "quickstart/concierge",
    name: "Concierge",
    description: "A quick, conversational agent focused on spaces operations and navigation.",
    personalityPrompt: [
      "You are a concierge — warm, direct, and efficient.",
      "Your job is to help the user navigate, manage, and orchestrate their spaces.",
      "",
      "Behavioral rules:",
      "- Act immediately on clear requests. Do not over-explain.",
      "- When uncertain, ask ONE clarifying question — never present a list of options.",
      "- After completing an action, suggest the next logical step.",
      "- Keep operational responses under 3 sentences.",
      "- Never interrupt or over-qualify. Be a good listener.",
      "- Know when you are out of scope: route complex analytical, creative, or coding tasks to the main agent or a team space.",
      "",
      "You are not a general-purpose assistant. You are the operations concierge.",
    ].join("\n"),
    canModerate: false,
    providerHint: "",
    modelHint: "fast",
    preferredTier: "standard",
  },
  // -- Quick Start single-agent profiles --
  {
    profileId: "quickstart/personal-assistant",
    name: "Personal Assistant",
    description: "A general-purpose AI assistant for everyday tasks.",
    personalityPrompt: [
      "You are a helpful, friendly personal assistant.",
      "You help with a wide range of tasks including:",
      "- Answering questions and explaining concepts.",
      "- Writing and editing text.",
      "- Brainstorming ideas and solving problems.",
      "- Summarizing information.",
      "Be concise, clear, and proactive in offering follow-up suggestions.",
    ].join("\n"),
    canModerate: false,
    providerHint: "",
    modelHint: "",
    preferredTier: "standard",
  },
  {
    profileId: "quickstart/writing-partner",
    name: "Writing Partner",
    description: "Helps draft, edit, and polish written content.",
    personalityPrompt: [
      "You are a skilled writing partner.",
      "You help with all forms of written content:",
      "- Drafting documents, emails, blog posts, and creative writing.",
      "- Editing for clarity, tone, grammar, and style.",
      "- Suggesting improvements and alternative phrasings.",
      "- Adapting voice and tone to the intended audience.",
      "Ask clarifying questions about audience and purpose when helpful.",
    ].join("\n"),
    canModerate: false,
    providerHint: "",
    modelHint: "",
    preferredTier: "standard",
  },
  {
    profileId: "quickstart/code-companion",
    name: "Code Companion",
    description: "Pair-programs, debugs, and reviews code.",
    personalityPrompt: [
      "You are an experienced software developer and pair-programming partner.",
      "You help with:",
      "- Writing, reviewing, and debugging code.",
      "- Explaining technical concepts and architecture decisions.",
      "- Suggesting best practices, patterns, and optimizations.",
      "- Exploring new technologies and frameworks.",
      "Write clean, well-documented code and explain your reasoning.",
    ].join("\n"),
    canModerate: false,
    providerHint: "",
    modelHint: "",
    preferredTier: "advanced",
  },
  {
    profileId: "quickstart/learning-tutor",
    name: "Learning Tutor",
    description: "Teaches topics with explanations, examples, and questions.",
    personalityPrompt: [
      "You are a patient, encouraging tutor.",
      "Your teaching approach:",
      "- Explain concepts clearly, building from fundamentals.",
      "- Use concrete examples and analogies.",
      "- Ask Socratic questions to check understanding.",
      "- Adapt your explanations to the learner's level.",
      "- Celebrate progress and gently correct misconceptions.",
      "Break complex topics into digestible pieces.",
    ].join("\n"),
    canModerate: false,
    providerHint: "",
    modelHint: "",
    preferredTier: "standard",
  },
  {
    profileId: "quickstart/project-planner",
    name: "Project Planner",
    description: "Breaks down goals into actionable tasks and plans.",
    personalityPrompt: [
      "You are a structured project planning assistant.",
      "You help with:",
      "- Breaking ambitious goals into concrete, actionable tasks.",
      "- Creating timelines, milestones, and priorities.",
      "- Identifying risks, dependencies, and blockers.",
      "- Tracking progress and suggesting next steps.",
      "Be specific with deliverables and keep plans realistic.",
    ].join("\n"),
    canModerate: false,
    providerHint: "",
    modelHint: "",
    preferredTier: "standard",
  },
];

// ---------------------------------------------------------------------------
// Template seed definitions
// ---------------------------------------------------------------------------

export type TemplateCategory = "quick_start" | "team_pattern" | "custom";
export type ComplexityTier = "simple" | "advanced";

export interface ArchetypeTemplateSeed {
  archetypeId: ArchetypeId;
  templateId: string;
  name: string;
  description: string;
  topology: "direct" | "broadcast_team" | "shared_team_chat";
  turnModel: string;
  agents: Array<{
    agentId: string;
    profileId: string;
    role: string;
    isPrimary: boolean;
    agentTier: CapabilityTier;
  }>;
  tags: string[];
  masterModeEnabled: boolean;
  peerReviewEnabled: boolean;
  /** Max convergence iterations for master mode (default: 1). */
  masterModeMaxIterations?: number;
  /** Convergence confidence threshold for peer review (0.0-1.0, default: 0.8). */
  masterModeConvergenceThreshold?: number;
  defaultGoal?: string;
  /** Template catalog metadata */
  category: TemplateCategory;
  complexityTier: ComplexityTier;
  icon: string;
  featured: boolean;
  sortOrder: number;
}

export const ARCHETYPE_TEMPLATES: readonly ArchetypeTemplateSeed[] = [
  {
    archetypeId: "research",
    templateId: "archetype/research",
    name: "Research Team",
    description: "Coordinator plans research tasks, workers investigate in parallel, coordinator synthesizes findings.",
    topology: "broadcast_team",
    turnModel: "primary_only",
    agents: [
      { agentId: "coordinator", profileId: "archetype/research-coordinator", role: "global_coordinator", isPrimary: true, agentTier: "advanced" },
      { agentId: "researcher-1", profileId: "archetype/researcher", role: "participant", isPrimary: false, agentTier: "standard" },
      { agentId: "researcher-2", profileId: "archetype/researcher", role: "participant", isPrimary: false, agentTier: "standard" },
    ],
    tags: ["research", "investigation", "archetype"],
    masterModeEnabled: true,
    peerReviewEnabled: false,
    defaultGoal: "Research the assigned topic thoroughly and produce a comprehensive synthesis.",
    category: "team_pattern",
    complexityTier: "advanced",
    icon: "magnifyingglass.circle.fill",
    featured: false,
    sortOrder: 100,
  },
  {
    archetypeId: "analysis",
    templateId: "archetype/analysis",
    name: "Analysis Team",
    description: "Coordinator decomposes analysis into sub-tasks, analysts work in parallel, coordinator consolidates.",
    topology: "broadcast_team",
    turnModel: "primary_only",
    agents: [
      { agentId: "coordinator", profileId: "archetype/analysis-coordinator", role: "global_coordinator", isPrimary: true, agentTier: "advanced" },
      { agentId: "analyst-1", profileId: "archetype/analyst", role: "participant", isPrimary: false, agentTier: "standard" },
      { agentId: "analyst-2", profileId: "archetype/analyst", role: "participant", isPrimary: false, agentTier: "standard" },
    ],
    tags: ["analysis", "data", "archetype"],
    masterModeEnabled: true,
    peerReviewEnabled: false,
    defaultGoal: "Analyze the assigned topic systematically and produce evidence-based conclusions.",
    category: "team_pattern",
    complexityTier: "advanced",
    icon: "chart.bar.fill",
    featured: false,
    sortOrder: 101,
  },
  {
    archetypeId: "discussion",
    templateId: "archetype/discussion",
    name: "Discussion Group",
    description: "Multiple agents discuss a topic in a shared conversation, building on each other's ideas.",
    topology: "shared_team_chat",
    turnModel: "sequential_all",
    agents: [
      { agentId: "discussant-1", profileId: "archetype/discussant", role: "participant", isPrimary: true, agentTier: "standard" },
      { agentId: "discussant-2", profileId: "archetype/discussant", role: "participant", isPrimary: false, agentTier: "standard" },
      { agentId: "discussant-3", profileId: "archetype/discussant", role: "participant", isPrimary: false, agentTier: "standard" },
    ],
    tags: ["discussion", "brainstorm", "collaboration", "archetype"],
    masterModeEnabled: false,
    peerReviewEnabled: false,
    defaultGoal: "Discuss the topic collaboratively and surface diverse perspectives.",
    category: "team_pattern",
    complexityTier: "advanced",
    icon: "bubble.left.and.bubble.right.fill",
    featured: false,
    sortOrder: 102,
  },
  {
    archetypeId: "debate",
    templateId: "archetype/debate",
    name: "Debate Team",
    description: "Two debaters argue positions with peer review, a synthesizer produces a balanced conclusion.",
    topology: "broadcast_team",
    turnModel: "primary_only",
    agents: [
      { agentId: "synthesizer", profileId: "archetype/debate-synthesizer", role: "global_coordinator", isPrimary: true, agentTier: "advanced" },
      { agentId: "debater-1", profileId: "archetype/debater", role: "participant", isPrimary: false, agentTier: "standard" },
      { agentId: "debater-2", profileId: "archetype/debater", role: "participant", isPrimary: false, agentTier: "standard" },
    ],
    tags: ["debate", "argument", "compare", "archetype"],
    masterModeEnabled: true,
    peerReviewEnabled: true,
    masterModeMaxIterations: 2,
    masterModeConvergenceThreshold: 0.8,
    defaultGoal: "Debate the topic from multiple angles and produce a balanced synthesis.",
    category: "team_pattern",
    complexityTier: "advanced",
    icon: "person.2.wave.2.fill",
    featured: false,
    sortOrder: 103,
  },
  {
    archetypeId: "coding",
    templateId: "archetype/coding",
    name: "Coding Team",
    description: "Developers collaborate in a shared workspace on implementation tasks.",
    topology: "shared_team_chat",
    turnModel: "sequential_all",
    agents: [
      { agentId: "developer-1", profileId: "archetype/developer", role: "participant", isPrimary: true, agentTier: "advanced" },
      { agentId: "developer-2", profileId: "archetype/developer", role: "participant", isPrimary: false, agentTier: "advanced" },
    ],
    tags: ["coding", "development", "programming", "archetype"],
    masterModeEnabled: false,
    peerReviewEnabled: false,
    defaultGoal: "Collaborate on the implementation task and produce clean, working code.",
    category: "team_pattern",
    complexityTier: "advanced",
    icon: "chevron.left.forwardslash.chevron.right",
    featured: false,
    sortOrder: 104,
  },
  // ---------------------------------------------------------------------------
  // Quick Start — single-agent templates for immediate value
  // ---------------------------------------------------------------------------
  {
    archetypeId: "concierge",
    templateId: "quickstart/concierge",
    name: "Concierge",
    description: "Navigate, manage, and orchestrate your spaces with a quick conversational assistant.",
    topology: "direct",
    turnModel: "primary_only",
    agents: [
      { agentId: "concierge", profileId: "quickstart/concierge", role: "participant", isPrimary: true, agentTier: "standard" },
    ],
    tags: ["concierge", "operations", "navigation", "quickstart"],
    masterModeEnabled: false,
    peerReviewEnabled: false,
    defaultGoal: "Help navigate and manage spaces efficiently.",
    category: "quick_start",
    complexityTier: "simple",
    icon: "bell.concierge.fill",
    featured: true,
    sortOrder: -1,
  },
  {
    archetypeId: "personal-assistant",
    templateId: "quickstart/personal-assistant",
    name: "Personal Assistant",
    description: "Ask anything, get help with writing, brainstorming, and everyday questions.",
    topology: "direct",
    turnModel: "primary_only",
    agents: [
      { agentId: "assistant", profileId: "quickstart/personal-assistant", role: "participant", isPrimary: true, agentTier: "standard" },
    ],
    tags: ["assistant", "general", "quickstart"],
    masterModeEnabled: false,
    peerReviewEnabled: false,
    defaultGoal: "Help with whatever you need.",
    category: "quick_start",
    complexityTier: "simple",
    icon: "bubble.left.fill",
    featured: true,
    sortOrder: 0,
  },
  {
    archetypeId: "project-planner",
    templateId: "quickstart/project-planner",
    name: "Project Planner",
    description: "Break down goals into tasks, create plans, and track progress.",
    topology: "direct",
    turnModel: "primary_only",
    agents: [
      { agentId: "planner", profileId: "quickstart/project-planner", role: "participant", isPrimary: true, agentTier: "standard" },
    ],
    tags: ["planning", "tasks", "project", "quickstart"],
    masterModeEnabled: false,
    peerReviewEnabled: false,
    defaultGoal: "Help plan and organize your project.",
    category: "quick_start",
    complexityTier: "simple",
    icon: "checklist",
    featured: true,
    sortOrder: 1,
  },
  {
    archetypeId: "writing-partner",
    templateId: "quickstart/writing-partner",
    name: "Writing Partner",
    description: "Draft, edit, and polish documents, emails, and creative writing.",
    topology: "direct",
    turnModel: "primary_only",
    agents: [
      { agentId: "writer", profileId: "quickstart/writing-partner", role: "participant", isPrimary: true, agentTier: "standard" },
    ],
    tags: ["writing", "editing", "content", "quickstart"],
    masterModeEnabled: false,
    peerReviewEnabled: false,
    defaultGoal: "Help with writing and editing.",
    category: "quick_start",
    complexityTier: "simple",
    icon: "pencil.line",
    featured: false,
    sortOrder: 2,
  },
  {
    archetypeId: "code-companion",
    templateId: "quickstart/code-companion",
    name: "Code Companion",
    description: "Pair-program, debug, review code, and explore technical ideas.",
    topology: "direct",
    turnModel: "primary_only",
    agents: [
      { agentId: "coder", profileId: "quickstart/code-companion", role: "participant", isPrimary: true, agentTier: "advanced" },
    ],
    tags: ["coding", "development", "programming", "quickstart"],
    masterModeEnabled: false,
    peerReviewEnabled: false,
    defaultGoal: "Help with coding and technical tasks.",
    category: "quick_start",
    complexityTier: "simple",
    icon: "terminal.fill",
    featured: false,
    sortOrder: 3,
  },
  {
    archetypeId: "learning-tutor",
    templateId: "quickstart/learning-tutor",
    name: "Learning Tutor",
    description: "Study a topic with explanations, examples, and Socratic questioning.",
    topology: "direct",
    turnModel: "primary_only",
    agents: [
      { agentId: "tutor", profileId: "quickstart/learning-tutor", role: "participant", isPrimary: true, agentTier: "standard" },
    ],
    tags: ["learning", "education", "tutoring", "quickstart"],
    masterModeEnabled: false,
    peerReviewEnabled: false,
    defaultGoal: "Help you learn and understand new topics.",
    category: "quick_start",
    complexityTier: "simple",
    icon: "book.fill",
    featured: false,
    sortOrder: 4,
  },
];

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

/**
 * Build a SpaceTemplate JSON config for persisting via SpaceTemplateRepository.
 */
export function buildTemplateConfigJson(seed: ArchetypeTemplateSeed): string {
  return JSON.stringify({
    templateId: seed.templateId,
    name: seed.name,
    description: seed.description,
    version: 1,
    turnModel: seed.turnModel,
    agents: seed.agents.map((a) => ({
      agentId: a.agentId,
      profileId: a.profileId,
      role: a.role,
      isPrimary: a.isPrimary,
      agentTier: a.agentTier,
    })),
    capabilities: [],
    defaultGoal: seed.defaultGoal ?? "",
    rules: [],
    tags: seed.tags,
    metadata: {
      archetypeId: seed.archetypeId,
      topology: seed.topology,
      masterModeEnabled: seed.masterModeEnabled,
      peerReviewEnabled: seed.peerReviewEnabled,
      masterModeMaxIterations: seed.masterModeMaxIterations,
      masterModeConvergenceThreshold: seed.masterModeConvergenceThreshold,
      category: seed.category,
      complexityTier: seed.complexityTier,
      icon: seed.icon,
      featured: seed.featured,
      sortOrder: seed.sortOrder,
    },
  });
}

/**
 * Convert an ArchetypeProfileSeed to a CreateProfileInput.
 */
export function toCreateProfileInput(seed: ArchetypeProfileSeed): CreateProfileInput {
  return {
    profileId: seed.profileId,
    name: seed.name,
    description: seed.description,
    personalityPrompt: seed.personalityPrompt,
    canModerate: seed.canModerate,
    providerHint: seed.providerHint,
    modelHint: seed.modelHint,
    modelConfig: seed.modelConfig,
  };
}

/**
 * Seed archetype profiles and templates into the database.
 * Idempotent: skips profiles/templates that already exist.
 */
export function seedArchetypeTemplates(deps: {
  profileRepo: {
    getById(id: string): unknown | undefined;
    create(input: CreateProfileInput): unknown;
  };
  templateRepo: {
    getById(id: string): unknown | undefined;
    upsertWithNewRevision(input: {
      templateId: string;
      ownerPrincipalId: string;
      name: string;
      description?: string;
      spaceConfigJson: string;
    }): unknown;
  };
  db: { exec(sql: string): void; query(sql: string): { run(...args: unknown[]): unknown } };
}): { profilesCreated: number; templatesCreated: number } {
  let profilesCreated = 0;
  let templatesCreated = 0;

  // Seed profiles
  for (const seed of ARCHETYPE_PROFILES) {
    const existing = deps.profileRepo.getById(seed.profileId);
    if (!existing) {
      deps.profileRepo.create(toCreateProfileInput(seed));
      profilesCreated++;
    }
    // Set preferred_tier on the profile row (column may not exist in older schemas)
    try {
      deps.db.query(
        `UPDATE agent_profiles SET preferred_tier = ? WHERE profile_id = ?`,
      ).run(seed.preferredTier, seed.profileId);
    } catch {
      // Column not yet available — skip preferred_tier update
    }
  }

  // Seed templates
  for (const seed of ARCHETYPE_TEMPLATES) {
    const existing = deps.templateRepo.getById(seed.templateId);
    if (!existing) {
      deps.templateRepo.upsertWithNewRevision({
        templateId: seed.templateId,
        ownerPrincipalId: "system",
        name: seed.name,
        description: seed.description,
        spaceConfigJson: buildTemplateConfigJson(seed),
      });
      templatesCreated++;
    }
  }

  return { profilesCreated, templatesCreated };
}
