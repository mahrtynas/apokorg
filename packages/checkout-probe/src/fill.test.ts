import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CartFillFn, MerchantAdapter } from '@apokorg/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testBrowser } from '../test/browser';
import { startFixtureServer, type FixtureServer } from '../test/server';
import { closeCartBrowsers, runCartFill } from './fill';
import type { BrowserLaunch } from './run';

let server: FixtureServer;
let launch: BrowserLaunch;
let profileDir: string;

beforeAll(async () => {
  server = await startFixtureServer();
  launch = await testBrowser();
}, 60_000);

afterAll(async () => {
  await server?.close();
});

beforeEach(async () => {
  profileDir = await mkdtemp(join(tmpdir(), 'apokorg-fill-test-'));
});

afterEach(async () => {
  await closeCartBrowsers();
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

function adapter(fillCart?: CartFillFn): MerchantAdapter {
  return {
    info: {
      id: 'mock',
      name: 'Mock',
      baseUrl: 'https://mock.invalid',
      category: 'pharmacy',
      searchStrategy: 'api',
    },
    search: async () => [],
    getProduct: async () => null,
    fillCart,
  };
}

const items = [{ url: 'https://mock.invalid/p/1', merchantProductId: 'p1', qty: 3 }];
const run = (fill: CartFillFn | undefined, timeoutMs?: number) =>
  runCartFill(adapter(fill), { items }, { profileDir, launch, headless: true, timeoutMs });

describe('runCartFill', () => {
  it('fills a quantity, clicks the add-to-cart button and returns where it stopped', async () => {
    const result = await run(async (req, page) => {
      await page.goto(`${server.url}/cart.html`);
      await page.fill('#qty', String(req.items[0]!.qty));
      await page.click('#buy');
      expect(await page.textContent('#added')).toBe('3');
      return { url: `${server.url}/cart.html`, skipped: [] };
    });
    expect(result).toEqual({ status: 'ok', url: `${server.url}/cart.html`, skipped: [] });
  });

  it('keeps the guard: no payment clicks, no numbers outside quantity fields', async () => {
    const pay = await run(async (_req, page) => {
      await page.goto(`${server.url}/cart.html`);
      await page.click('#pay');
      return { url: server.url, skipped: [] };
    });
    expect(pay.status).toBe('failed');
    expect(pay.message).toMatch(/^forbidden-action: .*betala/i);

    for (const field of ['#pnr', '#note']) {
      const r = await run(async (_req, page) => {
        await page.goto(`${server.url}/cart.html`);
        await page.fill(field, '3');
        return { url: server.url, skipped: [] };
      });
      expect(r.status).toBe('failed');
      expect(r.message).toMatch(/^forbidden-action/);
    }
  });

  it('refuses order URLs, and a later fill in the same browser still works', async () => {
    server.requests.length = 0;
    const result = await run(async (_req, page) => {
      await page.goto(`${server.url}/cart.html`);
      await page.goto(`${server.url}/checkout/place-order`).catch(() => {});
      return { url: `${server.url}/cart.html`, skipped: [] };
    });
    expect(result.status).toBe('failed');
    expect(server.requests.some((r) => r.includes('place-order'))).toBe(false);

    const again = await run(async (_req, page) => {
      await page.goto(`${server.url}/cart.html`);
      return { url: `${server.url}/cart.html`, skipped: [] };
    });
    expect(again.status).toBe('ok');
  });

  it('reports a store without a script as unsupported, and a timeout as failed', async () => {
    expect((await run(undefined)).status).toBe('unsupported');
    const slow = await run(() => new Promise(() => {}), 3_000);
    expect(slow).toMatchObject({ status: 'failed', message: expect.stringMatching(/^timeout/) });
  });
});
