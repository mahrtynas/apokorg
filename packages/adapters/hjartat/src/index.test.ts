import { ProductOffer } from '@apokorg/core';
import { loadFixture } from '@apokorg/adapter-kit';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  extractInitialData,
  parseProduct,
  parseSearch,
  readJsStringConcat,
  toOffer,
} from './index';
import { trimProductPage, wrapInitialData } from './fixtures';

const dir = fileURLToPath(new URL('..', import.meta.url));
const at = '2026-10-21T12:00:00.000Z';

async function search(name: string) {
  return parseSearch(await loadFixture(dir, name), at);
}

describe('INITIAL_DATA decoding', () => {
  it('decodes a JSON.parse string literal with escapes and concatenation', () => {
    const html =
      `<script>window.INITIAL_DATA = JSON.parse('{"a":"it\\'s","b":"<' + '!-- x -->\\\\n","c":"\\u00e4"}');` +
      `window.X = 1;</script>`;
    expect(extractInitialData(html)).toEqual({ a: "it's", b: '<!-- x -->\n', c: 'ä' });
  });

  it('falls back to a plain object assignment', () => {
    expect(extractInitialData('<script>window.INITIAL_DATA = {"a":1};</script>')).toEqual({
      a: 1,
    });
  });

  it('returns undefined for missing or broken data', () => {
    expect(extractInitialData('<html></html>')).toBeUndefined();
    expect(extractInitialData("window.INITIAL_DATA = JSON.parse('{oops');")).toBeUndefined();
    expect(readJsStringConcat('foo', 0)).toBeUndefined();
  });

  it('round-trips through the fixture wrapper', () => {
    const data = { page: { s: "a'b\\c</script><!-- d" } };
    expect(extractInitialData(wrapInitialData(data))).toEqual(data);
  });
});

describe('hjartat search parsing', () => {
  it('parses a pharmacy search into valid offers', async () => {
    const offers = await search('search-alvedon.html');
    expect(offers.length).toBe(9);
    for (const o of offers) expect(() => ProductOffer.parse(o)).not.toThrow();

    const alvedon = offers.find((o) => o.merchantProductId === '37434');
    expect(alvedon).toMatchObject({
      merchantId: 'hjartat',
      title: 'Alvedon Filmdragerad Tablett 500 mg 20 st',
      brand: 'Alvedon',
      ean: '7046260976108',
      price: 34,
      packCount: 20,
      unitPrice: { value: 1.7, per: 'st' },
      inStock: true,
      url: 'https://www.apotekhjartat.se/varumarken/alvedon/alvedon-filmdragerad-tablett-500-mg-20-st',
      fetchedAt: at,
    });
    expect(alvedon?.originalPrice).toBeUndefined();
    expect(alvedon?.memberPrice).toBeUndefined();
    expect(alvedon?.imageUrl).toMatch(/^https:\/\//);

    const suspension = offers.find((o) => o.title.startsWith('Alvedon Oral Suspension'));
    expect(suspension).toMatchObject({
      ean: '5054563932891',
      size: { value: 100, unit: 'ml' },
      unitPrice: { value: 550, per: 'l' },
    });
  });

  it('handles campaigns: multi-buy keeps the single-item price, discounts set originalPrice', async () => {
    const offers = await search('search-tandkram.html');
    expect(offers.length).toBeGreaterThan(50);
    for (const o of offers) expect(() => ProductOffer.parse(o)).not.toThrow();

    // "Köp 2 få 30%": price.current is 25.90 per item when buying two; one costs 37.
    const multiBuy = offers.find((o) => o.title === 'Parodontax Ultra Clean Tandkräm 75 ml');
    expect(multiBuy).toMatchObject({
      price: 37,
      ean: '5054563099617',
      size: { value: 75, unit: 'ml' },
    });
    expect(multiBuy?.originalPrice).toBeUndefined();

    // Straight 25 % campaign.
    const discounted = offers.find((o) => o.title === 'Virbac Enzymtandkräm 70 g');
    expect(discounted).toMatchObject({
      price: 66.75,
      originalPrice: 89,
      size: { value: 70, unit: 'g' },
    });

    // "soonInStock" (not buyable yet) counts as out of stock.
    const soon = offers.find((o) => o.title === 'Sensodyne Sensitivity & Gum Enamel Tandkräm 75ml');
    expect(soon).toMatchObject({ price: 29.4, originalPrice: 42, inStock: false });
  });

  it('drops prescription-only items', async () => {
    expect(await search('search-atorvastatin.html')).toEqual([]);
  });

  it('returns [] for no results and for pages without data', async () => {
    expect(await search('search-noresults.html')).toEqual([]);
    expect(parseSearch('<html><body>Fel</body></html>')).toEqual([]);
  });

  it('skips items that do not look like products', () => {
    expect(toOffer({ foo: 1 })).toBeNull();
    expect(toOffer(null)).toBeNull();
  });
});

describe('hjartat product parsing', () => {
  it('parses a product page', async () => {
    const url =
      'https://www.apotekhjartat.se/varumarken/alvedon/alvedon-filmdragerad-tablett-500-mg-20-st';
    const offer = parseProduct(await loadFixture(dir, 'product-alvedon.html'), url, at);
    expect(() => ProductOffer.parse(offer)).not.toThrow();
    expect(offer).toMatchObject({
      merchantProductId: '37434',
      price: 34,
      ean: '7046260976108',
      inStock: true,
      url,
    });
  });

  it('parses a multi-buy product page with the single-item price', async () => {
    const url =
      'https://www.apotekhjartat.se/varumarken/parodontax/parodontax-ultra-clean-tandkram-75-ml';
    const offer = parseProduct(await loadFixture(dir, 'product-parodontax.html'), url, at);
    expect(offer).toMatchObject({
      merchantProductId: '1032716',
      price: 37,
      brand: 'Parodontax',
      url,
    });
  });

  it('returns null for a page without a product', () => {
    expect(parseProduct('<html></html>', 'https://www.apotekhjartat.se/x')).toBeNull();
    expect(
      parseProduct(trimProductPage('<html></html>'), 'https://www.apotekhjartat.se/x'),
    ).toBeNull();
  });
});
