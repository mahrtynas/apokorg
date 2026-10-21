import { ProductOffer } from '@apokorg/core';
import { loadFixture } from '@apokorg/adapter-kit';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import adapter, {
  parseProduct,
  parseSearch,
  productIdFromUrl,
  resolvePrices,
  searchRequestBody,
} from './index';
import { trimProductHtml, trimSearchBody } from './trim';

const dir = fileURLToPath(new URL('..', import.meta.url));
const FETCHED_AT = '2026-10-21T19:08:00.000Z';

const search = async (name: string) => parseSearch(await loadFixture(dir, name), FETCHED_AT);
const product = async (name: string, url = 'https://www.apoteket.se/produkt/x-1/') =>
  parseProduct(await loadFixture(dir, name), url, FETCHED_AT);

describe('apoteket search parsing', () => {
  it('parses a pharmacy search into valid offers', async () => {
    const offers = await search('search-pharmacy.json');
    expect(offers.length).toBe(9);
    for (const o of offers) expect(() => ProductOffer.parse(o)).not.toThrow();

    const alvedon = offers.find((o) => o.merchantProductId === '243170');
    expect(alvedon).toMatchObject({
      merchantId: 'apoteket',
      title: 'Alvedon, filmdragerad tablett 500 mg, 20 st',
      brand: 'Alvedon',
      ean: '7046260976108',
      packCount: 20,
      price: 34,
      unitPrice: { value: 1.7, per: 'st' },
      inStock: true,
      url: 'https://www.apoteket.se/produkt/alvedon-filmdragerad-tablett-500-mg-20-st-blister-243170/',
      imageUrl: 'https://www.apoteket.se/produktbilder/Validoo/097610m.jpg',
      fetchedAt: FETCHED_AT,
    });
    // The web price is used; InStorePrice (52 kr) is ignored.
    expect(alvedon?.originalPrice).toBeUndefined();

    const suspension = offers.find((o) => o.merchantProductId === '1564517');
    expect(suspension?.size).toEqual({ value: 100, unit: 'ml' });
    expect(suspension?.unitPrice).toEqual({ value: 550, per: 'l' });
  });

  it('uses the campaign price as the public price for general campaigns', async () => {
    const offers = await search('search-campaign.json');
    expect(offers.length).toBe(30);
    for (const o of offers) expect(() => ProductOffer.parse(o)).not.toThrow();

    const colgate = offers.find((o) => o.merchantProductId === '1563774');
    expect(colgate).toMatchObject({
      title: 'Colgate Tandkräm Karies Kontroll, 75 ml',
      ean: '8718951560109',
      price: 18.75,
      originalPrice: 25,
      size: { value: 75, unit: 'ml' },
      unitPrice: { value: 250, per: 'l' },
    });
    expect(colgate?.memberPrice).toBeUndefined();

    const plain = offers.find((o) => o.merchantProductId === '1386005');
    expect(plain).toMatchObject({ price: 49, inStock: true });
    expect(plain?.originalPrice).toBeUndefined();
  });

  it('keeps member-only campaign prices out of the public price', async () => {
    const offers = await search('search-cosmetic.json');
    expect(offers.length).toBe(30);
    for (const o of offers) expect(() => ProductOffer.parse(o)).not.toThrow();

    const foundation = offers.find((o) => o.merchantProductId === '991012');
    expect(foundation).toMatchObject({
      title: 'IDUN MINERALS Foundation - Freja, 7 g',
      brand: 'IDUN MINERALS',
      ean: '7340074710362',
      price: 329,
      memberPrice: 246.75,
      size: { value: 7, unit: 'g' },
      unitPrice: { value: 47000, per: 'kg' },
    });
    expect(foundation?.originalPrice).toBeUndefined();

    // A product outside the member campaign has no member price.
    const dreamStick = offers.find((o) => o.merchantProductId === '1585161');
    expect(dreamStick).toMatchObject({ price: 249 });
    expect(dreamStick?.memberPrice).toBeUndefined();
  });

  it('filters out prescription items', async () => {
    const body = await loadFixture(dir, 'search-prescription.json');
    expect(JSON.parse(body).results.items.length).toBe(30);
    expect(parseSearch(body, FETCHED_AT)).toEqual([]);
  });

  it('returns [] for no results', async () => {
    expect(await search('search-none.json')).toEqual([]);
  });

  it('maps out-of-stock items to inStock false', () => {
    const body = JSON.stringify({
      results: {
        items: [
          {
            type: 'Product',
            id: '1',
            attributes: [
              { name: 'Id', values: ['1'] },
              { name: 'Name', values: ['Test, 10 st'] },
              { name: 'ProductURL', values: ['/produkt/test-1/'] },
              { name: 'Price', values: [10] },
              { name: 'InStock', values: [false] },
              { name: 'Availability', values: ['InStoreOnly'] },
            ],
          },
        ],
      },
    });
    const [offer] = parseSearch(body, FETCHED_AT);
    expect(offer?.inStock).toBe(false);
    expect(ProductOffer.safeParse(offer).success).toBe(true);
  });

  it('trimming a fixture again does not change the parsed result', async () => {
    const body = await loadFixture(dir, 'search-campaign.json');
    expect(parseSearch(trimSearchBody(body), FETCHED_AT)).toEqual(parseSearch(body, FETCHED_AT));
  });
});

