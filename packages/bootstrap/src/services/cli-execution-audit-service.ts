import { randomUUID } from "node:crypto";
import type {
  CliExecutionObserver,
  CliExecutionObserverEvent,
  EventBus,
} from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import {
  ArtifactRepository,
  SpaceRepository,
} from "@spaceskit/persistence";
import { sanitizeTracePayload } from "./trace-payload-sanitizer.js";

export const CLI_EXECUTION_TRANSCRIPT_ARTIFACT_TYPE = "cli_execution_transcript";
export const CLI_EXECUTION_TRANSCRIPT_ARTIFACT_TAGS = ["debug", "cli_execution", "transcript"] as const;

export interface CliExecutionAuditServiceOptions {
  artifacts: ArtifactRepository;
  spaces: SpaceRepository;
  eventBus: EventBus;
  logger?: Logger;
  maxTranscriptBytes?: number;
}

export interface CreateCliExecutionObserverInput {
  spaceId: string;
  turnId: string;
  agentId?: string;
  stepIndex: number;
  providerId: string;
  modelId: string;
}

export interface CliExecutionTranscriptArtifactMetadata {
  artifactId?: string;
  transcriptTruncated: boolean;
}

export function isCliExecutionTranscriptArtifact(type: string, tags: string[] = []): boolean {
  if (type.trim().toLowerCase() === CLI_EXECUTION_TRANSCRIPT_ARTIFACT_TYPE) {
    return true;
  }
  const normalizedTags = new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean));
  return normalizedTags.has("cli_execution") && normalizedTags.has("transcript");
}

export class CliExecutionAuditService {
  private readonly logger?: Logger;
  private readonly maxTranscriptBytes: number;

  constructor(private readonly options: CliExecutionAuditServiceOptions) {
    this.logger = options.logger;
    this.maxTranscriptBytes = options.maxTranscriptBytes ?? 512 * 1024;
  }

