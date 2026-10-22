import type { MerchantAdapter, ProbeRequest, ProbeResult } from '@apokorg/core';
import { describe, expect, it, vi } from 'vitest';
import { probeWithCache, type ProbeCache } from './cache';
import type { runProbe } from './run';

const request: ProbeRequest = { items: [], postcode: '11738', email: 'probe@example.com' };
const adapter = { info: { id: 'mock' } } as MerchantAdapter;

const result = (status: ProbeResult['status'], fee = 49): ProbeResult => ({
  merchantId: 'mock',
  orderValue: 250,
  postcode: '11738',
  options: [{ id: 'ombud', name: 'Ombud', kind: 'pickup-point', fee }],
  probedAt: new Date(0).toISOString(),
  status,
});

function memoryCache(): ProbeCache & { rows: ProbeResult[] } {
  const rows: ProbeResult[] = [];
  return {
    rows,
    get: (merchantId, postcode, orderValue) =>
      rows.find(
        (r) =>
          r.merchantId === merchantId &&
          r.postcode === postcode &&
          Math.floor(r.orderValue / 100) === Math.floor(orderValue / 100),
      ) ?? null,
    set: (r) => void rows.push(r),
  };
}

describe('probeWithCache', () => {
  it('returns a cached result without probing', async () => {
    const cache = memoryCache();
    cache.rows.push(result('ok', 29));
    const run = vi.fn<typeof runProbe>();
    const got = await probeWithCache(adapter, request, { cache, orderValue: 299, run });
    expect(got.options[0]?.fee).toBe(29);
    expect(run).not.toHaveBeenCalled();
  });

  it('probes on a miss and caches ok and unsupported results', async () => {
    for (const status of ['ok', 'unsupported'] as const) {
      const cache = memoryCache();
      const run = vi.fn<typeof runProbe>(async () => result(status));
      await probeWithCache(adapter, request, { cache, orderValue: 250, run });
      expect(run).toHaveBeenCalledWith(adapter, request, { orderValue: 250 });
      expect(cache.rows).toEqual([result(status)]);
    }
  });

  it('does not cache failures', async () => {
    const cache = memoryCache();
    const run = vi.fn<typeof runProbe>(async () => ({
      ...result('failed'),
      message: 'timeout: x',
    }));
    await probeWithCache(adapter, request, { cache, orderValue: 250, run });
    expect(cache.rows).toEqual([]);
  });

  it('runs one probe at a time per store, so a concurrent request hits the cache', async () => {
    const cache = memoryCache();
    let running = 0;
    let maxRunning = 0;
    const run = vi.fn<typeof runProbe>(async () => {
      maxRunning = Math.max(maxRunning, ++running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
      return result('ok');
    });
    const [a, b] = await Promise.all([
      probeWithCache(adapter, request, { cache, orderValue: 250, run }),
      probeWithCache(adapter, request, { cache, orderValue: 260, run }),
    ]);
    expect(a).toEqual(b);
    expect(run).toHaveBeenCalledTimes(1);
    expect(maxRunning).toBe(1);
  });
});
