import type {
  GenerateOptions,
  GenerateResult,
  ModelInfo,
  ModelProvider,
  StreamChunk,
} from "@spaceskit/core";
import { UnsupportedProviderError } from "./provider-errors.js";

export class UnsupportedModelProvider implements ModelProvider {
  readonly id: string;
  readonly name: string;
  readonly isLocal: boolean;

  private readonly detail: string;

  constructor(input: {
    id: string;
    name: string;
    isLocal?: boolean;
    detail: string;
  }) {
    this.id = input.id;
    this.name = input.name;
    this.isLocal = input.isLocal ?? false;
    this.detail = input.detail;
  }

  async checkHealth(): Promise<{ available: boolean; latencyMs?: number }> {
    return { available: false, latencyMs: 0 };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }

  async generate(_model: string, _options: GenerateOptions): Promise<GenerateResult> {
    throw new UnsupportedProviderError(this.id, this.detail);
  }

  async *stream(_model: string, _options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new UnsupportedProviderError(this.id, this.detail);
    yield { type: "finish", finishReason: "error" };
  }
}
