import { ProductOffer } from '@apokorg/core';
import { HttpError, loadFixture } from '@apokorg/adapter-kit';
import {
  CATALOG_SOURCES,
  openCatalogDb,
  refreshCatalog,
  searchCandidates,
  type CatalogDb,
} from '@apokorg/catalog-index';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { BASE_URL, CANDIDATE_PAGES, createMedsAdapter, parseProduct } from './index';

const dir = fileURLToPath(new URL('..', import.meta.url));

const SITEMAP_ROUTES: Record<string, string> = {
  'https://www.meds.se/sitemap/': 'sitemap-index.xml',
  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [
      `https://www.meds.se/sitemap/${n}`,
      `sitemap-${n}.xml`,
    ]),
  ),
};

const PAGE_ROUTES: Record<string, string> = {
  [`${BASE_URL}/alvedon-filmdragerad-tablett-500-mg-20-st`]: 'product-otc.html',
  [`${BASE_URL}/decubal-restoring-lips-dry-spots-balm-30-ml`]: 'product-campaign.html',
  [`${BASE_URL}/barebells-soft-protein-bar-cinnamon-bun-55-g`]: 'product-combo.html',
  [`${BASE_URL}/la-roche-posay-effaclar-duo-m-40-ml`]: 'product-cosmetic.html',
  [`${BASE_URL}/inderal-10-mg-100-styck-filmdragerad-tablett-5056227206560`]:
    'product-prescription.html',
};

const fixtureBytes = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))));

/** Serves product fixtures; any other product URL 404s, like a product gone from the site. */
function fixturePages() {
  const calls: string[] = [];
  const fetchPage = async (url: string) => {
    calls.push(url);
    const name = PAGE_ROUTES[url];
    if (!name) throw new HttpError(404, url);
    return loadFixture(dir, name);
  };
  return { calls, fetchPage };
}

let db: CatalogDb;

beforeAll(async () => {
  db = openCatalogDb(':memory:');
  const requested: string[] = [];
  await refreshCatalog('meds', CATALOG_SOURCES.meds, {
    db,
    fetchBytes: async (url) => {
      requested.push(url);
      const name = SITEMAP_ROUTES[url];
      if (!name) throw new Error(`Unexpected fetch: ${url}`);
      return fixtureBytes(name);
    },
  });
  // Every child sitemap mixes products with other pages, so all nine are read.
  expect(requested).toEqual(Object.keys(SITEMAP_ROUTES));
});

describe('meds catalog', () => {
  it('indexes product pages only', () => {
    const rows = db.prepare('SELECT url FROM products').all() as { url: string }[];
    const urls = rows.map((r) => r.url);
    expect(urls).toHaveLength(61);
    expect(urls).toContain(`${BASE_URL}/alvedon-filmdragerad-tablett-500-mg-20-st`);
    // Brand and category pages, shipping items and /<manufacturer>/<rx-product> are dropped.
    expect(urls.filter((u) => u.endsWith('/'))).toEqual([]);
    expect(urls.filter((u) => u.includes('/frakt-'))).toEqual([]);
    expect(urls.filter((u) => new URL(u).pathname.split('/').length > 2)).toEqual([]);
  });

  it('ranks the exact product first', () => {
    const [top] = searchCandidates('meds', 'alvedon 500 mg 20 st', 5, { db });
    expect(top?.url).toBe(`${BASE_URL}/alvedon-filmdragerad-tablett-500-mg-20-st`);
  });
});

describe('meds search', () => {
  it('fetches the top candidates one at a time and returns valid offers', async () => {
    const pages = fixturePages();
    const adapter = createMedsAdapter({ db, fetchPage: pages.fetchPage });
    const offers = await adapter.search('alvedon 500 mg 20 st');

    expect(pages.calls.length).toBeGreaterThan(0);
    expect(pages.calls.length).toBeLessThanOrEqual(CANDIDATE_PAGES);
    expect(pages.calls[0]).toBe(`${BASE_URL}/alvedon-filmdragerad-tablett-500-mg-20-st`);
    // The other candidates 404 in this test and are skipped.
    expect(offers.map((o) => o.title)).toEqual(['Alvedon filmdragerad tablett 500 mg 20 st']);
    for (const o of offers) expect(() => ProductOffer.parse(o)).not.toThrow();
  });

  it('respects a smaller limit', async () => {
    const pages = fixturePages();
    const adapter = createMedsAdapter({ db, fetchPage: pages.fetchPage });
    await adapter.search('alvedon', { limit: 2 });
    expect(pages.calls).toHaveLength(2);
  });

  it('drops prescription medicines', async () => {
    const pages = fixturePages();
    const adapter = createMedsAdapter({ db, fetchPage: pages.fetchPage });
    const offers = await adapter.search('inderal 10 mg 100 styck', { limit: 1 });
    expect(pages.calls).toEqual([
      `${BASE_URL}/inderal-10-mg-100-styck-filmdragerad-tablett-5056227206560`,
    ]);
    expect(offers).toEqual([]);
  });

  it('returns [] without fetching when nothing matches', async () => {
    const pages = fixturePages();
    const adapter = createMedsAdapter({ db, fetchPage: pages.fetchPage });
    expect(await adapter.search('qxzvbnmplk')).toEqual([]);
    expect(await adapter.search('   ')).toEqual([]);
    expect(pages.calls).toEqual([]);
  });

  it('returns [] when the catalog has no MEDS products yet', async () => {
    const pages = fixturePages();
    const adapter = createMedsAdapter({ db: openCatalogDb(':memory:'), ...pages });
    expect(await adapter.search('alvedon')).toEqual([]);
    expect(pages.calls).toEqual([]);
  });

  it('rethrows errors other than HTTP errors', async () => {
    const adapter = createMedsAdapter({
      db,
      fetchPage: async () => {
        throw new Error('network down');
      },
    });
    await expect(adapter.search('alvedon')).rejects.toThrow('network down');
  });

  it('getProduct works on a URL returned by search', async () => {
    const pages = fixturePages();
    const adapter = createMedsAdapter({ db, fetchPage: pages.fetchPage });
    const [offer] = await adapter.search('decubal restoring lips dry spots balm 30 ml', {
      limit: 1,
    });
    const again = await adapter.getProduct(offer!.url);
    expect(again?.merchantProductId).toBe(offer!.merchantProductId);
  });
});

