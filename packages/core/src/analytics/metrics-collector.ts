/**
 * Analytics / Metrics — POST-MVP STUB
 *
 * This module provides the interfaces for gateway performance metrics.
 * Implementation deferred to post-MVP. See STATUS.md for details.
 *
 * TODO: Implement after MVP
 * - Counter, gauge, and histogram metric types
 * - Auto-subscribe to EventBus events (turn, capability, security, plugin, DLQ)
 * - Prometheus text exposition format output
 * - Periodic flush with EventBus emission
 */

/**
 * Supported metric types
 */
export type MetricType = "counter" | "gauge" | "histogram";

/**
 * A single metric data point
 */
export interface MetricPoint {
  name: string;
  type: MetricType;
  value: number;
  labels: Record<string, string>;
  timestamp: Date;
}

/**
 * Histogram bucket data structure
 */
export interface HistogramBuckets {
  buckets: number[];
  counts: number[];
  sum: number;
  count: number;
}

/**
 * Complete metrics snapshot
 */
export interface MetricsSnapshot {
  collectedAt: Date;
  uptime: number;
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, HistogramBuckets>;
}

/**
 * Configuration options for MetricsCollector
 */
export interface MetricsCollectorOptions {
  eventBus: unknown;
  flushIntervalMs?: number;
  histogramBuckets?: number[];
}

/**
 * Collects and reports gateway metrics — stub implementation.
 * TODO: Implement after MVP.
 */
export class MetricsCollector {
  constructor(_options: MetricsCollectorOptions) {
    // Post-MVP
  }

  incrementCounter(_name: string, _labels?: Record<string, string>, _amount?: number): void {
    // no-op stub
  }

  setGauge(_name: string, _value: number, _labels?: Record<string, string>): void {
    // no-op stub
  }

  recordHistogram(_name: string, _value: number, _labels?: Record<string, string>): void {
    // no-op stub
  }

  getSnapshot(): MetricsSnapshot {
    return {
      collectedAt: new Date(),
      uptime: 0,
      counters: {},
      gauges: {},
      histograms: {},
    };
  }

  formatPrometheus(): string {
    return "# MetricsCollector is a post-MVP stub\n";
  }

  start(): void {
    // no-op stub
  }

  stop(): void {
    // no-op stub
  }

  reset(): void {
    // no-op stub
  }
}
