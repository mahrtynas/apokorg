import { ProductOffer } from '@apokorg/core';
import { HttpError, loadFixture } from '@apokorg/adapter-kit';
import { CATALOG_SOURCES, openCatalogDb, refreshCatalog } from '@apokorg/catalog-index';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import adapter, {
  BASE_URL,
  createAdapter,
  decodeHtml,
  parseProduct,
  parseProductPage,
  parseVariants,
  rankByQuery,
} from './index';
import { trimProductPage } from './fixtures';

const dir = fileURLToPath(new URL('..', import.meta.url));
const at = '2026-10-22T08:00:00.000Z';

const KREATIN = `${BASE_URL}/kreatin-monohydrat-500-g/609.html`;
const WHEY80 = `${BASE_URL}/whey-80-vassleprotein-1-kg/585R.html`;
const CINNAMON = `${BASE_URL}/whey-80-1-kg-cinnamon-bun/58100.html`;
const BUNDLE = `${BASE_URL}/2-x-whey-80-vassleprotein-1-kg/SET2W80.html`;

const PAGES: Record<string, string> = {
  [KREATIN]: 'product-kreatin.html',
  [WHEY80]: 'product-whey80-master.html',
  [CINNAMON]: 'product-whey80-cinnamon-bun.html',
  [BUNDLE]: 'product-bundle.html',
};

const page = (name: string) => loadFixture(dir, name);

/** Serves product pages from fixtures; anything else is a 404, like a removed product. */
function fixturePages() {
  const calls: string[] = [];
  const fetchPage = async (url: string) => {
    calls.push(url);
    const name = PAGES[url];
    if (!name) throw new HttpError(404, url);
    return page(name);
  };
  return Object.assign(fetchPage, { calls });
}

/** An in-memory catalog built from the fixture sitemaps with the real Gymgrossisten config. */
async function fixtureCatalog() {
  const db = openCatalogDb(':memory:');
  const fetchBytes = async (url: string) => {
    const name = /\/(sitemap_(?:index|\d)\.xml)$/.exec(url)?.[1];
    if (!name) throw new Error(`Unexpected fetch: ${url}`);
    return new Uint8Array(readFileSync(`${dir}fixtures/${name}`));
  };
  const result = await refreshCatalog('gymgrossisten', CATALOG_SOURCES.gymgrossisten, {
    db,
    fetchBytes,
  });
  return { db, result };
}

