import { describe, expect, test } from "bun:test";
import { MessageRouter } from "../src/message-router.js";
import { MessageTypes, type GatewayMessage } from "../src/protocol.js";

const ConciergeMessageTypes = {
  start: MessageTypes.CONCIERGE_CALL_START,
  answer: MessageTypes.CONCIERGE_CALL_ANSWER,
  end: MessageTypes.CONCIERGE_CALL_END,
  setMuted: MessageTypes.CONCIERGE_CALL_SET_MUTED,
  audioChunk: MessageTypes.CONCIERGE_CALL_AUDIO_CHUNK,
  control: MessageTypes.CONCIERGE_CALL_CONTROL,
  registerPush: MessageTypes.CONCIERGE_CALL_REGISTER_PUSH,
} as const;

function makeClient(overrides: Record<string, unknown> = {}): any {
  return {
    id: "client-concierge-call-test",
    authenticated: true,
    clientType: "sdk",
    publicKey: "principal-concierge",
    deviceId: "device-concierge",
    subscribedSpaces: new Set<string>(),
    connectedAt: new Date(),
    ...overrides,
  };
}

function makeMessage<T>(type: string, payload: T): GatewayMessage<T> {
  return {
    type,
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    payload,
  };
}

function makeRouter(): MessageRouter {
  const logger: any = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };

  return new MessageRouter({
    spaceManager: {
      executeTurn: async () => ({ turnId: "turn-1" }),
      resumeFeedback: async () => {},
    } as any,
    capabilities: {
      invoke: async () => ({ ok: true }),
      register: () => {},
      deregister: () => {},
    } as any,
    conciergeCallRuntimeService: {
      startCall: (payload: any) => ({
        callId: payload.callId,
        state: "connecting",
        platform: payload.platform,
        deviceId: payload.deviceId,
        displayName: payload.displayName ?? "Spaces Concierge",
        ttsMode: payload.ttsMode ?? "apple_native",
        muted: false,
        reason: "call_started",
        metrics: {
          callSetupMs: 0,
          routeChangeCount: 0,
          handoffCount: 0,
          providerFallbackCount: 0,
          interruptCount: 0,
          playbackUnderrunCount: 0,
          reconnectCount: 0,
        },
        ts: new Date().toISOString(),
      }),
      answerCall: (payload: any) => ({
        callId: payload.callId,
        state: "active",
        platform: payload.platform ?? "iphone",
        deviceId: payload.deviceId,
        displayName: "Spaces Concierge",
        ttsMode: "apple_native",
        muted: false,
        reason: "call_answered",
        metrics: {
          callSetupMs: 10,
          routeChangeCount: 0,
          handoffCount: 0,
          providerFallbackCount: 0,
          interruptCount: 0,
          playbackUnderrunCount: 0,
          reconnectCount: 0,
        },
        ts: new Date().toISOString(),
      }),
      endCall: (payload: any) => ({
        callId: payload.callId,
        state: "ended",
        platform: "iphone",
        deviceId: "device-concierge",
        displayName: "Spaces Concierge",
        ttsMode: "apple_native",
        muted: false,
        reason: payload.reason ?? "call_ended",
        metrics: {
          callSetupMs: 10,
          routeChangeCount: 0,
          handoffCount: 0,
          providerFallbackCount: 0,
          interruptCount: 0,
          playbackUnderrunCount: 0,
          reconnectCount: 0,
        },
        ts: new Date().toISOString(),
      }),
      setMuted: (payload: any) => ({
        callId: payload.callId,
        state: "active",
        platform: "iphone",
        deviceId: "device-concierge",
        displayName: "Spaces Concierge",
        ttsMode: "apple_native",
        muted: Boolean(payload.muted),
        reason: payload.muted ? "muted" : "unmuted",
        metrics: {
          callSetupMs: 10,
          routeChangeCount: 0,
          handoffCount: 0,
          providerFallbackCount: 0,
          interruptCount: 0,
          playbackUnderrunCount: 0,
          reconnectCount: 0,
        },
        ts: new Date().toISOString(),
      }),
      appendAudioChunk: (payload: any) => ({
        events: [
          {
            callId: payload.callId,
            state: "active",
            platform: "iphone",
            deviceId: "device-concierge",
            displayName: "Spaces Concierge",
            ttsMode: "apple_native",
            muted: false,
            transcriptDelta: payload.transcriptText,
            transcriptFinal: payload.isFinal,
            mediaEventType: payload.isFinal ? "transcript_final" : "transcript_partial",
            sequence: payload.sequence,
            metrics: {
              callSetupMs: 10,
              sttFirstPartialMs: 5,
              routeChangeCount: 0,
              handoffCount: 0,
              providerFallbackCount: 0,
              interruptCount: 0,
              playbackUnderrunCount: 0,
              reconnectCount: 0,
            },
            reason: payload.isFinal ? "user_transcript_final" : "user_transcript_partial",
            ts: new Date().toISOString(),
          },
        ],
      }),
      control: (payload: any) => ({
        callId: payload.callId,
        state: "active",
        platform: "iphone",
        deviceId: "device-concierge",
        displayName: "Spaces Concierge",
        ttsMode: "apple_native",
        muted: false,
        mediaEventType: "interrupted",
        reason: payload.reason ?? "user_interrupt",
        metrics: {
          callSetupMs: 10,
          routeChangeCount: 0,
          handoffCount: 0,
          providerFallbackCount: 0,
          interruptCount: 1,
          playbackUnderrunCount: 0,
          reconnectCount: 0,
        },
        ts: new Date().toISOString(),
      }),
      prepareHandoff: (_payload: any) => ({
        event: {
          callId: "call-1",
          state: "active",
          platform: "iphone",
          deviceId: "device-concierge",
          displayName: "Spaces Concierge",
          ttsMode: "apple_native",
          muted: false,
          reason: "handoff_prepared",
          ts: new Date().toISOString(),
        },
        handoffToken: {
          token: "handoff-1",
          callId: "call-1",
          destinationPlatform: "macos",
          expiresAt: new Date().toISOString(),
          signature: "sig-1",
        },
      }),
      acceptHandoff: (_payload: any) => ({
        callId: "call-1",
        state: "active",
        platform: "macos",
        deviceId: "device-concierge",
        displayName: "Spaces Concierge",
        ttsMode: "apple_native",
        muted: false,
        reason: "handoff_accepted",
        ts: new Date().toISOString(),
      }),
      registerPush: (payload: any) => ({
        principalId: "principal-concierge",
        deviceId: payload.deviceId,
        platform: payload.platform,
        pushToken: payload.pushToken,
        proactiveOptIn: Boolean(payload.proactiveOptIn),
        registeredAt: new Date().toISOString(),
      }),
    } as any,
    logger,
  });
}

