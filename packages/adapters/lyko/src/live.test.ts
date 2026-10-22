/**
 * Hits the real site. Never run in CI. Usage:
 *   pnpm --filter @apokorg/adapter-lyko test:live
 *   RECORD_FIXTURES=1 pnpm --filter @apokorg/adapter-lyko test:live   (also saves fixtures)
 *
 * If Lyko's Queue-it waiting room is active the search throws a QueueError; don't retry in a
 * loop, try again later.
 */
import { ProductOffer } from '@apokorg/core';
import { isRecording, saveFixture } from '@apokorg/adapter-kit';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import adapter, { fetchPage, parseProduct, parseSearch, searchUrl } from './index';
import { trimProductPage, trimSearchPage } from './fixtures';

const dir = fileURLToPath(new URL('..', import.meta.url));
const query = process.env.LIVE_QUERY ?? 'olaplex no.4 shampoo';

/**
 * Fixture name -> query. Searches: hair care (campaigns and Combo Deals), toothpaste (the
 * pharmacy-like aisle, with out-of-stock items), a query that redirects to a category page,
 * and no results (letters always fuzzy-match something; digits don't).
 */
const SEARCH_FIXTURES: Record<string, { q: string; max?: number }> = {
  'search-schampo.html': { q: 'schampo' },
  'search-tandkram.html': { q: 'tandkräm' },
  'search-parfym-redirect.html': { q: 'parfym', max: 6 },
  'search-noresults.html': { q: '9999999999' },
};
const PRODUCT_FIXTURES: Record<string, string> = {
  'product-olaplex.html': `${adapter.info.baseUrl}/olaplex/olaplex---bond-maintenance-shampoo-no4`,
  'product-elvital-combo.html': `${adapter.info.baseUrl}/loreal-paris/l-or-al-paris-elvital-hyaluron-pure--purifying-shampoo-250-ml`,
};

describe('lyko live', () => {
  it(`searches "${query}" and re-fetches the first hit`, { timeout: 60_000 }, async () => {
    const started = Date.now();
    const offers = await adapter.search(query);
    const searchMs = Date.now() - started;
    console.table(
      offers.map((o) => ({
        title: o.title,
        price: o.price,
        originalPrice: o.originalPrice,
        memberPrice: o.memberPrice,
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
    expect(again?.ean).toMatch(/^\d{8,14}$/);
  });

  it.runIf(isRecording())('records fixtures', { timeout: 120_000 }, async () => {
    for (const [name, { q, max }] of Object.entries(SEARCH_FIXTURES)) {
      const html = await fetchPage(searchUrl(q));
      const trimmed = trimSearchPage(html, max);
      // Trimming must not change what the parser sees.
      const at = new Date().toISOString();
      expect(parseSearch(trimmed, at)).toEqual(parseSearch(html, at).slice(0, max));
      await saveFixture(dir, name, trimmed);
    }
    for (const [name, url] of Object.entries(PRODUCT_FIXTURES)) {
      const html = await fetchPage(url);
      const trimmed = trimProductPage(html);
      const at = new Date().toISOString();
      expect(parseProduct(trimmed, url, at)).toEqual(parseProduct(html, url, at));
      await saveFixture(dir, name, trimmed);
    }
  });
});
