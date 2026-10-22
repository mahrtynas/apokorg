import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { defaultCatalogPath, defaultDataDir, openCatalogDb } from './db';
import { catalogStatus, needsRefresh, refreshCatalog, type CatalogSource } from './refresh';
import { searchCandidates } from './search';
import { CATALOG_SOURCES } from './stores';
import { fixtureFetch } from './test-helpers';

const SHOP_ROUTES = {
  'https://shop.test/sitemap-index.xml': 'sitemap-index.xml',
  'https://shop.test/sitemap-pages.xml': 'sitemap-pages.xml',
  'https://shop.test/sitemap-products-1.xml': 'sitemap-products-1.xml',
  'https://shop.test/sitemap-products-2.xml.gz': 'sitemap-products-2.xml.gz',
};

const shop: CatalogSource = {
  sitemapUrl: 'https://shop.test/sitemap-index.xml',
  productUrlFilter: (url) => url.pathname.startsWith('/p/'),
};

const urls = (db: ReturnType<typeof openCatalogDb>) =>
  (db.prepare('SELECT url FROM products ORDER BY url').all() as { url: string }[]).map(
    (r) => r.url,
  );

describe('refreshCatalog', () => {
  it('follows the index, gunzips, and keeps product URLs only', async () => {
    const db = openCatalogDb(':memory:');
    const fetchBytes = fixtureFetch(SHOP_ROUTES);
    const result = await refreshCatalog('shop', shop, { db, fetchBytes, now: 1000 });

    expect(fetchBytes.calls).toEqual([
      'https://shop.test/sitemap-index.xml',
      'https://shop.test/sitemap-pages.xml',
      'https://shop.test/sitemap-products-1.xml',
      'https://shop.test/sitemap-products-2.xml.gz',
    ]);
    expect(result).toMatchObject({
      merchantId: 'shop',
      products: 5,
      sitemapsFetched: 4,
      sitemapsSkipped: 0,
    });
    expect(urls(db)).toEqual([
      'https://shop.test/p/alvedon-500-mg-filmdragerad-tablett-20-st',
      'https://shop.test/p/ipren-200-mg-tablett-20-st',
      'https://shop.test/p/la-roche-posay-effaclar-duo-40-ml?utm=x&a=b',
      'https://shop.test/p/m%C3%B6llers-omega-3-250-ml',
      'https://shop.test/p/panodil-500-mg-filmdragerad-tablett-20-st',
    ]);
    const row = db
      .prepare('SELECT title, search_text, lastmod FROM products WHERE url LIKE ?')
      .get('%alvedon%');
    expect(row).toEqual({
      title: 'alvedon 500 mg filmdragerad tablett 20 st',
      search_text: 'alvedon 500mg filmdragerad tablett 20st',
      lastmod: '2026-10-20',
    });
    expect(catalogStatus('shop', { db })).toEqual({
      merchantId: 'shop',
      refreshedAt: 1000,
      productCount: 5,
    });
  });

  it('skips child sitemaps whose lastmod is unchanged, and drops removed ones', async () => {
    const db = openCatalogDb(':memory:');
    await refreshCatalog('shop', shop, { db, fetchBytes: fixtureFetch(SHOP_ROUTES) });

    const again = fixtureFetch(SHOP_ROUTES);
    const result = await refreshCatalog('shop', shop, { db, fetchBytes: again });
    expect(again.calls).toEqual(['https://shop.test/sitemap-index.xml']);
    expect(result).toMatchObject({ products: 5, sitemapsFetched: 1, sitemapsSkipped: 3 });

    // The index no longer lists products-1: its rows go, products-2's stay.
    const src: CatalogSource = {
      ...shop,
      sitemapFilter: (u) => !u.pathname.includes('products-1'),
    };
    const fewer = await refreshCatalog('shop', src, { db, fetchBytes: fixtureFetch(SHOP_ROUTES) });
    expect(fewer.products).toBe(2);

    // full: refetches everything.
    const full = fixtureFetch(SHOP_ROUTES);
    await refreshCatalog('shop', shop, { db, fetchBytes: full, full: true });
    expect(full.calls).toHaveLength(4);
    expect(urls(db)).toHaveLength(5);
  });

  it('keeps stores apart', async () => {
    const db = openCatalogDb(':memory:');
    await refreshCatalog('a', shop, { db, fetchBytes: fixtureFetch(SHOP_ROUTES) });
    await refreshCatalog('b', shop, { db, fetchBytes: fixtureFetch(SHOP_ROUTES) });
    expect(urls(db)).toHaveLength(10);
    expect(searchCandidates('a', 'ipren', 10, { db })).toHaveLength(1);
    expect(searchCandidates('c', 'ipren', 10, { db })).toEqual([]);
  });

  it('discovers sitemaps from robots.txt, same host only', async () => {
    const db = openCatalogDb(':memory:');
    const fetchBytes = fixtureFetch({
      'https://www.gymgrossisten.com/robots.txt': 'gymgrossisten-robots.txt',
      'https://www.gymgrossisten.com/sitemap_index.xml': 'sitemap-1000.xml',
    });
    const src = {
      ...CATALOG_SOURCES.gymgrossisten,
      sitemapUrl: 'https://www.gymgrossisten.com/robots.txt',
    };
    const result = await refreshCatalog('gymgrossisten', src, { db, fetchBytes });
    expect(fetchBytes.calls).toHaveLength(2);
    expect(result.products).toBe(0); // the fixture holds apotea URLs, which the filter rejects
  });

  it('leaves the previous index intact when a fetch fails', async () => {
    const db = openCatalogDb(':memory:');
    await refreshCatalog('shop', shop, { db, fetchBytes: fixtureFetch(SHOP_ROUTES) });
    const broken = fixtureFetch({ 'https://shop.test/sitemap-index.xml': 'sitemap-index.xml' });
    await expect(
      refreshCatalog('shop', shop, { db, fetchBytes: broken, full: true }),
    ).rejects.toThrow(/Unexpected fetch/);
    expect(urls(db)).toHaveLength(5);
  });
});

