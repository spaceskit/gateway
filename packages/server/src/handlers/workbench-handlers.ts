import type { ErrorPayload } from "../protocol.js";
import {
  MessageTypes,
  type GatewayMessage,
  type WorkbenchApproveStagePayload,
  type WorkbenchApproveStageResponsePayload,
  type WorkbenchCancelRunPayload,
  type WorkbenchCancelRunResponsePayload,
  type WorkbenchCreateBatchPayload,
  type WorkbenchCreateBatchResponsePayload,
  type WorkbenchGetPolicyPayload,
  type WorkbenchGetPolicyResponsePayload,
  type WorkbenchGetQueueItemPayload,
  type WorkbenchGetQueueItemResponsePayload,
  type WorkbenchGetRunPayload,
  type WorkbenchGetRunResponsePayload,
  type WorkbenchListArtifactsPayload,
  type WorkbenchListArtifactsResponsePayload,
  type WorkbenchListBatchesPayload,
  type WorkbenchListBatchesResponsePayload,
  type WorkbenchListQueuePayload,
  type WorkbenchListQueueResponsePayload,
  type WorkbenchListRunsPayload,
  type WorkbenchListRunsResponsePayload,
  type WorkbenchRejectStagePayload,
  type WorkbenchRejectStageResponsePayload,
  type WorkbenchRetryRunPayload,
  type WorkbenchRetryRunResponsePayload,
  type WorkbenchSetModePayload,
  type WorkbenchSetModeResponsePayload,
  type WorkbenchStartRunPayload,
  type WorkbenchStartRunResponsePayload,
  type WorkbenchUpdateBatchPayload,
  type WorkbenchUpdateBatchResponsePayload,
  type WorkbenchUpdatePolicyPayload,
  type WorkbenchUpdatePolicyResponsePayload,
} from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type { WorkbenchService } from "../message-router-gateway-services.js";

export interface WorkbenchHandlerContext {
  workbenchService: WorkbenchService | null;
  response: (correlationId: string, type: string, payload?: unknown) => GatewayMessage;
  errorResponse: (
    correlationId: string,
    code: ErrorPayload["code"],
    message: string,
    errDetails?: unknown,
  ) => GatewayMessage;
}

function missingServiceResponse(
  context: WorkbenchHandlerContext,
  msg: GatewayMessage,
): GatewayMessage | null {
  if (context.workbenchService) return null;
  return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Workbench service unavailable");
}

function requirePrincipal(
  context: WorkbenchHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): { principalId: string; error: null } | { principalId: null; error: GatewayMessage } {
  if (client.publicKey) {
    return { principalId: client.publicKey, error: null };
  }
  return {
    principalId: null,
    error: context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required"),
  };
}

export async function handleWorkbenchListQueue(
  context: WorkbenchHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const unavailable = missingServiceResponse(context, msg);
  if (unavailable) return unavailable;
  const payload = (msg.payload ?? {}) as WorkbenchListQueuePayload;
  const items = await context.workbenchService!.listQueue({ ...payload, principalId: client.publicKey ?? undefined });
  return context.response(msg.id, MessageTypes.WORKBENCH_LIST_QUEUE, { items } satisfies WorkbenchListQueueResponsePayload);
}

export async function handleWorkbenchGetQueueItem(
  context: WorkbenchHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const unavailable = missingServiceResponse(context, msg);
  if (unavailable) return unavailable;
  const payload = msg.payload as WorkbenchGetQueueItemPayload;
  if (!payload?.queueItemId?.trim()) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "queueItemId is required");
  }
  const item = await context.workbenchService!.getQueueItem({ ...payload, principalId: client.publicKey ?? undefined });
  if (!item) {
    return context.errorResponse(msg.id, "NOT_FOUND", `Workbench queue item not found: ${payload.queueItemId}`);
  }
  return context.response(msg.id, MessageTypes.WORKBENCH_GET_QUEUE_ITEM, { item } satisfies WorkbenchGetQueueItemResponsePayload);
}