describe('apoteket product parsing', () => {
  it('parses an OTC product page', async () => {
    const offer = await product('product-otc.html');
    expect(() => ProductOffer.parse(offer)).not.toThrow();
    expect(offer).toMatchObject({
      merchantProductId: '243170',
      title: 'Alvedon, filmdragerad tablett 500 mg, 20 st',
      brand: 'Alvedon',
      ean: '7046260976108',
      packCount: 20,
      price: 34,
      inStock: true,
      // Canonical URL from JSON-LD, not the URL passed in.
      url: 'https://www.apoteket.se/produkt/alvedon-filmdragerad-tablett-500-mg-20-st-blister-243170/',
    });
    expect(offer?.originalPrice).toBeUndefined();
  });

  it('matches what search returned for the same product', async () => {
    const fromSearch = (await search('search-pharmacy.json')).find(
      (o) => o.merchantProductId === '243170',
    );
    const fromPage = await product('product-otc.html');
    expect(fromPage).toEqual(fromSearch);
  });

  it('reads a member campaign as memberPrice', async () => {
    const offer = await product('product-member.html');
    expect(() => ProductOffer.parse(offer)).not.toThrow();
    expect(offer).toMatchObject({
      merchantProductId: '1061015',
      ean: '7340074774081',
      price: 159,
      memberPrice: 119.25,
      size: { value: 250, unit: 'ml' },
    });
    expect(offer?.originalPrice).toBeUndefined();
  });

  it('reads a general campaign as price + originalPrice', async () => {
    const offer = await product('product-campaign.html');
    expect(() => ProductOffer.parse(offer)).not.toThrow();
    expect(offer).toMatchObject({
      merchantProductId: '1582873',
      ean: '5021807011193',
      price: 167.2,
      originalPrice: 209,
      inStock: true,
    });
    expect(offer?.memberPrice).toBeUndefined();
  });

  it('returns null for a prescription product page', async () => {
    expect(await product('product-prescription.html')).toBeNull();
  });

  it('returns null for a page without product data', () => {
    expect(parseProduct('<html></html>', 'https://www.apoteket.se/x/', FETCHED_AT)).toBeNull();
  });

  it('trimming a product page again does not change the parsed result', async () => {
    const html = await loadFixture(dir, 'product-member.html');
    const url = 'https://www.apoteket.se/produkt/x-1/';
    expect(parseProduct(trimProductHtml(html), url, FETCHED_AT)).toEqual(
      parseProduct(html, url, FETCHED_AT),
    );
  });
});

describe('apoteket helpers', () => {
  it('resolves campaign prices', () => {
    expect(resolvePrices(100, 0, 0)).toEqual({ price: 100 });
    expect(resolvePrices(100, undefined, undefined)).toEqual({ price: 100 });
    expect(resolvePrices(100, 80, 2)).toEqual({ price: 80, originalPrice: 100 });
    expect(resolvePrices(100, 80, 0)).toEqual({ price: 80, originalPrice: 100 });
    expect(resolvePrices(100, 75, 1)).toEqual({ price: 100, memberPrice: 75 });
    expect(resolvePrices(100, 120, 2)).toEqual({ price: 100 });
  });

  it('extracts product ids from URLs', () => {
    expect(
      productIdFromUrl(
        'https://www.apoteket.se/produkt/alvedon-filmdragerad-tablett-500-mg-20-st-blister-243170/',
      ),
    ).toBe('243170');
    expect(productIdFromUrl('/produkt/Apoteket-Sol-50-plus-Duo-p11022/')).toBe('p11022');
  });

  it('asks Loop54 for more rows than the default five', () => {
    expect(JSON.parse(searchRequestBody('alvedon', 20))).toEqual({
      query: 'alvedon',
      resultsOptions: { skip: 0, take: 20 },
    });
  });

  it('returns [] for an empty query without a request', async () => {
    expect(await adapter.search('   ')).toEqual([]);
  });

  it('describes the store', () => {
    expect(adapter.info).toMatchObject({
      id: 'apoteket',
      category: 'pharmacy',
      searchStrategy: 'api',
    });
  });
});
