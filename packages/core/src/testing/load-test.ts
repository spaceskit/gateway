/**
 * Load Testing Infrastructure — POST-MVP STUB
 *
 * This module provides the interfaces for load testing Spaceskit.
 * Implementation deferred to post-MVP. See STATUS.md for details.
 *
 * TODO: Implement after MVP
 * - Semaphore-based concurrency control
 * - Ramp-up phase with gradual concurrency increase
 * - Percentile latency metrics (p50/p95/p99)
 * - Report generation
 */

/**
 * Configuration for load testing Spaceskit
 */
export interface LoadTestConfig {
  /** Number of concurrent operations */
  concurrency: number;
  /** Total number of requests to execute */
  totalRequests: number;
  /** Ramp-up duration in milliseconds */
  rampUpMs: number;
  /** Total test duration in milliseconds */
  testDurationMs: number;
  /** WebSocket URL for testing (optional) */
  targetUrl?: string;
  /** Space ID to run turns against. Default: "load-test-space". */
  targetSpaceId?: string;
  /** Type of operation to perform */
  operationType: "executeTurn" | "createSpace" | "mixedWorkload";
}

/**
 * Results from a load test execution
 */
export interface LoadTestResult {
  totalRequests: number;
  successCount: number;
  failCount: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  maxLatencyMs: number;
  minLatencyMs: number;
  requestsPerSecond: number;
  durationMs: number;
  errors: string[];
}

/**
 * Load test runner — stub implementation.
 * TODO: Implement after MVP.
 */
export class LoadTestRunner {
  constructor(
    _spaceManager: unknown,
    _eventBus: unknown,
    _config: LoadTestConfig,
  ) {
    // Post-MVP: wire SpaceManager + EventBus
  }

  async run(): Promise<LoadTestResult> {
    throw new Error("LoadTestRunner is a post-MVP stub. Not yet implemented.");
  }

  stop(): void {
    // no-op
  }

  generateReport(_result: LoadTestResult): string {
    return "LoadTestRunner is a post-MVP stub. Not yet implemented.";
  }
}

/**
 * Compute the nth percentile of a sorted array of numbers
 */
export function computePercentile(sortedLatencies: number[], p: number): number {
  if (sortedLatencies.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedLatencies.length) - 1;
  return Math.round(sortedLatencies[Math.max(0, index)] * 100) / 100;
}

/**
 * Format a duration in milliseconds to a human-readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(2)}m`;
  return `${(minutes / 60).toFixed(2)}h`;
}
