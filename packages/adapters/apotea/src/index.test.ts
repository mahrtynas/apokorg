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
import { BASE_URL, CANDIDATE_PAGES, createApoteaAdapter, parseProduct } from './index';

const dir = fileURLToPath(new URL('..', import.meta.url));

const SITEMAP_ROUTES: Record<string, string> = {
  'https://www.apotea.se/sitemap/sitemaps': 'sitemap-index.xml',
  'https://www.apotea.se/sitemap/files/sitemap-products-1': 'sitemap-products-1.xml',
  'https://www.apotea.se/sitemap/files/sitemap-products-2': 'sitemap-products-2.xml',
};

const PAGE_ROUTES: Record<string, string> = {
  [`${BASE_URL}/alvedon-filmdragerad-tablett-500-mg-20-st`]: 'product-otc.html',
  [`${BASE_URL}/ccs-fotvardssalva-175-ml`]: 'product-campaign.html',
  [`${BASE_URL}/la-roche-posay-effaclar-duom-40-ml`]: 'product-cosmetic.html',
  [`${BASE_URL}/atorvastatin-accord-filmdragerad-tablett-10-mg`]: 'product-prescription.html',
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
  await refreshCatalog('apotea', CATALOG_SOURCES.apotea, {
    db,
    fetchBytes: async (url) => {
      requested.push(url);
      const name = SITEMAP_ROUTES[url];
      if (!name) throw new Error(`Unexpected fetch: ${url}`);
      return fixtureBytes(name);
    },
  });
  // Only the product sitemaps are followed, not brands, categories, images or pages.
  expect(requested).toEqual(Object.keys(SITEMAP_ROUTES));
});

describe('apotea catalog', () => {
  it('indexes the product sitemaps from the fixture', () => {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number };
    expect(n).toBe(58);
  });

  it('ranks the exact product first', () => {
    const [top] = searchCandidates('apotea', 'alvedon 500 mg 20 st', 5, { db });
    expect(top?.url).toBe(`${BASE_URL}/alvedon-filmdragerad-tablett-500-mg-20-st`);
  });
});

describe('apotea search', () => {
  it('fetches the top candidates one at a time and returns valid offers', async () => {
    const pages = fixturePages();
    const adapter = createApoteaAdapter({ db, fetchPage: pages.fetchPage });
    const offers = await adapter.search('alvedon 500 mg 20 st');

    expect(pages.calls.length).toBeGreaterThan(0);
    expect(pages.calls.length).toBeLessThanOrEqual(CANDIDATE_PAGES);
    expect(pages.calls[0]).toBe(`${BASE_URL}/alvedon-filmdragerad-tablett-500-mg-20-st`);
    // The other candidates 404 in this test and are skipped.
    expect(offers.map((o) => o.title)).toEqual(['Alvedon, filmdragerad tablett 500 mg, 20 st']);
    for (const o of offers) expect(() => ProductOffer.parse(o)).not.toThrow();
  });

  it('respects a smaller limit', async () => {
    const pages = fixturePages();
    const adapter = createApoteaAdapter({ db, fetchPage: pages.fetchPage });
    await adapter.search('alvedon', { limit: 2 });
    expect(pages.calls).toHaveLength(2);
  });

  it('drops prescription medicines', async () => {
    const pages = fixturePages();
    const adapter = createApoteaAdapter({ db, fetchPage: pages.fetchPage });
    const offers = await adapter.search('atorvastatin accord 10 mg', { limit: 1 });
    expect(pages.calls).toEqual([`${BASE_URL}/atorvastatin-accord-filmdragerad-tablett-10-mg`]);
    expect(offers).toEqual([]);
  });

  it('returns [] without fetching when nothing matches', async () => {
    const pages = fixturePages();
    const adapter = createApoteaAdapter({ db, fetchPage: pages.fetchPage });
    expect(await adapter.search('qxzvbnmplk')).toEqual([]);
    expect(await adapter.search('   ')).toEqual([]);
    expect(pages.calls).toEqual([]);
  });

  it('returns [] when the catalog has no Apotea products yet', async () => {
    const pages = fixturePages();
    const adapter = createApoteaAdapter({ db: openCatalogDb(':memory:'), ...pages });
    expect(await adapter.search('alvedon')).toEqual([]);
    expect(pages.calls).toEqual([]);
  });

  it('rethrows errors other than HTTP errors', async () => {
    const adapter = createApoteaAdapter({
      db,
      fetchPage: async () => {
        throw new Error('network down');
      },
    });
    await expect(adapter.search('alvedon')).rejects.toThrow('network down');
  });

  it('getProduct works on a URL returned by search', async () => {
    const pages = fixturePages();
    const adapter = createApoteaAdapter({ db, fetchPage: pages.fetchPage });
    const [offer] = await adapter.search('ccs fotvårdssalva 175 ml', { limit: 1 });
    const again = await adapter.getProduct(offer!.url);
    expect(again?.merchantProductId).toBe(offer!.merchantProductId);
  });
});

