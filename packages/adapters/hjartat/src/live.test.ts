/**
 * Hits the real site. Never run in CI. Usage:
 *   pnpm --filter @apokorg/adapter-hjartat test:live
 *   RECORD_FIXTURES=1 pnpm --filter @apokorg/adapter-hjartat test:live   (also saves fixtures)
 */
import { ProductOffer } from '@apokorg/core';
import { fetchText, isRecording, saveFixture } from '@apokorg/adapter-kit';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import adapter, { parseProduct, parseSearch, searchUrl } from './index';
import { trimProductPage, trimSearchPage } from './fixtures';

const dir = fileURLToPath(new URL('..', import.meta.url));
const query = process.env.LIVE_QUERY ?? 'alvedon 500 mg 20 st';

/** Fixture name -> source URL. Searches: pharmacy, cosmetic/campaigns, Rx-only, no results. */
const SEARCH_FIXTURES: Record<string, { q: string; max?: number }> = {
  'search-alvedon.html': { q: 'alvedon' },
  'search-tandkram.html': { q: 'tandkräm' },
  // Prescription-only hits; a handful is enough to prove they are dropped.
  'search-atorvastatin.html': { q: 'atorvastatin', max: 8 },
  'search-noresults.html': { q: 'xyzzyqqnotaproduct' },
};
const PRODUCT_FIXTURES: Record<string, string> = {
  'product-alvedon.html': `${adapter.info.baseUrl}/varumarken/alvedon/alvedon-filmdragerad-tablett-500-mg-20-st`,
  'product-parodontax.html': `${adapter.info.baseUrl}/varumarken/parodontax/parodontax-ultra-clean-tandkram-75-ml`,
};

describe('hjartat live', () => {
  it(`searches "${query}" and re-fetches the first hit`, { timeout: 60_000 }, async () => {
    const started = Date.now();
    const offers = await adapter.search(query);
    const searchMs = Date.now() - started;
    console.table(
      offers.map((o) => ({
        title: o.title,
        price: o.price,
        originalPrice: o.originalPrice,
        ean: o.ean,
        inStock: o.inStock,
      })),
    );
    console.log(`search took ${searchMs} ms`);
    expect(searchMs).toBeLessThan(8000);
    expect(offers.length).toBeGreaterThan(0);
    for (const o of offers) ProductOffer.parse(o);

    const again = await adapter.getProduct(offers[0]!.url);
    expect(again?.merchantProductId).toBe(offers[0]!.merchantProductId);
    expect(again?.price).toBe(offers[0]!.price);
  });

  it.runIf(isRecording())('records fixtures', { timeout: 120_000 }, async () => {
    for (const [name, { q, max }] of Object.entries(SEARCH_FIXTURES)) {
      const html = await fetchText(searchUrl(q));
      const trimmed = trimSearchPage(html, max);
      // Trimming must not change what the parser sees. Capped fixtures are Rx-only (no offers).
      const at = new Date().toISOString();
      expect(parseSearch(trimmed, at)).toEqual(parseSearch(html, at));
      await saveFixture(dir, name, trimmed);
    }
    for (const [name, url] of Object.entries(PRODUCT_FIXTURES)) {
      const html = await fetchText(url);
      const trimmed = trimProductPage(html);
      const at = new Date().toISOString();
      expect(parseProduct(trimmed, url, at)).toEqual(parseProduct(html, url, at));
      await saveFixture(dir, name, trimmed);
    }
  });
});