export async function handleWorkbenchCreateBatch(
  context: WorkbenchHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const unavailable = missingServiceResponse(context, msg);
  if (unavailable) return unavailable;
  const { principalId, error } = requirePrincipal(context, client, msg);
  if (error) return error;
  const payload = msg.payload as WorkbenchCreateBatchPayload;
  if (!payload?.name?.trim() || !Array.isArray(payload?.queueItemIds) || payload.queueItemIds.length === 0) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "name and queueItemIds are required");
  }
  const batch = await context.workbenchService!.createBatch({ ...payload, principalId });
  return context.response(msg.id, MessageTypes.WORKBENCH_CREATE_BATCH, { batch } satisfies WorkbenchCreateBatchResponsePayload);
}

export async function handleWorkbenchListBatches(
  context: WorkbenchHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const unavailable = missingServiceResponse(context, msg);
  if (unavailable) return unavailable;
  const payload = (msg.payload ?? {}) as WorkbenchListBatchesPayload;
  const batches = await context.workbenchService!.listBatches({ ...payload, principalId: client.publicKey ?? undefined });
  return context.response(msg.id, MessageTypes.WORKBENCH_LIST_BATCHES, { batches } satisfies WorkbenchListBatchesResponsePayload);
}

export async function handleWorkbenchUpdateBatch(
  context: WorkbenchHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const unavailable = missingServiceResponse(context, msg);
  if (unavailable) return unavailable;
  const { principalId, error } = requirePrincipal(context, client, msg);
  if (error) return error;
  const payload = msg.payload as WorkbenchUpdateBatchPayload;
  if (!payload?.batchId?.trim()) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "batchId is required");
  }
  const batch = await context.workbenchService!.updateBatch({ ...payload, principalId });
  return context.response(msg.id, MessageTypes.WORKBENCH_UPDATE_BATCH, { batch } satisfies WorkbenchUpdateBatchResponsePayload);
}

export async function handleWorkbenchStartRun(
  context: WorkbenchHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const unavailable = missingServiceResponse(context, msg);
  if (unavailable) return unavailable;
  const { principalId, error } = requirePrincipal(context, client, msg);
  if (error) return error;
  const payload = msg.payload as WorkbenchStartRunPayload;
  if (!payload?.queueItemId?.trim()) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "queueItemId is required");
  }
  const run = await context.workbenchService!.startRun({ ...payload, principalId });
  return context.response(msg.id, MessageTypes.WORKBENCH_START_RUN, { run } satisfies WorkbenchStartRunResponsePayload);
}

export async function handleWorkbenchRetryRun(
  context: WorkbenchHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const unavailable = missingServiceResponse(context, msg);
  if (unavailable) return unavailable;
  const { principalId, error } = requirePrincipal(context, client, msg);
  if (error) return error;
  const payload = msg.payload as WorkbenchRetryRunPayload;
  if (!payload?.runId?.trim()) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "runId is required");
  }
  const run = await context.workbenchService!.retryRun({ ...payload, principalId });
  return context.response(msg.id, MessageTypes.WORKBENCH_RETRY_RUN, { run } satisfies WorkbenchRetryRunResponsePayload);
}

export async function handleWorkbenchCancelRun(
  context: WorkbenchHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const unavailable = missingServiceResponse(context, msg);
  if (unavailable) return unavailable;
  const { principalId, error } = requirePrincipal(context, client, msg);
  if (error) return error;
  const payload = msg.payload as WorkbenchCancelRunPayload;
  if (!payload?.runId?.trim()) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "runId is required");
  }
  const run = await context.workbenchService!.cancelRun({ ...payload, principalId });
  return context.response(msg.id, MessageTypes.WORKBENCH_CANCEL_RUN, { run } satisfies WorkbenchCancelRunResponsePayload);
}

export async function handleWorkbenchListRuns(
  context: WorkbenchHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const unavailable = missingServiceResponse(context, msg);
  if (unavailable) return unavailable;
  const payload = (msg.payload ?? {}) as WorkbenchListRunsPayload;
  const runs = await context.workbenchService!.listRuns({ ...payload, principalId: client.publicKey ?? undefined });
  return context.response(msg.id, MessageTypes.WORKBENCH_LIST_RUNS, { runs } satisfies WorkbenchListRunsResponsePayload);
}

