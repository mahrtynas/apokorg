import { ProductOffer } from '@apokorg/core';
import { loadFixture } from '@apokorg/adapter-kit';
import { openCatalogDb, refreshCatalog, type CatalogDb } from '@apokorg/catalog-index';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import adapter, {
  catalogSource,
  createDozAdapter,
  eanFromImageUrl,
  MAX_PRODUCT_FETCHES,
  parseProduct,
} from './index';
import { trimProductHtml } from './trim';

const dir = fileURLToPath(new URL('..', import.meta.url));
const FETCHED_AT = '2026-10-22T11:46:00.000Z';

const product = async (name: string, url = 'https://dozapotek.se/x-000001') =>
  parseProduct(await loadFixture(dir, name), url, FETCHED_AT);

const SITEMAP_ROUTES: Record<string, string> = {
  'https://dozapotek.se/media/sitemap/sitemap.xml': 'sitemap.xml',
  'https://dozapotek.se/media/sitemap/sitemap-1-1.xml': 'sitemap-1-1.xml',
  'https://dozapotek.se/media/sitemap/sitemap-1-2.xml': 'sitemap-1-2.xml',
};

const PAGE_ROUTES: Record<string, string> = {
  'https://dozapotek.se/alvedon-filmdragerad-tablett-500-mg-20-styck-097610': 'product-otc.html',
  'https://dozapotek.se/la-roche-posay-cicaplast-mains-handcreme-50-ml-759690':
    'product-cosmetic.html',
  'https://dozapotek.se/daxxin-shampoo-mot-mjall-250-ml-820890': 'product-campaign.html',
  'https://dozapotek.se/omeprazol-sandoz-enterokapsel-hard-20-mg-28-kapsel-kapslar-109472':
    'product-gtin14.html',
  'https://dozapotek.se/sertralin-teva-filmdragerad-tablett-100-mg-100-tablett-er-194617':
    'product-prescription.html',
};

const fixtureBytes = async (url: string) => {
  const name = SITEMAP_ROUTES[url];
  if (!name) throw new Error(`Unexpected fetch: ${url}`);
  return new Uint8Array(readFileSync(`${dir}fixtures/${name}`));
};

/** Serves product pages from fixtures; unknown pages 404 like a product removed since refresh. */
function pageFetcher() {
  const calls: string[] = [];
  const fetchPage = async (url: string) => {
    calls.push(url);
    const name = PAGE_ROUTES[url];
    if (!name) throw new Error(`HTTP 404 for ${url}`);
    return loadFixture(dir, name);
  };
  return { calls, fetchPage };
}

