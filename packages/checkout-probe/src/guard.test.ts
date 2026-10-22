import type { GuardedPage } from '@apokorg/core';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Frame,
  type Page,
} from 'playwright-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFixtureServer, type FixtureServer } from '../test/server';
import { testBrowser } from '../test/browser';
import { ForbiddenActionError, ProbeError } from './errors';
import { createGuardedPage, installRequestGuard, type BlockedRequest } from './guard';
import { CLICK_DENYLIST } from './rules';

const POSTCODE = '11738';
const EMAIL = 'probe+apokorg@example.com';
const KLARNA = 'iframe[name="klarna-checkout-iframe"] >> internal:control=enter-frame >> ';

let server: FixtureServer;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let guarded: GuardedPage;
let violations: ForbiddenActionError[];
let blocked: BlockedRequest[];
let escaped: string[];

beforeAll(async () => {
  server = await startFixtureServer();
  browser = await chromium.launch({ ...(await testBrowser()), headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

beforeEach(async () => {
  context = await browser.newContext({ serviceWorkers: 'block' });
  violations = [];
  blocked = [];
  escaped = [];
  // Registered first, so it only sees what the guard lets through: keeps the tests offline.
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    escaped.push(url.href);
    return route.abort('internetdisconnected');
  });
  await installRequestGuard(context, (req) => blocked.push(req));
  page = await context.newPage();
  guarded = createGuardedPage(page, {
    postcode: POSTCODE,
    email: EMAIL,
    actionTimeoutMs: 2_000,
    onViolation: (err) => violations.push(err),
  });
  await guarded.goto(`${server.url}/checkout.html`);
  // The first context after a cold browser start is slow on a busy CI runner.
}, 30_000);

afterEach(async () => {
  await context?.close();
  expect(escaped).toEqual([]);
});

/** What the fixture's capture-phase click listener recorded. */
const clicks = (frame: Page | Frame = page) => frame.evaluate<string[]>('window.__clicks');
const klarnaFrame = () => page.frame({ name: 'klarna-checkout-iframe' })!;

describe('click', () => {
  it.each(CLICK_DENYLIST)('refuses the denylisted button "%s"', async (term) => {
    await expect(guarded.click(`[data-term="${term}"]`)).rejects.toBeInstanceOf(
      ForbiddenActionError,
    );
    expect(violations).toHaveLength(1);
    expect(await clicks()).toEqual([]);
  });

  it.each([
    ['input value', 'input-value'],
    ['aria-label', 'aria-label'],
    ['text in a child element', 'child'],
    ['text without diacritics', 'no-diacritics'],
    ['enclosing form action', 'form-action'],
    ['enclosing Swedish form action', 'form-action-sv'],
    ['link target', 'link'],
  ])('refuses a button denylisted through its %s', async (_, id) => {
    await expect(guarded.click(`[data-id="${id}"]`)).rejects.toBeInstanceOf(ForbiddenActionError);
    expect(await clicks()).toEqual([]);
  });

  it('refuses clicking a child of a denylisted button', async () => {
    await expect(guarded.click('#child-span')).rejects.toBeInstanceOf(ForbiddenActionError);
  });

  it('refuses clicking a container that holds a denylisted button', async () => {
    await expect(guarded.click('#denylist')).rejects.toBeInstanceOf(ForbiddenActionError);
    expect(await clicks()).toEqual([]);
  });

  it('allows ordinary buttons and labels', async () => {
    for (const id of ['continue', 'add-to-cart', 'to-checkout', 'shipping-label']) {
      await guarded.click(`[data-id="${id}"]`);
    }
    expect(await clicks()).toEqual(['continue', 'add-to-cart', 'to-checkout', 'shipping-label']);
    expect(violations).toEqual([]);
  });

  it('refuses a submit button inside a payment iframe, even with harmless text', async () => {
    await expect(guarded.click(`${KLARNA}[data-id="k-submit"]`)).rejects.toThrow(
      /klarna payment frame/,
    );
    await expect(guarded.click(`${KLARNA}[data-id="k-role"]`)).rejects.toBeInstanceOf(
      ForbiddenActionError,
    );
    expect(await clicks(klarnaFrame())).toEqual([]);
  });

  it('allows choosing a delivery option inside a payment iframe', async () => {
    await guarded.click(`${KLARNA}[data-id="k-shipping"]`);
    expect(await clicks(klarnaFrame())).toEqual(['k-shipping']);
  });

  it('reports a missing selector as layout-changed', async () => {
    const err = await guarded.click('#does-not-exist').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProbeError);
    expect((err as ProbeError).code).toBe('layout-changed');
  });
});

describe('fill', () => {
  const FORBIDDEN = [
    'personnummer',
    'ssn',
    'card',
    'card-sv',
    'expiry',
    'cvc',
    'cvv-label',
    'phone',
    'phone-sv',
    'first-name',
    'last-name',
    'full-name',
    'address',
    'address-sv',
    'city',
    'postort',
    'password',
    'password-sv',
  ];

  it.each(FORBIDDEN)('refuses the forbidden field "%s"', async (kind) => {
    const selector = `[data-kind="${kind}"]`;
    await expect(guarded.fill(selector, POSTCODE)).rejects.toBeInstanceOf(ForbiddenActionError);
    await expect(guarded.fill(selector, EMAIL)).rejects.toBeInstanceOf(ForbiddenActionError);
    expect(await page.inputValue(selector)).toBe('');
  });

  it('fills the postcode and email fields', async () => {
    await guarded.fill('#postcode', POSTCODE);
    await guarded.fill('#email', EMAIL);
    await guarded.fill('#zip-only', '117 38');
    expect(await page.inputValue('#postcode')).toBe(POSTCODE);
    expect(await page.inputValue('#email')).toBe(EMAIL);
    expect(await page.inputValue('#zip-only')).toBe('117 38');
    expect(violations).toEqual([]);
  });

  it('fills a field through its label', async () => {
    await guarded.fill('label:has-text("Postnummer")', POSTCODE);
    expect(await page.inputValue('#postcode')).toBe(POSTCODE);
  });

  it('fills the postcode and email inside a payment iframe', async () => {
    await guarded.fill(`${KLARNA}#k-email`, EMAIL);
    await guarded.fill(`${KLARNA}#k-postcode`, POSTCODE);
    expect(await klarnaFrame().inputValue('#k-postcode')).toBe(POSTCODE);
  });

  it('refuses any other value, even in an allowed field', async () => {
    for (const value of ['12345', 'Anna Andersson', '4111 1111 1111 1111', 'other@example.com']) {
      await expect(guarded.fill('#postcode', value)).rejects.toThrow(/neither the probe postcode/);
    }
    expect(await page.inputValue('#postcode')).toBe('');
  });
});

describe('goto and evaluateJson', () => {
  it('refuses order and non-http URLs', async () => {
    for (const url of [
      `${server.url}/checkout/place-order`,
      `${server.url}/kassa/slutfor`,
      'javascript:alert(1)',
      'file:///etc/passwd',
    ]) {
      await expect(guarded.goto(url)).rejects.toBeInstanceOf(ForbiddenActionError);
    }
    expect(server.requests.some((r) => /place-order|slutfor/.test(r))).toBe(false);
  });

  it('evaluates read-only functions and expressions', async () => {
    expect(await guarded.evaluateJson<string>('document.querySelector("#fee").textContent')).toBe(
      '49 kr',
    );
    expect(await guarded.evaluateJson<{ n: number }>('() => ({ n: 1 + 1 })')).toEqual({ n: 2 });
    expect(await guarded.evaluateJson<null>('async () => undefined')).toBeNull();
  });

  it('refuses scripts that act on the page', async () => {
    for (const fn of [
      '() => document.querySelector("[data-term=betala]").click()',
      '() => document.forms[0].submit()',
      '() => fetch("/x", { method: "POST" })',
      '() => { document.querySelector("#postcode").value = "1" }',
      '() => { location.href = "/checkout/place-order" }',
    ]) {
      await expect(guarded.evaluateJson(fn)).rejects.toBeInstanceOf(ForbiddenActionError);
    }
    expect(await clicks()).toEqual([]);
  });

  it('reads text and waits for selectors', async () => {
    expect(await guarded.textContent('#fee')).toBe('49 kr');
    await guarded.waitFor('#fee');
    const err = await guarded.waitFor('#nope', 200).catch((e: unknown) => e);
    expect((err as ProbeError).code).toBe('layout-changed');
  });
});

describe('route interceptor', () => {
  it('never lets an order or payment request reach the network', async () => {
    await guarded.click('[data-id="sneaky"]');
    await expect.poll(() => server.requests.includes('POST /api/cart')).toBe(true);
    await expect.poll(() => blocked.length).toBeGreaterThanOrEqual(4);

    expect(
      server.requests.filter((r) => /place-order|\/orders?\b|checkout\/complete/.test(r)),
    ).toEqual([]);
    expect(blocked.map((b) => new URL(b.url).pathname).sort()).toEqual([
      '/api/checkout/place-order',
      '/api/orders',
      '/checkout/complete',
      '/order/confirm',
    ]);
  });

  it('blocks payment-provider calls before they leave the browser', async () => {
    // Routed requests are aborted locally, so these hosts are never contacted.
    const results = await page.evaluate(async () => {
      const urls = [
        'https://api.stripe.com/v1/payment_intents',
        'https://checkout-live.adyen.com/v71/payments',
        'https://js.klarna.com/eu/kco/checkout/orders/abc/authorize',
      ];
      return Promise.all(
        urls.map((u) =>
          fetch(u, { method: 'POST' }).then(
            () => 'sent',
            () => 'blocked',
          ),
        ),
      );
    });
    expect(results).toEqual(['blocked', 'blocked', 'blocked']);
    expect(blocked).toHaveLength(3);
  });
});