export async function handleWorkbenchGetRun(
  context: WorkbenchHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const unavailable = missingServiceResponse(context, msg);
  if (unavailable) return unavailable;
  const payload = msg.payload as WorkbenchGetRunPayload;
  if (!payload?.runId?.trim()) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "runId is required");
  }
  const run = await context.workbenchService!.getRun({ ...payload, principalId: client.publicKey ?? undefined });
  if (!run) {
    return context.errorResponse(msg.id, "NOT_FOUND", `Workbench run not found: ${payload.runId}`);
  }
  return context.response(msg.id, MessageTypes.WORKBENCH_GET_RUN, { run } satisfies WorkbenchGetRunResponsePayload);
}

export async function handleWorkbenchApproveStage(
  context: WorkbenchHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const unavailable = missingServiceResponse(context, msg);
  if (unavailable) return unavailable;
  const { principalId, error } = requirePrincipal(context, client, msg);
  if (error) return error;
  const payload = msg.payload as WorkbenchApproveStagePayload;
  if (!payload?.runId?.trim()) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "runId is required");
  }
  const run = await context.workbenchService!.approveStage({ ...payload, principalId });
  return context.response(msg.id, MessageTypes.WORKBENCH_APPROVE_STAGE, { run } satisfies WorkbenchApproveStageResponsePayload);
}

export async function handleWorkbenchRejectStage(
  context: WorkbenchHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const unavailable = missingServiceResponse(context, msg);
  if (unavailable) return unavailable;
  const { principalId, error } = requirePrincipal(context, client, msg);
  if (error) return error;
  const payload = msg.payload as WorkbenchRejectStagePayload;
  if (!payload?.runId?.trim()) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "runId is required");
  }
  const run = await context.workbenchService!.rejectStage({ ...payload, principalId });
  return context.response(msg.id, MessageTypes.WORKBENCH_REJECT_STAGE, { run } satisfies WorkbenchRejectStageResponsePayload);
}

export async function handleWorkbenchSetMode(
  context: WorkbenchHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const unavailable = missingServiceResponse(context, msg);
  if (unavailable) return unavailable;
  const { principalId, error } = requirePrincipal(context, client, msg);
  if (error) return error;
  const payload = msg.payload as WorkbenchSetModePayload;
  if (!payload?.executionMode || (!payload?.runId?.trim() && !payload?.batchId?.trim())) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "executionMode and either runId or batchId are required");
  }
  const result = await context.workbenchService!.setMode({ ...payload, principalId });
  return context.response(msg.id, MessageTypes.WORKBENCH_SET_MODE, result satisfies WorkbenchSetModeResponsePayload);
}

export async function handleWorkbenchListArtifacts(
  context: WorkbenchHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const unavailable = missingServiceResponse(context, msg);
  if (unavailable) return unavailable;
  const payload = msg.payload as WorkbenchListArtifactsPayload;
  if (!payload?.runId?.trim()) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "runId is required");
  }
  const artifacts = await context.workbenchService!.listArtifacts({ ...payload, principalId: client.publicKey ?? undefined });
  return context.response(msg.id, MessageTypes.WORKBENCH_LIST_ARTIFACTS, { artifacts } satisfies WorkbenchListArtifactsResponsePayload);
}

export async function handleWorkbenchGetPolicy(
  context: WorkbenchHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const unavailable = missingServiceResponse(context, msg);
  if (unavailable) return unavailable;
  const payload = (msg.payload ?? {}) as WorkbenchGetPolicyPayload;
  const policy = await context.workbenchService!.getPolicy({ ...payload, principalId: client.publicKey ?? undefined });
  return context.response(msg.id, MessageTypes.WORKBENCH_GET_POLICY, { policy } satisfies WorkbenchGetPolicyResponsePayload);
}

export async function handleWorkbenchUpdatePolicy(
  context: WorkbenchHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  const unavailable = missingServiceResponse(context, msg);
  if (unavailable) return unavailable;
  const { principalId, error } = requirePrincipal(context, client, msg);
  if (error) return error;
  const payload = (msg.payload ?? {}) as WorkbenchUpdatePolicyPayload;
  const policy = await context.workbenchService!.updatePolicy({ ...payload, principalId });
  return context.response(msg.id, MessageTypes.WORKBENCH_UPDATE_POLICY, { policy } satisfies WorkbenchUpdatePolicyResponsePayload);
}
