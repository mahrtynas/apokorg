import { ProductOffer } from '@apokorg/core';
import { loadFixture } from '@apokorg/adapter-kit';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import adapter, {
  campaignOriginalPrice,
  normalizeUnits,
  parseKronansPackCount,
  parseMultiBuy,
  parseProduct,
  parseSearch,
  productIdFromUrl,
  searchUrl,
} from './index';
import { trimProductHtml, trimSearchBody } from './trim';

const dir = fileURLToPath(new URL('..', import.meta.url));
const FETCHED_AT = '2026-10-22T08:17:00.000Z';

const search = async (name: string) => parseSearch(await loadFixture(dir, name), FETCHED_AT);
const product = async (name: string, url = 'https://www.kronansapotek.se/x/p/1/') =>
  parseProduct(await loadFixture(dir, name), url, FETCHED_AT);

describe('kronans search parsing', () => {
  it('parses a pharmacy search into valid offers and drops prescription items', async () => {
    const body = await loadFixture(dir, 'search-pharmacy.json');
    expect(JSON.parse(body).primaryList.productGroups.length).toBe(22);
    const offers = parseSearch(body, FETCHED_AT);
    // 11 of the 22 hits are prescription medicines (rX "Ja").
    expect(offers.length).toBe(11);
    for (const o of offers) expect(() => ProductOffer.parse(o)).not.toThrow();
    expect(offers.map((o) => o.merchantProductId)).not.toContain('097666');

    const alvedon = offers.find((o) => o.merchantProductId === '097610');
    expect(alvedon).toMatchObject({
      merchantId: 'kronans',
      title: 'Alvedon 500 mg Paracetamol, Filmdragerad tablett, 20 styck',
      brand: 'Alvedon',
      ean: '7046260976108',
      packCount: 20,
      price: 34,
      unitPrice: { value: 1.7, per: 'st' },
      inStock: true,
      url: 'https://www.kronansapotek.se/Alvedon/p/097610/',
      imageUrl: 'https://www.kronansapotek.se/k2/images/097610/large/0.jpg',
      fetchedAt: FETCHED_AT,
    });
    // basePrice (52 kr, the in-pharmacy price) is ignored.
    expect(alvedon?.originalPrice).toBeUndefined();
    expect(alvedon?.memberPrice).toBeUndefined();

    const suspension = offers.find((o) => o.merchantProductId === '126168');
    expect(suspension?.size).toEqual({ value: 100, unit: 'ml' });
    expect(suspension?.unitPrice).toEqual({ value: 550, per: 'l' });

    const outOfStock = offers.find((o) => o.merchantProductId === '488347');
    expect(outOfStock).toMatchObject({ price: 27, inStock: false });
  });

  it('parses a cosmetic search', async () => {
    const offers = await search('search-cosmetic.json');
    expect(offers.length).toBe(30);
    for (const o of offers) expect(() => ProductOffer.parse(o)).not.toThrow();

    const cicaplast = offers.find((o) => o.merchantProductId === '796303');
    expect(cicaplast).toMatchObject({
      title: 'La Roche-Posay Cicaplast Baume B5+ Balm 100 ml',
      brand: 'La Roche-Posay',
      ean: '3337875816847',
      price: 161,
      size: { value: 100, unit: 'ml' },
      unitPrice: { value: 1610, per: 'l' },
      inStock: true,
    });
  });

  it('reads campaigns as price + the 30-day lowest price', async () => {
    const offers = await search('search-campaign.json');
    expect(offers.length).toBe(30);
    for (const o of offers) expect(() => ProductOffer.parse(o)).not.toThrow();

    const sensodyne = offers.find((o) => o.merchantProductId === '785360');
    expect(sensodyne).toMatchObject({
      title: 'Sensodyne Repair and Protect Tandkräm 75 ml',
      ean: '5054563097620',
      price: 34.93,
      // listPrice is 49.9; the site shows "Tidigare pris: 50 kr" (minPriceMonth).
      originalPrice: 50,
      size: { value: 75, unit: 'ml' },
      unitPrice: { value: 465.73, per: 'l' },
    });
    expect(sensodyne?.memberPrice).toBeUndefined();

    const plain = offers.find((o) => o.merchantProductId === '788053');
    expect(plain).toMatchObject({ price: 24, inStock: true });
    expect(plain?.originalPrice).toBeUndefined();

    // "1 x 51 gram": the spelled-out unit is understood.
    const duraphat = offers.find((o) => o.merchantProductId === '024392');
    expect(duraphat).toMatchObject({ size: { value: 51, unit: 'g' }, packCount: 1 });
    // minPriceMonth (104) without a campaign is not an original price.
    expect(duraphat?.originalPrice).toBeUndefined();
  });

  it('reads "2 för 40:-" ribbons as a multi-buy', async () => {
    const offers = await search('search-multibuy.json');
    for (const o of offers) expect(() => ProductOffer.parse(o)).not.toThrow();

    const apelsin = offers.find((o) => o.merchantProductId === '757388');
    expect(apelsin).toMatchObject({
      title: 'Kronans Apotek C-Vitamin Apelsin Brustabletter 20 st',
      ean: '7312489998253',
      price: 30,
      multiBuy: { qty: 2, unitPrice: 20 },
      packCount: 20,
    });
    expect(apelsin?.originalPrice).toBeUndefined();
  });

  it('returns [] for no results', async () => {
    expect(await search('search-none.json')).toEqual([]);
  });

  it('skips malformed products instead of failing the search', () => {
    const body = JSON.stringify({
      primaryList: {
        productGroups: [
          { products: [{ key: 'broken' }] },
          {
            products: [
              {
                key: '1',
                title: 'Test',
                link: '/test/p/1/',
                sellingPrice: { min: 10 },
                inStock: true,
                custom: { subTitle: [{ id: '10 st', label: '10 st' }] },
              },
            ],
          },
        ],
      },
    });
    const offers = parseSearch(body, FETCHED_AT);
    expect(offers.map((o) => o.merchantProductId)).toEqual(['1']);
    expect(ProductOffer.safeParse(offers[0]).success).toBe(true);
  });

  it('trimming a fixture again does not change the parsed result', async () => {
    const body = await loadFixture(dir, 'search-campaign.json');
    expect(parseSearch(trimSearchBody(body), FETCHED_AT)).toEqual(parseSearch(body, FETCHED_AT));
  });
});

