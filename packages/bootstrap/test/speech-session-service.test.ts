import { describe, expect, test } from "bun:test";
import { SpeechSessionService } from "../src/services/speech-session-service.js";
import { VoiceRoutingService } from "../src/services/voice-routing-service.js";

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
});
