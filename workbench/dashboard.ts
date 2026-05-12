import type { ServerWebSocket } from "bun";
import { join, resolve } from "node:path";
import { auditWorkbenchPlanningRepo } from "../packages/bootstrap/src/services/workbench-service.js";
import type { WorkbenchAnalystService } from "./analyst-service.js";
import {
  buildAnalystNarrativeSummary,
  buildReportNarrativeSummary,
  buildRunNarrativeSummary,
} from "./dashboard-summary.js";
import { listReports, loadPlanningTask, loadReport } from "./dashboard-data.js";
import { renderDashboardHtml } from "./dashboard-html.js";
import type { WorkbenchLiveMessage } from "./runner-protocol.js";
import type { WorkbenchRunnerService } from "./runner-service.js";

const REPORTS_DIR = join(import.meta.dir, "reports");
const PLANNING_TASKS_DIR = "/Users/caruso/Documents/work/projects/spaces/tasks";
const PORT = 19321;
const HOST = "127.0.0.1";

function jsonBody(request: Request): Promise<Record<string, unknown>> {
  return request.json().catch(() => ({}));
}

function normalizeJobConfigPayload(input: Record<string, unknown>): {
  name?: string;
  layers?: string[];
  providers?: string[];
  presetId?: string;
} {
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : undefined;
  const layers = Array.isArray(input.layers)
    ? input.layers.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
    : undefined;
  const providers = Array.isArray(input.providers)
    ? input.providers.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
    : undefined;
  const presetId = typeof input.presetId === "string" && input.presetId.trim() ? input.presetId.trim() : undefined;
  return {
    ...(name ? { name } : {}),
    ...(layers ? { layers } : {}),
    ...(providers ? { providers } : {}),
    ...(presetId ? { presetId } : {}),
  };
}

function normalizePresetPayload(input: Record<string, unknown>): {
  name: string;
  layers?: string[];
  providers?: string[];
} {
  const payload = normalizeJobConfigPayload(input);
  return {
    name: payload.name ?? "Workbench Preset",
    ...(payload.layers ? { layers: payload.layers } : {}),
    ...(payload.providers ? { providers: payload.providers } : {}),
  };
}

function responseError(error: unknown, status = 400): Response {
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ error: message }, { status });
}

