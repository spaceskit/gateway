import type { ArchetypeId, CapabilityTier } from "@spaceskit/core";

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
  {
    archetypeId: "discussion",
    templateId: "workbench/plan-discussion",
    name: "Workbench Plan Discussion",
    description: "Multi-provider planning team for testing a mid-complex Workbench plan handoff.",
    topology: "broadcast_team",
    turnModel: "primary_only",
    agents: [
      { agentId: "plan-coordinator", profileId: "plan-coordinator-opus", role: "global_coordinator", isPrimary: true, agentTier: "advanced" },
      { agentId: "plan-codex-architect", profileId: "plan-codex-architect", role: "participant", isPrimary: false, agentTier: "advanced" },
      { agentId: "plan-opus-reviewer", profileId: "plan-opus-reviewer", role: "participant", isPrimary: false, agentTier: "advanced" },
      { agentId: "plan-gemini-constraints", profileId: "plan-gemini-constraints", role: "participant", isPrimary: false, agentTier: "advanced" },
      { agentId: "plan-lmstudio-maintainer", profileId: "plan-lmstudio-maintainer", role: "participant", isPrimary: false, agentTier: "standard" },
      { agentId: "plan-apple-continuity", profileId: "plan-apple-continuity", role: "participant", isPrimary: false, agentTier: "standard" },
    ],
    tags: ["workbench", "planning", "handoff", "multi-provider"],
    masterModeEnabled: true,
    peerReviewEnabled: true,
    masterModeMaxIterations: 2,
    masterModeConvergenceThreshold: 0.8,
    defaultGoal: "Create a decision-complete implementation plan and handoff artifact for the Workbench code team.",
    category: "team_pattern",
    complexityTier: "advanced",
    icon: "point.3.connected.trianglepath.dotted",
    featured: false,
    sortOrder: 105,
  },
  {
    archetypeId: "coding",
    templateId: "workbench/code-implementation",
    name: "Workbench Code Implementation",
    description: "Multi-provider code implementation team that consumes a saved Workbench plan artifact.",
    topology: "shared_team_chat",
    turnModel: "sequential_all",
    agents: [
      { agentId: "code-lead", profileId: "code-lead-codex", role: "global_coordinator", isPrimary: true, agentTier: "advanced" },
      { agentId: "code-opus-reviewer", profileId: "code-opus-reviewer", role: "participant", isPrimary: false, agentTier: "advanced" },
      { agentId: "code-gemini-integrator", profileId: "code-gemini-integrator", role: "participant", isPrimary: false, agentTier: "advanced" },
      { agentId: "code-lmstudio-maintainer", profileId: "code-lmstudio-maintainer", role: "participant", isPrimary: false, agentTier: "standard" },
      { agentId: "code-apple-continuity", profileId: "code-apple-continuity", role: "participant", isPrimary: false, agentTier: "standard" },
    ],
    tags: ["workbench", "coding", "implementation", "plan-handoff", "multi-provider"],
    masterModeEnabled: false,
    peerReviewEnabled: true,
    defaultGoal: "Consume the saved Workbench plan artifact and produce an implementation breakdown with verification steps.",
    category: "team_pattern",
    complexityTier: "advanced",
    icon: "hammer.fill",
    featured: false,
    sortOrder: 106,
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