describe('kronans product parsing', () => {
  it('parses an OTC product page', async () => {
    const offer = await product('product-otc.html');
    expect(() => ProductOffer.parse(offer)).not.toThrow();
    expect(offer).toMatchObject({
      merchantProductId: '097610',
      title: 'Alvedon 500 mg Paracetamol, Filmdragerad tablett, 20 styck',
      brand: 'Alvedon',
      // JSON-LD gtin14 "07046260976108" without the leading 0.
      ean: '7046260976108',
      packCount: 20,
      price: 34,
      inStock: true,
      // Canonical URL from JSON-LD, not the URL passed in.
      url: 'https://www.kronansapotek.se/Alvedon/p/097610/',
    });
    expect(offer?.originalPrice).toBeUndefined();
  });

  it('matches what search returned for the same product', async () => {
    const fromSearch = (await search('search-pharmacy.json')).find(
      (o) => o.merchantProductId === '097610',
    );
    expect(await product('product-otc.html')).toEqual(fromSearch);

    const multiFromSearch = (await search('search-multibuy.json')).find(
      (o) => o.merchantProductId === '757388',
    );
    expect(await product('product-multibuy.html')).toEqual(multiFromSearch);
  });

  it('reads a campaign as price + originalPrice with its end date', async () => {
    const offer = await product('product-campaign.html');
    expect(() => ProductOffer.parse(offer)).not.toThrow();
    expect(offer).toMatchObject({
      merchantProductId: '785360',
      ean: '5054563097620',
      price: 34.93,
      originalPrice: 50,
      priceValidUntil: '2026-10-25',
      inStock: true,
    });
    expect(offer?.memberPrice).toBeUndefined();
  });

  it('reads the product’s own multi-buy badge', async () => {
    const offer = await product('product-multibuy.html');
    expect(offer).toMatchObject({ price: 30, multiBuy: { qty: 2, unitPrice: 20 } });
  });

  it('reads out-of-stock availability', async () => {
    const offer = await product('product-out-of-stock.html');
    expect(() => ProductOffer.parse(offer)).not.toThrow();
    expect(offer).toMatchObject({ merchantProductId: '488347', price: 27, inStock: false });
  });

  it('returns null for a prescription product page', async () => {
    expect(await product('product-prescription.html')).toBeNull();
  });

  it('returns null for a page without product data', () => {
    expect(
      parseProduct('<html></html>', 'https://www.kronansapotek.se/x/p/1/', FETCHED_AT),
    ).toBeNull();
  });

  it('trimming a product page again does not change the parsed result', async () => {
    const html = await loadFixture(dir, 'product-multibuy.html');
    const url = 'https://www.kronansapotek.se/x/p/1/';
    expect(parseProduct(trimProductHtml(html), url, FETCHED_AT)).toEqual(
      parseProduct(html, url, FETCHED_AT),
    );
  });
});