describe('meds product pages', () => {
  const parse = async (name: string, path: string) =>
    parseProduct(await loadFixture(dir, name), `${BASE_URL}${path}`, '2026-10-22T12:00:00.000Z');

  it('parses an OTC medicine', async () => {
    const offer = await parse('product-otc.html', '/alvedon-filmdragerad-tablett-500-mg-20-st');
    expect(offer).toEqual({
      merchantId: 'meds',
      merchantProductId: '97610',
      title: 'Alvedon filmdragerad tablett 500 mg 20 st',
      brand: 'Alvedon',
      ean: '7046260976108',
      size: undefined,
      packCount: 20,
      price: 36,
      unitPrice: { value: 1.8, per: 'st' },
      inStock: true,
      url: `${BASE_URL}/alvedon-filmdragerad-tablett-500-mg-20-st`,
      imageUrl:
        'https://media.meds.se/meds/images/image-png-2025-03-11-134915291/0/0/auto/c/7046260976108-1-png.png',
      fetchedAt: '2026-10-22T12:00:00.000Z',
    });
    expect(() => ProductOffer.parse(offer)).not.toThrow();
  });

  it('reads the campaign price and the previous lowest price', async () => {
    const offer = await parse(
      'product-campaign.html',
      '/decubal-restoring-lips-dry-spots-balm-30-ml',
    );
    expect(offer).toMatchObject({
      merchantProductId: '817279',
      ean: '7350087736983',
      price: 46,
      originalPrice: 57,
      size: { value: 30, unit: 'ml' },
      inStock: true,
    });
    expect(offer?.memberPrice).toBeUndefined();
    expect(() => ProductOffer.parse(offer)).not.toThrow();
  });

  it('uses the single-item price when the shown price needs a 699 kr combo basket', async () => {
    const offer = await parse(
      'product-combo.html',
      '/barebells-soft-protein-bar-cinnamon-bun-55-g',
    );
    expect(offer).toMatchObject({ price: 26, size: { value: 55, unit: 'g' } });
    expect(offer?.originalPrice).toBeUndefined();
    expect(() => ProductOffer.parse(offer)).not.toThrow();
  });

  it('parses a cosmetic', async () => {
    const offer = await parse('product-cosmetic.html', '/la-roche-posay-effaclar-duo-m-40-ml');
    expect(offer).toMatchObject({
      brand: 'La Roche-Posay',
      size: { value: 40, unit: 'ml' },
    });
    expect(offer?.title).toMatch(/Effaclar Duo/i);
    expect(offer?.price).toBeGreaterThan(0);
    expect(offer?.ean).toMatch(/^\d{13}$/);
    expect(() => ProductOffer.parse(offer)).not.toThrow();
  });

  it('returns null for prescription medicines', async () => {
    const path = '/inderal-10-mg-100-styck-filmdragerad-tablett-5056227206560';
    expect(await parse('product-prescription.html', path)).toBeNull();
  });

  it('reads stock from the price box, falling back to JSON-LD availability', async () => {
    const html = await loadFixture(dir, 'product-otc.html');
    const url = `${BASE_URL}/alvedon-filmdragerad-tablett-500-mg-20-st`;
    const outOfStock = 'https://schema.org/OutOfStock';
    expect(
      parseProduct(
        html.replace(
          '<link itemprop="availability" href="https://schema.org/InStock"',
          `<link itemprop="availability" href="${outOfStock}"`,
        ),
        url,
      )?.inStock,
    ).toBe(false);
    const noBox = html.replace(/<link itemprop="availability"[^>]*>/, '');
    expect(parseProduct(noBox, url)?.inStock).toBe(true);
    expect(
      parseProduct(noBox.replace('https://schema.org/InStock', outOfStock), url)?.inStock,
    ).toBe(false);
  });

  it('falls back to the Produktfakta EAN', async () => {
    const html = await loadFixture(dir, 'product-otc.html');
    const noLdEan = html.replace('"identifier":"7046260976108",', '');
    expect(parseProduct(noLdEan, `${BASE_URL}/x`)?.ean).toBe('7046260976108');
  });

  it('returns null for a page without product JSON-LD', () => {
    expect(parseProduct('<html></html>', `${BASE_URL}/x`)).toBeNull();
  });
});
