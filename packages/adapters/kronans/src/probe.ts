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
  cookieDecline:
    '#CybotCookiebotDialogBodyButtonDecline, #CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll >> nth=0',
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
  /**
   * The k-th element in a row with text of its own (name, delivery time, fee, …), skipping
   * the invisible screen-reader prefix "(Vald) leveransalternativ".
   */
  rowText: (k: number) =>
    `xpath=.//*[text()[normalize-space()][1][not(starts-with(normalize-space(.), 'Leveransalternativ')) and not(starts-with(normalize-space(.), 'Vald '))]] >> nth=${k}`,
  /** The whole widget, for the free-shipping threshold. */
  widget: `${FRAME}body`,
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
  title: document.title,
  h1: document.querySelector('h1')?.textContent?.trim() ?? null,
  buyButtons: document.querySelectorAll('[data-testid$="-buy-button"]').length,
  consentButtons: [...document.querySelectorAll('#CybotCookiebotDialog button')]
    .filter((b) => b.offsetParent !== null)
    .map((b) => b.id + ': ' + b.textContent.trim()),
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
  if (!(await exists(page, SELECTORS.buyButton(id), 15_000))) {
    throw new LayoutChanged(`no buy button on the product page: ${await describePage(page)}`);
  }
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
    try {
      await page.click(SELECTORS.buyButton(id));
    } catch (err) {
      // A click that times out (something covers the button) reads as "selector not found".
      if ((err as { code?: string }).code !== 'layout-changed') throw err;
      throw new LayoutChanged(`buy button not clickable: ${await describePage(page)}`);
    }
    // No drawer opens, only the header count changes; an add that didn't land shows up as
    // an empty cart on /kassa/. Give the cart time to update before the next click or page.
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
    const row = `${radio} >> ${SELECTORS.optionRow}`;
    const parts: string[] = [];
    // Hidden elements count as missing; stop after two misses in a row.
    for (let k = 0, misses = 0; k < MAX_ROWS && misses < 2; k++) {
      const part = `${row} >> ${SELECTORS.rowText(k)}`;
      if (!(await exists(page, part, 300))) {
        misses++;
        continue;
      }
      misses = 0;
      parts.push((await page.textContent(part)) ?? '');
    }
    const option = parseOptionParts(parts);
    if (!option) {
      const text = await page.textContent(row);
      throw new LayoutChanged(
        `can't read delivery option ${i}: ${JSON.stringify(parts)} in ${JSON.stringify(text)}`,
      );
    }
    let id = option.id;
    for (let n = 2; ids.has(id); n++) id = `${option.id}-${n}`;
    ids.add(id);
    options.push({ ...option, id });
  }
  if (options.length === 0) throw new LayoutChanged('no delivery options shown');
  // The threshold is stated once for the widget rather than in each row.
  const freeFrom = parseFreeFrom((await page.textContent(SELECTORS.widget)) ?? '');
  return options.map((o) =>
    o.fee > 0 && o.freeFrom == null && freeFrom != null ? { ...o, freeFrom } : o,
  );
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

const THRESHOLD = /fri frakt (?:från|över) (\d[\d\s]*(?:[.,]\d+)?) ?(?:kr|:-)/i;
const FEE = /^(?:(\d+(?:[.,]\d+)?) ?(?:kr|:-)|gratis|kostnadsfri)/i;

/** "Fri frakt från 299 kr eller vid receptköp" -> 299. */
export function parseFreeFrom(text: string): number | undefined {
  const m = cleanText(text).match(THRESHOLD);
  return m ? parsePrice(m[1]) : undefined;
}

/**
 * Reads one option row from the texts of its elements, e.g. ["Leveransalternativ",
 * "Instabox paketskåp", "Levereras imorgon runt 20:00", "19kr med Instabox"]. The name is the
 * first text, without the screen-reader prefix "(Vald) leveransalternativ"; the fee is the
 * first text that starts with an amount, so times like "20:00" are never read as a fee.
 */
export function parseOptionParts(raw: string[]): DeliveryOption | null {
  const parts = raw
    .map((p) => cleanText(p.replace(/\s+/g, ' ')).replace(/^(?:vald )?leveransalternativ\s*/i, ''))
    .filter(Boolean);
  const name = parts.find((p) => !THRESHOLD.test(p) && !FEE.test(p));
  const feeText = parts.find((p) => FEE.test(p));
  if (!name || !feeText) return null;
  const m = feeText.match(FEE)!;
  const fee = m[1] != null ? parsePrice(m[1]) : 0;
  if (fee == null) return null;
  const freeFrom = parts.map(parseFreeFrom).find((n) => n != null);
  return {
    id: slug(name),
    name,
    kind: deliveryKind(name),
    fee,
    ...(freeFrom != null && fee > 0 ? { freeFrom } : {}),
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
