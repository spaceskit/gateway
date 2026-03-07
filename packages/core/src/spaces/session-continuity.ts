/**
 * SessionContinuityManager — resume spaces across reconnections.
 *
 * Manages space session state so clients can reconnect and resume
 * without losing context. Uses CheckpointManager for state persistence.
 */

import type { CheckpointManager } from "./checkpoint.js";

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
   */
  async pause(spaceId: string, clientId: string): Promise<void> {
    const session = this.findSession(spaceId, clientId);
    if (!session) return;

    session.status = "paused";
    session.pausedAt = new Date();

    // Create checkpoint if manager available
    if (this.checkpointManager && session.continuityMode !== "stateless") {
      const checkpoint = await this.checkpointManager.save(spaceId, {
        stateJson: JSON.stringify({ sessionId: session.sessionId }),
        configJson: "{}",
        turnIds: [],
        agentStates: {},
        label: `session-pause:${clientId}`,
      });
      session.checkpointId = checkpoint.checkpointId;
    }
  }

  /**
   * Resume a paused session.
   */
  async resume(spaceId: string, clientId: string): Promise<SessionState | null> {
    const session = this.findSession(spaceId, clientId);
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
    return Array.from(this.sessions.values())
      .filter((s) => s.clientId === clientId && s.status === "paused" && !this.isExpired(s));
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
}
