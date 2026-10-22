/**
 * Hits the real site. Never run in CI. Usage:
 *   pnpm --filter @apokorg/adapter-meds test:live
 *   RECORD_FIXTURES=1 pnpm --filter @apokorg/adapter-meds test:live   (also saves fixtures)
 *
 * Refreshes an in-memory catalog from the live sitemaps first (nine ~3 MB files, about 10 s),
 * then searches it, so the user's catalog.db is left alone.
 */
import { ProductOffer } from '@apokorg/core';
import { fetchText, isRecording, saveFixture } from '@apokorg/adapter-kit';
import { CATALOG_SOURCES, openCatalogDb, refreshCatalog } from '@apokorg/catalog-index';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BASE_URL, createMedsAdapter } from './index';
import { trimProductHtml, trimSitemap } from './trim';

const dir = fileURLToPath(new URL('..', import.meta.url));
const query = process.env.LIVE_QUERY ?? 'alvedon 500 mg 20 st';

/** Fixture name -> product path. */
const PRODUCT_FIXTURES: Record<string, string> = {
  'product-otc.html': '/alvedon-filmdragerad-tablett-500-mg-20-st',
  'product-campaign.html': '/decubal-restoring-lips-dry-spots-balm-30-ml',
  'product-combo.html': '/barebells-soft-protein-bar-cinnamon-bun-55-g',
  'product-cosmetic.html': '/la-roche-posay-effaclar-duo-m-40-ml',
  'product-prescription.html': '/inderal-10-mg-100-styck-filmdragerad-tablett-5056227206560',
};

/**
 * Paths kept in the trimmed sitemap fixtures: the fixture products and their neighbours, plus
 * brand/category pages, shipping items and two-segment prescription URLs the filter must drop.
 */
const SITEMAP_KEEP =
  /^\/(alvedon|ipren|la-roche-posay-effaclar|inderal|decubal-restoring|barebells-soft-protein-bar-cinnamon|frakt-|feber-vark\/|orifarm-generics-a-s\/diazepam)/;

describe('meds live', () => {
  it(`refreshes the catalog and searches "${query}"`, { timeout: 180_000 }, async () => {
    const db = openCatalogDb(':memory:');
    const refresh = await refreshCatalog('meds', CATALOG_SOURCES.meds, { db });
    console.log(
      `refresh: ${refresh.products} products from ${refresh.sitemapsFetched} sitemaps in ${refresh.durationMs} ms`,
    );
    expect(refresh.products).toBeGreaterThan(10_000);

    const adapter = createMedsAdapter({ db });
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

  it.runIf(isRecording())('records fixtures', { timeout: 180_000 }, async () => {
    const index = await fetchText(CATALOG_SOURCES.meds.sitemapUrl);
    await saveFixture(dir, 'sitemap-index.xml', index);
    const children = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
    for (const loc of children) {
      const xml = await fetchText(loc);
      const keep = (l: string) => SITEMAP_KEEP.test(new URL(l).pathname);
      await saveFixture(
        dir,
        `sitemap-${loc.split('/').filter(Boolean).pop()}.xml`,
        trimSitemap(xml, keep),
      );
    }
    for (const [name, path] of Object.entries(PRODUCT_FIXTURES)) {
      await saveFixture(dir, name, trimProductHtml(await fetchText(`${BASE_URL}${path}`)));
    }
  });
});
