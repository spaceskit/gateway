/**
 * SessionContinuityManager — resume spaces across reconnections.
 *
 * Manages space session state so clients can reconnect and resume
 * without losing context. Uses CheckpointManager for state persistence.
 */

import type { Checkpoint, CheckpointManager } from "./checkpoint.js";
import type { ModelMessage } from "../agents/model-provider.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContinuityMode = "stateless" | "session" | "persistent";

export interface SessionState {
  sessionId: string;
  spaceId: string;
  clientId: string;
  continuityMode: ContinuityMode;
  checkpointId?: string;
  contextSummary?: string;
  lastActivityAt: Date;
  pausedAt?: Date;
  status: "active" | "paused" | "expired";
}

export interface SessionContinuityOptions {
  checkpointManager?: CheckpointManager;
  /** Session expiry time in ms. Default: 24 hours. */
  sessionExpiryMs?: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class SessionContinuityManager {
  private sessions = new Map<string, SessionState>();
  private checkpointManager?: CheckpointManager;
  private sessionExpiryMs: number;

  constructor(options: SessionContinuityOptions = {}) {
    this.checkpointManager = options.checkpointManager;
    this.sessionExpiryMs = options.sessionExpiryMs ?? 24 * 60 * 60 * 1000;
  }

  /**
   * Create or resume a session for a space+client pair.
   */
  async getOrCreate(spaceId: string, clientId: string, mode: ContinuityMode = "session"): Promise<SessionState> {
    // Check for existing session
    const existing = this.findSession(spaceId, clientId);
    if (existing && existing.status !== "expired") {
      existing.lastActivityAt = new Date();
      if (existing.status === "paused") {
        existing.status = "active";
        existing.pausedAt = undefined;
      }
      return existing;
    }

    // Create new session
    const session: SessionState = {
      sessionId: `${spaceId}:${clientId}:${Date.now()}`,
      spaceId,
      clientId,
      continuityMode: mode,
      lastActivityAt: new Date(),
      status: "active",
    };

    this.sessions.set(session.sessionId, session);
    return session;
  }

  /**
   * Pause a session (client disconnecting).
   * When spaceState is provided and checkpoint manager is available,
   * the full agent state (including messages) is persisted.
   */
  async pause(
    spaceId: string,
    clientId: string,
    spaceState?: {
      agentStates: Record<string, { status: string; lastTurnId?: string; messages?: ModelMessage[] }>;
      turnIds: string[];
    },
  ): Promise<void> {
    const session = this.findSession(spaceId, clientId);
    if (!session) return;

    session.status = "paused";
    session.pausedAt = new Date();

    // Create checkpoint if manager available
    if (this.checkpointManager && session.continuityMode !== "stateless") {
      const checkpoint = await this.checkpointManager.save(spaceId, {
        stateJson: JSON.stringify({
          sessionId: session.sessionId,
          clientId: session.clientId,
          continuityMode: session.continuityMode,
        }),
        configJson: "{}",
        turnIds: spaceState?.turnIds ?? [],
        agentStates: spaceState?.agentStates ?? {},
        label: this.pauseLabel(clientId),
      });
      session.checkpointId = checkpoint.checkpointId;
    }
  }

  /**
   * Resume a paused session.
   */
  async resume(spaceId: string, clientId: string): Promise<SessionState | null> {
    let session: SessionState | null | undefined = this.findSession(spaceId, clientId);
    if (!session || session.status === "expired") {
      session = await this.hydrateSessionFromCheckpoint(spaceId, clientId);
    }
    if (!session || session.status === "expired") return null;

    // Check if session has expired
    if (this.isExpired(session)) {
      session.status = "expired";
      return null;
    }

    session.status = "active";
    session.lastActivityAt = new Date();
    session.pausedAt = undefined;

    return session;
  }

  /**
   * List all resumable sessions for a client.
   */
  async listResumable(clientId: string): Promise<SessionState[]> {
    this.cleanupExpired();
    const resumable = Array.from(this.sessions.values())
      .filter((s) => s.clientId === clientId && s.status === "paused" && !this.isExpired(s));
    const persisted = await this.listPersistedResumable(clientId);

    const bySpaceId = new Map<string, SessionState>();
    for (const session of resumable) {
      bySpaceId.set(session.spaceId, session);
    }
    for (const session of persisted) {
      const existing = bySpaceId.get(session.spaceId);
      if (!existing || existing.lastActivityAt.getTime() < session.lastActivityAt.getTime()) {
        bySpaceId.set(session.spaceId, session);
      }
    }

    return Array.from(bySpaceId.values()).sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
  }

  async loadCheckpoint(checkpointId: string): Promise<Checkpoint | null> {
    if (!this.checkpointManager) return null;
    return this.checkpointManager.load(checkpointId);
  }

  /**
   * Expire and clean up old sessions.
   */
  cleanupExpired(): number {
    let cleaned = 0;
    for (const [id, session] of this.sessions) {
      if (this.isExpired(session)) {
        session.status = "expired";
        this.sessions.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }

  private findSession(spaceId: string, clientId: string): SessionState | undefined {
    // Auto-cleanup expired sessions to prevent unbounded map growth
    if (this.sessions.size > 100) {
      this.cleanupExpired();
    }
    return Array.from(this.sessions.values())
      .find((s) => s.spaceId === spaceId && s.clientId === clientId && s.status !== "expired");
  }

  private isExpired(session: SessionState): boolean {
    const referenceTime = session.pausedAt ?? session.lastActivityAt;
    return Date.now() - referenceTime.getTime() > this.sessionExpiryMs;
  }

  private pauseLabel(clientId: string): string {
    return `session-pause:${clientId}`;
  }

  private listCheckpointManagerByLabel():
    | (CheckpointManager & {
      listByLabel: (label: string, limit?: number) => Promise<Checkpoint[]>;
    })
    | null {
    if (!this.checkpointManager) return null;
    const candidate = this.checkpointManager as CheckpointManager & {
      listByLabel?: (label: string, limit?: number) => Promise<Checkpoint[]>;
    };
    if (typeof candidate.listByLabel !== "function") return null;
    return candidate as CheckpointManager & {
      listByLabel: (label: string, limit?: number) => Promise<Checkpoint[]>;
    };
  }

  private async listPersistedResumable(clientId: string): Promise<SessionState[]> {
    const checkpointLookup = this.listCheckpointManagerByLabel();
    if (!checkpointLookup) return [];
    const checkpoints = await checkpointLookup.listByLabel(this.pauseLabel(clientId), 200);
    const sessions: SessionState[] = [];
    for (const checkpoint of checkpoints) {
      const hydrated = this.sessionFromCheckpoint(checkpoint, clientId);
      if (!hydrated || this.isExpired(hydrated)) continue;
      sessions.push(hydrated);
      // Keep the in-memory cache warm so resume can be O(1) after listing.
      const existing = this.sessions.get(hydrated.sessionId);
      if (!existing || existing.lastActivityAt.getTime() < hydrated.lastActivityAt.getTime()) {
        this.sessions.set(hydrated.sessionId, hydrated);
      }
    }
    return sessions;
  }

  private async hydrateSessionFromCheckpoint(spaceId: string, clientId: string): Promise<SessionState | null> {
    const checkpointLookup = this.listCheckpointManagerByLabel();
    if (!checkpointLookup) return null;
    const checkpoints = await checkpointLookup.listByLabel(this.pauseLabel(clientId), 200);
    for (const checkpoint of checkpoints) {
      if (checkpoint.spaceId !== spaceId) continue;
      const hydrated = this.sessionFromCheckpoint(checkpoint, clientId);
      if (!hydrated || this.isExpired(hydrated)) continue;
      this.sessions.set(hydrated.sessionId, hydrated);
      return hydrated;
    }
    return null;
  }

  private sessionFromCheckpoint(checkpoint: Checkpoint, clientId: string): SessionState | null {
    const parsed = this.parseStateJson(checkpoint.stateJson);
    const continuityMode = parsed.continuityMode === "stateless"
      || parsed.continuityMode === "session"
      || parsed.continuityMode === "persistent"
      ? parsed.continuityMode
      : "persistent";
    const checkpointClientId = typeof parsed.clientId === "string" && parsed.clientId.trim()
      ? parsed.clientId.trim()
      : clientId;
    if (checkpointClientId !== clientId) return null;
    const parsedSessionId = typeof parsed.sessionId === "string" ? parsed.sessionId.trim() : "";
    const sessionId = parsedSessionId || `${checkpoint.spaceId}:${clientId}:${checkpoint.createdAt.getTime()}`;
    return {
      sessionId,
      spaceId: checkpoint.spaceId,
      clientId,
      continuityMode,
      checkpointId: checkpoint.checkpointId,
      lastActivityAt: checkpoint.createdAt,
      pausedAt: checkpoint.createdAt,
      status: "paused",
    };
  }

  private parseStateJson(stateJson: string): {
    sessionId?: unknown;
    clientId?: unknown;
    continuityMode?: unknown;
  } {
    try {
      const parsed = JSON.parse(stateJson);
      if (parsed && typeof parsed === "object") {
        return parsed as { sessionId?: unknown; clientId?: unknown; continuityMode?: unknown };
      }
    } catch {
      // Ignore malformed checkpoint metadata and fall back to defaults.
    }
    return {};
  }
}
