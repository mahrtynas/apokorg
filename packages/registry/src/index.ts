import type { MerchantAdapter } from '@apokorg/core';
import { createMockAdapters, type MockOptions } from '@apokorg/adapter-mock';
import { generatedAdapters } from './generated';

export interface LoadAdaptersOptions {
  /** Serve fake data for every v1 merchant instead of hitting real sites. */
  mock?: boolean | MockOptions;
}

/**
 * All adapters the server should use. Real adapters come from packages/adapters/<id>
 * (discovered by scripts/gen-registry.mjs); mock mode replaces them with fixture data.
 */
export function loadAdapters(opts: LoadAdaptersOptions = {}): MerchantAdapter[] {
  if (opts.mock) return createMockAdapters(opts.mock === true ? {} : opts.mock);
  return generatedAdapters;
}