describe('searchCandidates', () => {
  const apotea: CatalogSource = {
    ...CATALOG_SOURCES.apotea,
    sitemapUrl: 'https://www.apotea.se/sitemap-1000.xml',
  };

  async function index1000() {
    const db = openCatalogDb(':memory:');
    const result = await refreshCatalog('apotea', apotea, {
      db,
      fetchBytes: fixtureFetch({ 'https://www.apotea.se/sitemap-1000.xml': 'sitemap-1000.xml' }),
    });
    expect(result.products).toBe(1000);
    return db;
  }

  it('ranks "alvedon 500 20" first in a 1,000-row index, in under 20 ms', async () => {
    const db = await index1000();
    // Warm up once (statement compilation, lazy matcher setup), then time the median of 5 runs.
    searchCandidates('apotea', 'panodil', 10, { db });
    const times: number[] = [];
    let hits = searchCandidates('apotea', 'alvedon 500 20', 10, { db });
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      hits = searchCandidates('apotea', 'alvedon 500 20', 10, { db });
      times.push(performance.now() - t0);
    }
    const ms = times.sort((a, b) => a - b)[2]!;

    expect(hits[0]?.url).toBe('https://www.apotea.se/alvedon-500-mg-filmdragerad-tablett-20-st');
    expect(hits.map((h) => h.url)).not.toContain(
      'https://www.apotea.se/panodil-500-mg-filmdragerad-tablett-20-st',
    );
    expect(ms).toBeLessThan(20);
  });

  it('normalizes units and prefix-matches', async () => {
    const db = await index1000();
    expect(searchCandidates('apotea', 'Alvedon 500 mg 20 tabletter', 1, { db })[0]?.url).toBe(
      'https://www.apotea.se/alvedon-500-mg-filmdragerad-tablett-20-st',
    );
    expect(searchCandidates('apotea', 'alvedon novum', 1, { db })[0]?.url).toBe(
      'https://www.apotea.se/alvedon-novum-500-mg-filmdragerad-tablett-20-st',
    );
    expect(searchCandidates('apotea', 'alved 665', 1, { db })[0]?.title).toBe(
      'alvedon 665 mg tablett med modifierad frisattning 24 st',
    );
    expect(searchCandidates('apotea', 'alvedon', 3, { db })).toHaveLength(3);
  });

  it('falls back to any term, and handles empty or odd queries', async () => {
    const db = await index1000();
    expect(searchCandidates('apotea', 'ipren xyzzy', 5, { db })[0]?.url).toBe(
      'https://www.apotea.se/ipren-200-mg-tablett-20-st',
    );
    expect(searchCandidates('apotea', '   ', 5, { db })).toEqual([]);
    expect(searchCandidates('apotea', '"* OR NEAR(', 5, { db })).toEqual(expect.any(Array));
  });
});

describe('needsRefresh', () => {
  it('is true when never refreshed or older than 7 days', async () => {
    const db = openCatalogDb(':memory:');
    expect(needsRefresh('shop', { db })).toBe(true);
    const day = 24 * 60 * 60 * 1000;
    await refreshCatalog('shop', shop, {
      db,
      fetchBytes: fixtureFetch(SHOP_ROUTES),
      now: 10 * day,
    });
    expect(needsRefresh('shop', { db, now: 16 * day })).toBe(false);
    expect(needsRefresh('shop', { db, now: 17 * day + 1 })).toBe(true);
  });
});

describe('catalog.db location', () => {
  it('lives in APOKORG_DATA_DIR like the server db', () => {
    expect(defaultDataDir({ APOKORG_DATA_DIR: '/data' })).toBe('/data');
    expect(defaultCatalogPath('/data')).toBe(join('/data', 'catalog.db'));
  });

  it('creates the file and directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'catalog-'));
    try {
      const db = openCatalogDb(join(dir, 'nested', 'catalog.db'));
      expect(needsRefresh('x', { db })).toBe(true);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
