import { ProductOffer } from '@apokorg/core';
import { loadFixture } from '@apokorg/adapter-kit';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import adapter, {
  QueueError,
  isQueuePage,
  parseProduct,
  parseSearch,
  searchUrl,
  toOffer,
} from './index';
import { trimProductPage, wrapCurrentPage } from './fixtures';

const dir = fileURLToPath(new URL('..', import.meta.url));
const at = '2026-10-22T08:00:00.000Z';

async function search(name: string) {
  return parseSearch(await loadFixture(dir, name), at);
}

/** A search hit with the fields that matter, for tweaking one at a time. */
function hit(overrides: Record<string, unknown> = {}, price: Record<string, unknown> = {}) {
  return {
    code: '1000-100-0100',
    url: '/sv/brand/product-100-ml',
    displayName: 'Brand Product 100 ml',
    brandName: 'Brand',
    price: {
      current: 100,
      comparisonPrices: [],
      isMemberPrice: false,
      isComboDealPrice: false,
      campaignPriceValidUntil: null,
      memberPrice: null,
      memberPriceValidUntil: null,
      ...price,
    },
    size: 100,
    unit: 'ml',
    images: [{ url: '/globalassets/product-images/x.jpg?ref=1' }],
    onlineStatus: { interactionType: 'buy' },
    ...overrides,
  };
}

