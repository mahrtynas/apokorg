/**
 * Hits the real site. Never run in CI. Usage:
 *   pnpm --filter @apokorg/adapter-apotea test:live
 *   RECORD_FIXTURES=1 pnpm --filter @apokorg/adapter-apotea test:live   (also saves fixtures)
 *
 * Refreshes an in-memory catalog from the live sitemaps first (two ~7 MB files, a few
 * seconds), then searches it, so the user's catalog.db is left alone.
 */
import { ProductOffer } from '@apokorg/core';
import { fetchText, isRecording, saveFixture } from '@apokorg/adapter-kit';
import { CATALOG_SOURCES, openCatalogDb, refreshCatalog } from '@apokorg/catalog-index';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BASE_URL, createApoteaAdapter } from './index';
import { trimProductHtml, trimSitemap } from './trim';

const dir = fileURLToPath(new URL('..', import.meta.url));
const query = process.env.LIVE_QUERY ?? 'alvedon 500 mg 20 st';

/** Fixture name -> product path. */
const PRODUCT_FIXTURES: Record<string, string> = {
  'product-otc.html': '/alvedon-filmdragerad-tablett-500-mg-20-st',
  'product-campaign.html': '/ccs-fotvardssalva-175-ml',
  'product-cosmetic.html': '/la-roche-posay-effaclar-duom-40-ml',
  'product-prescription.html': '/atorvastatin-accord-filmdragerad-tablett-10-mg',
};

/** Product slugs kept in the trimmed sitemap fixtures. */
const SITEMAP_KEEP =
  /^\/(alvedon|ipren|la-roche-posay-effaclar|atorvastatin-accord|ccs-fot|vichy-normaderm)/;

describe('apotea live', () => {
  it(`refreshes the catalog and searches "${query}"`, { timeout: 120_000 }, async () => {
    const db = openCatalogDb(':memory:');
    const refresh = await refreshCatalog('apotea', CATALOG_SOURCES.apotea, { db });
    console.log(
      `refresh: ${refresh.products} products from ${refresh.sitemapsFetched} sitemaps in ${refresh.durationMs} ms`,
    );
    expect(refresh.products).toBeGreaterThan(10_000);

    const adapter = createApoteaAdapter({ db });
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
        url: o.url,
      })),
    );
    console.log(`search took ${ms} ms`);
    expect(offers.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(8_000);
    for (const o of offers) ProductOffer.parse(o);

    const product = await adapter.getProduct(offers[0]!.url);
    expect(product?.merchantProductId).toBe(offers[0]!.merchantProductId);
    ProductOffer.parse(product);
  });

  it.runIf(isRecording())('records fixtures', { timeout: 120_000 }, async () => {
    const index = await fetchText(CATALOG_SOURCES.apotea.sitemapUrl);
    await saveFixture(dir, 'sitemap-index.xml', index);
    for (const n of [1, 2]) {
      const xml = await fetchText(`${BASE_URL}/sitemap/files/sitemap-products-${n}`);
      const keep = (loc: string) => SITEMAP_KEEP.test(new URL(loc).pathname);
      await saveFixture(dir, `sitemap-products-${n}.xml`, trimSitemap(xml, keep));
    }
    for (const [name, path] of Object.entries(PRODUCT_FIXTURES)) {
      await saveFixture(dir, name, trimProductHtml(await fetchText(`${BASE_URL}${path}`)));
    }
  });
});
