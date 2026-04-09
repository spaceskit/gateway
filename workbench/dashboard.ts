import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { WorkbenchReport } from "./report.js";

const REPORTS_DIR = join(import.meta.dir, "reports");
const PORT = 19321;

// ── Report helpers ─────────────────────────────────────────────────────

async function listReports(): Promise<
  Array<{
    filename: string;
    timestamp: string;
    overall: "pass" | "fail";
    duration_ms: number;
    layers: number;
    scenarios: number;
  }>
> {
  let files: string[];
  try {
    files = await readdir(REPORTS_DIR);
  } catch {
    return [];
  }

  const jsonFiles = files
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();

  const summaries = await Promise.all(
    jsonFiles.map(async (filename) => {
      try {
        const file = Bun.file(join(REPORTS_DIR, filename));
        const report: WorkbenchReport = await file.json();
        const scenarioCount = report.layers.reduce(
          (sum, l) => sum + l.scenarios.length,
          0,
        );
        return {
          filename,
          timestamp: report.timestamp,
          overall: report.overall,
          duration_ms: report.duration_ms,
          layers: report.layers.length,
          scenarios: scenarioCount,
        };
      } catch {
        return null;
      }
    }),
  );

  return summaries.filter(
    (s): s is NonNullable<typeof s> => s !== null,
  );
}

async function loadReport(
  filename: string,
): Promise<WorkbenchReport | null> {
  if (filename.includes("..") || filename.includes("/")) return null;
  try {
    const file = Bun.file(join(REPORTS_DIR, filename));
    return await file.json();
  } catch {
    return null;
  }
}

// ── HTML ───────────────────────────────────────────────────────────────