describe('doz catalog source', () => {
  let db: CatalogDb;
  beforeAll(async () => {
    db = openCatalogDb(':memory:');
    await refreshCatalog('doz', catalogSource, { db, fetchBytes: fixtureBytes });
  });

  it('keeps product URLs only, with readable titles', () => {
    const rows = db.prepare('SELECT url, title FROM products ORDER BY url').all() as {
      url: string;
      title: string;
    }[];
    expect(rows.map((r) => r.url.replace('https://dozapotek.se/', ''))).toEqual([
      'allevyn-adhesive-7-5-x-7-5-cm-10-st-9991012230',
      'alvedon-brustablett-500-mg-20-styck-156341',
      'alvedon-filmdragerad-tablett-500-mg-20-styck-097610',
      'alvedon-munsonderfallande-tablett-500-mg-16-styck-007012',
      'alvedon-novum-filmdragerad-tablett-500-mg-20-tablett-er-379421',
      'avene-cleanance-serum-30-ml-782201',
      'blomdahl-haltagning-piercing-aftercare-1-ask-24-st-l1078',
      'colgate-tandkram-total-original-75-ml-782086',
      'daxxin-shampoo-mot-mjall-250-ml-820890',
      'la-roche-posay-cicaplast-mains-handcreme-50-ml-759690',
      'omeprazol-sandoz-enterokapsel-hard-20-mg-28-kapsel-kapslar-109472',
      'sertralin-teva-filmdragerad-tablett-100-mg-100-tablett-er-194617',
    ]);
    // Categories, brands, CMS pages and "black-week-2026" are dropped; ids are cut from titles.
    expect(rows.find((r) => r.url.endsWith('097610'))?.title).toBe(
      'alvedon filmdragerad tablett 500 mg 20 styck',
    );
    expect(rows.find((r) => r.url.endsWith('l1078'))?.title).toBe(
      'blomdahl haltagning piercing aftercare 1 ask 24 st',
    );
  });

  it('searches a pharmacy item: candidates first, product pages fetched in order', async () => {
    const { calls, fetchPage } = pageFetcher();
    const offers = await createDozAdapter({ db, fetchPage }).search('alvedon filmdragerad 20');
    expect(calls[0]).toBe(
      'https://dozapotek.se/alvedon-filmdragerad-tablett-500-mg-20-styck-097610',
    );
    expect(calls.length).toBeLessThanOrEqual(MAX_PRODUCT_FETCHES);
    // Candidates without a fixture "404" and are skipped rather than failing the search.
    expect(offers.map((o) => o.merchantProductId)).toEqual(['097610']);
    for (const o of offers) expect(() => ProductOffer.parse(o)).not.toThrow();
  });

  it('searches a cosmetic', async () => {
    const { fetchPage } = pageFetcher();
    const offers = await createDozAdapter({ db, fetchPage }).search('la roche posay cicaplast');
    expect(offers[0]).toMatchObject({
      merchantProductId: '759690',
      title: 'La Roche-Posay Cicaplast Mains handcreme, 50 ml',
    });
  });

  it('drops prescription items from search results', async () => {
    const { calls, fetchPage } = pageFetcher();
    const offers = await createDozAdapter({ db, fetchPage }).search('sertralin');
    expect(calls).toHaveLength(1);
    expect(offers).toEqual([]);
  });

  it('returns [] when nothing matches, without fetching', async () => {
    const { calls, fetchPage } = pageFetcher();
    expect(await createDozAdapter({ db, fetchPage }).search('qxzvbnmplk')).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('returns [] when the index is empty for the store', async () => {
    const { calls, fetchPage } = pageFetcher();
    const empty = openCatalogDb(':memory:');
    expect(await createDozAdapter({ db: empty, fetchPage }).search('alvedon')).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('fetches no more pages than the limit', async () => {
    const { calls, fetchPage } = pageFetcher();
    await createDozAdapter({ db, fetchPage }).search('alvedon', { limit: 2 });
    expect(calls).toHaveLength(2);
  });

  it('stops when aborted', async () => {
    const { fetchPage } = pageFetcher();
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      createDozAdapter({ db, fetchPage }).search('alvedon', { signal: ctrl.signal }),
    ).rejects.toThrow();
  });
});

describe('doz product parsing', () => {
  it('parses an OTC product page', async () => {
    const offer = await product('product-otc.html');
    expect(() => ProductOffer.parse(offer)).not.toThrow();
    expect(offer).toEqual({
      merchantId: 'doz',
      merchantProductId: '097610',
      // The <h1> includes the pack size; JSON-LD `name` doesn't.
      title: 'Alvedon, filmdragerad tablett 500 mg, 20 styck',
      brand: 'Alvedon',
      ean: '7046260976108',
      size: undefined,
      packCount: 20,
      price: 37.4,
      unitPrice: { value: 1.87, per: 'st' },
      inStock: true,
      // Canonical URL from JSON-LD, not the URL passed in.
      url: 'https://dozapotek.se/alvedon-filmdragerad-tablett-500-mg-20-styck-097610',
      imageUrl:
        'https://media.dozapotek.se/catalog/product/7/0/7046260976108_1_1.png?width=400&height=400&store=default&image-type=image',
      fetchedAt: FETCHED_AT,
    });
  });

  it('parses a cosmetic with the size in the title', async () => {
    const offer = await product('product-cosmetic.html');
    expect(() => ProductOffer.parse(offer)).not.toThrow();
    expect(offer).toMatchObject({
      merchantProductId: '759690',
      brand: 'La Roche-Posay',
      ean: '3337872414145',
      size: { value: 50, unit: 'ml' },
      price: 98,
      unitPrice: { value: 1960, per: 'l' },
      inStock: true,
    });
    expect(offer?.originalPrice).toBeUndefined();
  });

  it('reads a campaign as price + originalPrice', async () => {
    const offer = await product('product-campaign.html');
    expect(() => ProductOffer.parse(offer)).not.toThrow();
    expect(offer).toMatchObject({
      merchantProductId: '820890',
      ean: '7331162600252',
      price: 95.2,
      originalPrice: 119,
      size: { value: 250, unit: 'ml' },
    });
    expect(offer?.memberPrice).toBeUndefined();
  });

  it('reads a GTIN-14 image filename and the package line', async () => {
    const offer = await product('product-gtin14.html');
    expect(offer).toMatchObject({
      merchantProductId: '109472',
      title: 'Omeprazol Sandoz, enterokapsel, hård 20 mg, 28 kapsel/kapslar',
      ean: '7046261094726',
      packCount: 28,
      price: 79,
    });
  });

  it('returns null for a prescription product page', async () => {
    expect(await product('product-prescription.html')).toBeNull();
  });

  it('returns null for a page without product data', () => {
    expect(parseProduct('<html></html>', 'https://dozapotek.se/x', FETCHED_AT)).toBeNull();
  });

  it('trimming a product page again does not change the parsed result', async () => {
    const html = await loadFixture(dir, 'product-campaign.html');
    const url = 'https://dozapotek.se/x-000001';
    expect(parseProduct(trimProductHtml(html), url, FETCHED_AT)).toEqual(
      parseProduct(html, url, FETCHED_AT),
    );
  });

  it('getProduct fetches and parses a page', async () => {
    const { fetchPage } = pageFetcher();
    const url = 'https://dozapotek.se/daxxin-shampoo-mot-mjall-250-ml-820890';
    const offer = await createDozAdapter({ fetchPage }).getProduct(url);
    expect(offer?.url).toBe(url);
  });
});

describe('doz helpers', () => {
  it('takes the EAN from image filenames only when it validates', () => {
    const img = (file: string) => `https://media.dozapotek.se/catalog/product/7/0/${file}?w=1`;
    expect(eanFromImageUrl(img('7046260976108_1_1.png'))).toBe('7046260976108');
    expect(eanFromImageUrl(img('07046261094726_C1L1.tif_12.png'))).toBe('7046261094726');
    expect(eanFromImageUrl(img('7046260976109_1.png'))).toBeUndefined();
    expect(eanFromImageUrl(img('sensual_f_10pcs_k1072xn.jpg'))).toBeUndefined();
    expect(eanFromImageUrl(img('123456.jpg'))).toBeUndefined();
    expect(eanFromImageUrl(undefined)).toBeUndefined();
  });

  it('returns [] for an empty query without a request', async () => {
    expect(await adapter.search('   ')).toEqual([]);
  });

  it('describes the store', () => {
    expect(adapter.info).toMatchObject({
      id: 'doz',
      name: 'DOZ Apotek',
      baseUrl: 'https://dozapotek.se',
      category: 'pharmacy',
      searchStrategy: 'catalog-index',
    });
  });
});