describe("MessageRouter concierge call handlers", () => {
  test("routes concierge.call lifecycle messages and returns structured event payloads", async () => {
    const router = makeRouter();
    const client = makeClient();

    const startResponse = await router.handle(
      client,
      makeMessage(ConciergeMessageTypes.start, {
        callId: "call-1",
        platform: "iphone",
        ttsMode: "apple_native",
        displayName: "Spaces Concierge",
      }),
    );
    expect(startResponse?.type).toBe(ConciergeMessageTypes.start);
    expect((startResponse?.payload as any).event.callId).toBe("call-1");
    expect((startResponse?.payload as any).event.state).toBe("connecting");

    const answerResponse = await router.handle(
      client,
      makeMessage(ConciergeMessageTypes.answer, {
        callId: "call-1",
        platform: "iphone",
      }),
    );
    expect(answerResponse?.type).toBe(ConciergeMessageTypes.answer);
    expect((answerResponse?.payload as any).event.state).toBe("active");

    const mutedResponse = await router.handle(
      client,
      makeMessage(ConciergeMessageTypes.setMuted, {
        callId: "call-1",
        muted: true,
      }),
    );
    expect(mutedResponse?.type).toBe(ConciergeMessageTypes.setMuted);
    expect((mutedResponse?.payload as any).event.muted).toBe(true);

    const endResponse = await router.handle(
      client,
      makeMessage(ConciergeMessageTypes.end, {
        callId: "call-1",
        reason: "user_hangup",
      }),
    );
    expect(endResponse?.type).toBe(ConciergeMessageTypes.end);
    expect((endResponse?.payload as any).event.state).toBe("ended");
    expect((endResponse?.payload as any).event.reason).toBe("user_hangup");
  });

  test("routes concierge.call.register_push and falls back to authenticated client deviceId", async () => {
    const router = makeRouter();
    const client = makeClient({ deviceId: "device-from-client" });

    const response = await router.handle(
      client,
      makeMessage(ConciergeMessageTypes.registerPush, {
        platform: "iphone",
        pushToken: "push-token-1",
        proactiveOptIn: true,
      }),
    );

    expect(response?.type).toBe(ConciergeMessageTypes.registerPush);
    expect((response?.payload as any).registration.deviceId).toBe("device-from-client");
    expect((response?.payload as any).registration.platform).toBe("iphone");
    expect((response?.payload as any).registration.pushToken).toBe("push-token-1");
    expect((response?.payload as any).registration.proactiveOptIn).toBe(true);
  });

  test("routes concierge.call.audio_chunk and returns transcript events", async () => {
    const router = makeRouter();
    const client = makeClient();

    const response = await router.handle(
      client,
      makeMessage(ConciergeMessageTypes.audioChunk, {
        callId: "call-1",
        sequence: 1,
        audioBase64: "AAAA",
        transcriptText: "Open the concierge dashboard",
        isFinal: true,
      }),
    );

    expect(response?.type).toBe(ConciergeMessageTypes.audioChunk);
    expect((response?.payload as any).events).toHaveLength(1);
    expect((response?.payload as any).events[0].transcriptDelta).toBe("Open the concierge dashboard");
    expect((response?.payload as any).events[0].mediaEventType).toBe("transcript_final");
  });

  test("routes concierge.call.control interrupt messages", async () => {
    const router = makeRouter();
    const client = makeClient();

    const response = await router.handle(
      client,
      makeMessage(ConciergeMessageTypes.control, {
        callId: "call-1",
        command: "interrupt",
        reason: "user_interrupt",
      }),
    );

    expect(response?.type).toBe(ConciergeMessageTypes.control);
    expect((response?.payload as any).event.mediaEventType).toBe("interrupted");
    expect((response?.payload as any).event.reason).toBe("user_interrupt");
  });

  test("routes concierge.call.answer through the concierge runtime service", async () => {
    const router = makeRouter();
    const client = makeClient();

    const response = await router.handle(
      client,
      makeMessage(ConciergeMessageTypes.answer, {
        callId: "missing-call",
      }),
    );

    expect(response?.type).toBe(ConciergeMessageTypes.answer);
    expect((response?.payload as any).event.state).toBe("active");
  });
});
