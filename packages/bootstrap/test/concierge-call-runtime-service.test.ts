import { describe, expect, test } from "bun:test";
import { EventBus } from "@spaceskit/core";
import { ConciergeCallRuntimeService } from "../src/services/concierge-call-runtime-service.js";

const logger = {
  info() {},
  warn() {},
  error() {},
} as const;

describe("ConciergeCallRuntimeService", () => {
  test("buffers immediate turn events emitted before the executeTurn ack is consumed", async () => {
    const eventBus = new EventBus();
    const service = new ConciergeCallRuntimeService({
      eventBus,
      logger: logger as any,
      spaceManager: {
        async executeTurn(spaceId: string) {
          const turnId = "turn-immediate";
          eventBus.emit({
            type: "space.turn_event",
            spaceId,
            turnId,
            event: {
              type: "text_delta",
              text: "Hello",
            },
            timestamp: new Date(),
          });
          eventBus.emit({
            type: "space.turn_event",
            spaceId,
            turnId,
            event: {
              type: "turn_completed",
              result: {
                finalMessage: {
                  content: "Hello world",
                },
              },
            },
            timestamp: new Date(),
          });
          return { turnId };
        },
        async cancelTurn() {
          return true;
        },
      } as any,
    });

    service.startCall({
      callId: "call-1",
      platform: "ios",
      spaceId: "main-space",
      displayName: "Concierge",
    });

    const response = await service.appendAudioChunk({
      callId: "call-1",
      sequence: 1,
      audioBase64: "AAAA",
      audioDurationSeconds: 0.1,
      transcriptText: "hi",
      isFinal: true,
    });

    expect(response.events.map((event) => event.mediaEventType)).toEqual([
      "transcript_final",
      "assistant_text_partial",
      "assistant_text_final",
    ]);
    expect(response.events[0]?.transcriptDelta).toBe("hi");
    expect(response.events[1]?.assistantTextDelta).toBe("Hello");
    expect(response.events[2]?.assistantTextDelta).toBe("Hello world");
    expect(response.events[2]?.assistantTextFinal).toBe(true);
  });
});
