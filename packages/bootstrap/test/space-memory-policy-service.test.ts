import { describe, expect, test } from "bun:test";
import {
  AgentUsageSessionRepository,
  ArtifactRepository,
  EventLogRepository,
  ExperienceRepository,
  GatewayMemoryDefaultsRepository,
  OrchestrationJournalRepository,
  PersonalityInsightRepository,
  SpaceAgentNotesRepository,
  SpaceReplaySessionRepository,
  SpaceRepository,
  TurnRepository,
  initDatabase,
} from "@spaceskit/persistence";
import { SpaceMemoryPolicyService } from "../src/services/space-memory-policy-service.js";

function createContext(configJson?: Record<string, unknown>) {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-space-memory-policy-${crypto.randomUUID()}`,
  });

  const spaces = new SpaceRepository(db.db);
  spaces.create({
    spaceId: "space-main",
    resourceId: "resource-main",
    spaceType: "space",
    name: "Main Space",
    goal: "",
    turnModel: "sequential_all",
    configJson: JSON.stringify(configJson ?? {
      spaceUid: "11111111-1111-1111-8111-111111111111",
    }),
  });
  db.db.query(`
    INSERT INTO agent_profiles(
      profile_id,
      name,
      description,
      can_moderate,
      visibility,
      is_default,
      active_revision,
      archived,
      created_at,
      updated_at
    ) VALUES (?, ?, '', 0, 1, 0, 1, 0, ?, ?)
  `).run(
    "profile-main",
    "Profile Main",
    "2026-03-11T09:00:00.000Z",
    "2026-03-11T09:00:00.000Z",
  );

  const gatewayDefaults = new GatewayMemoryDefaultsRepository(db.db);
  const replaySessions = new SpaceReplaySessionRepository(db.db);
  const turns = new TurnRepository(db.db);
  const eventLog = new EventLogRepository(db.db);
  const orchestrationJournal = new OrchestrationJournalRepository(db.db);
  const artifacts = new ArtifactRepository(db.db);
  const experiences = new ExperienceRepository(db.db);
  const personalityInsights = new PersonalityInsightRepository(db.db);
  const agentNotes = new SpaceAgentNotesRepository(db.db);
  const agentUsageSessions = new AgentUsageSessionRepository(db.db);

  let nowIso = "2026-03-11T10:00:00.000Z";
  const service = new SpaceMemoryPolicyService({
    spaces,
    gatewayDefaults,
    replaySessions,
    turns,
    eventLog,
    orchestrationJournal,
    artifacts,
    experiences,
    personalityInsights,
    agentNotes,
    agentUsageSessions,
    now: () => new Date(nowIso),
  });

  return {
    db,
    spaces,
    gatewayDefaults,
    replaySessions,
    turns,
    eventLog,
    orchestrationJournal,
    artifacts,
    experiences,
    personalityInsights,
    agentNotes,
    agentUsageSessions,
    service,
    setNowIso: (value: string) => {
      nowIso = value;
    },
  };
}

describe("SpaceMemoryPolicyService", () => {
  test("triggers self-check eligibility after 10 turns for enabled standard spaces", async () => {
    const context = createContext({
      spaceUid: "11111111-1111-1111-8111-111111111111",
      thinkingCapturePolicy: "SUMMARY",
      memoryPolicy: {
        experienceCapture: "ENABLED",
        privacyMode: "STANDARD",
      },
    });

    try {
      expect(context.service.shouldGenerateExperiences("space-main")).toBe(true);
      expect(context.service.getEffectiveThinkingCapturePolicy("space-main")).toBe("SUMMARY");

      let lastShouldGenerate = false;
      for (let idx = 0; idx < 10; idx += 1) {
        const { shouldGenerateExperience } = context.service.noteTurnPersisted(
          "space-main",
          `2026-03-11T10:00:${String(idx).padStart(2, "0")}.000Z`,
        );
        lastShouldGenerate = shouldGenerateExperience;
      }

      expect(lastShouldGenerate).toBe(true);

      context.service.markSelfCheckCompleted("space-main", 10);
      const followUp = context.service.noteTurnPersisted(
        "space-main",
        "2026-03-11T10:01:00.000Z",
      );
      expect(followUp.shouldGenerateExperience).toBe(false);
      expect(followUp.session.turn_count).toBe(11);
      expect(followUp.session.last_self_check_turn_count).toBe(10);
    } finally {
      context.db.close();
    }
  });

  test("resolves inherited disabled experience capture from gateway defaults", () => {
    const context = createContext({
      spaceUid: "11111111-1111-1111-8111-111111111111",
      thinkingCapturePolicy: "FULL",
      memoryPolicy: {
        experienceCapture: "INHERIT",
        privacyMode: "STANDARD",
      },
    });

    try {
      context.gatewayDefaults.set({
        defaultExperienceCapture: "DISABLED",
      });

      const resolution = context.service.resolveSpacePolicy("space-main");
      expect(resolution.configured.experienceCapture).toBe("INHERIT");
      expect(resolution.effective.experienceCapture).toBe("DISABLED");
      expect(resolution.effectiveThinkingCapturePolicy).toBe("FULL");
      expect(context.service.shouldGenerateExperiences("space-main")).toBe(false);

      let shouldGenerate = false;
      for (let idx = 0; idx < 10; idx += 1) {
        shouldGenerate = context.service.noteTurnPersisted(
          "space-main",
          `2026-03-11T11:00:${String(idx).padStart(2, "0")}.000Z`,
        ).shouldGenerateExperience;
      }
      expect(shouldGenerate).toBe(false);
    } finally {
      context.db.close();
    }
  });

  test("updates configured thinking capture policy in space config", () => {
    const context = createContext({
      spaceUid: "11111111-1111-1111-8111-111111111111",
      thinkingCapturePolicy: "SUMMARY",
      memoryPolicy: {
        experienceCapture: "INHERIT",
        privacyMode: "STANDARD",
      },
    });

    try {
      expect(context.service.getThinkingCapturePolicy("space-main")).toBe("SUMMARY");

      const updated = context.service.setThinkingCapturePolicy("space-main", "FULL");

      expect(updated).toBe("FULL");
      expect(context.service.getThinkingCapturePolicy("space-main")).toBe("FULL");
      expect(context.service.getEffectiveThinkingCapturePolicy("space-main")).toBe("FULL");
    } finally {
      context.db.close();
    }
  });

  test("updates configured space memory policy and ends incognito when leaving session mode", async () => {
    const context = createContext({
      spaceUid: "11111111-1111-1111-8111-111111111111",
      thinkingCapturePolicy: "FULL",
      memoryPolicy: {
        experienceCapture: "DISABLED",
        privacyMode: "INCOGNITO_SESSION",
      },
    });

    try {
      context.service.noteTurnPersisted(
        "space-main",
        "2026-03-11T10:00:00.000Z",
      );

      const result = await context.service.setSpaceMemoryPolicy("space-main", {
        experienceCapture: "ENABLED",
        privacyMode: "STANDARD",
      });

      expect(result?.ended).toBe(true);
      expect(result?.reason).toBe("policy_change");
      expect(context.service.getSpaceMemoryPolicy("space-main")).toEqual({
        experienceCapture: "ENABLED",
        privacyMode: "STANDARD",
      });
      expect(context.service.getEffectiveThinkingCapturePolicy("space-main")).toBe("FULL");
    } finally {
      context.db.close();
    }
  });

  test("incognito sessions force thinking off and purge only session-scoped replay data", async () => {
    const context = createContext({
      spaceUid: "11111111-1111-1111-8111-111111111111",
      thinkingCapturePolicy: "FULL",
      memoryPolicy: {
        experienceCapture: "ENABLED",
        privacyMode: "INCOGNITO_SESSION",
      },
    });

    try {
      expect(context.service.shouldPersistWorkspaceLogs("space-main")).toBe(false);
      expect(context.service.shouldPersistTurnTrace("space-main")).toBe(false);
      expect(context.service.shouldPersistOrchestrationJournal("space-main")).toBe(false);
      expect(context.service.shouldGenerateExperiences("space-main")).toBe(false);
      expect(context.service.getEffectiveThinkingCapturePolicy("space-main")).toBe("OFF");

      context.turns.create({
        turnId: "turn-before",
        spaceId: "space-main",
        actorType: "agent",
        actorId: "agent-main",
        inputJson: JSON.stringify({ text: "before" }),
      });
      context.turns.complete("turn-before", {
        outputJson: JSON.stringify({ text: "before-output" }),
        tokenInput: 1,
        tokenOutput: 1,
      });
      context.db.db.query(`
        UPDATE turns
        SET created_at = ?, completed_at = ?
        WHERE turn_id = ?
      `).run("2026-03-11T09:00:00.000Z", "2026-03-11T09:00:01.000Z", "turn-before");

      const started = context.service.noteTurnPersisted(
        "space-main",
        "2026-03-11T10:00:00.000Z",
      );
      expect(started.session.privacy_mode).toBe("INCOGNITO_SESSION");

      context.turns.create({
        turnId: "turn-incognito",
        spaceId: "space-main",
        actorType: "agent",
        actorId: "agent-main",
        inputJson: JSON.stringify({ text: "incognito" }),
      });
      context.turns.complete("turn-incognito", {
        outputJson: JSON.stringify({ text: "incognito-output" }),
        tokenInput: 2,
        tokenOutput: 3,
      });
      context.db.db.query(`
        UPDATE turns
        SET created_at = ?, completed_at = ?
        WHERE turn_id = ?
      `).run("2026-03-11T10:05:00.000Z", "2026-03-11T10:05:01.000Z", "turn-incognito");

      context.eventLog.create({
        eventId: "event-incognito",
        spaceId: "space-main",
        turnId: "turn-incognito",
        agentId: "agent-main",
        eventType: "turn_completed",
        createdAt: "2026-03-11T10:05:01.000Z",
      });

      context.orchestrationJournal.create({
        eventId: "journal-incognito",
        spaceId: "space-main",
        turnId: "turn-incognito",
        eventType: "agent.completed",
        actorId: "agent-main",
        createdAt: "2026-03-11T10:05:02.000Z",
      });

      context.artifacts.create({
        artifactId: "artifact-incognito",
        spaceId: "space-main",
        resourceId: "resource-main",
        turnId: "turn-incognito",
        agentId: "agent-main",
        type: "document",
        retentionScope: "space_local",
        title: "Incognito Artifact",
        contentJson: JSON.stringify({ text: "temporary" }),
      });
      context.db.db.query(`
        UPDATE space_artifacts
        SET created_at = ?, updated_at = ?
        WHERE artifact_id = ?
      `).run("2026-03-11T10:05:03.000Z", "2026-03-11T10:05:03.000Z", "artifact-incognito");

      context.artifacts.create({
        artifactId: "artifact-exported",
        spaceId: "space-main",
        resourceId: "resource-main",
        turnId: "turn-incognito",
        agentId: "agent-main",
        type: "export",
        retentionScope: "durable_export",
        title: "Exported Artifact",
        contentJson: JSON.stringify({ text: "keep" }),
      });
      context.db.db.query(`
        UPDATE space_artifacts
        SET created_at = ?, updated_at = ?
        WHERE artifact_id = ?
      `).run("2026-03-11T10:05:04.000Z", "2026-03-11T10:05:04.000Z", "artifact-exported");

      context.experiences.create({
        experienceId: "exp-incognito",
        spaceId: "space-main",
        summary: "temporary experience",
      });
      context.db.db.query(`
        UPDATE experiences
        SET created_at = ?, updated_at = ?
        WHERE experience_id = ?
      `).run("2026-03-11T10:05:05.000Z", "2026-03-11T10:05:05.000Z", "exp-incognito");

      context.personalityInsights.create({
        insightId: "insight-incognito",
        experienceId: "exp-incognito",
        spaceId: "space-main",
        profileId: "profile-main",
        baseRevision: 1,
        proposedPromptDelta: "temporary delta",
        rationale: "temporary rationale",
        confidence: 0.8,
      });
      context.db.db.query(`
        UPDATE personality_insights
        SET created_at = ?, updated_at = ?
        WHERE insight_id = ?
      `).run("2026-03-11T10:05:06.000Z", "2026-03-11T10:05:06.000Z", "insight-incognito");

      context.agentNotes.upsert({
        spaceId: "space-main",
        agentId: "agent-main",
        notes: "temporary note",
        updatedAt: "2026-03-11T10:05:07.000Z",
      });

      context.agentUsageSessions.ensureActive({
        spaceId: "space-main",
        agentId: "agent-main",
        nowIso: "2026-03-11T10:05:08.000Z",
      });

      context.setNowIso("2026-03-11T10:30:00.000Z");
      const ended = await context.service.endIncognitoSession("space-main", "manual");

      expect(ended.ended).toBe(true);
      expect(ended.reason).toBe("manual");
      expect(ended.sessionId).toBe(started.session.session_id);
      expect(ended.purgedAt).toBe("2026-03-11T10:30:00.000Z");
      expect(context.turns.listBySpace("space-main").map((row) => row.turn_id)).toEqual(["turn-before"]);
      expect(context.eventLog.count("space-main")).toBe(0);
      expect(context.orchestrationJournal.count("space-main")).toBe(0);
      expect(context.artifacts.getById("artifact-incognito")).toBeUndefined();
      expect(context.artifacts.getById("artifact-exported")).toBeDefined();
      expect(context.experiences.getById("exp-incognito")).toBeNull();
      expect(context.personalityInsights.getById("insight-incognito")).toBeUndefined();
      expect(context.agentNotes.listBySpace("space-main")).toHaveLength(0);
      expect(context.agentUsageSessions.listBySpace("space-main")).toHaveLength(0);
    } finally {
      context.db.close();
    }
  });
});
