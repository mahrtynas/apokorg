import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MerchantAdapter, ProbeFn, ProbeRequest } from '@apokorg/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testBrowser } from '../test/browser';
import { startFixtureServer, type FixtureServer } from '../test/server';
import { ProbeError } from './errors';
import { runProbe, type BrowserLaunch } from './run';

let server: FixtureServer;
let launch: BrowserLaunch;
let profileRoot: string;

beforeAll(async () => {
  server = await startFixtureServer();
  launch = await testBrowser();
}, 60_000);

afterAll(async () => {
  await server?.close();
});

beforeEach(async () => {
  profileRoot = await mkdtemp(join(tmpdir(), 'apokorg-probe-test-'));
});

afterEach(async () => {
  await rm(profileRoot, { recursive: true, force: true });
});

const request: ProbeRequest = {
  items: [{ url: 'https://example.invalid/p/1', qty: 1 }],
  postcode: '11738',
  email: 'probe+apokorg@example.com',
};

function adapter(probe?: ProbeFn): MerchantAdapter {
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
    probe,
  };
}

const run = (probe: ProbeFn | undefined, opts: Parameters<typeof runProbe>[2] = {}) =>
  runProbe(adapter(probe), request, { launch, profileRoot, orderValue: 250, ...opts });

const profileDirs = () => readdir(profileRoot);

describe('runProbe', () => {
  it('returns the probe result and deletes the profile dir', async () => {
    let dirsDuringProbe: string[] = [];
    const result = await run(async (req, page) => {
      dirsDuringProbe = await profileDirs();
      await page.goto(`${server.url}/checkout.html`);
      await page.fill('#postcode', req.postcode);
      const fee = Number((await page.textContent('#fee'))?.replace(/\D/g, ''));
      return {
        merchantId: 'mock',
        orderValue: 250,
        postcode: req.postcode,
        options: [{ id: 'ombud', name: 'Ombud', kind: 'pickup-point', fee }],
        probedAt: new Date().toISOString(),
        status: 'ok',
      };
    });
    expect(result.status).toBe('ok');
    expect(result.options).toEqual([{ id: 'ombud', name: 'Ombud', kind: 'pickup-point', fee: 49 }]);
    expect(dirsDuringProbe).toHaveLength(1);
    expect(dirsDuringProbe[0]).toMatch(/^apokorg-probe-/);
    expect(await profileDirs()).toEqual([]);
  }, 60_000);

  it('deletes the profile dir when the probe throws', async () => {
    let dirsDuringProbe: string[] = [];
    const result = await run(async (_req, page) => {
      dirsDuringProbe = await profileDirs();
      await page.goto(`${server.url}/checkout.html`);
      throw new Error('boom');
    });
    expect(result).toMatchObject({
      status: 'failed',
      message: 'probe-error: boom',
      orderValue: 250,
    });
    expect(dirsDuringProbe).toHaveLength(1);
    expect(await profileDirs()).toEqual([]);
  }, 60_000);

  it('fails a probe that swallowed a refused click', async () => {
    const result = await run(async (req, page) => {
      await page.goto(`${server.url}/checkout.html`);
      await page.click('[data-term="betala"]').catch(() => {});
      return {
        merchantId: 'mock',
        orderValue: 250,
        postcode: req.postcode,
        options: [],
        probedAt: new Date().toISOString(),
        status: 'ok',
      };
    });
    expect(result.status).toBe('failed');
    expect(result.message).toMatch(/^forbidden-action: refused click/);
    expect(await profileDirs()).toEqual([]);
  }, 60_000);

  it('fails a probe whose page tried to place an order', async () => {
    const result = await run(async (_req, page) => {
      await page.goto(`${server.url}/checkout.html`);
      await page.click('[data-id="sneaky"]');
      await page.waitFor('#never', 1_000).catch(() => {});
      throw new Error('should not matter');
    });
    expect(result.message).toMatch(/^forbidden-action: blocked POST/);
    expect(server.requests.some((r) => r.includes('place-order'))).toBe(false);
  }, 60_000);

  it('maps login-required to unsupported', async () => {
    const result = await run(async () => {
      throw new ProbeError('login-required', 'BankID needed for delivery options');
    });
    expect(result).toMatchObject({
      status: 'unsupported',
      message: 'login-required: BankID needed for delivery options',
    });
  }, 60_000);

  it('accepts a plain error with a login-required code', async () => {
    const result = await run(async () => {
      throw Object.assign(new Error('login wall'), { code: 'login-required' });
    });
    expect(result.status).toBe('unsupported');
  }, 60_000);

  it('reports a missing selector as layout-changed', async () => {
    const result = await run(async (_req, page) => {
      await page.goto(`${server.url}/checkout.html`);
      await page.waitFor('#delivery-options', 200);
      throw new Error('unreachable');
    });
    expect(result.status).toBe('failed');
    expect(result.message).toMatch(/^layout-changed: selector not found: #delivery-options/);
  }, 60_000);

  it('times out, closes the browser and deletes the profile dir', async () => {
    const started = Date.now();
    const result = await run(
      async (_req, page) => {
        await page.goto(`${server.url}/checkout.html`);
        return new Promise(() => {});
      },
      { timeoutMs: 3_000 },
    );
    expect(result.status).toBe('failed');
    expect(result.message).toMatch(/^timeout:/);
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(await profileDirs()).toEqual([]);
  }, 60_000);

  it('reports a missing browser as edge-not-found', async () => {
    const result = await run(
      async () => {
        throw new Error('unreachable');
      },
      { launch: { executablePath: join(profileRoot, 'no-such-msedge.exe') } },
    );
    expect(result.status).toBe('failed');
    expect(result.message).toMatch(/^edge-not-found:/);
    expect(await profileDirs()).toEqual([]);
  }, 60_000);

  it('rejects a result that breaks the ProbeResult schema', async () => {
    const result = await run(async () => ({ nonsense: true }) as never);
    expect(result.status).toBe('failed');
    expect(result.message).toMatch(/^invalid-result:/);
  }, 60_000);

  it('returns unsupported without starting a browser when the store has no probe', async () => {
    const result = await run(undefined);
    expect(result).toMatchObject({ status: 'unsupported', merchantId: 'mock', postcode: '11738' });
    expect(await profileDirs()).toEqual([]);
  });
});
