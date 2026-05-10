import { describe, expect, test } from "bun:test";
import { initDatabase, VoiceUsageRepository } from "@spaceskit/persistence";
import { SpeechSessionService } from "../src/services/speech-session-service.js";
import { VoiceRoutingService } from "../src/services/voice-routing-service.js";
import { VoiceUsageLockService } from "../src/services/voice-usage-lock-service.js";

describe("SpeechSessionService", () => {
  test("derives deterministic UUID spaceUid when omitted", () => {
    const service = new SpeechSessionService({
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-1" }),
      } as any,
    });

    const first = service.startSession({
      spaceId: "main-space",
      sessionId: "speech-uid-1",
    });
    const second = service.startSession({
      spaceId: "main-space",
      sessionId: "speech-uid-2",
    });

    expect(first.spaceUid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(first.spaceUid).toBe(second.spaceUid);
    expect(first.spaceUid).not.toBe("main-space");
  });

  test("supports interrupt and resumes on next audio chunk", async () => {
    const turnInputs: string[] = [];
    const service = new SpeechSessionService({
      spaceManager: {
        executeTurn: async (_spaceId: string, input: string) => {
          turnInputs.push(input);
          return { turnId: "turn-1" };
        },
      } as any,
    });

    const started = service.startSession({
      spaceId: "main-space",
      sessionId: "speech-1",
      autoSubmitTurns: true,
    });
    expect(started.state).toBe("running");

    const interrupted = service.control({
      sessionId: "speech-1",
      command: "interrupt",
      reason: "barge-in",
    });
    expect(interrupted.state).toBe("interrupted");

    const events = await service.appendAudioChunk({
      sessionId: "speech-1",
      sequence: 1,
      audioBase64: "AAAA",
      transcriptText: "hello world",
      isFinal: true,
    });

    expect(events.length).toBe(2);
    expect(events[0].state).toBe("running");
    expect(events[1].eventType).toBe("transcript_final");
    expect(events[1].turnId).toBe("turn-1");
    expect(turnInputs).toEqual(["hello world"]);
  });

  test("propagates principal/device context to auto-submitted turns", async () => {
    const executeTurnCalls: Array<[string, string, string | undefined, any]> = [];
    const service = new SpeechSessionService({
      spaceManager: {
        executeTurn: async (
          spaceId: string,
          input: string,
          targetAgentId?: string,
          identity?: { principalId?: string; deviceId?: string },
        ) => {
          executeTurnCalls.push([spaceId, input, targetAgentId, identity]);
          return { turnId: "turn-auth" };
        },
      } as any,
    });

    service.startSession({
      spaceId: "main-space",
      sessionId: "speech-auth",
      principalId: "principal-1",
      deviceId: "device-1",
      autoSubmitTurns: true,
    });

    const events = await service.appendAudioChunk({
      sessionId: "speech-auth",
      sequence: 1,
      audioBase64: "AAAA",
      transcriptText: "secure note",
      isFinal: true,
    });

    expect(events.at(-1)?.turnId).toBe("turn-auth");
    expect(executeTurnCalls).toEqual([
      [
        "main-space",
        "secure note",
        undefined,
        { principalId: "principal-1", deviceId: "device-1" },
      ],
    ]);
  });

  test("rejects control commands after session end", () => {
    const service = new SpeechSessionService({
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-1" }),
      } as any,
    });

    service.startSession({
      spaceId: "main-space",
      sessionId: "speech-2",
    });
    const ended = service.control({
      sessionId: "speech-2",
      command: "end",
    });
    expect(ended.state).toBe("ended");

    expect(() => {
      service.control({
        sessionId: "speech-2",
        command: "stop",
      });
    }).toThrow("already ended");
  });

  test("falls back to local route when managed lock blocks start", () => {
    const service = new SpeechSessionService({
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-1" }),
      } as any,
      voiceRoutingService: new VoiceRoutingService(),
      voiceUsageLockService: {
        evaluate: () => ({ allowed: false }),
      } as any,
    });

    const started = service.startSession({
      spaceId: "main-space",
      sessionId: "speech-3",
      allowLocalFallback: true,
    });

    expect(started.providerSource).toBe("local_model");
    expect(started.fallbackReason).toBe("quota_fallback");
  });

  test("reroutes active session when managed lock is hit mid-stream", async () => {
    let evaluations = 0;
    const service = new SpeechSessionService({
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-1" }),
      } as any,
      voiceRoutingService: new VoiceRoutingService(),
      voiceUsageLockService: {
        evaluate: () => {
          evaluations += 1;
          return { allowed: evaluations === 1 };
        },
      } as any,
    });

    const started = service.startSession({
      spaceId: "main-space",
      sessionId: "speech-4",
      allowLocalFallback: true,
    });
    expect(started.providerSource).toBe("managed");

    const events = await service.appendAudioChunk({
      sessionId: "speech-4",
      sequence: 1,
      audioBase64: "AAAA",
      transcriptText: "hello",
      isFinal: false,
    });

    expect(events[0].eventType).toBe("session_rerouted");
    expect(events[0].providerSource).toBe("local_model");
    expect(events[1].eventType).toBe("transcript_segment");
    expect(events[1].providerSource).toBe("local_model");
  });

  test("reroutes to BYOK before local/apple when managed lock is hit", async () => {
    let evaluations = 0;
    const service = new SpeechSessionService({
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-1" }),
      } as any,
      voiceRoutingService: new VoiceRoutingService(),
      voiceUsageLockService: {
        evaluate: () => {
          evaluations += 1;
          return { allowed: evaluations === 1, reason: "daily_stt_seconds_exceeded" };
        },
      } as any,
    });

    const started = service.startSession({
      spaceId: "main-space",
      sessionId: "speech-byok-reroute",
      byokProviderId: "byok/openai-primary",
      localModelProviderId: "local/lmstudio",
      appleSpeechProviderId: "apple/native",
      allowByokFallback: true,
      allowLocalFallback: true,
      allowAppleSpeechFallback: true,
    });
    expect(started.providerSource).toBe("managed");

    const events = await service.appendAudioChunk({
      sessionId: "speech-byok-reroute",
      sequence: 1,
      audioBase64: "AAAA",
      transcriptText: "hello",
      isFinal: false,
    });

    expect(events[0].eventType).toBe("session_rerouted");
    expect(events[0].providerSource).toBe("byok");
    expect(events[0].providerId).toBe("byok/openai-primary");
    expect(events[0].fallbackReason).toBe("quota_fallback");
    expect(events[0].lockReason).toBe("daily_stt_seconds_exceeded");
  });

  test("uses deterministic fallback ladder on start: BYOK -> local -> apple", () => {
    const service = new SpeechSessionService({
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-1" }),
      } as any,
      voiceRoutingService: new VoiceRoutingService(),
      voiceUsageLockService: {
        evaluate: () => ({ allowed: false, reason: "daily_stt_seconds_exceeded" }),
      } as any,
    });

    const byok = service.startSession({
      spaceId: "main-space",
      sessionId: "speech-fallback-byok",
      byokProviderId: "byok/anthropic-primary",
      localModelProviderId: "local/lmstudio",
      appleSpeechProviderId: "apple/native",
      allowByokFallback: true,
      allowLocalFallback: true,
      allowAppleSpeechFallback: true,
    });
    expect(byok.providerSource).toBe("byok");
    expect(byok.providerId).toBe("byok/anthropic-primary");

    const local = service.startSession({
      spaceId: "main-space",
      sessionId: "speech-fallback-local",
      byokProviderId: "",
      localModelProviderId: "local/lmstudio",
      appleSpeechProviderId: "apple/native",
      allowByokFallback: true,
      allowLocalFallback: true,
      allowAppleSpeechFallback: true,
    });
    expect(local.providerSource).toBe("local_model");
    expect(local.providerId).toBe("local/lmstudio");

    const apple = service.startSession({
      spaceId: "main-space",
      sessionId: "speech-fallback-apple",
      allowByokFallback: false,
      allowLocalFallback: false,
      allowAppleSpeechFallback: true,
      appleSpeechProviderId: "apple/native",
    });
    expect(apple.providerSource).toBe("apple_speech");
    expect(apple.providerId).toBe("apple/native");
  });

  test("blocks start when managed lock is hit and no fallback route exists", () => {
    const service = new SpeechSessionService({
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-1" }),
      } as any,
      voiceRoutingService: new VoiceRoutingService(),
      voiceUsageLockService: {
        evaluate: () => ({ allowed: false }),
      } as any,
    });

    expect(() => {
      service.startSession({
        spaceId: "main-space",
        sessionId: "speech-5",
        allowByokFallback: false,
        allowLocalFallback: false,
        allowAppleSpeechFallback: false,
      });
    }).toThrow("No fallback voice route is available");
  });

  test("executeTurn timeout emits transcript_final with error reason", async () => {
    const service = new SpeechSessionService({
      spaceManager: {
        executeTurn: async () => new Promise<never>(() => {
          // never resolves
        }),
      } as any,
    });

    service.startSession({
      spaceId: "main-space",
      sessionId: "speech-timeout",
      autoSubmitTurns: true,
    });

    const events = await service.appendAudioChunk({
      sessionId: "speech-timeout",
      sequence: 1,
      audioBase64: "AAAA",
      transcriptText: "hello timeout",
      isFinal: true,
    });

    const final = events.find((e) => e.eventType === "transcript_final");
    expect(final).toBeDefined();
    expect(final!.turnId).toBeUndefined();
    expect(final!.reason).toContain("timed out");
    expect(final!.transcript).toBe("hello timeout");
  }, 35_000);

  test("executeTurn error emits transcript_final with error reason", async () => {
    const service = new SpeechSessionService({
      spaceManager: {
        executeTurn: async () => {
          throw new Error("provider unavailable");
        },
      } as any,
    });

    service.startSession({
      spaceId: "main-space",
      sessionId: "speech-error",
      autoSubmitTurns: true,
    });

    const events = await service.appendAudioChunk({
      sessionId: "speech-error",
      sequence: 1,
      audioBase64: "AAAA",
      transcriptText: "hello error",
      isFinal: true,
    });

    const final = events.find((e) => e.eventType === "transcript_final");
    expect(final).toBeDefined();
    expect(final!.turnId).toBeUndefined();
    expect(final!.reason).toBe("provider unavailable");
    expect(final!.transcript).toBe("hello error");
  });

  test("session continues accepting audio after executeTurn failure", async () => {
    let callCount = 0;
    const service = new SpeechSessionService({
      spaceManager: {
        executeTurn: async () => {
          callCount += 1;
          if (callCount === 1) {
            throw new Error("transient failure");
          }
          return { turnId: "turn-recovered" };
        },
      } as any,
    });

    service.startSession({
      spaceId: "main-space",
      sessionId: "speech-recover",
      autoSubmitTurns: true,
    });

    // First turn fails
    const firstEvents = await service.appendAudioChunk({
      sessionId: "speech-recover",
      sequence: 1,
      audioBase64: "AAAA",
      transcriptText: "first attempt",
      isFinal: true,
    });
    const firstFinal = firstEvents.find((e) => e.eventType === "transcript_final");
    expect(firstFinal!.turnId).toBeUndefined();
    expect(firstFinal!.reason).toBe("transient failure");

    // Session is still usable — send more audio (non-final)
    const secondEvents = await service.appendAudioChunk({
      sessionId: "speech-recover",
      sequence: 2,
      audioBase64: "BBBB",
      transcriptText: "second attempt",
      isFinal: false,
    });
    expect(secondEvents.length).toBeGreaterThan(0);
    expect(secondEvents[0].eventType).toBe("transcript_segment");
  });

  test("floating-point precision: many small chunks stay precise", async () => {
    const service = new SpeechSessionService({
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-1" }),
      } as any,
    });

    service.startSession({
      spaceId: "main-space",
      sessionId: "speech-fp",
      autoSubmitTurns: false,
    });

    const chunkCount = 1000;
    const chunkDuration = 0.000001; // 1 microsecond each
    let lastEvents: Awaited<ReturnType<typeof service.appendAudioChunk>> = [];

    for (let i = 0; i < chunkCount; i++) {
      lastEvents = await service.appendAudioChunk({
        sessionId: "speech-fp",
        sequence: i + 1,
        audioBase64: "AAAA",
        audioDurationSeconds: chunkDuration,
        ttsSeconds: chunkDuration,
        transcriptText: `seg-${i}`,
        isFinal: false,
      });
    }

    const usage = lastEvents.at(-1)!.usage!;
    // 1000 * 0.000001 = 0.001 exactly
    expect(usage.sttSeconds).toBe(0.001);
    expect(usage.ttsSeconds).toBe(0.001);
    // Verify no floating-point drift beyond 6 decimal places
    const sttStr = usage.sttSeconds.toString();
    const decimalPart = sttStr.split(".")[1] || "";
    expect(decimalPart.length).toBeLessThanOrEqual(6);
  });

  test("resets transcript buffer after each final turn", async () => {
    const service = new SpeechSessionService({
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-1" }),
      } as any,
    });

    service.startSession({
      spaceId: "main-space",
      sessionId: "speech-reset",
      autoSubmitTurns: false,
    });

    const firstEvents = await service.appendAudioChunk({
      sessionId: "speech-reset",
      sequence: 1,
      audioBase64: "AAAA",
      transcriptText: "first turn",
      isFinal: true,
    });
    expect(firstEvents.at(-1)?.transcript).toBe("first turn");

    const secondEvents = await service.appendAudioChunk({
      sessionId: "speech-reset",
      sequence: 2,
      audioBase64: "BBBB",
      transcriptText: "second turn",
      isFinal: true,
    });
    expect(secondEvents.at(-1)?.transcript).toBe("second turn");
  });

  test("attributes the quota-crossing STT chunk to managed before rerouting future chunks", async () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `speech-attribution-${crypto.randomUUID()}`,
    });
    const voiceUsageRepo = new VoiceUsageRepository(db.db);
    const voiceUsageLockService = new VoiceUsageLockService({
      usageRepo: voiceUsageRepo,
      loadPolicy: () => ({
        enabled: true,
        managedSttSecondsMonthlyLimit: 1,
      }),
    });

    const service = new SpeechSessionService({
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-1" }),
      } as any,
      voiceUsageRepo,
      voiceUsageLockService,
      voiceRoutingService: new VoiceRoutingService(),
    });

    try {
      const started = service.startSession({
        spaceId: "main-space",
        sessionId: "speech-attribution",
        allowLocalFallback: true,
      });
      expect(started.providerSource).toBe("managed");

      const firstEvents = await service.appendAudioChunk({
        sessionId: "speech-attribution",
        sequence: 1,
        audioBase64: "AAAA",
        audioDurationSeconds: 1.25,
        transcriptText: "hello one",
        isFinal: false,
      });
      expect(firstEvents[0]?.eventType).toBe("session_rerouted");
      expect(firstEvents[0]?.channel).toBe("stt");
      expect(firstEvents[0]?.providerSource).toBe("local_model");

      const secondEvents = await service.appendAudioChunk({
        sessionId: "speech-attribution",
        sequence: 2,
        audioBase64: "BBBB",
        audioDurationSeconds: 0.5,
        transcriptText: "hello two",
        isFinal: false,
      });
      expect(secondEvents[0]?.eventType).toBe("transcript_segment");
      expect(secondEvents[0]?.sttRoute?.source).toBe("local_model");

      const aggregates = voiceUsageRepo.aggregateByProviderChannel();
      const managedStt = aggregates.find((row) => row.channel === "stt" && row.source === "managed");
      const localStt = aggregates.find((row) => row.channel === "stt" && row.source === "local_model");
      expect(managedStt?.sttSeconds).toBe(1.25);
      expect(localStt?.sttSeconds).toBe(0.5);
    } finally {
      db.close();
    }
  });

  test("onTurnFailure callback fires when executeTurn fails", async () => {
    const failures: Array<{ sessionId: string; spaceId: string; err: unknown }> = [];
    const service = new SpeechSessionService({
      spaceManager: {
        executeTurn: async () => {
          throw new Error("provider unavailable");
        },
      } as any,
      onTurnFailure: (info) => {
        failures.push(info);
      },
    });

    service.startSession({
      spaceId: "main-space",
      sessionId: "speech-on-turn-failure",
      autoSubmitTurns: true,
    });

    await service.appendAudioChunk({
      sessionId: "speech-on-turn-failure",
      sequence: 1,
      audioBase64: "AAAA",
      transcriptText: "hello failure",
      isFinal: true,
    });

    expect(failures.length).toBe(1);
    expect(failures[0].sessionId).toBe("speech-on-turn-failure");
    expect(failures[0].spaceId).toBe("main-space");
    expect(failures[0].err).toBeInstanceOf(Error);
    expect((failures[0].err as Error).message).toBe("provider unavailable");
  });

  test("default (no onTurnFailure callback) does NOT write to console.error", async () => {
    const service = new SpeechSessionService({
      spaceManager: {
        executeTurn: async () => {
          throw new Error("provider unavailable");
        },
      } as any,
    });

    service.startSession({
      spaceId: "main-space",
      sessionId: "speech-default-silent",
      autoSubmitTurns: true,
    });

    const originalError = console.error;
    const errors: unknown[][] = [];
    console.error = ((...args: unknown[]) => {
      errors.push(args);
    }) as typeof console.error;

    try {
      await service.appendAudioChunk({
        sessionId: "speech-default-silent",
        sequence: 1,
        audioBase64: "AAAA",
        transcriptText: "hello silent",
        isFinal: true,
      });
    } finally {
      console.error = originalError;
    }

    expect(errors).toEqual([]);
  });

  test("reroutes TTS independently from STT when only managed TTS usage is locked", async () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `speech-tts-reroute-${crypto.randomUUID()}`,
    });
    const voiceUsageRepo = new VoiceUsageRepository(db.db);
    const voiceUsageLockService = new VoiceUsageLockService({
      usageRepo: voiceUsageRepo,
      loadPolicy: () => ({
        enabled: true,
        managedTtsCharsMonthlyLimit: 10,
      }),
    });

    const service = new SpeechSessionService({
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-1" }),
      } as any,
      voiceUsageRepo,
      voiceUsageLockService,
      voiceRoutingService: new VoiceRoutingService(),
    });

    try {
      service.startSession({
        spaceId: "main-space",
        sessionId: "speech-tts-reroute",
        allowLocalFallback: true,
        ttsAllowByokFallback: true,
        ttsByokProviderId: "byok/elevenlabs-voice",
      });

      const events = await service.appendAudioChunk({
        sessionId: "speech-tts-reroute",
        sequence: 1,
        audioBase64: "AAAA",
        audioDurationSeconds: 0.2,
        ttsChars: 20,
        ttsSeconds: 1.5,
        transcriptText: "hello",
        isFinal: false,
      });

      expect(events[0]?.eventType).toBe("session_rerouted");
      expect(events[0]?.channel).toBe("tts");
      expect(events[0]?.providerSource).toBe("byok");
      expect(events[0]?.sttRoute?.source).toBe("managed");
      expect(events[0]?.ttsRoute?.source).toBe("byok");
      expect(events[1]?.eventType).toBe("transcript_segment");
      expect(events[1]?.sttRoute?.source).toBe("managed");
      expect(events[1]?.ttsRoute?.source).toBe("byok");
    } finally {
      db.close();
    }
  });
});
