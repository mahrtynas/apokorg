/**
 * Sitemap sources for the stores whose search pages are disallowed in robots.txt.
 * Researched against the live robots.txt and sitemaps on 2026-10-22.
 */
import type { CatalogSource } from './refresh';
import { segmentTitle, slugToTitle } from './slug';

const segments = (url: URL) => url.pathname.split('/').filter(Boolean);

/** A one-segment path made of dashed words, e.g. `/alvedon-500-mg-filmdragerad-tablett-20-st`. */
const isSlugPath = (url: URL) => {
  const segs = segments(url);
  return segs.length === 1 && /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(segs[0]!);
};

export type CatalogStoreId = 'apotea' | 'doz' | 'gymgrossisten' | 'meds';

export const CATALOG_SOURCES: Record<CatalogStoreId, CatalogSource> = {
  /**
   * robots.txt: `Disallow: /sok/*`, `Sitemap: https://www.apotea.se/sitemap/sitemaps`.
   * The index lists brands, categories, images-N, pages and products-N (no extension, plain XML).
   * Product URLs are one segment: `/1541-of-london-dressing-comb-fine-tooth`. Everything in
   * sitemap-products-N is a product, and some slugs have no dash, dots or underscores
   * (`/braunseries3rakapparat3010bt`, `/dotarem-inj-vatska-losning-279.3-mg-ml`), so any
   * one-segment path counts (A-apotea, PR #20: the slug rule dropped 99 of 56,857).
   */
  apotea: {
    sitemapUrl: 'https://www.apotea.se/sitemap/sitemaps',
    sitemapFilter: (url) => /\/sitemap-products-\d+$/.test(url.pathname),
    productUrlFilter: (url) => url.host === 'www.apotea.se' && segments(url).length === 1,
  },

  /**
   * The store moved to dozapotek.se (valid TLS; the expired certificate belongs to the old
   * www.doz.se). Verified by A-doz on 2026-10-22 (PR #22). Product URLs are one slug segment
   * ending in a product id: `/alvedon-filmdragerad-tablett-500-mg-20-st-109264`. The id suffix
   * keeps out CMS pages such as `/kopvillkor-pa-dozapotek`, and is dropped from the title.
   */
  doz: {
    sitemapUrl: 'https://dozapotek.se/media/sitemap/sitemap.xml',
    productUrlFilter: (url) =>
      url.host === 'dozapotek.se' &&
      isSlugPath(url) &&
      /-(\d{6,}|[a-z]\d{3,})$/i.test(segments(url)[0]!),
    slugToTitle: (url) => slugToTitle(url).replace(/ (\d{6,}|[a-z]\d{3,})$/i, ''),
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

  /**
   * robots.txt: `Disallow: /sok/`, `/error/`, `/kvitto/`; `Sitemap: https://www.meds.se/sitemap/`.
   * The index lists `/sitemap/1` to `/sitemap/9`, each mixing products, brand and category pages
   * (always with a trailing slash: `/alvedon/`, `/feber-vark/huvudvark/`) and CMS pages, so there is
   * no sitemapFilter. Products are one segment without a trailing slash:
   * `/alvedon-filmdragerad-tablett-500-mg-20-st`. Prescription medicines also appear as
   * `/<manufacturer>/<name>-<ean>` (`/orifarm-generics-a-s/diazepam-…-5711313001589`); they need
   * BankID to buy, so the two-segment form is left out. `/frakt-*` pages are internal shipping
   * items (A-meds, checked 2026-10-22). Some prescription slugs end in the EAN, dropped from the title.
   */
  meds: {
    sitemapUrl: 'https://www.meds.se/sitemap/',
    productUrlFilter: (url) =>
      url.host === 'www.meds.se' &&
      segments(url).length === 1 &&
      !url.pathname.endsWith('/') &&
      !/^frakt-/i.test(segments(url)[0]!),
    slugToTitle: (url) => slugToTitle(url).replace(/ \d{8,14}$/, ''),
  },
};
