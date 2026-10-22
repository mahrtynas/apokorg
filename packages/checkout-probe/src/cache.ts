import type { MerchantAdapter, MerchantId, ProbeRequest, ProbeResult } from '@apokorg/core';
import { runProbe, type RunProbeOptions } from './run';

/**
 * Storage for probe results, 24 h per store, postcode and order-value band. The server backs it
 * with its `probe_cache` table: `{ get: repo.getCachedProbe, set: repo.cacheProbe }` (bound).
 */
export interface ProbeCache {
  get(
    merchantId: MerchantId,
    postcode: string,
    orderValue: number,
  ): ProbeResult | null | Promise<ProbeResult | null>;
  set(result: ProbeResult): void | Promise<void>;
}

export interface ProbeWithCacheOptions extends RunProbeOptions {
  cache: ProbeCache;
  /** The order value to look up and probe for, usually the store's subtotal in the split. */
  orderValue: number;
  /** Replaces runProbe, for tests. */
  run?: typeof runProbe;
}

// One probe at a time per store (CLAUDE.md: never run in parallel against one store).
const queues = new Map<MerchantId, Promise<unknown>>();

/**
 * Returns the cached result when there is one, otherwise runs the probe and caches `ok` and
 * `unsupported` results. Failures (timeout, layout-changed, edge-not-found, …) are returned but
 * not cached, so the next run tries again.
 */
export function probeWithCache(
  adapter: MerchantAdapter,
  request: ProbeRequest,
  opts: ProbeWithCacheOptions,
): Promise<ProbeResult> {
  const { cache, run = runProbe, ...runOpts } = opts;
  const id = adapter.info.id;
  const task = async (): Promise<ProbeResult> => {
    const cached = await cache.get(id, request.postcode, opts.orderValue);
    if (cached) return cached;
    const result = await run(adapter, request, runOpts);
    if (result.status !== 'failed') await cache.set(result);
    return result;
  };
  const next = (queues.get(id) ?? Promise.resolve()).then(task, task);
  const settled = next.catch(() => {});
  queues.set(id, settled);
  void settled.then(() => {
    if (queues.get(id) === settled) queues.delete(id);
  });
  return next;
}
