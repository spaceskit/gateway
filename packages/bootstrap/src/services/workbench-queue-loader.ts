import type { Logger } from "@spaceskit/observability";
import type {
  WorkbenchPolicyRow,
  WorkbenchRunRepository,
} from "@spaceskit/persistence";
import type { WorkbenchQueueItemPayload } from "@spaceskit/server";
import {
  extractNextAction,
  itemsConflict,
  loadCentralTasks,
  type CentralTaskRecord,
} from "./workbench-task-metadata.js";
import { WorkbenchServiceError } from "./workbench-service-normalizers.js";

export function loadWorkbenchQueueItems(input: {
  workProjectsRoot: string;
  workbenchProjectSlug: string;
  now: Date;
  logger: Logger | null;
}): WorkbenchQueueItemPayload[] {
  const tasks: CentralTaskRecord[] = loadCentralTasks(
    input.workProjectsRoot,
    input.workbenchProjectSlug,
    input.now,
    input.logger,
  );
  const items: WorkbenchQueueItemPayload[] = [];
  for (const [index, task] of tasks.entries()) {
    const taskMetadata = task.metadata;
    items.push({
      queueItemId: taskMetadata.id,
      queueIndex: index + 1,
      title: taskMetadata.title,
      type: task.frontmatter.get("spaces-item-type") ?? taskMetadata.priority ?? "task",
      status: taskMetadata.status,
      nextAction: taskMetadata.summary ?? extractNextAction(task.body) ?? taskMetadata.title,
      taskFilePath: task.path,
      delegation: taskMetadata.delegation,
      parallelKeys: taskMetadata.parallelKeys,
      aiShippable: taskMetadata.aiShippable,
      executionModeEligibility: {
        supervised: true,
        autonomous: taskMetadata.executionModeBlockers.length === 0,
      },
      verificationMode: taskMetadata.verificationMode,
      executionModeBlockers: taskMetadata.executionModeBlockers,
      products: taskMetadata.products,
      verificationCommands: taskMetadata.verificationCommands,
    } satisfies WorkbenchQueueItemPayload);
  }
  return items;
}

export function resolveWorkbenchQueueItems(
  queueItemIds: string[],
  allItems: WorkbenchQueueItemPayload[],
): WorkbenchQueueItemPayload[] {
  const itemsById = new Map(allItems.map((item) => [item.queueItemId, item]));
  return queueItemIds.map((queueItemId) => {
    const item = itemsById.get(queueItemId);
    if (!item) {
      throw new WorkbenchServiceError("NOT_FOUND", `Workbench queue item not found: ${queueItemId}`);
    }
    return item;
  });
}

export function assertWorkbenchBatchConflictFree(items: WorkbenchQueueItemPayload[]): void {
  for (let index = 0; index < items.length; index += 1) {
    for (let inner = index + 1; inner < items.length; inner += 1) {
      if (itemsConflict(items[index]!, items[inner]!)) {
        throw new WorkbenchServiceError(
          "FAILED_PRECONDITION",
          `Queue items conflict and cannot share a batch: ${items[index]!.queueItemId} vs ${items[inner]!.queueItemId}`,
        );
      }
    }
  }
}

export function assertWorkbenchNoActiveRunConflict(input: {
  queueItem: WorkbenchQueueItemPayload;
  runs: WorkbenchRunRepository;
  resolveQueueItems: (queueItemIds: string[]) => WorkbenchQueueItemPayload[];
}): void {
  const activeRuns = input.runs.listActive();
  const activeQueueItemIds = Array.from(new Set(activeRuns.map((row) => row.queue_item_id)));
  const activeItems = activeQueueItemIds.length > 0 ? input.resolveQueueItems(activeQueueItemIds) : [];
  const conflict = activeItems.find((item) => itemsConflict(input.queueItem, item));
  if (conflict) {
    throw new WorkbenchServiceError(
      "FAILED_PRECONDITION",
      `Queue item conflicts with active run: ${input.queueItem.queueItemId} vs ${conflict.queueItemId}`,
    );
  }
}

export function assertWorkbenchParallelCapacity(
  policy: WorkbenchPolicyRow,
  runs: WorkbenchRunRepository,
): void {
  const activeRuns = runs.listActive();
  if (activeRuns.length >= policy.max_parallel_runs) {
    throw new WorkbenchServiceError(
      "FAILED_PRECONDITION",
      `Workbench is at max parallel capacity (${policy.max_parallel_runs})`,
    );
  }
}

export function assertWorkbenchAutonomousEligibility(
  queueItem: WorkbenchQueueItemPayload,
  policy: WorkbenchPolicyRow,
): void {
  if (!policy.autonomous_enabled) {
    throw new WorkbenchServiceError("FAILED_PRECONDITION", "Autonomous execution is disabled by policy");
  }
  if (policy.require_ai_shippable_for_autonomous && !queueItem.aiShippable) {
    throw new WorkbenchServiceError("FAILED_PRECONDITION", `Queue item is not AI-shippable: ${queueItem.queueItemId}`);
  }
  if (queueItem.delegation !== "autonomous") {
    throw new WorkbenchServiceError("FAILED_PRECONDITION", `Queue item does not allow autonomous execution: ${queueItem.queueItemId}`);
  }
  const centralBlocker = queueItem.executionModeBlockers.find((blocker) =>
    blocker.startsWith("Task status is ")
    || blocker.startsWith("Unmet dependencies:")
    || blocker === "Task has an active unexpired claim.");
  if (centralBlocker) {
    throw new WorkbenchServiceError("FAILED_PRECONDITION", centralBlocker);
  }
  if (queueItem.verificationMode !== "machine_readable") {
    throw new WorkbenchServiceError(
      "FAILED_PRECONDITION",
      queueItem.executionModeBlockers.find((blocker) =>
        blocker.includes("machine-readable verification"))
        ?? `Queue item requires review-only execution: ${queueItem.queueItemId}`,
    );
  }
}
