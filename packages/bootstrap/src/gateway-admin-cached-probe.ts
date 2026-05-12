export interface CachedCatalogProbeEntry<T> {
  expiresAt: number;
  value: T;
}

export async function runCachedCatalogProbe<T>(input: {
  cache: Map<string, CachedCatalogProbeEntry<T>>;
  inFlight: Map<string, Promise<T>>;
  cacheKey: string;
  forceRefresh: boolean;
  ttlMs: number;
  cloneValue: (value: T) => T;
  buildValue: () => Promise<T>;
}): Promise<T> {
  const {
    cache,
    inFlight,
    cacheKey,
    forceRefresh,
    ttlMs,
    cloneValue,
    buildValue,
  } = input;

  const now = Date.now();
  if (forceRefresh) {
    cache.delete(cacheKey);
    inFlight.delete(cacheKey);
  }

  const cached = cache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cloneValue(cached.value);
  }

  const existingRequest = forceRefresh ? undefined : inFlight.get(cacheKey);
  if (existingRequest) {
    return cloneValue(await existingRequest);
  }

  const requestPromise = buildValue();
  inFlight.set(cacheKey, requestPromise);
  const value = await requestPromise;
  inFlight.delete(cacheKey);
  cache.set(cacheKey, {
    expiresAt: Date.now() + ttlMs,
    value,
  });
  return cloneValue(value);
}
