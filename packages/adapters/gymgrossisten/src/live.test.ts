/**
 * Hits the real site. Never run in CI. Usage:
 *   pnpm --filter @apokorg/adapter-gymgrossisten test:live
 *   RECORD_FIXTURES=1 pnpm --filter @apokorg/adapter-gymgrossisten test:live   (also saves fixtures)
 *
 * Refreshes the catalog index into an in-memory database first (4 sitemap requests, about
 * 25 s), then searches it. The shared catalog.db in the data dir is not touched.
 */
import { ProductOffer } from '@apokorg/core';
import { isRecording, saveFixture } from '@apokorg/adapter-kit';
import { CATALOG_SOURCES, openCatalogDb, refreshCatalog } from '@apokorg/catalog-index';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { BASE_URL, createAdapter, fetchPage, parseProductPage } from './index';
import { trimProductPage } from './fixtures';

const dir = fileURLToPath(new URL('..', import.meta.url));
const query = process.env.LIVE_QUERY ?? 'whey 80 1 kg vanilj';

/**
 * A single product on campaign, a master page with 31 flavours (one out of stock), one of its
 * variant URLs, and a bundle without an EAN.
 */
const PRODUCT_FIXTURES: Record<string, string> = {
  'product-kreatin.html': `${BASE_URL}/kreatin-monohydrat-500-g/609.html`,
  'product-whey80-master.html': `${BASE_URL}/whey-80-vassleprotein-1-kg/585R.html`,
  'product-whey80-cinnamon-bun.html': `${BASE_URL}/whey-80-1-kg-cinnamon-bun/58100.html`,
  'product-bundle.html': `${BASE_URL}/2-x-whey-80-vassleprotein-1-kg/SET2W80.html`,
};

describe('gymgrossisten live', () => {
  const db = openCatalogDb(':memory:');
  const adapter = createAdapter({ db });

  beforeAll(async () => {
    const result = await refreshCatalog('gymgrossisten', CATALOG_SOURCES.gymgrossisten, { db });
    console.log(result);
    expect(result.products).toBeGreaterThan(1000);
  }, 180_000);

  it(`searches "${query}" and re-fetches the first hit`, { timeout: 60_000 }, async () => {
    const started = Date.now();
    const offers = await adapter.search(query);
    const searchMs = Date.now() - started;
    console.table(
      offers.map((o) => ({
        id: o.merchantProductId,
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

    // A variant URL returns that variant, now with its EAN.
    const again = await adapter.getProduct(offers[0]!.url);
    console.log(again);
    expect(again?.merchantProductId).toBe(offers[0]!.merchantProductId);
    expect(again?.price).toBe(offers[0]!.price);
    expect(again?.ean).toMatch(/^\d{8,14}$/);
  });

  it.runIf(isRecording())('records fixtures', { timeout: 120_000 }, async () => {
    for (const [name, url] of Object.entries(PRODUCT_FIXTURES)) {
      const html = await fetchPage(url);
      const trimmed = trimProductPage(html);
      // Trimming must not change what the parser sees.
      const at = new Date().toISOString();
      expect(parseProductPage(trimmed, at)).toEqual(parseProductPage(html, at));
      await saveFixture(dir, name, trimmed);
    }
  });
});
