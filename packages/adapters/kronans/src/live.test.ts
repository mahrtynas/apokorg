/**
 * Hits the real site. Never run in CI. Usage:
 *   pnpm --filter @apokorg/adapter-kronans test:live
 *   RECORD_FIXTURES=1 pnpm --filter @apokorg/adapter-kronans test:live   (also saves fixtures)
 */
import { ProductOffer } from '@apokorg/core';
import { fetchText, isRecording, saveFixture } from '@apokorg/adapter-kit';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import adapter, { BASE_URL, searchRaw } from './index';
import { trimProductHtml, trimSearchBody } from './trim';

const dir = fileURLToPath(new URL('..', import.meta.url));
const query = process.env.LIVE_QUERY ?? 'alvedon 500 mg 20 st';

/** Fixture name -> query. Recorded with limit=30 and trimmed. */
const SEARCH_FIXTURES: Record<string, string> = {
  'search-pharmacy.json': 'alvedon',
  'search-cosmetic.json': 'la roche-posay',
  'search-campaign.json': 'tandkräm',
  'search-multibuy.json': 'c-vitamin brustabletter',
  'search-none.json': 'qxzvbnmplk',
};

/** Fixture name -> product path. */
const PRODUCT_FIXTURES: Record<string, string> = {
  'product-otc.html': '/Alvedon/p/097610/',
  'product-campaign.html': '/Sensodyne-Repair--Protect/p/785360/',
  'product-multibuy.html': '/Kronans-Apotek-C-Vitamin-Apelsin/p/757388/',
  'product-out-of-stock.html': '/alvedon-500mg-filmdragerad-tablett/p/488347/',
  'product-prescription.html': '/Alvedon-forte/p/097666/',
};

describe('kronans live', () => {
  it(`searches "${query}"`, { timeout: 60_000 }, async () => {
    const started = Date.now();
    const offers = await adapter.search(query);
    const ms = Date.now() - started;
    console.table(
      offers.map((o) => ({
        title: o.title,
        price: o.price,
        orig: o.originalPrice,
        multi: o.multiBuy ? `${o.multiBuy.qty} à ${o.multiBuy.unitPrice}` : undefined,
        ean: o.ean,
        inStock: o.inStock,
      })),
    );
    console.log(`search took ${ms} ms`);
    expect(ms).toBeLessThan(8000);
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
