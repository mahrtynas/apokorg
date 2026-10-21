/**
 * Hits the real site. Never run in CI. Usage:
 *   pnpm --filter @apokorg/adapter-apoteket test:live
 *   RECORD_FIXTURES=1 pnpm --filter @apokorg/adapter-apoteket test:live   (also saves fixtures)
 */
import { ProductOffer } from '@apokorg/core';
import { fetchText, isRecording, saveFixture } from '@apokorg/adapter-kit';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import adapter, { BASE_URL, searchRaw } from './index';
import { trimProductHtml, trimSearchBody } from './trim';

const dir = fileURLToPath(new URL('..', import.meta.url));
const query = process.env.LIVE_QUERY ?? 'alvedon 500 mg 20 st';

/** Fixture name -> query. Recorded with take=30 and trimmed. */
const SEARCH_FIXTURES: Record<string, string> = {
  'search-pharmacy.json': 'alvedon',
  'search-cosmetic.json': 'idun minerals',
  'search-campaign.json': 'tandkräm',
  'search-prescription.json': 'atorvastatin',
  'search-none.json': 'qxzvbnmplk',
};

/** Fixture name -> product path. */
const PRODUCT_FIXTURES: Record<string, string> = {
  'product-otc.html': '/produkt/alvedon-filmdragerad-tablett-500-mg-20-st-blister-243170/',
  'product-member.html': '/produkt/idun-minerals-shampoo-250-ml-flaska-1061015/',
  'product-campaign.html': '/produkt/new-nordic-hair-volume-shampoo-250-ml-flaska-1582873/',
  'product-prescription.html':
    '/produkt/atorvastatin-teva-filmdragerad-tablett-80-mg-100-tabletter-blister-247938/',
};

describe('apoteket live', () => {
  it(`searches "${query}"`, { timeout: 60_000 }, async () => {
    const started = Date.now();
    const offers = await adapter.search(query);
    const ms = Date.now() - started;
    console.table(
      offers.map((o) => ({
        title: o.title,
        price: o.price,
        orig: o.originalPrice,
        member: o.memberPrice,
        ean: o.ean,
        inStock: o.inStock,
      })),
    );
    console.log(`search took ${ms} ms`);
    expect(offers.length).toBeGreaterThan(0);
    for (const o of offers) ProductOffer.parse(o);

    const product = await adapter.getProduct(offers[0]!.url);
    expect(product?.merchantProductId).toBe(offers[0]!.merchantProductId);
    ProductOffer.parse(product);
  });

  it.runIf(isRecording())('records fixtures', { timeout: 120_000 }, async () => {
    for (const [name, q] of Object.entries(SEARCH_FIXTURES)) {
      await saveFixture(dir, name, trimSearchBody(await searchRaw(q, 30)));
    }
    for (const [name, path] of Object.entries(PRODUCT_FIXTURES)) {
      await saveFixture(dir, name, trimProductHtml(await fetchText(`${BASE_URL}${path}`)));
    }
  });
});
