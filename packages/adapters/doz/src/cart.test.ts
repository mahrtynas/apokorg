import type { GuardedPage } from '@apokorg/core';
import { describe, expect, it } from 'vitest';
import { SELECTORS, cartDataUrl, checkoutUrl, fillCart } from './cart';

/** A fake store: product pages, a cart that the Köp button adds to, and the cart JSON. */
function fakeStore(cart: Record<string, number>) {
  const log: string[] = [];
  let url = '';
  let qty = '1';
  const page: GuardedPage = {
    async goto(u) {
      url = u;
      log.push(`goto ${u}`);
    },
    async fill(selector, value) {
      expect(selector).toBe(SELECTORS.qty);
      qty = value;
      log.push(`fill ${value}`);
    },
    async click(selector) {
      expect(selector).toBe(SELECTORS.buy);
      const sku = /-(\d+)$/.exec(url)![1]!;
      cart[sku] = (cart[sku] ?? 0) + Number(qty);
      log.push(`click ${sku}`);
    },
    async waitFor() {},
    async textContent(selector) {
      expect(selector).toBe('body');
      expect(url).toBe(cartDataUrl());
      const items = Object.entries(cart).map(([product_sku, q]) => ({ product_sku, qty: q }));
      return JSON.stringify({ cart: { summary_count: items.length, items } });
    },
    async evaluateJson() {
      throw new Error('not used');
    },
  };
  return { page, log, cart };
}

const item = (sku: string, qty: number) => ({
  url: `https://dozapotek.se/product-${sku}`,
  merchantProductId: sku,
  qty,
});

describe('fillCart', () => {
  it('adds only what is missing, checks the cart, and stops on the checkout', async () => {
    const store = fakeStore({ '779716': 1 });
    const result = await fillCart({ items: [item('687795', 2), item('779716', 1)] }, store.page);
    expect(result).toEqual({ url: checkoutUrl(), skipped: ['779716'] });
    expect(store.cart).toEqual({ '687795': 2, '779716': 1 });
    expect(store.log).toEqual([
      `goto ${cartDataUrl()}`,
      'goto https://dozapotek.se/product-687795',
      'fill 2',
      'click 687795',
      `goto ${cartDataUrl()}`,
      `goto ${checkoutUrl()}`,
    ]);
  });

  it('tops up a smaller quantity already in the cart', async () => {
    const store = fakeStore({ '687795': 1 });
    await fillCart({ items: [item('687795', 3)] }, store.page);
    expect(store.cart['687795']).toBe(3);
    expect(store.log).toContain('fill 2');
  });

  it('fails with layout-changed when an item did not reach the cart', async () => {
    const store = fakeStore({});
    store.page.click = async () => {};
    await expect(fillCart({ items: [item('687795', 1)] }, store.page)).rejects.toMatchObject({
      code: 'layout-changed',
      message: expect.stringContaining('687795 (0 of 1)'),
    });
  });
});
