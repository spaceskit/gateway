import type { Layer } from "./scenarios/index.js";

export interface WorkbenchCliOptions {
  interactive: boolean;
  serveOnly: boolean;
  layers?: Set<string>;
  providers?: Set<string>;
  dbPath: string;
  reportsDir: string;
}

interface Defaults {
  dbPath: string;
  reportsDir: string;
}

export function parseWorkbenchArgs(argv: string[], defaults: Defaults): WorkbenchCliOptions {
  let interactive = false;
  let serveOnly = false;
  let layers: Set<string> | undefined;
  let providers: Set<string> | undefined;
  let dbPath = defaults.dbPath;
  let reportsDir = defaults.reportsDir;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--interactive") {
      interactive = true;
      continue;
    }
    if (arg === "--serve-only") {
      serveOnly = true;
      continue;
    }

    const [flag, inlineValue] = splitInlineFlag(arg);
    switch (flag) {
      case "--layers": {
        const value = inlineValue ?? argv[++index];
        layers = parseCommaSet(value);
        if (!layers) throw new Error("--layers requires a comma-separated value");
        continue;
      }
      case "--providers": {
        const value = inlineValue ?? argv[++index];
        providers = parseCommaSet(value, { normalizeLowercase: true });
        if (!providers) throw new Error("--providers requires a comma-separated value");
        continue;
      }
      case "--db-path": {
        const value = inlineValue ?? argv[++index];
        if (!value?.trim()) throw new Error("--db-path requires a value");
        dbPath = value.trim();
        continue;
      }
      case "--reports-dir": {
        const value = inlineValue ?? argv[++index];
        if (!value?.trim()) throw new Error("--reports-dir requires a value");
        reportsDir = value.trim();
        continue;
      }
      default:
        throw new Error(`Unknown workbench argument: ${arg}`);
    }
  }

  return {
    interactive,
    serveOnly,
    ...(layers ? { layers } : {}),
    ...(providers ? { providers } : {}),
    dbPath,
    reportsDir,
  };
}

export function filterWorkbenchLayers(
  layers: Layer[],
  requestedLayerNames?: Set<string>,
): Layer[] {
  if (!requestedLayerNames || requestedLayerNames.size === 0) {
    return layers;
  }

  const availableLayerNames = new Set(layers.map((layer) => layer.name));
  const unknown = Array.from(requestedLayerNames).filter((name) => !availableLayerNames.has(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown workbench layers: ${unknown.join(", ")}`);
  }

  return layers.filter((layer) => requestedLayerNames.has(layer.name));
}

function splitInlineFlag(arg: string): [string, string | undefined] {
  const equalsIndex = arg.indexOf("=");
  if (equalsIndex === -1) {
    return [arg, undefined];
  }
  return [arg.slice(0, equalsIndex), arg.slice(equalsIndex + 1)];
}

function parseCommaSet(
  value: string | undefined,
  options: { normalizeLowercase?: boolean } = {},
): Set<string> | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  const items = normalized
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => options.normalizeLowercase ? entry.toLowerCase() : entry);

  return items.length > 0 ? new Set(items) : undefined;
}