function renderDashboard(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Workbench Dashboard</title>
<style>
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --border: #30363d;
    --text: #c9d1d9;
    --text-dim: #8b949e;
    --green: #3fb950;
    --red: #f85149;
    --yellow: #d29922;
    --blue: #58a6ff;
    --font-mono: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
    --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.5;
    padding: 24px;
    max-width: 960px;
    margin: 0 auto;
  }
  h1 {
    font-size: 20px;
    font-weight: 600;
    margin-bottom: 4px;
    color: #f0f6fc;
  }
  .subtitle {
    font-size: 12px;
    color: var(--text-dim);
    margin-bottom: 24px;
    font-family: var(--font-mono);
  }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .badge-pass { background: rgba(63,185,80,0.15); color: var(--green); }
  .badge-fail { background: rgba(248,81,73,0.15); color: var(--red); }
  .badge-skip { background: rgba(210,153,34,0.15); color: var(--yellow); }
  .report-list { list-style: none; }
  .report-item {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 18px;
    margin-bottom: 8px;
    cursor: pointer;
    transition: border-color 0.15s;
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .report-item:hover { border-color: var(--blue); }
  .report-item .meta { flex: 1; }
  .report-item .timestamp {
    font-family: var(--font-mono);
    font-size: 13px;
    color: #f0f6fc;
  }
  .report-item .stats {
    font-size: 12px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    margin-top: 2px;
  }
  .report-item .duration {
    font-size: 12px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    white-space: nowrap;
  }
  .empty {
    text-align: center;
    color: var(--text-dim);
    padding: 48px 0;
    font-size: 14px;
  }
  #detail {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
    display: none;
    margin-bottom: 24px;
  }
  #detail .back {
    font-size: 12px;
    color: var(--blue);
    cursor: pointer;
    font-family: var(--font-mono);
    margin-bottom: 16px;
    display: inline-block;
  }
  #detail .back:hover { text-decoration: underline; }
  .detail-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }
  .detail-header h2 { font-size: 16px; color: #f0f6fc; }
  .layer {
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-bottom: 10px;
    overflow: hidden;
  }
  .layer-header {
    padding: 10px 14px;
    background: rgba(255,255,255,0.02);
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    font-weight: 600;
    border-bottom: 1px solid var(--border);
  }
  .layer-header .ldur {
    font-weight: 400;
    font-size: 11px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    margin-left: auto;
  }
  .scenario {
    padding: 6px 14px 6px 28px;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 13px;
    border-bottom: 1px solid rgba(48,54,61,0.5);
  }
  .scenario:last-child { border-bottom: none; }
  .scenario .s-name { flex: 1; }
  .scenario .s-dur {
    font-size: 11px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    white-space: nowrap;
  }
  .scenario .s-error {
    font-size: 12px;
    color: var(--red);
    font-family: var(--font-mono);
    margin-top: 2px;
    word-break: break-word;
  }
</style>
</head>
<body>
  <h1>Workbench Dashboard</h1>
  <div class="subtitle">127.0.0.1:${PORT} &middot; auto-refreshes every 10s</div>

  <div id="detail">
    <span class="back" onclick="hideDetail()">&larr; back to list</span>
    <div id="detail-content"></div>
  </div>

  <ul class="report-list" id="report-list"></ul>

<script>
let reports = [];
let pollTimer = null;

async function fetchReports() {
  try {
    const res = await fetch('/api/reports');
    reports = await res.json();
    renderList();
  } catch (e) {
    console.error('Failed to fetch reports', e);
  }
}

function renderList() {
  const el = document.getElementById('report-list');
  if (!reports.length) {
    el.innerHTML = '<li class="empty">No reports found.<br>Run the workbench to generate reports.</li>';
    return;
  }
  el.innerHTML = reports.map(r => {
    const cls = r.overall === 'pass' ? 'badge-pass' : 'badge-fail';
    return '<li class="report-item" onclick="showDetail(\\'' + r.filename + '\\')">'
      + '<span class="badge ' + cls + '">' + r.overall + '</span>'
      + '<div class="meta">'
      + '<div class="timestamp">' + esc(r.timestamp) + '</div>'
      + '<div class="stats">' + r.layers + ' layers &middot; ' + r.scenarios + ' scenarios</div>'
      + '</div>'
      + '<div class="duration">' + r.duration_ms + 'ms</div>'
      + '</li>';
  }).join('');
}

async function showDetail(filename) {
  stopPolling();
  try {
    const res = await fetch('/api/reports/' + encodeURIComponent(filename));
    const report = await res.json();
    renderDetail(report);
    document.getElementById('detail').style.display = 'block';
    document.getElementById('report-list').style.display = 'none';
  } catch (e) {
    console.error('Failed to load report', e);
  }
}

function hideDetail() {
  document.getElementById('detail').style.display = 'none';
  document.getElementById('report-list').style.display = '';
  startPolling();
}

function renderDetail(report) {
  const cls = report.overall === 'pass' ? 'badge-pass' : 'badge-fail';
  let html = '<div class="detail-header">'
    + '<span class="badge ' + cls + '">' + report.overall + '</span>'
    + '<h2>' + esc(report.timestamp) + '</h2>'
    + '<span style="color:var(--text-dim);font-size:12px;font-family:var(--font-mono);margin-left:auto">'
    + report.duration_ms + 'ms</span>'
    + '</div>';

  for (const layer of report.layers) {
    const lcls = layer.status === 'pass' ? 'badge-pass' : 'badge-fail';
    html += '<div class="layer">'
      + '<div class="layer-header">'
      + '<span class="badge ' + lcls + '">' + layer.status + '</span>'
      + '<span>' + esc(layer.name) + '</span>'
      + '<span class="ldur">' + layer.duration_ms + 'ms</span>'
      + '</div>';

    for (const s of layer.scenarios) {
      const scls = s.status === 'pass' ? 'badge-pass' : s.status === 'fail' ? 'badge-fail' : 'badge-skip';
      html += '<div class="scenario">'
        + '<span class="badge ' + scls + '">' + s.status + '</span>'
        + '<div class="s-name">' + esc(s.name)
        + (s.error ? '<div class="s-error">' + esc(s.error) + '</div>' : '')
        + '</div>'
        + '<span class="s-dur">' + s.duration_ms + 'ms</span>'
        + '</div>';
    }
    html += '</div>';
  }

  document.getElementById('detail-content').innerHTML = html;
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(fetchReports, 10000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

fetchReports();
startPolling();
</script>
</body>
</html>`;
}

// ── Server ─────────────────────────────────────────────────────────────

export function startDashboard(): { port: number; stop: () => void } {
  const server = Bun.serve({
    port: PORT,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/api/reports" && req.method === "GET") {
        const reports = await listReports();
        return Response.json(reports);
      }

      if (
        url.pathname.startsWith("/api/reports/") &&
        req.method === "GET"
      ) {
        const filename = decodeURIComponent(
          url.pathname.slice("/api/reports/".length),
        );
        const report = await loadReport(filename);
        if (!report) {
          return Response.json(
            { error: "Report not found" },
            { status: 404 },
          );
        }
        return Response.json(report);
      }

      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(renderDashboard(), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });

  console.log(
    `  Dashboard running at http://127.0.0.1:${server.port}`,
  );

  return { port: server.port, stop: () => server.stop() };
}

// Auto-start when run directly
if (import.meta.main) {
  startDashboard();
}
