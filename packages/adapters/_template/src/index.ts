/**
 * __NAME__ adapter. Endpoints and quirks: docs/stores/__ID__.md
 */
import type { MerchantAdapter, ProductOffer } from '@apokorg/core';
import { fetchText } from '@apokorg/adapter-kit';

export const BASE_URL = '__BASE_URL__';

/** Pure parsing, kept separate from fetching so unit tests can run on fixtures. */
export function parseSearch(_body: string): ProductOffer[] {
  // TODO: map the store's search response to ProductOffer[].
  return [];
}

export function parseProduct(_html: string, _url: string): ProductOffer | null {
  // TODO: map a product page to a ProductOffer.
  return null;
}

const adapter: MerchantAdapter = {
  info: {
    id: '__ID__',
    name: '__NAME__',
    baseUrl: BASE_URL,
    category: '__CATEGORY__',
    searchStrategy: '__STRATEGY__',
  },
  async search(query, opts) {
    const body = await fetchText(`${BASE_URL}/TODO?q=${encodeURIComponent(query)}`, {
      signal: opts?.signal,
    });
    return parseSearch(body).slice(0, opts?.limit ?? 10);
  },
  async getProduct(url, opts) {
    return parseProduct(await fetchText(url, { signal: opts?.signal }), url);
  },
};

export default adapter;