  createObserver(input: CreateCliExecutionObserverInput): CliExecutionObserver {
    const session = new CliExecutionAuditSession({
      ...input,
      artifacts: this.options.artifacts,
      spaces: this.options.spaces,
      eventBus: this.options.eventBus,
      maxTranscriptBytes: this.maxTranscriptBytes,
    });

    return async (event) => {
      try {
        await session.handle(event);
      } catch (error) {
        this.logger?.warn("CLI execution audit observer failed", {
          spaceId: input.spaceId,
          turnId: input.turnId,
          stepIndex: input.stepIndex,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
  }
}

interface CliExecutionAuditSessionOptions extends CreateCliExecutionObserverInput {
  artifacts: ArtifactRepository;
  spaces: SpaceRepository;
  eventBus: EventBus;
  maxTranscriptBytes: number;
}

class CliExecutionAuditSession {
  private readonly executionId = `cli-exec-${randomUUID()}`;
  private readonly transcriptLines: string[] = [];
  private readonly maxTranscriptBytes: number;
  private transcriptBytes = 0;
  private transcriptTruncated = false;
  private finalized = false;

  private startedAt: string | undefined;
  private workingDirectory: string | undefined;
  private commandPreview: string | undefined;
  private providerId: string;
  private modelId: string;

  constructor(private readonly options: CliExecutionAuditSessionOptions) {
    this.maxTranscriptBytes = options.maxTranscriptBytes;
    this.providerId = options.providerId;
    this.modelId = options.modelId;
  }

  async handle(event: CliExecutionObserverEvent): Promise<void> {
    if (this.finalized) return;

    switch (event.type) {
      case "started":
        this.startedAt = event.startedAt;
        this.providerId = event.providerId || this.providerId;
        this.modelId = event.modelId || this.modelId;
        this.workingDirectory = normalizeOptionalString(event.workingDirectory);
        this.commandPreview = normalizeOptionalString(event.commandPreview);
        this.appendTranscriptLine({
          type: "started",
          executionId: this.executionId,
          stepIndex: this.options.stepIndex,
          ...sanitizeTracePayload({
            mode: event.mode,
            startedAt: event.startedAt,
            providerId: this.providerId,
            modelId: this.modelId,
            workingDirectory: this.workingDirectory,
            commandPreview: this.commandPreview,
          }),
        });
        this.emitTurnEvent("cli_execution.started", {
          executionId: this.executionId,
          stepIndex: this.options.stepIndex,
          agentId: this.options.agentId,
          providerId: this.providerId,
          modelId: this.modelId,
          status: "running",
          startedAt: event.startedAt,
          workingDirectory: this.workingDirectory,
          commandPreview: this.commandPreview,
        }, event.startedAt);
        return;
      case "stdout":
        this.appendTranscriptLine({
          type: "stdout",
          executionId: this.executionId,
          chunk: event.chunk,
        });
        return;
      case "stderr":
        this.appendTranscriptLine({
          type: "stderr",
          executionId: this.executionId,
          chunk: event.chunk,
        });
        return;
      case "parsed":
        this.appendTranscriptLine({
          type: "parsed",
          executionId: this.executionId,
          chunk: event.chunk,
        });
        return;
      case "completed":
        this.appendTranscriptLine({
          type: "completed",
          executionId: this.executionId,
          stepIndex: this.options.stepIndex,
          ...sanitizeTracePayload({
            completedAt: event.completedAt,
            durationMs: event.durationMs,
            exitCode: event.exitCode,
          }),
        });
        await this.finalize({
          status: event.exitCode === 0 ? "completed" : "failed",
          completedAt: event.completedAt,
          durationMs: event.durationMs,
          exitCode: event.exitCode,
        });
        return;
      case "failed":
        this.appendTranscriptLine({
          type: "failed",
          executionId: this.executionId,
          stepIndex: this.options.stepIndex,
          ...sanitizeTracePayload({
            completedAt: event.completedAt,
            durationMs: event.durationMs,
            errorMessage: event.errorMessage,
          }),
        });
        await this.finalize({
          status: "failed",
          completedAt: event.completedAt,
          durationMs: event.durationMs,
          errorMessage: event.errorMessage,
        });
        return;
    }
  }

  private async finalize(input: {
    status: "completed" | "failed";
    completedAt: string;
    durationMs: number;
    exitCode?: number;
    errorMessage?: string;
  }): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;

    const transcriptArtifact = this.persistTranscriptArtifact();
    this.emitTurnEvent("cli_execution.completed", {
      executionId: this.executionId,
      stepIndex: this.options.stepIndex,
      agentId: this.options.agentId,
      providerId: this.providerId,
      modelId: this.modelId,
      status: input.status,
      startedAt: this.startedAt,
      completedAt: input.completedAt,
      durationMs: input.durationMs,
      workingDirectory: this.workingDirectory,
      exitCode: input.exitCode,
      commandPreview: this.commandPreview,
      transcriptArtifactId: transcriptArtifact.artifactId,
      transcriptTruncated: transcriptArtifact.transcriptTruncated,
      errorMessage: input.errorMessage,
    }, input.completedAt);
  }

  private persistTranscriptArtifact(): CliExecutionTranscriptArtifactMetadata {
    const space = this.options.spaces.getById(this.options.spaceId);
    if (!space) {
      return { transcriptTruncated: this.transcriptTruncated };
    }

    const artifactId = `artifact-${randomUUID()}`;
    const transcriptContent = this.transcriptLines.join("\n");
    this.options.artifacts.create({
      artifactId,
      spaceId: this.options.spaceId,
      resourceId: space.resource_id,
      turnId: this.options.turnId,
      agentId: this.options.agentId,
      type: CLI_EXECUTION_TRANSCRIPT_ARTIFACT_TYPE,
      title: `CLI execution transcript • Step ${this.options.stepIndex + 1}`,
      mimeType: "application/x-ndjson",
      contentJson: JSON.stringify(transcriptContent),
      tagsJson: JSON.stringify([...CLI_EXECUTION_TRANSCRIPT_ARTIFACT_TAGS]),
      visibility: "private",
    });

    return {
      artifactId,
      transcriptTruncated: this.transcriptTruncated,
    };
  }

  private emitTurnEvent(
    eventType: string,
    payload: Record<string, unknown>,
    timestamp?: string,
  ): void {
    this.options.eventBus.emit({
      type: "space.turn_event",
      spaceId: this.options.spaceId,
      turnId: this.options.turnId,
      agentId: this.options.agentId,
      event: {
        type: eventType,
        ...sanitizeTracePayload(payload),
      },
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    });
  }

  private appendTranscriptLine(value: Record<string, unknown>): void {
    const line = JSON.stringify(value);
    const nextBytes = Buffer.byteLength(`${line}\n`, "utf8");
    if (this.transcriptBytes + nextBytes > this.maxTranscriptBytes) {
      this.transcriptTruncated = true;
      return;
    }
    this.transcriptLines.push(line);
    this.transcriptBytes += nextBytes;
  }
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
