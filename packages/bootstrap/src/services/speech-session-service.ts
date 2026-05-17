import { randomUUID } from "node:crypto";
import { normalizeOrDeterministicUuid } from "../utils/uuid.js";
import { buildSpeechSessionEvent } from "./speech-session-events.js";
import {
  buildChunkUsageDelta,
  cloneRoutes,
  emptyUsageByChannel,
  emptyUsageMetrics,
  normalizeEngineMetrics,
} from "./speech-session-normalizers.js";
import {
  buildRoutePreferences,
  ensureVoiceRoutesForNextChunk,
  resolveInitialRoutes,
} from "./speech-session-routing.js";
import { SpeechSessionError } from "./speech-session-types.js";
import type {
  SpeechAudioChunkInput,
  SpeechControlInput,
  SpeechSessionEvent,
  SpeechSessionRecord,
  SpeechSessionServiceOptions,
  StartSpeechSessionInput,
} from "./speech-session-types.js";
import { applyUsageDelta, recordUsageForChunk } from "./speech-session-usage.js";

export { SpeechSessionError } from "./speech-session-types.js";
export type {
  SpeechAudioChunkInput,
  SpeechControlCommand,
  SpeechControlInput,
  SpeechEngineLatencyMetrics,
  SpeechFallbackEvent,
  SpeechLockDecisionPayload,
  SpeechProviderConfigPayload,
  SpeechRouteSet,
  SpeechRouteState,
  SpeechSessionEvent,
  SpeechSessionServiceOptions,
  SpeechSessionState,
  SpeechSessionUsageMetrics,
  SpeechUsageByChannel,
  StartSpeechSessionInput,
} from "./speech-session-types.js";

export class SpeechSessionService {
  private readonly sessions = new Map<string, SpeechSessionRecord>();
  private readonly now: () => Date;

