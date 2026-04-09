import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ── Types ──────────────────────────────────────────────────────────────

export interface ScenarioResult {
  name: string;
  status: "pass" | "fail" | "skip";
  duration_ms: number;
  error?: string;
}

export interface LayerResult {
  name: string;
  status: "pass" | "fail";
  scenarios: ScenarioResult[];
  duration_ms: number;
}

export interface ProviderParityRow {
  scope?: "live" | "metadata";
  provider: string;
  model: string;
  transport: "native" | "bridge" | "mediated_fallback";
  status: "pass" | "fail" | "unavailable";
  observedToolCall?: string;
  observedToolResult?: unknown;
  failureReason?: string;
}

export interface WorkbenchReport {
  timestamp: string;
  duration_ms: number;
  overall: "pass" | "fail";
  layers: LayerResult[];
  providerParity?: ProviderParityRow[];
}

// ── ANSI helpers ───────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";

function statusBadge(status: "pass" | "fail" | "skip"): string {
  switch (status) {
    case "pass":
      return `${GREEN}PASS${RESET}`;
    case "fail":
      return `${RED}FAIL${RESET}`;
    case "skip":
      return `${YELLOW}SKIP${RESET}`;
  }
}

function providerStatusBadge(status: ProviderParityRow["status"]): string {
  switch (status) {
    case "pass":
      return `${GREEN}PASS${RESET}`;
    case "fail":
      return `${RED}FAIL${RESET}`;
    case "unavailable":
      return `${YELLOW}UNAVAILABLE${RESET}`;
  }
}

function pad(text: string, width: number): string {
  const stripped = text.replace(/\x1b\[[0-9;]*m/g, "");
  const diff = width - stripped.length;
  return diff > 0 ? text + " ".repeat(diff) : text;
}

export function computeWorkbenchOverallStatus(
  layers: LayerResult[],
  providerParity: ProviderParityRow[] = [],
): WorkbenchReport["overall"] {
  const layersPass = layers.every((layer) => layer.status === "pass");
  const providerParityPass = providerParity.every((row) => row.status !== "fail");
  return layersPass && providerParityPass ? "pass" : "fail";
}

// ── Console report ─────────────────────────────────────────────────────

export function printConsoleReport(report: WorkbenchReport): void {
  const innerWidth = 64;

  const top = `╭${"─".repeat(innerWidth)}╮`;
  const bot = `╰${"─".repeat(innerWidth)}╯`;
  const sep = `├${"─".repeat(innerWidth)}┤`;
  const line = (content: string) => `│ ${pad(content, innerWidth - 2)} │`;

  const overallColor = report.overall === "pass" ? GREEN : RED;

  console.log("");
  console.log(top);
  console.log(
    line(
      `${BOLD}${WHITE}Workbench Report${RESET}  ${overallColor}${BOLD}${report.overall.toUpperCase()}${RESET}`,
    ),
  );
  console.log(
    line(
      `${DIM}${report.timestamp}  ${report.duration_ms}ms${RESET}`,
    ),
  );
  console.log(sep);

  for (const layer of report.layers) {
    const layerColor = layer.status === "pass" ? GREEN : RED;
    const passed = layer.scenarios.filter((s) => s.status === "pass").length;
    const failed = layer.scenarios.filter((s) => s.status === "fail").length;
    const skipped = layer.scenarios.filter((s) => s.status === "skip").length;

    console.log(
      line(
        `${layerColor}${BOLD}${layer.status === "pass" ? "✓" : "✗"}${RESET} ${BOLD}${layer.name}${RESET}  ${DIM}${layer.duration_ms}ms${RESET}`,
      ),
    );

    const counts: string[] = [];
    if (passed > 0) counts.push(`${GREEN}${passed} passed${RESET}`);
    if (failed > 0) counts.push(`${RED}${failed} failed${RESET}`);
    if (skipped > 0) counts.push(`${YELLOW}${skipped} skipped${RESET}`);
    console.log(line(`  ${counts.join(`${DIM} · ${RESET}`)}`));

    for (const scenario of layer.scenarios) {
      const icon =
        scenario.status === "pass"
          ? `${GREEN}✓${RESET}`
          : scenario.status === "fail"
            ? `${RED}✗${RESET}`
            : `${YELLOW}−${RESET}`;
      console.log(
        line(
          `  ${icon} ${scenario.name}  ${DIM}${scenario.duration_ms}ms${RESET}`,
        ),
      );
      if (scenario.error) {
        console.log(line(`    ${RED}${scenario.error}${RESET}`));
      }
    }

    if (layer !== report.layers[report.layers.length - 1]) {
      console.log(sep);
    }
  }

  if (report.providerParity && report.providerParity.length > 0) {
    console.log(sep);
    console.log(line(`${CYAN}${BOLD}Provider Tool Parity${RESET}`));

    for (const row of report.providerParity) {
      const displayModel = row.model.startsWith(`${row.provider}/`)
        ? row.model
        : `${row.provider}/${row.model}`;
      console.log(
        line(
          `${providerStatusBadge(row.status)} ${displayModel} ${DIM}[${row.transport}${row.scope ? ` · ${row.scope}` : ""}]${RESET}`,
        ),
      );
      if (row.observedToolCall) {
        console.log(line(`  tool: ${row.observedToolCall}`));
      }
      if (row.failureReason) {
        console.log(line(`  ${RED}${row.failureReason}${RESET}`));
      }
    }
  }

  console.log(bot);
  console.log("");
}

// ── JSON report persistence ────────────────────────────────────────────

export async function saveJsonReport(
  report: WorkbenchReport,
  reportsDir: string,
): Promise<string> {
  await mkdir(reportsDir, { recursive: true });

  const ts = report.timestamp.replace(/:/g, "-");
  const filename = `${ts}.json`;
  const filepath = join(reportsDir, filename);

  await writeFile(filepath, JSON.stringify(report, null, 2), "utf-8");

  return filepath;
}
