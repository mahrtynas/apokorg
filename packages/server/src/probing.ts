/**
 * Checkout probes go through packages/checkout-probe, which hands probe scripts only a guarded
 * page. It is imported on first use, so the browser driver isn't loaded unless a probe runs, and
 * a build that leaves it out still starts.
 */
import type { MerchantAdapter, ProbeRequest, ProbeResult } from '@apokorg/core';
import type { ProbeWithCacheOptions } from '@apokorg/checkout-probe';

export type ProbeService = (
  adapter: MerchantAdapter,
  request: ProbeRequest,
  opts: Pick<ProbeWithCacheOptions, 'cache' | 'orderValue'>,
) => Promise<ProbeResult>;

export const defaultProbe: ProbeService = async (adapter, request, opts) => {
  let mod: typeof import('@apokorg/checkout-probe');
  try {
    mod = await import('@apokorg/checkout-probe');
  } catch (err) {
    throw new Error('Checkout probes are not available in this build', { cause: err });
  }
  return mod.probeWithCache(adapter, request, opts);
};
