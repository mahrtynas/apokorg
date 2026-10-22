/**
 * Sitemap sources for the stores whose search pages are disallowed in robots.txt.
 * Researched against the live robots.txt and sitemaps on 2026-10-22.
 */
import type { CatalogSource } from './refresh';
import { segmentTitle } from './slug';

const segments = (url: URL) => url.pathname.split('/').filter(Boolean);

/** A one-segment path made of dashed words, e.g. `/alvedon-500-mg-filmdragerad-tablett-20-st`. */
const isSlugPath = (url: URL) => {
  const segs = segments(url);
  return segs.length === 1 && /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(segs[0]!);
};

export type CatalogStoreId = 'apotea' | 'doz' | 'gymgrossisten';

export const CATALOG_SOURCES: Record<CatalogStoreId, CatalogSource> = {
  /**
   * robots.txt: `Disallow: /sok/*`, `Sitemap: https://www.apotea.se/sitemap/sitemaps`.
   * The index lists brands, categories, images-N, pages and products-N (no extension, plain XML).
   * Product URLs are one slug segment: `/1541-of-london-dressing-comb-fine-tooth`.
   */
  apotea: {
    sitemapUrl: 'https://www.apotea.se/sitemap/sitemaps',
    sitemapFilter: (url) => /\/sitemap-products-\d+$/.test(url.pathname),
    productUrlFilter: (url) => url.host === 'www.apotea.se' && isSlugPath(url),
  },

  /**
   * NOT VERIFIED: www.doz.se and doz.se served an expired TLS certificate on 2026-10-21 and
   * 2026-10-22 (SEC_E_CERT_EXPIRED), and the Wayback Machine was offline, so neither robots.txt
   * nor the sitemaps could be read. TLS verification is deliberately not disabled; a refresh
   * fails until the certificate is renewed. This uses the robots.txt `Sitemap:` lines and keeps
   * one-segment slug URLs; A-doz must confirm the URL shape and tighten the filter.
   */
  doz: {
    sitemapUrl: 'https://www.doz.se/robots.txt',
    productUrlFilter: (url) => url.host === 'www.doz.se' && isSlugPath(url),
  },

  /**
   * robots.txt: `Disallow: /search*`; lists the .com, .no, .dk and .fi sitemap indexes, so it
   * is not used for discovery. `sitemap_index.xml` → sitemap_0 (products), sitemap_1 (brands and
   * landing pages, no `.html`), sitemap_2 (articles, `/<slug>.html`).
   * Product URLs are `/<slug>/<sku>.html`: `/kreatin-monohydrat-500-g/609.html`.
   */
  gymgrossisten: {
    sitemapUrl: 'https://www.gymgrossisten.com/sitemap_index.xml',
    productUrlFilter: (url) => {
      const segs = segments(url);
      return (
        url.host === 'www.gymgrossisten.com' &&
        segs.length === 2 &&
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(segs[0]!) &&
        /\.html$/i.test(segs[1]!)
      );
    },
    slugToTitle: segmentTitle(0),
  },
};
