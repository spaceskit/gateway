import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessConciergeApiService } from "../src/services/harness-concierge-api-service.js";

describe("HarnessConciergeApiService", () => {
  test("returns concierge pings from the harness report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "spaces-concierge-"));
    const path = join(dir, "concierge-pings.json");
    await writeFile(path, JSON.stringify({
      generatedAt: "2026-05-22T10:00:00Z",
      activePings: [{ id: "concierge/N-1", urgency: "high", deliver: true }],
      counts: { active: 1 },
    }));
    const service = new HarnessConciergeApiService({ pingsPath: path });
    const request = new Request("http://localhost/api/concierge-pings");

    const response = await service.handleRequest(request, new URL(request.url));

    await rm(dir, { recursive: true, force: true });
    expect(response?.status).toBe(200);
    const body = await response!.json() as Record<string, unknown>;
    expect(body.sourcePath).toBe(path);
    expect((body.activePings as unknown[]).length).toBe(1);
  });

  test("ignores unrelated paths", async () => {
    const service = new HarnessConciergeApiService({});
    const request = new Request("http://localhost/api/other");

    const response = await service.handleRequest(request, new URL(request.url));

    expect(response).toBeNull();
  });
});
