import { describe, expect, test } from "bun:test";
import { MessageTypes, type GatewayMessage, type SpeechEventPayload } from "../src/protocol.js";
import { makeClient, makeMessage, makeRouter } from "./message-router.feature-flows-test-helpers.js";

describe("MessageRouter feature handlers", () => {
  test("routes sync announce/query/pull", async () => {
    const router = makeRouter({
      gatewaySyncService: {
        announcePeer: () => ({
          peerId: "peer-1",
          resourceId: "resource-main",
          gatewayVersion: "v1",
          syncEnabled: true,
          announcedAt: new Date().toISOString(),
          apiVersion: "v2",
        }),
        queryResources: () => ({
          resources: [],
          nextCursor: undefined,
          apiVersion: "v2",
        }),
        pullResources: () => ({
          resources: [],
          denied: [],
          provenance: [],
          appliedCount: 0,
          skippedCount: 0,
          apiVersion: "v2",
        }),
      },
    });

    const announceResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SYNC_ANNOUNCE, {
        peerId: "peer-1",
        resourceId: "resource-main",
        gatewayVersion: "v1",
      }),
    );
    expect(announceResponse?.type).toBe(MessageTypes.SYNC_ANNOUNCE);

    const queryResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SYNC_QUERY_RESOURCES, {
        peerId: "peer-1",
      }),
    );
    expect(queryResponse?.type).toBe(MessageTypes.SYNC_QUERY_RESOURCES);

    const pullResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SYNC_PULL_RESOURCES, {
        peerId: "peer-1",
        idempotencyKey: "idem-1",
        refs: [],
      }),
    );
    expect(pullResponse?.type).toBe(MessageTypes.SYNC_PULL_RESOURCES);
  });

  test("routes speech session lifecycle and emits speech.event broadcast", async () => {
    const broadcasts: GatewayMessage[] = [];
    let startInput: any;
    const router = makeRouter({
      speechSessionService: {
        startSession: (input: any) => {
          startInput = input;
          return {
            sessionId: "speech-1",
            spaceId: "main-space",
            state: "running",
            eventType: "session_started",
            ts: new Date().toISOString(),
          };
        },
        appendAudioChunk: async () => [{
          sessionId: "speech-1",
          spaceId: "main-space",
          state: "running",
          eventType: "transcript_segment",
          transcript: "hello",
          sequence: 1,
          ts: new Date().toISOString(),
        }],
        control: () => ({
          sessionId: "speech-1",
          spaceId: "main-space",
          state: "ended",
          eventType: "session_control",
          reason: "done",
          ts: new Date().toISOString(),
        }),
      },
      broadcastToSpace: (_spaceId: string, message: GatewayMessage) => {
        broadcasts.push(message);
      },
    });

    const startResponse = await router.handle(
      makeClient({ publicKey: "principal-1", deviceId: "device-1" }),
      makeMessage(MessageTypes.SPEECH_START, {
        spaceId: "main-space",
      }),
    );
    expect(startResponse?.type).toBe(MessageTypes.SPEECH_START);
    expect(startInput.principalId).toBe("principal-1");
    expect(startInput.deviceId).toBe("device-1");

    const chunkResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPEECH_AUDIO_CHUNK, {
        sessionId: "speech-1",
        sequence: 1,
        audioBase64: "AAAA",
      }),
    );
    expect(chunkResponse?.type).toBe(MessageTypes.SPEECH_AUDIO_CHUNK);

    const controlResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPEECH_CONTROL, {
        sessionId: "speech-1",
        command: "end",
      }),
    );
    expect(controlResponse?.type).toBe(MessageTypes.SPEECH_CONTROL);
    expect(broadcasts.some((msg) => msg.type === MessageTypes.SPEECH_EVENT)).toBe(true);
    const speechBroadcast = broadcasts.find((msg) => {
      if (msg.type !== MessageTypes.SPEECH_EVENT) return false;
      const payload = msg.payload as SpeechEventPayload;
      return payload.eventType === "transcript_segment";
    });
    const payload = speechBroadcast?.payload as SpeechEventPayload | undefined;
    expect(payload?.emittedAt).toBeDefined();
    expect(payload?.sequenceNo).toBeDefined();
  });
});
