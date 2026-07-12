import { describe, expect, test } from "bun:test";
import type { GatewayMessage } from "../src/protocol.js";
import { MessageTypes } from "../src/protocol.js";
import type { AgentPresenceSnapshotPayload } from "../src/protocol/agent-presence.js";
import {
  AGENT_PRESENCE_TOPIC,
  AgentPresenceSourceService,
} from "../src/services/agent-presence-source.js";

interface RecordingLogger {
  warns: Array<{ message: string; details?: Record<string, unknown> }>;
  infos: Array<{ message: string; details?: Record<string, unknown> }>;
  warn(message: string, details?: Record<string, unknown>): void;
  info(message: string, details?: Record<string, unknown>): void;
}

function recordingLogger(): RecordingLogger {
  const warns: RecordingLogger["warns"] = [];
  const infos: RecordingLogger["infos"] = [];
  return {
    warns,
    infos,
    warn: (message, details) => { warns.push({ message, details }); },
    info: (message, details) => { infos.push({ message, details }); },
  };
}

function body(agents: unknown[], generatedAt = "2026-06-29T12:00:00.000Z") {
  return { generatedAt, total: agents.length, agents };
}

const claudeRow = {
  key: "claude:s1",
  provider: "claude",
  sessionId: "s1",
  cwd: "/x",
  status: "turn-end",
  summary: "your move",
  hash: "h1",
  at: 1.5,
  live: true,
};

/** Capture per-client pushes (clientId -> messages). */
function recorder() {
  const sends: Array<{ clientId: string; msg: GatewayMessage }> = [];
  return { sends, send: (clientId: string, msg: GatewayMessage) => { sends.push({ clientId, msg }); } };
}

describe("AgentPresenceSourceService", () => {
  test("exposes the gateway-wide topic and an empty snapshot before any poll", async () => {
    const service = new AgentPresenceSourceService({ fetchSnapshot: async () => body([]) });
    expect(service.topic).toBe(AGENT_PRESENCE_TOPIC);
    expect(AGENT_PRESENCE_TOPIC).toBe("agent-presence");
    expect(await service.getSnapshot()).toEqual({ agents: [], generatedAt: 0 });
  });

  test("runOnce caches the mapped snapshot and pushes the full set to subscribers", async () => {
    const rec = recorder();
    const service = new AgentPresenceSourceService({ fetchSnapshot: async () => body([claudeRow]) });
    service.subscribe("client-A");
    service.subscribe("client-B");
    // Bind the delivery fn the way server-phase does, without running the timer.
    (service as unknown as { send: typeof rec.send }).send = rec.send;

    await service.runOnce();

    const snapshot: AgentPresenceSnapshotPayload = await service.getSnapshot();
    expect(snapshot.agents).toHaveLength(1);
    expect(snapshot.agents[0]!.provider).toBe("claude");
    expect(snapshot.agents[0]!.status).toBe("turn_end");
    expect(snapshot.generatedAt).toBe(Date.parse("2026-06-29T12:00:00.000Z"));

    // Full snapshot delivered to BOTH subscribers on the AGENT_PRESENCE_UPDATED type.
    expect(rec.sends.map((s) => s.clientId).sort()).toEqual(["client-A", "client-B"]);
    expect(rec.sends[0]!.msg.type).toBe(MessageTypes.AGENT_PRESENCE_UPDATED);
    const payload = rec.sends[0]!.msg.payload as AgentPresenceSnapshotPayload;
    expect(payload.agents).toHaveLength(1);
  });

  test("does not re-push when the waiting set is unchanged (at jitter ignored)", async () => {
    const rec = recorder();
    let at = 1.5;
    const service = new AgentPresenceSourceService({
      fetchSnapshot: async () => body([{ ...claudeRow, at: (at += 1) }], new Date().toISOString()),
    });
    service.subscribe("c1");
    (service as unknown as { send: typeof rec.send }).send = rec.send;

    await service.runOnce();
    await service.runOnce();
    await service.runOnce();

    expect(rec.sends).toHaveLength(1);
  });

  test("re-pushes when the waiting state changes (new hash)", async () => {
    const rec = recorder();
    let hash = "h1";
    const service = new AgentPresenceSourceService({ fetchSnapshot: async () => body([{ ...claudeRow, hash }]) });
    service.subscribe("c1");
    (service as unknown as { send: typeof rec.send }).send = rec.send;

    await service.runOnce();
    hash = "h2";
    await service.runOnce();

    expect(rec.sends).toHaveLength(2);
  });

  test("unsubscribe stops further pushes to that client", async () => {
    const rec = recorder();
    let hash = "h1";
    const service = new AgentPresenceSourceService({ fetchSnapshot: async () => body([{ ...claudeRow, hash }]) });
    service.subscribe("c1");
    (service as unknown as { send: typeof rec.send }).send = rec.send;

    await service.runOnce();
    service.unsubscribe("c1");
    hash = "h2";
    await service.runOnce();

    expect(rec.sends.map((s) => s.clientId)).toEqual(["c1"]);
  });

  test("degrades to an empty snapshot when infra-pulse is unreachable, without throwing", async () => {
    const logger = recordingLogger();
    const service = new AgentPresenceSourceService({
      logger,
      fetchSnapshot: async () => { throw new Error("ECONNREFUSED 127.0.0.1:9091"); },
    });

    // Must resolve, not reject.
    await service.runOnce();

    expect((await service.getSnapshot()).agents).toEqual([]);
    expect(logger.warns).toHaveLength(1);
    expect(logger.warns[0]!.message).toContain("unreachable");
  });

  test("debounces the failure log across a streak, then logs recovery once", async () => {
    const logger = recordingLogger();
    let healthy = false;
    const service = new AgentPresenceSourceService({
      logger,
      fetchSnapshot: async () => {
        if (!healthy) throw new Error("down");
        return body([claudeRow]);
      },
    });

    await service.runOnce();
    await service.runOnce();
    await service.runOnce();
    expect(logger.warns).toHaveLength(1);

    healthy = true;
    await service.runOnce();
    expect(logger.infos.some((e) => e.message.includes("recovered"))).toBe(true);
  });

  test("a transient failure after a good snapshot clears the board (no stale rows)", async () => {
    const rec = recorder();
    let healthy = true;
    const service = new AgentPresenceSourceService({
      fetchSnapshot: async () => {
        if (!healthy) throw new Error("down");
        return body([claudeRow]);
      },
    });
    service.subscribe("c1");
    (service as unknown as { send: typeof rec.send }).send = rec.send;

    await service.runOnce();
    expect((await service.getSnapshot()).agents).toHaveLength(1);

    healthy = false;
    await service.runOnce();
    expect((await service.getSnapshot()).agents).toEqual([]);
    // 1 row -> 0 rows is a real change, so a second push clears the prior ping.
    expect(rec.sends).toHaveLength(2);
  });

  test("stop() unbinds delivery so a post-stop poll does not push even on a real change", async () => {
    const rec = recorder();
    let hash = "h1";
    const service = new AgentPresenceSourceService({ fetchSnapshot: async () => body([{ ...claudeRow, hash }]) });
    service.subscribe("c1");
    (service as unknown as { send: typeof rec.send }).send = rec.send;

    await service.runOnce();
    expect(rec.sends).toHaveLength(1);

    service.stop();
    rec.sends.length = 0;
    hash = "h2"; // a genuine change that WOULD push if delivery were still bound
    await service.runOnce();
    expect(rec.sends).toHaveLength(0);
  });
});