export function startDashboard(input: string | DashboardOptions = REPORTS_DIR): { port: number; stop: () => void } {
  const options = typeof input === "string" ? { reportsDir: input } satisfies DashboardOptions : input;
  const reportsDir = options.reportsDir ?? REPORTS_DIR;
  const runner = options.runner;
  const analyst = options.analyst;
  const planningRepoRoot = resolve(options.planningRepoRoot ?? join(import.meta.dir, "..", ".."));
  const planningTasksRoot = resolve(options.planningTasksRoot ?? PLANNING_TASKS_DIR);
  const port = options.port ?? PORT;
  const host = options.host ?? HOST;

  const server = Bun.serve<DashboardSocketData>({
    port,
    hostname: host,
    async fetch(req, serverRef) {
      const url = new URL(req.url);

      if (url.pathname === "/api/jobs/ws") {
        if (!runner && !analyst) {
          return Response.json({ error: "Workbench live APIs are unavailable in this mode." }, { status: 503 });
        }
        const upgraded = serverRef.upgrade(req, {
          data: { channel: "jobs" },
        });
        if (upgraded) {
          return undefined;
        }
        return Response.json({ error: "WebSocket upgrade failed." }, { status: 400 });
      }

      if (url.pathname === "/api/reports" && req.method === "GET") {
        return Response.json(await listReports(reportsDir));
      }

      if (url.pathname === "/api/planning/audit" && req.method === "GET") {
        try {
          return Response.json(auditWorkbenchPlanningRepo(planningRepoRoot, {
            workProjectsRoot: resolve(planningTasksRoot, "..", ".."),
            projectSlug: resolve(planningTasksRoot, "..").split(/[\\/]/).pop() ?? "spaces",
          }));
        } catch (error) {
          return responseError(error, 500);
        }
      }

      if (url.pathname.startsWith("/api/planning/tasks/") && req.method === "GET") {
        const queueItemId = decodeURIComponent(url.pathname.slice("/api/planning/tasks/".length));
        const task = await loadPlanningTask(planningTasksRoot, queueItemId);
        if (!task) {
          return Response.json({ error: "Planning task not found" }, { status: 404 });
        }
        return Response.json(task);
      }

      if (url.pathname.startsWith("/api/reports/") && req.method === "GET") {
        const filename = decodeURIComponent(url.pathname.slice("/api/reports/".length));
        const report = await loadReport(filename, reportsDir);
        if (!report) {
          return Response.json({ error: "Report not found" }, { status: 404 });
        }
        return Response.json({
          ...report,
          narrativeSummary: buildReportNarrativeSummary(report),
        });
      }

      if (url.pathname === "/api/jobs/snapshot" && req.method === "GET") {
        if (!runner) return Response.json({ error: "Runner is unavailable in this mode." }, { status: 503 });
        return Response.json(runner.getSnapshot());
      }

      if (url.pathname === "/api/analyst/snapshot" && req.method === "GET") {
        if (!analyst) return Response.json({ error: "Analyst is unavailable in this mode." }, { status: 503 });
        return Response.json(analyst.getSnapshot());
      }

      if (url.pathname === "/api/jobs/presets" && req.method === "GET") {
        if (!runner) return Response.json({ error: "Runner is unavailable in this mode." }, { status: 503 });
        return Response.json(runner.listPresets());
      }

      if (url.pathname === "/api/jobs/presets" && req.method === "POST") {
        if (!runner) return Response.json({ error: "Runner is unavailable in this mode." }, { status: 503 });
        try {
          return Response.json(runner.createPreset(normalizePresetPayload(await jsonBody(req))));
        } catch (error) {
          return responseError(error);
        }
      }

      if (url.pathname.startsWith("/api/jobs/presets/") && !url.pathname.endsWith("/queue") && !url.pathname.endsWith("/run-now")) {
        if (!runner) return Response.json({ error: "Runner is unavailable in this mode." }, { status: 503 });
        const presetId = decodeURIComponent(url.pathname.slice("/api/jobs/presets/".length));
        try {
          if (req.method === "PUT") {
            return Response.json(runner.updatePreset(presetId, normalizePresetPayload(await jsonBody(req))));
          }
          if (req.method === "DELETE") {
            runner.deletePreset(presetId);
            return new Response(null, { status: 204 });
          }
        } catch (error) {
          return responseError(error, 404);
        }
      }

      if (url.pathname.startsWith("/api/jobs/presets/") && url.pathname.endsWith("/queue") && req.method === "POST") {
        if (!runner) return Response.json({ error: "Runner is unavailable in this mode." }, { status: 503 });
        const presetId = decodeURIComponent(url.pathname.slice("/api/jobs/presets/".length, -"/queue".length));
        try {
          return Response.json(runner.queuePresetRun(presetId));
        } catch (error) {
          return responseError(error, 404);
        }
      }

      if (url.pathname.startsWith("/api/jobs/presets/") && url.pathname.endsWith("/run-now") && req.method === "POST") {
        if (!runner) return Response.json({ error: "Runner is unavailable in this mode." }, { status: 503 });
        const presetId = decodeURIComponent(url.pathname.slice("/api/jobs/presets/".length, -"/run-now".length));
        try {
          return Response.json(runner.runPresetNow(presetId));
        } catch (error) {
          return responseError(error, 404);
        }
      }

      if (url.pathname === "/api/jobs/queue" && req.method === "POST") {
        if (!runner) return Response.json({ error: "Runner is unavailable in this mode." }, { status: 503 });
        try {
          return Response.json(runner.queueRun(normalizeJobConfigPayload(await jsonBody(req))));
        } catch (error) {
          return responseError(error);
        }
      }

      if (url.pathname === "/api/jobs/run-now" && req.method === "POST") {
        if (!runner) return Response.json({ error: "Runner is unavailable in this mode." }, { status: 503 });
        try {
          return Response.json(runner.runNow(normalizeJobConfigPayload(await jsonBody(req))));
        } catch (error) {
          return responseError(error);
        }
      }

      if (url.pathname.startsWith("/api/jobs/runs/") && req.method === "GET") {
        if (!runner) return Response.json({ error: "Runner is unavailable in this mode." }, { status: 503 });
        const runId = decodeURIComponent(url.pathname.slice("/api/jobs/runs/".length));
        const detail = runner.getRunDetail(runId);
        if (!detail) {
          return Response.json({ error: "Run not found" }, { status: 404 });
        }
        return Response.json({
          ...detail,
          narrativeSummary: buildRunNarrativeSummary(detail),
        });
      }

      if (url.pathname.startsWith("/api/jobs/runs/") && url.pathname.endsWith("/retry") && req.method === "POST") {
        if (!runner) return Response.json({ error: "Runner is unavailable in this mode." }, { status: 503 });
        const runId = decodeURIComponent(url.pathname.slice("/api/jobs/runs/".length, -"/retry".length));
        try {
          return Response.json(runner.retryRun(runId));
        } catch (error) {
          return responseError(error, 404);
        }
      }

      if (url.pathname.startsWith("/api/jobs/runs/") && url.pathname.endsWith("/cancel") && req.method === "POST") {
        if (!runner) return Response.json({ error: "Runner is unavailable in this mode." }, { status: 503 });
        const runId = decodeURIComponent(url.pathname.slice("/api/jobs/runs/".length, -"/cancel".length));
        try {
          const cancelled = await runner.cancelRun(runId);
          if (!cancelled) {
            return Response.json({ error: "Run not found" }, { status: 404 });
          }
          return Response.json(cancelled);
        } catch (error) {
          return responseError(error, 404);
        }
      }

      if (url.pathname === "/api/analyst/sessions/from-run" && req.method === "POST") {
        if (!analyst) return Response.json({ error: "Analyst is unavailable in this mode." }, { status: 503 });
        const body = await jsonBody(req);
        const runId = typeof body.runId === "string" ? body.runId.trim() : "";
        if (!runId) {
          return Response.json({ error: "runId is required" }, { status: 400 });
        }
        try {
          return Response.json(await analyst.startFromRun({ runId }), { status: 201 });
        } catch (error) {
          return responseError(error);
        }
      }

      if (url.pathname === "/api/analyst/sessions/from-space" && req.method === "POST") {
        if (!analyst) return Response.json({ error: "Analyst is unavailable in this mode." }, { status: 503 });
        const body = await jsonBody(req);
        const spaceId = typeof body.spaceId === "string" ? body.spaceId.trim() : "";
        const rootTurnId = typeof body.rootTurnId === "string" && body.rootTurnId.trim()
          ? body.rootTurnId.trim()
          : undefined;
        if (!spaceId) {
          return Response.json({ error: "spaceId is required" }, { status: 400 });
        }
        try {
          return Response.json(await analyst.startFromSpace({ spaceId, ...(rootTurnId ? { rootTurnId } : {}) }), { status: 201 });
        } catch (error) {
          return responseError(error);
        }
      }

      if (url.pathname.startsWith("/api/analyst/sessions/") && url.pathname.endsWith("/retry") && req.method === "POST") {
        if (!analyst) return Response.json({ error: "Analyst is unavailable in this mode." }, { status: 503 });
        const sessionId = decodeURIComponent(url.pathname.slice("/api/analyst/sessions/".length, -"/retry".length));
        try {
          return Response.json(await analyst.retrySession(sessionId));
        } catch (error) {
          return responseError(error, 404);
        }
      }

      if (url.pathname.startsWith("/api/analyst/sessions/") && url.pathname.endsWith("/cancel") && req.method === "POST") {
        if (!analyst) return Response.json({ error: "Analyst is unavailable in this mode." }, { status: 503 });
        const sessionId = decodeURIComponent(url.pathname.slice("/api/analyst/sessions/".length, -"/cancel".length));
        try {
          const cancelled = await analyst.cancelSession(sessionId);
          if (!cancelled) {
            return Response.json({ error: "Session not found" }, { status: 404 });
          }
          return Response.json(cancelled);
        } catch (error) {
          return responseError(error, 404);
        }
      }

      if (url.pathname.startsWith("/api/analyst/sessions/") && req.method === "GET") {
        if (!analyst) return Response.json({ error: "Analyst is unavailable in this mode." }, { status: 503 });
        const sessionId = decodeURIComponent(url.pathname.slice("/api/analyst/sessions/".length));
        const detail = analyst.getSessionDetail(sessionId);
        if (!detail) {
          return Response.json({ error: "Session not found" }, { status: 404 });
        }
        const sourceRun = runner && detail.sourceRunId ? runner.getRunDetail(detail.sourceRunId) : null;
        return Response.json({
          ...detail,
          ...(sourceRun
            ? {
              sourceRun: {
                id: sourceRun.id,
                status: sourceRun.status,
                overallStatus: sourceRun.overallStatus,
                exitSummary: sourceRun.exitSummary,
                narrativeSummary: buildRunNarrativeSummary(sourceRun),
              },
            }
            : {}),
          narrativeSummary: buildAnalystNarrativeSummary(detail, {
            sourceRun: sourceRun ?? undefined,
          }),
        });
      }

      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(renderDashboardHtml(Boolean(runner), Boolean(analyst), Boolean(planningRepoRoot)), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    },
    websocket: {
      open(ws: ServerWebSocket<DashboardSocketData>) {
        if (!runner && !analyst) {
          ws.close();
          return;
        }
        if (runner) {
          ws.send(JSON.stringify({ type: "snapshot", snapshot: runner.getSnapshot() } satisfies WorkbenchLiveMessage));
          ws.data.unsubscribeRunner = runner.subscribe((message) => {
            ws.send(JSON.stringify(message));
          });
        }
        if (analyst) {
          ws.send(JSON.stringify({ type: "analyst.snapshot", snapshot: analyst.getSnapshot() } satisfies WorkbenchLiveMessage));
          ws.data.unsubscribeAnalyst = analyst.subscribe((message) => {
            if (message.type.startsWith("analyst.")) {
              ws.send(JSON.stringify(message));
            }
          });
        }
      },
      close(ws: ServerWebSocket<DashboardSocketData>) {
        ws.data.unsubscribeRunner?.();
        ws.data.unsubscribeRunner = undefined;
        ws.data.unsubscribeAnalyst?.();
        ws.data.unsubscribeAnalyst = undefined;
      },
    },
  });

  console.log(`  Dashboard running at http://${host}:${server.port}`);

  return {
    port: server.port,
    stop: () => server.stop(),
  };
}

if (import.meta.main) {
  startDashboard();
}
