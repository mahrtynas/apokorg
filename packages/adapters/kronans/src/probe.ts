/**
 * Checkout probe for Kronans Apotek: adds the items to the cart, opens /kassa/, enters the
 * postcode in the Ingrid delivery widget and reads every delivery option, then empties the
 * cart. Uses only the GuardedPage it is given. Steps and findings: docs/stores/kronans.md
 */
import type { DeliveryKind, DeliveryOption, GuardedPage, ProbeFn } from '@apokorg/core';
import { cleanText, parsePrice } from '@apokorg/adapter-kit';
import { BASE_URL, productIdFromUrl } from './index';

/** The delivery widget is a cross-origin iframe; Playwright selectors step into it. */
const FRAME = 'iframe[title*="leveransalternativ" i] >> internal:control=enter-frame >> ';

/** Every selector the probe uses, so they're easy to fix when the site changes. */
export const SELECTORS = {
  checkoutPath: '/kassa/',
  /** Cookiebot's dialog ("Samtycke"); declined, since items don't reach the cart while it's open. */
  cookieDecline: 'internal:role=button[name=/^Neka/i] >> nth=0',
  /** The cart drawer that opens after add-to-cart. */
  cartDrawer: 'internal:text=/Till kassan/i >> nth=0',
  /** Add-to-cart (accessible name "Köp <product>, <price> kronor"), not a purchase. */
  buyButton: (id: string) => `[data-testid="${id}-buy-button"] >> nth=0`,
  deliveryFrame: 'iframe[title*="leveransalternativ" i]',
  postcode: `${FRAME}internal:role=textbox[name="Postnummer"i]`,
  continue: `${FRAME}internal:role=button[name="Fortsätt"i]`,
  showAll: `${FRAME}internal:role=button[name="Visa alla"i]`,
  options: `${FRAME}internal:role=radiogroup[name="Leveransalternativ"i]`,
  option: (i: number) =>
    `${FRAME}internal:role=radiogroup[name="Leveransalternativ"i] >> internal:role=radio >> nth=${i}`,
  /** The row around a radio: the nearest element that also holds the fee. */
  optionRow: `xpath=ancestor-or-self::*[contains(., 'kr')][1]`,
  removeItem: 'internal:role=button[name=/^Ta bort/i] >> nth=0',
  emptyCart: 'internal:text="Din varukorg är tom"i',
} as const;

/** At most this many options or cart rows are read or removed. */
const MAX_ROWS = 20;

/** The product's price from its JSON-LD; read-only, so the guard lets it through. */
const JSON_LD_PRICE = `(() => {
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    let data;
    try { data = JSON.parse(s.textContent || ''); } catch { continue; }
    for (const node of [data].flat()) {
      if (node && node['@type'] === 'Product') {
        const offer = [node.offers].flat()[0];
        return offer ? String(offer.price) : null;
      }
    }
  }
  return null;
})()`;

/** What the page shows, for failure messages. Read-only. */
const PAGE_STATE = `(() => ({
  url: location.pathname,
  cartEmpty: /Din varukorg är tom/i.test(document.body.innerText),
  iframes: [...document.querySelectorAll('iframe')].map((f) => f.title || f.src).slice(0, 8),
  text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300),
}))()`;

async function describePage(page: GuardedPage): Promise<string> {
  try {
    return JSON.stringify(await page.evaluateJson(PAGE_STATE));
  } catch {
    return 'page state unreadable';
  }
}

class LayoutChanged extends Error {
  readonly code = 'layout-changed';
}

/**
 * Builds the probe. `base` is the site the checkout lives on; tests point it at a local
 * fixture server.
 */
export function createProbe(base = BASE_URL): ProbeFn {
  return async (req, page) => {
    let orderValue = 0;
    try {
      for (const item of req.items) {
        orderValue += (await addToCart(page, item.url, item.qty, req.signal)) * item.qty;
      }
      await page.goto(new URL(SELECTORS.checkoutPath, base).href);
      if (!(await exists(page, SELECTORS.deliveryFrame, 20_000))) {
        throw new LayoutChanged(`no delivery widget on /kassa/: ${await describePage(page)}`);
      }
      await page.waitFor(SELECTORS.postcode, 15_000);
      await page.fill(SELECTORS.postcode, req.postcode);
      await page.click(SELECTORS.continue);
      await page.waitFor(SELECTORS.options, 15_000);
      if (await exists(page, SELECTORS.showAll, 2_000)) await page.click(SELECTORS.showAll);
      const options = await readOptions(page);
      return {
        merchantId: 'kronans',
        orderValue: Math.round(orderValue * 100) / 100,
        postcode: req.postcode,
        options,
        probedAt: new Date().toISOString(),
        status: 'ok',
      };
    } finally {
      await emptyCart(page, base);
    }
  };
}

