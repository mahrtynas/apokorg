/**
 * Checkout probes go through packages/checkout-probe, which hands probe scripts only a guarded
 * page. It is imported on first use, so the browser driver isn't loaded unless a probe runs, and
 * a build that leaves it out still starts.
 */
import { join } from 'node:path';
import type { CartFillRequest, MerchantAdapter, ProbeRequest, ProbeResult } from '@apokorg/core';
import type { CartFillOutcome, ProbeWithCacheOptions } from '@apokorg/checkout-probe';
import { defaultDataDir } from './db';

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

export type CartFillService = (
  adapter: MerchantAdapter,
  request: CartFillRequest,
) => Promise<CartFillOutcome>;

/**
 * Fills a store's cart in a visible Edge window with its own profile in the data directory,
 * so logins and carts survive between fills. The user finishes the order in that window.
 */
export const defaultCartFill =
  (dataDir: string = defaultDataDir()): CartFillService =>
  async (adapter, request) => {
    let mod: typeof import('@apokorg/checkout-probe');
    try {
      mod = await import('@apokorg/checkout-probe');
    } catch (err) {
      throw new Error('Filling carts is not available in this build', { cause: err });
    }
    return mod.runCartFill(adapter, request, { profileDir: join(dataDir, 'browser-profile') });
  };
