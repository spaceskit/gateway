/**
 * Phase 3: A2A Protocol E2E Tests
 *
 * Tests using fetch() against the gateway's HTTP A2A endpoints.
 */

import { describe, expect, test, afterAll } from "bun:test";
import {
  createTestGateway,
  getJson,
  readNextSseEvent,
  E2E_TIMEOUT,
  type TestGateway,
} from "./harness.js";

let gw: TestGateway;

afterAll(async () => {
  await gw?.cleanup();
});

describe("A2A protocol", () => {
  test(
    "agent card at /.well-known/agent.json",
    { timeout: E2E_TIMEOUT },
    async () => {
      gw = await createTestGateway();
      const { status, data } = await getJson<Record<string, unknown>>(
        `${gw.httpUrl}/.well-known/agent.json`,
      );
      expect(status).toBe(200);
      expect(data.name).toBeTruthy();
      expect(data.url).toBeTruthy();
      expect(data.capabilities).toBeDefined();
    },
  );

  test(
    "per-profile agent card",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) gw = await createTestGateway();
      // The main profile ID is set during gateway creation
      const mainProfileId = (gw.instance.config as unknown as Record<string, unknown>)
        .mainProfileId as string;

      const { status, data } = await getJson<Record<string, unknown>>(
        `${gw.httpUrl}/a2a/agents/${mainProfileId}`,
      );
      expect(status).toBe(200);
      expect(data.name).toBeTruthy();
    },
  );

  test(
    "create task (JSON response)",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) gw = await createTestGateway();
      const response = await fetch(`${gw.httpUrl}/a2a/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          message: {
            role: "user",
            parts: [{ type: "text", text: "Hello from E2E test" }],
          },
        }),
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as Record<string, unknown>;
      const task = data.task as Record<string, unknown>;
      expect(task).toBeDefined();
      expect(task.id).toBeTruthy();
      expect(
        ["submitted", "working", "completed", "failed"].includes(
          task.state as string,
        ),
      ).toBe(true);
    },
  );

  test(
    "create task (SSE streaming)",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) gw = await createTestGateway();
      const response = await fetch(`${gw.httpUrl}/a2a/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          message: {
            role: "user",
            parts: [{ type: "text", text: "Stream test" }],
          },
        }),
      });

      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();

      if (reader) {
        try {
          const event = await readNextSseEvent(reader);
          // First event should be task.started or similar
          expect(event.type ?? event.taskId).toBeTruthy();
        } finally {
          reader.releaseLock();
          // Consume remainder to avoid connection leak
          try {
            await response.body?.cancel();
          } catch {}
        }
      }
    },
  );

  test(
    "get task status after creation",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) gw = await createTestGateway();

      // Create a task first (JSON mode)
      const createResponse = await fetch(`${gw.httpUrl}/a2a/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          message: {
            role: "user",
            parts: [{ type: "text", text: "Status check test" }],
          },
        }),
      });

      const createData = (await createResponse.json()) as Record<
        string,
        unknown
      >;
      const task = createData.task as Record<string, unknown>;
      const taskId = task.id as string;

      // Get task status
      const { status, data } = await getJson<Record<string, unknown>>(
        `${gw.httpUrl}/a2a/tasks/${taskId}`,
      );
      expect(status).toBe(200);
      const fetched = data.task as Record<string, unknown>;
      expect(fetched.id).toBe(taskId);
    },
  );

  test(
    "multi-turn: send follow-up to existing task",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gw) gw = await createTestGateway();

      // Create initial task
      const createResponse = await fetch(`${gw.httpUrl}/a2a/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          message: {
            role: "user",
            parts: [{ type: "text", text: "First message" }],
          },
        }),
      });

      const createData = (await createResponse.json()) as Record<
        string,
        unknown
      >;
      const taskId = (createData.task as Record<string, unknown>).id as string;

      // Send follow-up referencing the task's space
      const metadata = (createData.task as Record<string, unknown>)
        .metadata as Record<string, unknown> | undefined;
      const spaceId = metadata?.spaceId as string | undefined;

      if (spaceId) {
        const followUp = await fetch(`${gw.httpUrl}/a2a/tasks`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            message: {
              role: "user",
              parts: [{ type: "text", text: "Follow-up message" }],
            },
            metadata: { spaceId },
          }),
        });
        expect(followUp.status).toBe(200);
      }
    },
  );
});