async function addToCart(
  page: GuardedPage,
  url: string,
  qty: number,
  signal?: AbortSignal,
): Promise<number> {
  const id = productIdFromUrl(url);
  if (!id) throw new LayoutChanged(`no product id in ${url}`);
  await page.goto(url);
  await page.waitFor(SELECTORS.buyButton(id));
  const price = parsePrice((await page.evaluateJson<string | null>(JSON_LD_PRICE)) ?? undefined);
  if (price == null) throw new LayoutChanged(`no price on ${url}`);
  // The button is server-rendered; a click before Gatsby hydrates the page does nothing.
  await waitForLoad(page, signal);
  if (await exists(page, SELECTORS.cookieDecline, 5_000)) {
    await page.click(SELECTORS.cookieDecline);
    await pause(2_000, signal);
    await waitForLoad(page, signal);
  }
  for (let i = 0; i < qty; i++) {
    if (!(await exists(page, SELECTORS.buyButton(id), 15_000))) {
      throw new LayoutChanged(`no buy button: ${await describePage(page)}`);
    }
    await page.click(SELECTORS.buyButton(id));
    if (!(await exists(page, SELECTORS.cartDrawer, 10_000))) {
      throw new LayoutChanged(`add-to-cart showed no cart: ${await describePage(page)}`);
    }
    // The cart updates in the background; give it time before the next click or page.
    await pause(2_000, signal);
  }
  return price;
}

async function readOptions(page: GuardedPage): Promise<DeliveryOption[]> {
  const options: DeliveryOption[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < MAX_ROWS; i++) {
    const radio = SELECTORS.option(i);
    if (!(await exists(page, radio, i === 0 ? 10_000 : 500))) break;
    const text = await page.textContent(`${radio} >> ${SELECTORS.optionRow}`);
    const option = parseOptionText(text ?? '');
    if (!option) throw new LayoutChanged(`can't read delivery option ${i}: ${text}`);
    let id = option.id;
    for (let n = 2; ids.has(id); n++) id = `${option.id}-${n}`;
    ids.add(id);
    options.push({ ...option, id });
  }
  if (options.length === 0) throw new LayoutChanged('no delivery options shown');
  return options;
}

/**
 * Removes every cart row on /kassa/ and checks that the cart says it is empty. Runs after
 * every probe, also when reading the options failed.
 */
async function emptyCart(page: GuardedPage, base: string): Promise<void> {
  await page.goto(new URL(SELECTORS.checkoutPath, base).href);
  for (let i = 0; i < MAX_ROWS; i++) {
    if (!(await exists(page, SELECTORS.removeItem, 5_000))) break;
    await page.click(SELECTORS.removeItem);
    await pause(2_000);
  }
  if (!(await exists(page, SELECTORS.emptyCart, 10_000))) {
    throw new LayoutChanged('the cart could not be emptied');
  }
}

/**
 * Reads one option row, e.g. "Instabox paketskåp 19 kr med Instabox Fri frakt från 299 kr
 * eller vid receptköp". The text before the fee is the name.
 */
export function parseOptionText(raw: string): DeliveryOption | null {
  let text = cleanText(raw.replace(/\s+/g, ' '));
  let freeFrom: number | undefined;
  const threshold = text.match(/fri frakt (?:från|över) (\d[\d\s]*(?:[.,]\d+)?) ?(?:kr|:-)/i);
  if (threshold) {
    freeFrom = parsePrice(threshold[1]);
    text = cleanText(
      text.slice(0, threshold.index) + ' ' + text.slice(threshold.index! + threshold[0].length),
    );
  }
  const fee = text.match(/(\d+(?:[.,]\d+)?) ?(?:kr|:-)/i) ?? text.match(/gratis|kostnadsfri/i);
  if (!fee) return null;
  const name = cleanText(text.slice(0, fee.index)).replace(/^Leveransalternativ /i, '');
  if (!name) return null;
  const feeValue = fee[1] != null ? parsePrice(fee[1]) : 0;
  if (feeValue == null) return null;
  return {
    id: slug(name),
    name,
    kind: deliveryKind(name),
    fee: feeValue,
    ...(freeFrom != null && feeValue > 0 ? { freeFrom } : {}),
  };
}

/** The kind of delivery an option name describes. */
export function deliveryKind(name: string): DeliveryKind {
  const n = name.toLowerCase();
  if (/apotek|butik|hämta/.test(n)) return 'store-pickup';
  if (/brevlåda/.test(n)) return 'mailbox';
  if (/skåp|box|automat/.test(n)) return 'parcel-box';
  if (/hem|budbee|(?:^| )bud\b|gordon|dörr/.test(n)) return 'home';
  return 'pickup-point';
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function exists(page: GuardedPage, selector: string, timeoutMs: number): Promise<boolean> {
  try {
    await page.waitFor(selector, timeoutMs);
    return true;
  } catch {
    return false;
  }
}

/** Waits for the page's load event, then a little longer for hydration to finish. */
async function waitForLoad(page: GuardedPage, signal?: AbortSignal): Promise<void> {
  for (let i = 0; i < 30; i++) {
    // Throws while the page is navigating (e.g. reloading after the cookie choice).
    const state = await page.evaluateJson<string>('document.readyState').catch(() => 'loading');
    if (state === 'complete') break;
    await pause(500, signal);
  }
  await pause(2_000, signal);
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });
}

/** `adapter.probe`. Built per call: index.ts and this file import each other. */
export const probe: ProbeFn = (req, page) => createProbe()(req, page);