describe('gymgrossisten product parsing', () => {
  it('parses a single product on campaign', async () => {
    const offers = parseProductPage(await page('product-kreatin.html'), at);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toEqual({
      merchantId: 'gymgrossisten',
      merchantProductId: '609',
      title: 'Kreatin Monohydrat 500 g',
      brand: 'Star Nutrition',
      ean: '7350049151014',
      size: { value: 500, unit: 'g' },
      packCount: undefined,
      // "Ord.pris 249 kr"; "Lägsta pris 30 dagar" is ignored.
      price: 199,
      originalPrice: 249,
      unitPrice: { value: 398, per: 'kg' },
      inStock: true,
      url: KREATIN,
      imageUrl: expect.stringMatching(/^https:\/\/www\.gymgrossisten\.com\/dw\/image\//),
      fetchedAt: at,
    });
    expect(() => ProductOffer.parse(offers[0])).not.toThrow();
  });

  it('gives every flavour of a master page its own offer', async () => {
    const offers = parseProductPage(await page('product-whey80-master.html'), at);
    expect(offers).toHaveLength(31);
    for (const o of offers) expect(() => ProductOffer.parse(o)).not.toThrow();
    expect(new Set(offers.map((o) => o.merchantProductId)).size).toBe(31);
    expect(new Set(offers.map((o) => o.title)).size).toBe(31);

    // The variant the master URL shows comes first, with the EAN from the page text.
    expect(offers[0]).toMatchObject({
      merchantProductId: '585-1',
      title: 'Whey-80, 1 kg, Double Rich Chocolate',
      ean: '7350049153445',
      price: 449,
      size: { value: 1, unit: 'kg' },
      url: `${BASE_URL}/whey-80-1-kg-double-rich-chocolate/585-1.html`,
    });
    // The others have no EAN on this page; their own URL has it.
    const vanilj = offers.find((o) => o.merchantProductId === '587');
    expect(vanilj).toMatchObject({
      title: 'Whey-80, 1 kg, Vanilj',
      brand: 'Star Nutrition',
      ean: undefined,
      price: 449,
      inStock: true,
      url: `${BASE_URL}/whey-80-1-kg-vanilj/587.html`,
    });
    // HTML entities in names are decoded; availability comes from the variant's microdata.
    expect(offers.find((o) => o.merchantProductId === '5992')).toMatchObject({
      title: 'Whey-80, 1 kg, Piña Colada',
      inStock: false,
      url: `${BASE_URL}/whey-80-1-kg-pi%C3%B1a-colada/5992.html`,
    });
    expect(offers.find((o) => o.merchantProductId === '5861')?.title).toBe(
      'Whey-80, 1 kg, Jordgubbar & Mjölk',
    );
  });

  it('returns the variant a variant URL points to', async () => {
    const html = await page('product-whey80-cinnamon-bun.html');
    expect(parseProduct(html, CINNAMON, at)).toMatchObject({
      merchantProductId: '58100',
      title: 'Whey-80, 1 kg, Cinnamon bun',
      ean: '7350049153384',
      price: 449,
      url: CINNAMON,
    });
    // The master URL returns its default variant instead.
    const master = parseProduct(await page('product-whey80-master.html'), WHEY80, at);
    expect(master?.merchantProductId).toBe('585-1');
  });

  it('reads a bundle as a pack of its parts, without an EAN', async () => {
    const offer = parseProduct(await page('product-bundle.html'), BUNDLE, at);
    expect(offer).toMatchObject({
      merchantProductId: 'SET2W80',
      title: '2 x Whey-80 Vassleprotein 1 kg',
      ean: undefined,
      size: { value: 1, unit: 'kg' },
      packCount: 2,
    });
    expect(offer!.unitPrice).toEqual({ value: offer!.price / 2, per: 'kg' });
  });

  it('returns nothing for a page that is not a product', () => {
    expect(parseProductPage('<html><body>Sidan hittades inte</body></html>')).toEqual([]);
    expect(parseProduct('<html></html>', KREATIN)).toBeNull();
  });

  it('decodes the entities the site uses', () => {
    expect(decodeHtml('Pi&ntilde;a &amp; &Aring;&auml;&ouml; &#246; &#xF6;')).toBe(
      'Piña & Åäö ö ö',
    );
    expect(decodeHtml('&unknown;')).toBe('&unknown;');
  });

  it('trimming a page keeps the parse identical', async () => {
    const html = await page('product-whey80-master.html');
    expect(parseProductPage(trimProductPage(html), at)).toEqual(parseProductPage(html, at));
    expect(parseVariants(html)).toHaveLength(31);
  });
});

describe('gymgrossisten search', () => {
  it('builds the catalog from the sitemaps with the shared config', async () => {
    const { db, result } = await fixtureCatalog();
    // sitemap_0 holds products; brands, landing pages and articles are filtered out.
    expect(result.products).toBe(8);
    const titles = (
      db.prepare('SELECT title FROM products ORDER BY title').all() as {
        title: string;
      }[]
    ).map((r) => r.title);
    expect(titles).toContain('whey 80 vassleprotein 1 kg');
  });

  it('fetches the top candidates one by one and ranks the matching flavour first', async () => {
    const { db } = await fixtureCatalog();
    const fetchPage = fixturePages();
    const gg = createAdapter({ db, fetchPage });
    const offers = await gg.search('whey 80 1 kg vanilj');

    expect(fetchPage.calls.length).toBeGreaterThan(0);
    expect(fetchPage.calls.length).toBeLessThanOrEqual(5);
    expect(fetchPage.calls[0]).toBe(WHEY80);
    expect(offers).toHaveLength(10);
    expect(offers[0]).toMatchObject({ merchantProductId: '587', title: 'Whey-80, 1 kg, Vanilj' });
    for (const o of offers) expect(() => ProductOffer.parse(o)).not.toThrow();
    expect(new Set(offers.map((o) => o.merchantProductId)).size).toBe(offers.length);
  });

  it('honours the limit and skips candidates that are gone', async () => {
    const { db } = await fixtureCatalog();
    const fetchPage = fixturePages();
    const offers = await createAdapter({ db, fetchPage }).search('kreatin', { limit: 3 });
    expect(offers[0]?.merchantProductId).toBe('609');
    expect(offers.length).toBeLessThanOrEqual(3);
  });

  it('returns [] when nothing matches or the index is empty', async () => {
    const { db } = await fixtureCatalog();
    const fetchPage = fixturePages();
    expect(await createAdapter({ db, fetchPage }).search('9999999999')).toEqual([]);
    const empty = createAdapter({ db: openCatalogDb(':memory:'), fetchPage });
    expect(await empty.search('whey')).toEqual([]);
    expect(fetchPage.calls).toEqual([]);
  });

  it('getProduct returns the variant, and null for a removed product', async () => {
    const gg = createAdapter({ db: openCatalogDb(':memory:'), fetchPage: fixturePages() });
    expect((await gg.getProduct(CINNAMON))?.merchantProductId).toBe('58100');
    expect(await gg.getProduct(`${BASE_URL}/borta/123.html`)).toBeNull();
  });

  it('rankByQuery keeps page order for equal scores', () => {
    const o = (id: string, title: string) =>
      ({ merchantProductId: id, title }) as unknown as ProductOffer;
    const ranked = rankByQuery(
      [o('1', 'Whey Choklad'), o('2', 'Whey Vanilj'), o('3', 'Whey Hallon')],
      'whey vanilj',
    );
    expect(ranked.map((x) => x.merchantProductId)).toEqual(['2', '1', '3']);
  });

  it('declares the catalog-index strategy', () => {
    expect(adapter.info).toMatchObject({
      id: 'gymgrossisten',
      category: 'sport',
      searchStrategy: 'catalog-index',
    });
  });
});
