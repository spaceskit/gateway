import { describe, expect, test } from "bun:test";
import { filterWorkbenchLayers, parseWorkbenchArgs } from "./options.js";
import { WORKBENCH_LAYERS } from "./runtime.js";
import type { Layer } from "./scenarios/index.js";

describe("workbench options", () => {
  test("parses layer/provider filters and path overrides", () => {
    const options = parseWorkbenchArgs([
      "--interactive",
      "--layers=chat-roundtrip,provider-tool-parity",
      "--providers",
      "claude,gemini",
      "--db-path",
      "/tmp/workbench.db",
      "--reports-dir=/tmp/reports",
    ], {
      dbPath: "/default/db.sqlite",
      reportsDir: "/default/reports",
    });

    expect(options).toEqual({
      interactive: true,
      serveOnly: false,
      layers: new Set(["chat-roundtrip", "provider-tool-parity"]),
      providers: new Set(["claude", "gemini"]),
      dbPath: "/tmp/workbench.db",
      reportsDir: "/tmp/reports",
    });
  });

  test("rejects unknown layer names", () => {
    const layers: Layer[] = [
      { name: "chat-roundtrip", scenarios: [] },
      { name: "provider-tool-parity", scenarios: [] },
    ];

    expect(() => filterWorkbenchLayers(layers, new Set(["missing-layer"]))).toThrow(
      "Unknown workbench layers: missing-layer",
    );
  });

  test("exposes the template handoff layer in the workbench catalog", () => {
    const selected = filterWorkbenchLayers(WORKBENCH_LAYERS, new Set(["template-handoff"]));
    expect(selected.map((layer) => layer.name)).toEqual(["template-handoff"]);
  });
});