describe('kronans helpers', () => {
  it('parses multi-buy ribbons', () => {
    expect(parseMultiBuy('2 för 40:-', 30)).toEqual({ qty: 2, unitPrice: 20 });
    expect(parseMultiBuy('3 för 100 kr', 45)).toEqual({ qty: 3, unitPrice: 33.33 });
    expect(parseMultiBuy('Köp 2 få 30%', 115)).toEqual({ qty: 2, unitPrice: 80.5 });
    expect(parseMultiBuy('2 för 80:-', 30)).toBeUndefined();
    expect(parseMultiBuy('25%', 30)).toBeUndefined();
    expect(parseMultiBuy('Bra deal', 30)).toBeUndefined();
  });

  it('picks the original price of a campaign', () => {
    expect(campaignOriginalPrice(34.93, 49.9, 50)).toBe(50);
    expect(campaignOriginalPrice(25.9, 37, 26.53)).toBe(26.53);
    expect(campaignOriginalPrice(25.9, 37, 20)).toBe(37);
    expect(campaignOriginalPrice(25.9, 37, undefined)).toBe(37);
    expect(campaignOriginalPrice(99, 99, 104)).toBeUndefined();
  });

  it('normalizes spelled-out units and pack counts', () => {
    expect(normalizeUnits('Oral lösning, 1\u00a0000 milliliter')).toBe('Oral lösning, 1000 ml');
    expect(normalizeUnits('Tandkräm, 1 x 51 gram')).toBe('Tandkräm, 1 x 51 gram');
    expect(parseKronansPackCount('Brustablett, 3 x 30 styck')).toBe(90);
    expect(parseKronansPackCount('Filmdragerad tablett, 20 tablett(er)')).toBe(20);
  });

  it('extracts the varunummer from product URLs', () => {
    expect(productIdFromUrl('https://www.kronansapotek.se/Alvedon/p/097610/')).toBe('097610');
    expect(productIdFromUrl('/kronans-hair-scalp-strengthening/p/01301771/')).toBe('01301771');
  });

  it('builds the Elevate search URL', () => {
    const url = new URL(searchUrl('tandkräm', 20));
    expect(url.origin + url.pathname).toBe(
      'https://wbd81f9f3.api.esales.apptus.cloud/api/storefront/v3/queries/search-page',
    );
    expect(url.searchParams.get('q')).toBe('tandkräm');
    expect(url.searchParams.get('limit')).toBe('20');
    expect(url.searchParams.get('market')).toBe('se');
    expect(url.searchParams.get('presentCustom')?.split('|')).toContain('rX');
  });

  it('returns [] for an empty query without a request', async () => {
    expect(await adapter.search('   ')).toEqual([]);
  });

  it('describes the store', () => {
    expect(adapter.info).toMatchObject({
      id: 'kronans',
      category: 'pharmacy',
      searchStrategy: 'api',
    });
  });
});