describe('lyko search parsing', () => {
  it('parses a search page into valid offers', async () => {
    const offers = await search('search-schampo.html');
    expect(offers.length).toBe(24);
    for (const o of offers) expect(() => ProductOffer.parse(o)).not.toThrow();

    const olaplex = offers.find((o) => o.merchantProductId === '1737-105-0250');
    expect(olaplex).toMatchObject({
      merchantId: 'lyko',
      title: 'Olaplex No.4 Bond Maintenance Shampoo 250 ml',
      brand: 'Olaplex',
      size: { value: 250, unit: 'ml' },
      // "Rek. pris" 379 is a list price, not a campaign.
      price: 303,
      unitPrice: { value: 1212, per: 'l' },
      inStock: true,
      url: 'https://lyko.com/sv/olaplex/olaplex---bond-maintenance-shampoo-no4',
      fetchedAt: at,
    });
    expect(olaplex?.originalPrice).toBeUndefined();
    expect(olaplex?.memberPrice).toBeUndefined();
    // Search hits carry no EAN; product pages do.
    expect(olaplex?.ean).toBeUndefined();
    expect(olaplex?.imageUrl).toMatch(/^https:\/\/lyko\.com\/globalassets\//);
  });

  it('uses the single-item price for Combo Deals and the "Tid. pris" for campaigns', async () => {
    const offers = await search('search-schampo.html');
    // Combo Deal 25%: current 34.425 only applies with other products; 45.9 is the real price.
    expect(offers.find((o) => o.merchantProductId === '1185-A50-0400')).toMatchObject({
      price: 45.9,
      unitPrice: { value: 183.6, per: 'l' },
    });
    const combo = offers.find((o) => o.merchantProductId === '1185-A50-0400');
    expect(combo?.originalPrice).toBeUndefined();
    expect(combo?.priceValidUntil).toBeUndefined();

    expect(offers.find((o) => o.merchantProductId === '1177-398-0300')).toMatchObject({
      title: 'Lanza Keratin Healing Oil Shampoo 300 ml',
      price: 201.9,
      originalPrice: 359,
    });
  });

  it('parses a toothpaste search', async () => {
    const offers = await search('search-tandkram.html');
    expect(offers.length).toBe(24);
    expect(offers.find((o) => o.merchantProductId === '1281-334-0100')).toMatchObject({
      title: 'Sensodyne Tandkräm Extra Fresh 100 ml',
      brand: 'Sensodyne',
      price: 49,
      size: { value: 100, unit: 'ml' },
      inStock: true,
    });
    expect(offers.find((o) => o.merchantProductId === '3711-105-0100')?.size).toEqual({
      value: 100,
      unit: 'g',
    });
  });

  it('parses the category page a search redirects to', async () => {
    const offers = await search('search-parfym-redirect.html');
    expect(offers.length).toBe(6);
    expect(offers[0]).toMatchObject({
      title: 'Valentino Born in Roma Donna Eau de Parfum 30 ml',
      size: { value: 30, unit: 'ml' },
    });
  });

  it('returns [] when nothing matches', async () => {
    expect(await search('search-noresults.html')).toEqual([]);
    expect(parseSearch('<html></html>')).toEqual([]);
  });
});

describe('lyko product page parsing', () => {
  it('parses a product page with its EAN', async () => {
    const url = 'https://lyko.com/sv/olaplex/olaplex---bond-maintenance-shampoo-no4';
    const offer = parseProduct(await loadFixture(dir, 'product-olaplex.html'), url, at);
    expect(() => ProductOffer.parse(offer)).not.toThrow();
    expect(offer).toMatchObject({
      merchantProductId: '1737-105-0250',
      // UPC-A, 12 digits.
      ean: '810177860303',
      price: 303,
      inStock: true,
      url,
    });
  });

  it('matches the search hit for the same variant', async () => {
    const offers = await search('search-schampo.html');
    const fromSearch = offers.find((o) => o.merchantProductId === '1185-A50-0400')!;
    const page = parseProduct(
      await loadFixture(dir, 'product-elvital-combo.html'),
      fromSearch.url,
      at,
    );
    expect(page).toMatchObject({
      merchantProductId: fromSearch.merchantProductId,
      price: fromSearch.price,
      url: fromSearch.url,
      ean: '3600524136949',
    });
  });

  it('returns null for a page without a product', () => {
    expect(parseProduct('<html></html>', 'https://lyko.com/sv/x')).toBeNull();
    expect(parseProduct(wrapCurrentPage({ products: { products: [] } }), '')).toBeNull();
  });

  it('round-trips through the fixture wrapper', async () => {
    const html = await loadFixture(dir, 'product-olaplex.html');
    expect(parseProduct(trimProductPage(html), '', at)).toEqual(parseProduct(html, '', at));
    const tricky = hit({ displayName: 'A </script> <!-- B 50 ml' });
    expect(parseProduct(wrapCurrentPage(tricky), '', at)?.title).toBe('A </script> <!-- B 50 ml');
  });
});

describe('lyko offer mapping', () => {
  it('marks "Bevaka" (monitor) items out of stock', () => {
    expect(toOffer(hit({ onlineStatus: { interactionType: 'monitor' } }))?.inStock).toBe(false);
    expect(toOffer(hit({ onlineStatus: null }))?.inStock).toBe(false);
    expect(toOffer(hit())?.inStock).toBe(true);
  });

  it('fills memberPrice only from explicit Club Lyko prices', () => {
    expect(toOffer(hit({}, { memberPrice: 89 }))).toMatchObject({ price: 100, memberPrice: 89 });
    expect(toOffer(hit({}, { memberPrice: 100 }))?.memberPrice).toBeUndefined();
    // Current price is itself the member price: the public price is the comparison price.
    expect(
      toOffer(
        hit(
          {},
          {
            current: 80,
            isMemberPrice: true,
            comparisonPrices: [{ type: 'ordinary', typeText: 'Tid. pris', value: 100 }],
          },
        ),
      ),
    ).toMatchObject({ price: 100, memberPrice: 80 });
  });

  it('reads the campaign end date in Swedish time', () => {
    const offer = toOffer(
      hit(
        {},
        {
          current: 75,
          comparisonPrices: [{ type: 'ordinary', typeText: 'Tid. pris', value: 100 }],
          campaignPriceValidUntil: { validUntil: '2026-11-01T23:00:00Z', isQuantityLimited: false },
        },
      ),
    );
    expect(offer).toMatchObject({ price: 75, originalPrice: 100, priceValidUntil: '2026-11-01' });
  });

  it('drops gift cards, donations and malformed hits', () => {
    expect(toOffer(hit({ isDigital: true }))).toBeNull();
    expect(toOffer(hit({ isCharity: true }))).toBeNull();
    expect(toOffer({ code: 'x' })).toBeNull();
  });

  it('falls back to the structured size when the title has none', () => {
    expect(toOffer(hit({ displayName: 'Brand Foundation 2N' }))?.size).toEqual({
      value: 100,
      unit: 'ml',
    });
  });
});

describe('lyko Queue-it', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('recognises the waiting room page and throws a QueueError', async () => {
    const queue = await loadFixture(dir, 'queue-it.html');
    expect(isQueuePage(queue)).toBe(true);
    expect(() => parseSearch(queue)).toThrow(QueueError);
    expect(() => parseProduct(queue, 'https://lyko.com/sv/x')).toThrow(QueueError);
  });

  it('does not flag normal pages, which load the Queue-it client script', async () => {
    const page = await loadFixture(dir, 'search-schampo.html');
    const withScript = page.replace(
      '</head>',
      '<script src="//static.queue-it.net/script/queueclient.min.js"></script></head>',
    );
    expect(isQueuePage(withScript)).toBe(false);
    expect(parseSearch(withScript, at)).toHaveLength(24);
  });

  it('fails fast when a request is redirected into the queue', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      url: 'https://lyko.queue-it.net/?c=lyko&e=lykose&t=https%3A%2F%2Flyko.com%2Fsv%2Fsok',
      headers: new Headers(),
      text: async () => '<html><body>Du står i kö</body></html>',
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(adapter.search('schampo')).rejects.toBeInstanceOf(QueueError);
    await expect(adapter.search('schampo')).rejects.toThrow(/Queue-it/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('builds the search URL', () => {
    expect(searchUrl('tandkräm 75 ml')).toBe('https://lyko.com/sv/sok?q=tandkr%C3%A4m%2075%20ml');
  });
});
