/**
 * Hits the real site. Never run in CI. Usage:
 *   pnpm --filter @apokorg/adapter-doz test:live
 *   RECORD_FIXTURES=1 pnpm --filter @apokorg/adapter-doz test:live   (also saves fixtures)
 *
 * Refreshes an in-memory catalog from the live sitemaps first (two sequential sitemap
 * downloads, ~14 MB), so the shared catalog.db is left alone.
 */
import { ProductOffer } from '@apokorg/core';
import { fetchText, isRecording, saveFixture } from '@apokorg/adapter-kit';
import { openCatalogDb, refreshCatalog } from '@apokorg/catalog-index';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BASE_URL, catalogSource, createDozAdapter, MERCHANT_ID } from './index';
import { trimProductHtml } from './trim';

const dir = fileURLToPath(new URL('..', import.meta.url));
const query = process.env.LIVE_QUERY ?? 'alvedon 500 mg 20 st';

/** Fixture name -> product path. */
const PRODUCT_FIXTURES: Record<string, string> = {
  'product-otc.html': '/alvedon-filmdragerad-tablett-500-mg-20-styck-097610',
  'product-cosmetic.html': '/la-roche-posay-cicaplast-mains-handcreme-50-ml-759690',
  'product-campaign.html': '/daxxin-shampoo-mot-mjall-250-ml-820890',
  'product-gtin14.html': '/omeprazol-sandoz-enterokapsel-hard-20-mg-28-kapsel-kapslar-109472',
  'product-prescription.html': '/sertralin-teva-filmdragerad-tablett-100-mg-100-tablett-er-194617',
};

describe('doz live', () => {
  it(`refreshes the catalog and searches "${query}"`, { timeout: 180_000 }, async () => {
    const db = openCatalogDb(':memory:');
    const refresh = await refreshCatalog(MERCHANT_ID, catalogSource, { db });
    console.log(
      `catalog refresh: ${refresh.products} products from ${refresh.sitemapsFetched} sitemaps in ${refresh.durationMs} ms`,
    );
    expect(refresh.products).toBeGreaterThan(10_000);

    const adapter = createDozAdapter({ db });
    const started = Date.now();
    const offers = await adapter.search(query);
    const ms = Date.now() - started;
    console.table(
      offers.map((o) => ({
        title: o.title,
        price: o.price,
        orig: o.originalPrice,
        ean: o.ean,
        inStock: o.inStock,
      })),
    );
    console.log(`search took ${ms} ms`);
    expect(offers.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(8000);
    for (const o of offers) ProductOffer.parse(o);

    const product = await adapter.getProduct(offers[0]!.url);
    expect(product?.merchantProductId).toBe(offers[0]!.merchantProductId);
    ProductOffer.parse(product);
  });

  it.runIf(isRecording())('records fixtures', { timeout: 120_000 }, async () => {
    for (const [name, path] of Object.entries(PRODUCT_FIXTURES)) {
      await saveFixture(dir, name, trimProductHtml(await fetchText(`${BASE_URL}${path}`)));
    }
  });
});
