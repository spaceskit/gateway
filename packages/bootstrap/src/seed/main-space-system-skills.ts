export interface MainSpaceSystemSkillSeed {
  skillId: string;
  name: string;
  description: string;
  contentMarkdown: string;
  sourceRef: string;
  tags: string[];
  status: "active";
}

const COMMAND_REGISTRY_V1 = [
  "list_rooms",
  "create_room",
  "list_skills",
  "create_skill",
  "handoff_room",
] as const;

const SHARED_SUFFIX = [
  "## Command Registry v1",
  "These are the currently supported control-plane commands:",
  ...COMMAND_REGISTRY_V1.map((command) => `- \`${command}\``),
  "",
  "This list is intentionally versioned and expandable.",
  "When a permanent command registry is provided, update this section in place.",
].join("\n");

export const MAIN_SPACE_SYSTEM_SKILLS: readonly MainSpaceSystemSkillSeed[] = [
  {
    skillId: "system/spaces-skill",
    name: "Spaces Skill",
    description: "Core Spaces app behavior, capabilities, constraints, and room operations guidance.",
    contentMarkdown: [
      "# Spaces Skill",
      "Use this as the canonical context for how Spaces works today.",
      "",
      "## Responsibilities",
      "- Describe current app capabilities and known limitations without guessing.",
      "- Explain room/space lifecycle behavior with clear operational steps.",
      "- Route control-surface actions through gateway orchestration contracts.",
      "",
      "## Current Capability Scope",
      "- Main chat shell with gateway-backed spaces.",
      "- Space creation, agent assignment, skill assignment, and workspace operations.",
      "- Scheduler, orchestration journal, and gateway admin surfaces.",
      "",
      "## Current Limitation Notes",
      "- Space archive/delete transport APIs are not yet shipped.",
      "- Main-space permanence is enforced by startup defaults and app-local guardrails.",
      "",
      SHARED_SUFFIX,
    ].join("\n"),
    sourceRef: "spaceskit:system/main-space/spaces-skill/v1",
    tags: ["system", "spaces", "main-space", "operations"],
    status: "active",
  },
  {
    skillId: "system/moderator-skill",
    name: "Moderator Skill",
    description: "Multi-agent coordination policy, scope control, and escalation behavior.",
    contentMarkdown: [
      "# Moderator Skill",
      "Use this to coordinate multiple agents with predictable execution discipline.",
      "",
      "## Responsibilities",
      "- Decide whether a request is simple or multi-agent worthy.",
      "- Keep tasks scoped; avoid unnecessary delegation.",
      "- Assign agents explicitly and maintain role clarity.",
      "- Escalate when blockers or policy constraints prevent safe execution.",
      "",
      "## Decision Rules",
      "- Prefer single-agent execution for focused tasks.",
      "- Use multi-agent only when work clearly benefits from decomposition.",
      "- Track handoff boundaries and ensure one final synthesized answer.",
      "",
      "## Handoff Guidance",
      "- Choose target room and agent intentionally.",
      "- Provide concise task framing, constraints, and expected output.",
      "",
      SHARED_SUFFIX,
    ].join("\n"),
    sourceRef: "spaceskit:system/main-space/moderator-skill/v1",
    tags: ["system", "moderation", "coordination", "main-space"],
    status: "active",
  },
  {
    skillId: "system/master-skill",
    name: "Master Skill",
    description: "Primary operational reference for architecture, docs locations, defaults, and management flows.",
    contentMarkdown: [
      "# Master Skill",
      "Use this as the top-level guide for how the app and gateway operate.",
      "",
      "## Responsibilities",
      "- Explain system architecture and runtime profile behavior.",
      "- Point to documentation and canonical planning sources.",
      "- Describe default commands/capabilities exposed by the current control plane.",
      "- Explain how to create/manage spaces, templates, agents, and experiences.",
      "",
      "## Documentation Map",
      "- Repository root: `README.md`",
      "- Gateway docs: `gateway/README.md` and `gateway/docs/`",
      "- Planning canon: `_planning/WORKFLOW-INSTRUCTION.md`, `_planning/WHAT-TO-DO-NEXT.md`",
      "",
      "## Operational Defaults",
      "- Main-space bootstrap is profile-aware (`embedded` and `external`).",
      "- Main-space coordination is expected to run through control-plane orchestration commands.",
      "",
      SHARED_SUFFIX,
    ].join("\n"),
    sourceRef: "spaceskit:system/main-space/master-skill/v1",
    tags: ["system", "master", "docs", "orchestration", "main-space"],
    status: "active",
  },
];

export const MAIN_SPACE_SYSTEM_SKILL_IDS = MAIN_SPACE_SYSTEM_SKILLS.map((skill) => skill.skillId);
