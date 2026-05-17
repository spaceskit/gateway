export interface IpBucket {
  tokens: number;
  lastRefillMs: number;
  lastActivityMs: number;
}

const IP_BUCKET_IDLE_EVICTION_MS = 10 * 60 * 1000;
const IP_BUCKET_EVICTION_INTERVAL_MS = 60_000;

export function createIpBucketEvictionTimer(
  ipBuckets: Map<string, IpBucket>,
): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    evictStaleIpBuckets(ipBuckets, Date.now());
  }, IP_BUCKET_EVICTION_INTERVAL_MS);

  if (timer.unref) {
    timer.unref();
  }
  return timer;
}

export function consumeHttpRateLimit(input: {
  ipBuckets: Map<string, IpBucket>;
  ip: string;
  rpm: number;
  nowMs?: number;
}): boolean {
  const now = input.nowMs ?? Date.now();
  const refillIntervalMs = 60_000 / input.rpm;

  let bucket = input.ipBuckets.get(input.ip);
  if (!bucket) {
    bucket = { tokens: input.rpm, lastRefillMs: now, lastActivityMs: now };
    input.ipBuckets.set(input.ip, bucket);
  }

  const elapsed = now - bucket.lastRefillMs;
  if (elapsed > 0) {
    const refilled = Math.floor(elapsed / refillIntervalMs);
    if (refilled > 0) {
      bucket.tokens = Math.min(input.rpm, bucket.tokens + refilled);
      bucket.lastRefillMs = now;
    }
  }

  bucket.lastActivityMs = now;

  if (bucket.tokens <= 0) {
    return false;
  }

  bucket.tokens -= 1;
  return true;
}

function evictStaleIpBuckets(ipBuckets: Map<string, IpBucket>, nowMs: number): void {
  const cutoff = nowMs - IP_BUCKET_IDLE_EVICTION_MS;
  for (const [ip, bucket] of ipBuckets) {
    if (bucket.lastActivityMs < cutoff) {
      ipBuckets.delete(ip);
    }
  }
}
