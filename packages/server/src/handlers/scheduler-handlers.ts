import { randomUUID } from "node:crypto";
import type { ErrorPayload } from "../protocol.js";
import {
  MessageTypes,
  type GatewayMessage,
  type OrchestratorCommandPayload,
  type OrchestratorCommandResponsePayload,
  type OrchestratorGetCommandPayload,
  type SchedulerCreateJobPayload,
  type SchedulerCreateJobResponsePayload,
  type SchedulerDeleteJobPayload,
  type SchedulerDeleteJobResponsePayload,
  type SchedulerListEvalDefinitionsPayload,
  type SchedulerListEvalDefinitionsResponsePayload,
  type SchedulerGetJobPayload,
  type SchedulerGetJobResponsePayload,
  type SchedulerLinkSpacePayload,
  type SchedulerLinkSpaceResponsePayload,
  type SchedulerListJobsPayload,
  type SchedulerListJobsResponsePayload,
  type SchedulerListRunsPayload,
  type SchedulerListRunsResponsePayload,
  type SchedulerRunNowPayload,
  type SchedulerRunNowResponsePayload,
  type SchedulerUnlinkSpacePayload,
  type SchedulerUnlinkSpaceResponsePayload,
  type SchedulerUpdateJobPayload,
  type SchedulerUpdateJobResponsePayload,
} from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type { OrchestratorCommandService, SchedulerService } from "../message-router-gateway-services.js";

export interface SchedulerHandlerContext {
  orchestratorCommandService: OrchestratorCommandService | null;
  schedulerService: SchedulerService | null;
  resolveSpaceUid: (spaceIdRaw: string) => Promise<string>;
  response: (correlationId: string, type: string, payload?: unknown) => GatewayMessage;
  errorResponse: (
    correlationId: string,
    code: ErrorPayload["code"],
    message: string,
    errDetails?: unknown,
  ) => GatewayMessage;
  broadcastToSpace: (spaceUid: string, msg: GatewayMessage) => void;
}

export async function handleSchedulerCreateJob(
  context: SchedulerHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.schedulerService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Scheduler service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }

  const payload = msg.payload as SchedulerCreateJobPayload;
  if (!payload?.name?.trim() || !payload?.primarySpaceId?.trim() || !payload?.timezone?.trim()) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "name, primarySpaceId, and timezone are required");
  }
  if (!payload.schedulePreset || !payload.action) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "schedulePreset and action are required");
  }

  const job = await context.schedulerService.createJob({
    ...payload,
    principalId: client.publicKey,
  });
  return context.response(msg.id, MessageTypes.SCHEDULER_CREATE_JOB, {
    job,
  } satisfies SchedulerCreateJobResponsePayload);
}

export async function handleSchedulerGetJob(
  context: SchedulerHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.schedulerService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Scheduler service unavailable");
  }
  const payload = msg.payload as SchedulerGetJobPayload;
  if (!payload?.jobId?.trim()) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "jobId is required");
  }

  const job = await context.schedulerService.getJob({
    ...payload,
    principalId: client.publicKey ?? undefined,
  });
  if (!job) {
    return context.errorResponse(msg.id, "NOT_FOUND", `Scheduler job not found: ${payload.jobId}`);
  }

  return context.response(msg.id, MessageTypes.SCHEDULER_GET_JOB, {
    job,
  } satisfies SchedulerGetJobResponsePayload);
}

export async function handleSchedulerListJobs(
  context: SchedulerHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.schedulerService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Scheduler service unavailable");
  }

  const payload = (msg.payload ?? {}) as SchedulerListJobsPayload;
  const jobs = await context.schedulerService.listJobs({
    ...payload,
    principalId: client.publicKey ?? undefined,
  });
  return context.response(msg.id, MessageTypes.SCHEDULER_LIST_JOBS, {
    jobs,
  } satisfies SchedulerListJobsResponsePayload);
}

export async function handleSchedulerListEvalDefinitions(
  context: SchedulerHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.schedulerService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Scheduler service unavailable");
  }

  const payload = (msg.payload ?? {}) as SchedulerListEvalDefinitionsPayload;
  const definitions = await context.schedulerService.listEvalDefinitions(payload);
  return context.response(msg.id, MessageTypes.SCHEDULER_LIST_EVAL_DEFINITIONS, {
    definitions,
  } satisfies SchedulerListEvalDefinitionsResponsePayload);
}

export async function handleSchedulerUpdateJob(
  context: SchedulerHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.schedulerService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Scheduler service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }
  const payload = msg.payload as SchedulerUpdateJobPayload;
  if (!payload?.jobId?.trim()) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "jobId is required");
  }

  const job = await context.schedulerService.updateJob({
    ...payload,
    principalId: client.publicKey,
  });
  return context.response(msg.id, MessageTypes.SCHEDULER_UPDATE_JOB, {
    job,
  } satisfies SchedulerUpdateJobResponsePayload);
}