describe('apotea product pages', () => {
  const parse = async (name: string, path: string) =>
    parseProduct(await loadFixture(dir, name), `${BASE_URL}${path}`, '2026-10-22T12:00:00.000Z');

  it('parses an OTC medicine', async () => {
    const offer = await parse('product-otc.html', '/alvedon-filmdragerad-tablett-500-mg-20-st');
    expect(offer).toEqual({
      merchantId: 'apotea',
      merchantProductId: '5212',
      title: 'Alvedon, filmdragerad tablett 500 mg, 20 st',
      brand: 'Alvedon',
      ean: '7046260976108',
      size: undefined,
      packCount: 20,
      price: 34,
      unitPrice: { value: 1.7, per: 'st' },
      inStock: true,
      url: `${BASE_URL}/alvedon-filmdragerad-tablett-500-mg-20-st`,
      imageUrl:
        'https://media.apotea.se/product-images/XL/alvedon-filmdragerad-tablett-500-mg-20-st-3.jpg',
      fetchedAt: '2026-10-22T12:00:00.000Z',
    });
    expect(() => ProductOffer.parse(offer)).not.toThrow();
  });

  it('reads the campaign price and the previous price', async () => {
    const offer = await parse('product-campaign.html', '/ccs-fotvardssalva-175-ml');
    expect(offer).toMatchObject({
      merchantProductId: '5330',
      ean: '7315982038631',
      price: 44,
      originalPrice: 55,
      size: { value: 175, unit: 'ml' },
      inStock: true,
    });
    expect(offer?.memberPrice).toBeUndefined();
    expect(() => ProductOffer.parse(offer)).not.toThrow();
  });

  it('parses a cosmetic', async () => {
    const offer = await parse('product-cosmetic.html', '/la-roche-posay-effaclar-duom-40-ml');
    expect(offer).toMatchObject({
      title: 'La Roche-Posay Effaclar DUO+M 40 ml',
      brand: 'La Roche-Posay',
      size: { value: 40, unit: 'ml' },
    });
    expect(offer?.price).toBeGreaterThan(0);
    expect(offer?.ean).toMatch(/^\d{13}$/);
    expect(() => ProductOffer.parse(offer)).not.toThrow();
  });

  it('returns null for prescription medicines', async () => {
    expect(
      await parse('product-prescription.html', '/atorvastatin-accord-filmdragerad-tablett-10-mg'),
    ).toBeNull();
  });

  it('reads stock from the price box, falling back to JSON-LD availability', async () => {
    const html = await loadFixture(dir, 'product-otc.html');
    const url = `${BASE_URL}/alvedon-filmdragerad-tablett-500-mg-20-st`;
    expect(
      parseProduct(html.replace('data-in-stock="true"', 'data-in-stock="false"'), url),
    ).toMatchObject({ inStock: false });
    const noBox = html.replace(/id="stock-info"[^>]*>/, '>');
    expect(parseProduct(noBox, url)?.inStock).toBe(true);
    expect(
      parseProduct(
        noBox.replace('https://schema.org/InStock', 'https://schema.org/OutOfStock'),
        url,
      )?.inStock,
    ).toBe(false);
  });

  it('returns null for a page without product JSON-LD', () => {
    expect(parseProduct('<html></html>', `${BASE_URL}/x`)).toBeNull();
  });
});
