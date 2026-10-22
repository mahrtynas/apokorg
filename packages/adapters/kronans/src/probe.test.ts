import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MerchantAdapter, ProbeRequest } from '@apokorg/core';
import { runProbe, type BrowserLaunch } from '@apokorg/checkout-probe';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testBrowser } from '../../../checkout-probe/test/browser';
import adapter from './index';
import { createProbe, deliveryKind, parseOptionText } from './probe';

const FIXTURES = fileURLToPath(new URL('../fixtures/probe/', import.meta.url));

/** Serves the probe fixtures and keeps the cart server-side, so the test can see it emptied. */
async function startStore() {
  const cart = new Map<string, number>();
  const requests: string[] = [];
  let mode = 'ok';
  const page = (name: string) => readFile(join(FIXTURES, name));
  const server = createServer(async (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const url = new URL(req.url ?? '/', 'http://x');
    const id = url.searchParams.get('id') ?? '';
    const html = (body: Buffer) =>
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
    if (req.method === 'POST' && url.pathname === '/cart/add') {
      cart.set(id, (cart.get(id) ?? 0) + 1);
      res.writeHead(204).end();
    } else if (req.method === 'POST' && url.pathname === '/cart/remove') {
      cart.delete(id);
      res.writeHead(204).end();
    } else if (url.pathname === '/cart') {
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify(Object.fromEntries(cart)));
    } else if (url.pathname === '/mode') {
      res.writeHead(200).end(mode);
    } else if (/\/p\/\d+\/$/.test(url.pathname)) {
      html(await page('product.html'));
    } else if (url.pathname === '/kassa/') {
      html(await page('kassa.html'));
    } else if (url.pathname === '/ingrid/') {
      html(await page('delivery.html'));
    } else if (url.pathname === '/klarna/') {
      html(await page('klarna.html'));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    cart,
    requests,
    setMode: (m: string) => (mode = m),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

let store: Awaited<ReturnType<typeof startStore>>;
let launch: BrowserLaunch;
let profileRoot: string;

beforeAll(async () => {
  store = await startStore();
  launch = await testBrowser();
}, 60_000);

afterAll(async () => {
  await store?.close();
});

beforeEach(async () => {
  store.cart.clear();
  store.requests.length = 0;
  store.setMode('ok');
  profileRoot = await mkdtemp(join(tmpdir(), 'apokorg-kronans-probe-'));
});

afterEach(async () => {
  await rm(profileRoot, { recursive: true, force: true });
});

function run(qty = 1) {
  const request: ProbeRequest = {
    items: [{ url: `${store.url}/kronans-apotek-tandkram-frisk-mint/p/788053/`, qty }],
    postcode: '11738',
    email: 'probe+apokorg@example.com',
  };
  const local: MerchantAdapter = { ...adapter, probe: createProbe(store.url) };
  return runProbe(local, request, { launch, profileRoot, actionTimeoutMs: 5_000 });
}

describe('kronans probe', () => {
  it('reads every delivery option and empties the cart', async () => {
    const result = await run(2);
    expect(result.message).toBeUndefined();
    expect(result.status).toBe('ok');
    expect(result.orderValue).toBe(48);
    expect(result.options).toEqual([
      {
        id: 'instabox-paketskap',
        name: 'Instabox paketskåp',
        kind: 'parcel-box',
        fee: 19,
        freeFrom: 299,
      },
      {
        id: 'hamta-express-pa-apotek',
        name: 'Hämta Express på apotek',
        kind: 'store-pickup',
        fee: 0,
      },
      {
        id: 'budbee-hemleverans',
        name: 'Budbee hemleverans',
        kind: 'home',
        fee: 39,
        freeFrom: 299,
      },
      {
        id: 'postnord-ombud',
        name: 'PostNord ombud',
        kind: 'pickup-point',
        fee: 19,
        freeFrom: 299,
      },
      {
        id: 'postnord-brevlada',
        name: 'PostNord brevlåda',
        kind: 'mailbox',
        fee: 19,
        freeFrom: 299,
      },
      {
        id: 'postnord-paketbox',
        name: 'PostNord paketbox',
        kind: 'parcel-box',
        fee: 19,
        freeFrom: 299,
      },
      { id: 'leverans-till-apotek', name: 'Leverans till apotek', kind: 'store-pickup', fee: 0 },
    ]);
    expect(store.requests.filter((r) => r.startsWith('POST /cart/add'))).toHaveLength(2);
    expect(store.cart.size).toBe(0);
    // Nothing reached the payment form.
    expect(store.requests.filter((r) => r.includes('/klarna/') && !r.startsWith('GET'))).toEqual(
      [],
    );
  }, 90_000);

  it('empties the cart when the options never show', async () => {
    store.setMode('broken');
    const result = await run();
    expect(result.status).toBe('failed');
    expect(result.message).toMatch(/^layout-changed: /);
    expect(store.requests).toContain('POST /cart/add?id=788053');
    expect(store.cart.size).toBe(0);
  }, 90_000);
});

describe('parseOptionText', () => {
  it('splits name, fee and free-shipping threshold', () => {
    expect(
      parseOptionText(
        'Instabox paketskåp19kr med InstaboxImorgonFri frakt från 299 kr eller vid receptköp',
      ),
    ).toEqual({
      id: 'instabox-paketskap',
      name: 'Instabox paketskåp',
      kind: 'parcel-box',
      fee: 19,
      freeFrom: 299,
    });
    expect(parseOptionText('Leveransalternativ PostNord ombud 49 kr')).toMatchObject({
      name: 'PostNord ombud',
      fee: 49,
    });
    expect(parseOptionText('Hämta på apotek Gratis')).toMatchObject({
      fee: 0,
      kind: 'store-pickup',
    });
  });

  it('returns null without a fee', () => {
    expect(parseOptionText('Instabox paketskåp')).toBeNull();
  });
});

describe('deliveryKind', () => {
  it.each([
    ['Hämta Express på apotek', 'store-pickup'],
    ['Leverans till apotek', 'store-pickup'],
    ['Instabox paketskåp', 'parcel-box'],
    ['PostNord paketbox', 'parcel-box'],
    ['PostNord brevlåda', 'mailbox'],
    ['PostNord ombud', 'pickup-point'],
    ['Budbee hemleverans', 'home'],
  ])('%s → %s', (name, kind) => {
    expect(deliveryKind(name)).toBe(kind);
  });
});
