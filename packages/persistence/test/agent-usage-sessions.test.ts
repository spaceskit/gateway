import { afterEach, describe, expect, test } from "bun:test";
import { initDatabase } from "../src/database.js";
import { AgentUsageSessionRepository } from "../src/repositories/agent-usage-sessions.js";
import { SpaceRepository } from "../src/repositories/spaces.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
});

function createRepo() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-agent-usage-sessions-${crypto.randomUUID()}`,
  });
  dbManagers.push(db);

  const spaces = new SpaceRepository(db.db);
  spaces.create({
    spaceId: "space-main",
    resourceId: "resource:main",
    name: "Main Space",
    spaceType: "space",
    goal: "",
    turnModel: "sequential_all",
  });

  return {
    db,
    repo: new AgentUsageSessionRepository(db.db),
  };
}

describe("AgentUsageSessionRepository", () => {
  test("persists display titles and provider session handles on the active session", () => {
    const { repo } = createRepo();

    const created = repo.ensureActive({
      spaceId: "space-main",
      agentId: "agent-main",
      agentRole: "agent",
      nowIso: "2026-04-12T10:00:00.000Z",
    });

    expect(created.display_title).toBe("");
    expect(created.provider_session_handle_json).toBe("");

    const updated = repo.updateRuntimeMetadata({
      spaceId: "space-main",
      agentId: "agent-main",
      displayTitle: "Plan provider session reuse",
      providerSessionHandleJson: JSON.stringify({
        type: "codex_app_server_thread",
        threadId: "thread-123",
      }),
      nowIso: "2026-04-12T10:01:00.000Z",
    });

    expect(updated.display_title).toBe("Plan provider session reuse");
    expect(updated.provider_session_handle_json).toBe(JSON.stringify({
      type: "codex_app_server_thread",
      threadId: "thread-123",
    }));

    const touched = repo.touch("space-main", "agent-main", "2026-04-12T10:02:00.000Z");
    expect(touched.display_title).toBe("Plan provider session reuse");
    expect(touched.provider_session_handle_json).toContain("thread-123");
    expect(touched.agent_role).toBe("agent");

    const [listed] = repo.listBySpace("space-main");
    expect(listed?.display_title).toBe("Plan provider session reuse");
    expect(listed?.provider_session_handle_json).toContain("thread-123");
  });

  test("runtime metadata updates preserve the active session role", () => {
    const { repo } = createRepo();

    repo.ensureActive({
      spaceId: "space-main",
      agentId: "agent-main",
      agentRole: "space_moderator",
      nowIso: "2026-04-12T10:00:00.000Z",
    });

    const updated = repo.updateRuntimeMetadata({
      spaceId: "space-main",
      agentId: "agent-main",
      displayTitle: "Moderator title",
      nowIso: "2026-04-12T10:01:00.000Z",
    });

    expect(updated.agent_role).toBe("space_moderator");
    expect(updated.display_title).toBe("Moderator title");
  });

  test("resetActive closes the old titled provider session and starts with blank metadata", () => {
    const { repo } = createRepo();

    repo.ensureActive({
      spaceId: "space-main",
      agentId: "agent-main",
      nowIso: "2026-04-12T10:00:00.000Z",
    });
    const first = repo.updateRuntimeMetadata({
      spaceId: "space-main",
      agentId: "agent-main",
      displayTitle: "Existing session title",
      providerSessionHandleJson: JSON.stringify({
        type: "openai_response",
        previousResponseId: "resp_123",
      }),
      nowIso: "2026-04-12T10:01:00.000Z",
    });

    const reset = repo.resetActive({
      spaceId: "space-main",
      agentId: "agent-main",
      resetBy: "principal-user",
      nowIso: "2026-04-12T10:05:00.000Z",
    });

    expect(reset.closedSession?.session_id).toBe(first.session_id);
    expect(reset.closedSession?.display_title).toBe("Existing session title");
    expect(reset.closedSession?.provider_session_handle_json).toContain("resp_123");
    expect(reset.activeSession.session_id).not.toBe(first.session_id);
    expect(reset.activeSession.display_title).toBe("");
    expect(reset.activeSession.provider_session_handle_json).toBe("");
  });
});
