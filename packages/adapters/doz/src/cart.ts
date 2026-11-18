/**
 * Cart filler for DOZ Apotek: tops the cart up to the wanted quantities, checks it, and opens
 * the checkout for the user to finish. Uses only the GuardedPage it is given. The user opted in
 * to cart automation for DOZ although robots.txt disallows /checkout/: they are at the
 * computer and place the order themselves. Notes: docs/stores/doz.md
 */
import type { CartFillFn, GuardedPage } from '@apokorg/core';
import { z } from 'zod';
import { BASE_URL } from './index';

/** Every selector the script uses, so they're easy to fix when the site changes. */
export const SELECTORS = {
  /** The visible quantity box of the product form (Hyvä, `form="product_addtocart_form"`). */
  qty: 'input[name="qty"][form="product_addtocart_form"]',
  /** "Köp" adds to the cart in the background; it is not a purchase. */
  buy: '#product-addtocart-button',
  /** The button has `is-loading` while the add runs and for about a second after. */
  busy: '#product-addtocart-button.is-loading',
  idle: '#product-addtocart-button:not(.is-loading)',
} as const;

// Functions, not constants: index.ts imports this module before BASE_URL is initialised.
/** Magento's customer-data section the minicart reads: the cart as JSON. */
export const cartDataUrl = () => `${BASE_URL}/customer/section/load/?sections=cart`;
export const checkoutUrl = () => `${BASE_URL}/checkout/`;

const CartData = z.object({
  cart: z.object({
    items: z.array(z.object({ product_sku: z.string(), qty: z.coerce.number() })).default([]),
  }),
});

const layoutChanged = (message: string) =>
  Object.assign(new Error(message), { code: 'layout-changed' });

/** Quantity per DOZ article number (the product SKU, our merchantProductId). */
export async function cartQuantities(page: GuardedPage): Promise<Map<string, number>> {
  await page.goto(cartDataUrl());
  const text = (await page.textContent('body')) ?? '';
  let parsed: z.infer<typeof CartData>;
  try {
    parsed = CartData.parse(JSON.parse(text));
  } catch {
    throw layoutChanged(`cart data at ${cartDataUrl()} is not what the script expects`);
  }
  const out = new Map<string, number>();
  for (const it of parsed.cart.items)
    out.set(it.product_sku, (out.get(it.product_sku) ?? 0) + it.qty);
  return out;
}

export const fillCart: CartFillFn = async (req, page) => {
  // Magento adds to what is already there, so only the missing quantity is added.
  const before = await cartQuantities(page);
  const skipped: string[] = [];
  for (const item of req.items) {
    req.signal?.throwIfAborted();
    const missing = item.qty - (before.get(item.merchantProductId) ?? 0);
    if (missing <= 0) {
      skipped.push(item.merchantProductId);
      continue;
    }
    await page.goto(item.url);
    await page.fill(SELECTORS.qty, String(missing));
    await page.click(SELECTORS.buy);
    // The busy state can be over before we look; the idle wait is what counts.
    await page.waitFor(SELECTORS.busy, 5_000).catch(() => {});
    await page.waitFor(SELECTORS.idle, 30_000);
  }

  const after = await cartQuantities(page);
  const short = req.items.filter((i) => (after.get(i.merchantProductId) ?? 0) < i.qty);
  if (short.length > 0) {
    const list = short
      .map((i) => `${i.merchantProductId} (${after.get(i.merchantProductId) ?? 0} of ${i.qty})`)
      .join(', ');
    throw layoutChanged(`not everything reached the cart: ${list}`);
  }

  await page.goto(checkoutUrl());
  return { url: checkoutUrl(), skipped };
};