  constructor(private readonly options: SpeechSessionServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  startSession(input: StartSpeechSessionInput): SpeechSessionEvent {
    const spaceId = input.spaceId.trim();
    if (!spaceId) {
      throw new SpeechSessionError("INVALID_ARGUMENT", "spaceId is required");
    }
    const spaceUid = normalizeOrDeterministicUuid(input.spaceUid, spaceId, "spaceskit.space.uuid");

    const sessionId = input.sessionId?.trim() || `speech-${randomUUID()}`;
    const now = this.now().toISOString();
    const existing = this.sessions.get(sessionId);

    const routePreferences = buildRoutePreferences(input, this.options.defaultVoiceRoute ?? {});
    const initialRoutes = resolveInitialRoutes(routePreferences, {
      voiceRoutingService: this.options.voiceRoutingService,
      voiceUsageLockService: this.options.voiceUsageLockService,
    });

    if (!initialRoutes.allowed || !initialRoutes.routes) {
      throw new SpeechSessionError(
        "FAILED_PRECONDITION",
        initialRoutes.message || "Voice route unavailable for requested session",
      );
    }

    if (existing && existing.state !== "ended") {
      existing.state = "running";
      existing.spaceUid = spaceUid;
      existing.updatedAt = now;
      existing.principalId = input.principalId?.trim() || undefined;
      existing.deviceId = input.deviceId?.trim() || undefined;
      existing.routes = cloneRoutes(initialRoutes.routes);
      existing.routePreferences = routePreferences;
      return this.event(existing, "session_started", {
        fallbackReason: initialRoutes.fallbackReason,
      });
    }

    const session: SpeechSessionRecord = {
      sessionId,
      spaceId,
      spaceUid,
      agentId: input.agentId?.trim() || undefined,
      principalId: input.principalId?.trim() || undefined,
      deviceId: input.deviceId?.trim() || undefined,
      state: "running",
      sequence: 0,
      transcriptSegments: [],
      autoSubmitTurns: input.autoSubmitTurns !== false,
      routePreferences,
      routes: cloneRoutes(initialRoutes.routes),
      usage: emptyUsageMetrics(),
      usageByChannel: emptyUsageByChannel(),
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(sessionId, session);
    return this.event(session, "session_started", {
      fallbackReason: initialRoutes.fallbackReason,
    });
  }

  async appendAudioChunk(input: SpeechAudioChunkInput): Promise<SpeechSessionEvent[]> {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      throw new SpeechSessionError("NOT_FOUND", `Speech session not found: ${input.sessionId}`);
    }
    if (
      session.state !== "running"
      && session.state !== "stopped"
      && session.state !== "interrupted"
    ) {
      throw new SpeechSessionError(
        "FAILED_PRECONDITION",
        `Cannot accept audio in state: ${session.state}`,
      );
    }

    const sequence = Number.isFinite(input.sequence)
      ? input.sequence
      : Number.isFinite(input.sequenceNo)
        ? input.sequenceNo as number
        : NaN;
    if (!Number.isFinite(sequence)) {
      throw new SpeechSessionError("INVALID_ARGUMENT", "sequence is required");
    }

    if (!input.audioBase64?.trim()) {
      throw new SpeechSessionError("INVALID_ARGUMENT", "audioBase64 is required");
    }

    if (session.state === "stopped" || session.state === "interrupted") {
      session.state = "running";
    }

    session.sequence = Math.max(session.sequence, sequence);
    session.updatedAt = this.now().toISOString();

    const delta = buildChunkUsageDelta(input);
    const engineMetrics = normalizeEngineMetrics(input);

    const attributedRoutes = cloneRoutes(session.routes);
    recordUsageForChunk(
      this.options.voiceUsageRepo,
      session,
      attributedRoutes,
      delta,
      sequence,
      input.isFinal === true,
      engineMetrics,
    );
    applyUsageDelta(session, delta);

    const rerouteEvents = ensureVoiceRoutesForNextChunk(session, {
      voiceRoutingService: this.options.voiceRoutingService,
      voiceUsageLockService: this.options.voiceUsageLockService,
      now: this.now,
      createEvent: (eventSession, eventType, extras) => this.event(eventSession, eventType, extras),
    });

    const segment = input.transcriptText?.trim() || `segment-${sequence}`;
    session.transcriptSegments.push(segment);

    const events: SpeechSessionEvent[] = [
      ...rerouteEvents,
      this.event(session, "transcript_segment", {
        transcript: segment,
        sequence,
        engineMetrics,
      }),
    ];

    if (input.isFinal) {
      const transcript = session.transcriptSegments.join(" ").trim();
      let turnId: string | undefined;
      let turnError: string | undefined;
      if (session.autoSubmitTurns && transcript.length > 0) {
        const executionIdentity = session.principalId || session.deviceId
          ? {
            principalId: session.principalId,
            deviceId: session.deviceId,
          }
          : undefined;
        try {
          const timeoutMs = 30_000;
          const timeoutPromise = new Promise<never>((_resolve, reject) => {
            setTimeout(() => reject(new Error("executeTurn timed out after 30s")), timeoutMs);
          });
          const result = await Promise.race([
            this.options.spaceManager.executeTurn(
              session.spaceId,
              transcript,
              session.agentId,
              executionIdentity,
            ),
            timeoutPromise,
          ]);
          turnId = result.turnId;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          turnError = message;
          this.options.onTurnFailure?.({
            sessionId: session.sessionId,
            spaceId: session.spaceId,
            err: error,
          });
        }
      }

      events.push(this.event(session, "transcript_final", {
        transcript,
        turnId,
        sequence,
        ...(turnError ? { reason: turnError } : {}),
        engineMetrics,
      }));
      session.transcriptSegments = [];
    }

    return events;
  }

  control(input: SpeechControlInput): SpeechSessionEvent {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      throw new SpeechSessionError("NOT_FOUND", `Speech session not found: ${input.sessionId}`);
    }

    if (session.state === "ended" && input.command !== "end") {
      throw new SpeechSessionError("FAILED_PRECONDITION", "Speech session already ended");
    }

    switch (input.command) {
      case "stop":
        session.state = "stopped";
        break;
      case "interrupt":
        session.state = "interrupted";
        break;
      case "end":
        session.state = "ended";
        break;
      default:
        throw new SpeechSessionError("INVALID_ARGUMENT", `Unsupported command: ${input.command}`);
    }
    session.updatedAt = this.now().toISOString();

    return this.event(session, "session_control", {
      reason: input.reason,
    });
  }

  getSession(sessionId: string): SpeechSessionEvent | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return this.event(session, "session_state");
  }

  private event(
    session: SpeechSessionRecord,
    eventType: string,
    extras: Partial<SpeechSessionEvent> = {},
  ): SpeechSessionEvent {
    return buildSpeechSessionEvent(session, eventType, extras, {
      now: this.now,
      voiceProviderConfigRepo: this.options.voiceProviderConfigRepo,
    });
  }
}
