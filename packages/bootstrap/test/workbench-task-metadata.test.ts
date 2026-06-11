import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateCentralTaskFile, upsertSection } from "../src/services/workbench-task-metadata.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function writeTaskFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "workbench-task-metadata-"));
  tempDirs.push(dir);
  const taskPath = join(dir, "T-0001.md");
  writeFileSync(
    taskPath,
    [
      "---",
      "id: spaces/T-0001",
      "title: metadata smoke",
      "status: ready",
      "owner: carmine",
      "autonomous: true",
      "updated: 2026-06-01",
      "---",
      "",
      "# metadata smoke",
      "",
      "## Goal",
      "",
      "- Verify section upserts.",
      "",
      "## Log",
      "",
      "- 2026-06-01T00:00:00Z - created",
      "",
    ].join("\n"),
  );
  return taskPath;
}

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}

describe("upsertSection", () => {
  test("appends the section when the heading does not exist", () => {
    const next = upsertSection("# Title\n\n## Goal\n\n- something\n", "Attempts", "### Entry One\n- at: now");
    expect(countOccurrences(next, "## Attempts")).toBe(1);
    expect(next).toContain("### Entry One");
  });

  test("merges into an existing section newest-first instead of duplicating the heading", () => {
    const first = upsertSection("# Title\n", "Attempts", "### Entry One\n- at: t1");
    const second = upsertSection(first, "Attempts", "### Entry Two\n- at: t2");
    expect(countOccurrences(second, "## Attempts")).toBe(1);
    expect(second.indexOf("### Entry Two")).toBeLessThan(second.indexOf("### Entry One"));
  });
});

describe("updateCentralTaskFile", () => {
  test("repeated status updates keep a single Attempts and a single Feedback section", () => {
    const taskPath = writeTaskFile();
    updateCentralTaskFile(taskPath, {
      status: "in-progress",
      updated: "2026-06-02",
      owner: "agent",
      logMessage: "Workbench run wb-run-1 started in autonomous mode.",
      nowIso: "2026-06-02T10:00:00Z",
    });
    updateCentralTaskFile(taskPath, {
      status: "in-progress",
      updated: "2026-06-02",
      owner: "agent",
      logMessage: "Workbench run wb-run-2 started in autonomous mode.",
      nowIso: "2026-06-02T11:00:00Z",
    });
    updateCentralTaskFile(taskPath, {
      status: "review",
      updated: "2026-06-02",
      logMessage: "Workbench run wb-run-2 completed verification and is ready for review.",
      nowIso: "2026-06-02T12:00:00Z",
    });
    updateCentralTaskFile(taskPath, {
      status: "blocked",
      updated: "2026-06-02",
      logMessage: "Workbench run wb-run-1 failed before verification.",
      nowIso: "2026-06-02T13:00:00Z",
    });

    const content = readFileSync(taskPath, "utf8");
    expect(countOccurrences(content, "\n## Attempts\n")).toBe(1);
    expect(countOccurrences(content, "\n## Feedback\n")).toBe(1);
    expect(countOccurrences(content, "\n## Log\n")).toBe(1);
    expect(countOccurrences(content, "### Spaces Workbench Attempt Started")).toBe(2);
    expect(countOccurrences(content, "### Spaces Workbench Review Requested")).toBe(1);
    expect(countOccurrences(content, "### Spaces Workbench Blocked")).toBe(1);
    // Newest-first within the merged sections, matching the Log behavior.
    expect(content.indexOf("- at: 2026-06-02T11:00:00Z")).toBeLessThan(content.indexOf("- at: 2026-06-02T10:00:00Z"));
    expect(content.indexOf("### Spaces Workbench Blocked")).toBeLessThan(content.indexOf("### Spaces Workbench Review Requested"));
    expect(content).toContain("status: blocked");
  });
});
