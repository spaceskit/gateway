import { randomUUID } from "node:crypto";
import type { WorkbenchBatchRow, WorkbenchPolicyRow } from "@spaceskit/persistence";
import type {
  WorkbenchBatchPayload,
  WorkbenchCreateBatchPayload,
  WorkbenchQueueItemPayload,
  WorkbenchUpdateBatchPayload,
} from "@spaceskit/server";
import { parseJsonArray } from "./workbench-service-normalizers.js";
import {
  WorkbenchServiceError,
  normalizeExecutionMode,
  normalizeQueueItemIds,
  normalizeRequired,
} from "./workbench-service-normalizers.js";
import type { WorkbenchServiceOptions } from "./workbench-service-types.js";

interface WorkbenchBatchContext {
  options: WorkbenchServiceOptions;
  resolveQueueItems(queueItemIds: string[]): WorkbenchQueueItemPayload[];
  assertBatchConflictFree(items: WorkbenchQueueItemPayload[]): void;
  assertAutonomousEligibility(queueItem: WorkbenchQueueItemPayload, policy: WorkbenchPolicyRow): void;
  toBatchPayload(row: WorkbenchBatchRow): WorkbenchBatchPayload;
}

export function createWorkbenchBatch(
  context: WorkbenchBatchContext,
  input: WorkbenchCreateBatchPayload & { principalId: string },
): WorkbenchBatchPayload {
  const principalId = normalizeRequired(input.principalId, "principalId");
  const name = normalizeRequired(input.name, "name");
  const queueItemIds = normalizeQueueItemIds(input.queueItemIds);
  const policy = context.options.policy.get();
  const executionMode = normalizeExecutionMode(input.executionMode ?? policy.default_execution_mode);
  const items = context.resolveQueueItems(queueItemIds);

  context.assertBatchConflictFree(items);
  if (executionMode === "autonomous") {
    for (const item of items) {
      context.assertAutonomousEligibility(item, policy);
    }
  }

  const row = context.options.batches.create({
    batchId: `wb-batch-${randomUUID()}`,
    name,
    status: "draft",
    executionMode,
    queueItemIdsJson: JSON.stringify(queueItemIds),
    createdByPrincipalId: principalId,
  });

  return context.toBatchPayload(row);
}

export function updateWorkbenchBatch(
  context: WorkbenchBatchContext,
  input: WorkbenchUpdateBatchPayload & { principalId: string },
): WorkbenchBatchPayload {
  normalizeRequired(input.principalId, "principalId");
  const batchId = normalizeRequired(input.batchId, "batchId");
  const existing = context.options.batches.get(batchId);
  if (!existing) {
    throw new WorkbenchServiceError("NOT_FOUND", `Workbench batch not found: ${batchId}`);
  }

  const nextQueueItemIds = input.queueItemIds ? normalizeQueueItemIds(input.queueItemIds) : parseJsonArray(existing.queue_item_ids_json);
  const items = context.resolveQueueItems(nextQueueItemIds);
  context.assertBatchConflictFree(items);

  const policy = context.options.policy.get();
  const nextMode = input.executionMode
    ? normalizeExecutionMode(input.executionMode)
    : existing.execution_mode;
  if (nextMode === "autonomous") {
    for (const item of items) {
      context.assertAutonomousEligibility(item, policy);
    }
  }

  const updated = context.options.batches.update(batchId, {
    name: input.name?.trim(),
    queueItemIdsJson: input.queueItemIds ? JSON.stringify(nextQueueItemIds) : undefined,
    executionMode: nextMode,
    status: input.status,
  });
  if (!updated) {
    throw new WorkbenchServiceError("NOT_FOUND", `Workbench batch not found: ${batchId}`);
  }
  return context.toBatchPayload(updated);
}