export async function handleSchedulerDeleteJob(
  context: SchedulerHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.schedulerService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Scheduler service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }
  const payload = msg.payload as SchedulerDeleteJobPayload;
  if (!payload?.jobId?.trim()) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "jobId is required");
  }

  const result = await context.schedulerService.deleteJob({
    ...payload,
    principalId: client.publicKey,
  });
  return context.response(msg.id, MessageTypes.SCHEDULER_DELETE_JOB, result satisfies SchedulerDeleteJobResponsePayload);
}

export async function handleSchedulerLinkSpace(
  context: SchedulerHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.schedulerService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Scheduler service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }
  const payload = msg.payload as SchedulerLinkSpacePayload;
  if (!payload?.jobId?.trim() || !payload?.spaceId?.trim()) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "jobId and spaceId are required");
  }

  const job = await context.schedulerService.linkSpace({
    ...payload,
    principalId: client.publicKey,
  });
  return context.response(msg.id, MessageTypes.SCHEDULER_LINK_SPACE, {
    job,
  } satisfies SchedulerLinkSpaceResponsePayload);
}

export async function handleSchedulerUnlinkSpace(
  context: SchedulerHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.schedulerService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Scheduler service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }
  const payload = msg.payload as SchedulerUnlinkSpacePayload;
  if (!payload?.jobId?.trim() || !payload?.spaceId?.trim()) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "jobId and spaceId are required");
  }

  const job = await context.schedulerService.unlinkSpace({
    ...payload,
    principalId: client.publicKey,
  });
  return context.response(msg.id, MessageTypes.SCHEDULER_UNLINK_SPACE, {
    job,
  } satisfies SchedulerUnlinkSpaceResponsePayload);
}

export async function handleSchedulerListRuns(
  context: SchedulerHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.schedulerService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Scheduler service unavailable");
  }
  const payload = msg.payload as SchedulerListRunsPayload;
  if (!payload?.jobId?.trim()) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "jobId is required");
  }

  const result = await context.schedulerService.listRuns({
    ...payload,
    principalId: client.publicKey ?? undefined,
  });
  return context.response(msg.id, MessageTypes.SCHEDULER_LIST_RUNS, result satisfies SchedulerListRunsResponsePayload);
}

export async function handleSchedulerRunNow(
  context: SchedulerHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.schedulerService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Scheduler service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }
  const payload = msg.payload as SchedulerRunNowPayload;
  if (!payload?.jobId?.trim()) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "jobId is required");
  }

  const result = await context.schedulerService.runNow({
    ...payload,
    principalId: client.publicKey,
  });
  return context.response(msg.id, MessageTypes.SCHEDULER_RUN_NOW, result satisfies SchedulerRunNowResponsePayload);
}

export async function handleOrchestratorCommand(
  context: SchedulerHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.orchestratorCommandService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Orchestrator command service unavailable");
  }

  const payload = msg.payload as OrchestratorCommandPayload;
  if (!payload?.commandType) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "commandType is required");
  }
  if (!payload?.targetSpaceId?.trim()) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "targetSpaceId is required");
  }

  const command = await context.orchestratorCommandService.submitCommand({
    ...payload,
    principalId: client.publicKey,
    deviceId: client.deviceId,
  });
  const latestEvent = command.events[command.events.length - 1];
  if (latestEvent) {
    const targetSpaceUid = await context.resolveSpaceUid(command.targetSpaceId);
    context.broadcastToSpace(targetSpaceUid, {
      type: MessageTypes.ORCHESTRATOR_EVENT,
      id: randomUUID(),
      ts: new Date().toISOString(),
      payload: {
        commandId: command.commandId,
        correlationId: command.correlationId,
        status: latestEvent.status,
        event: latestEvent.event,
        createdAt: latestEvent.createdAt,
      },
    });
  }

  return context.response(msg.id, MessageTypes.ORCHESTRATOR_COMMAND, {
    command,
  } satisfies OrchestratorCommandResponsePayload);
}

export async function handleOrchestratorGetCommand(
  context: SchedulerHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.orchestratorCommandService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Orchestrator command service unavailable");
  }
  const payload = msg.payload as OrchestratorGetCommandPayload;
  if (!payload?.commandId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "commandId is required");
  }

  const command = context.orchestratorCommandService.getCommand(payload.commandId);
  if (!command) {
    return context.errorResponse(msg.id, "NOT_FOUND", `Orchestrator command not found: ${payload.commandId}`);
  }

  return context.response(msg.id, MessageTypes.ORCHESTRATOR_GET_COMMAND, {
    command,
  } satisfies OrchestratorCommandResponsePayload);
}
