import { api, type MerchantAdapter } from '@apokorg/core';
import { loadAdapters } from '@apokorg/registry';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type AppOptions } from './app';
import { openDb } from './db';
import { OFFER_TTL_MS } from './repo';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function makeApp(overrides: Partial<AppOptions> = {}) {
  const app = await buildApp({
    db: openDb(':memory:'),
    adapters: loadAdapters({ mock: true }),
    ...overrides,
  });
  apps.push(app);
  return app;
}

const json = (body: unknown) => ({
  payload: JSON.stringify(body),
  headers: { 'content-type': 'application/json' },
});

describe('GET /api/merchants', () => {
  it('lists every adapter as enabled with shipping info', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/merchants' });
    expect(res.statusCode).toBe(200);
    const body = api.MerchantsResponse.parse(res.json());
    expect(body.merchants).toHaveLength(7);
    expect(body.merchants.every((m) => m.enabled && m.shipping)).toBe(true);
  });
});

describe('POST /api/search', () => {
  it('returns a status for each of the 7 stores', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/search',
      ...json({ query: 'alvedon' }),
    });
    expect(res.statusCode).toBe(200);
    const body = api.SearchResponse.parse(res.json());
    expect(body.merchants).toHaveLength(7);
    expect(new Set(body.merchants.map((m) => m.merchantId)).size).toBe(7);
    expect(body.merchants.every((m) => m.status === 'ok')).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results.every((r) => r.kind !== 'substitute')).toBe(true);
  });

  it('one failing store still gives 200 with that store as error', async () => {
    const adapters = loadAdapters({ mock: true }).map((a): MerchantAdapter =>
      a.info.id === 'doz'
        ? {
            ...a,
            search: async () => {
              throw new Error('boom');
            },
          }
        : a,
    );
    const app = await makeApp({ adapters });
    const res = await app.inject({
      method: 'POST',
      url: '/api/search',
      ...json({ query: 'alvedon' }),
    });
    expect(res.statusCode).toBe(200);
    const body = api.SearchResponse.parse(res.json());
    const doz = body.merchants.find((m) => m.merchantId === 'doz');
    expect(doz).toMatchObject({ status: 'error', message: 'boom' });
    expect(body.merchants.filter((m) => m.status === 'ok')).toHaveLength(6);
    expect(body.results.some((r) => r.offer.merchantId === 'apotea')).toBe(true);
  });

  it('reports a slow store as timeout', async () => {
    const adapters = loadAdapters({ mock: true }).map((a): MerchantAdapter =>
      a.info.id === 'lyko' ? { ...a, search: () => new Promise(() => {}) } : a,
    );
    const app = await makeApp({ adapters, searchTimeoutMs: 50 });
    const res = await app.inject({ method: 'POST', url: '/api/search', ...json({ query: 'x' }) });
    expect(res.statusCode).toBe(200);
    const body = api.SearchResponse.parse(res.json());
    expect(body.merchants.find((m) => m.merchantId === 'lyko')?.status).toBe('timeout');
  });

  it('reports requested stores without an adapter as unavailable', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/search',
      ...json({ query: 'alvedon', merchants: ['apotea', 'kicks'] }),
    });
    const body = api.SearchResponse.parse(res.json());
    expect(body.merchants.map((m) => [m.merchantId, m.status])).toEqual([
      ['apotea', 'ok'],
      ['kicks', 'unavailable'],
    ]);
  });

  it('serves offers from cache within the TTL', async () => {
    let now = Date.parse('2026-10-21T10:00:00Z');
    const adapters = loadAdapters({ mock: true });
    const apotea = adapters.find((a) => a.info.id === 'apotea')!;
    const spy = vi.spyOn(apotea, 'search');
    const app = await makeApp({ adapters, now: () => now });
    const search = () =>
      app.inject({
        method: 'POST',
        url: '/api/search',
        ...json({ query: 'Alvedon', merchants: ['apotea'] }),
      });

    await search();
    now += OFFER_TTL_MS - 1000;
    const cached = api.SearchResponse.parse((await search()).json());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(cached.results.length).toBeGreaterThan(0);

    now += 2000;
    await search();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('rejects an invalid body with 400', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/search', ...json({ query: '' }) });
    expect(res.statusCode).toBe(400);
    expect(api.ApiError.parse(res.json()).error).toBe('Invalid request');
  });
});

describe('baskets', () => {
  const basket = {
    name: 'Veckohandling',
    items: [
      { id: 'i1', query: 'alvedon 500 20st', qty: 2 },
      { id: 'i2', query: 'ipren', qty: 1, acceptSubstitutes: true },
    ],
  };

  it('round-trips create, read, list, update and delete', async () => {
    const app = await makeApp();
    const put = await app.inject({ method: 'PUT', url: '/api/baskets/b1', ...json(basket) });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ id: 'b1', name: 'Veckohandling' });

    const got = await app.inject({ method: 'GET', url: '/api/baskets/b1' });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toEqual(put.json());
    expect(got.json().items[0]).toEqual({
      id: 'i1',
      query: 'alvedon 500 20st',
      qty: 2,
      acceptSubstitutes: false,
      pinned: {},
    });

    await app.inject({
      method: 'PUT',
      url: '/api/baskets/b1',
      ...json({ ...basket, name: 'Renamed' }),
    });
    const list = api.BasketsResponse.parse(
      (await app.inject({ method: 'GET', url: '/api/baskets' })).json(),
    );
    expect(list.baskets.map((b) => b.name)).toEqual(['Renamed']);

    const del = await app.inject({ method: 'DELETE', url: '/api/baskets/b1' });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/baskets/b1' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/baskets/b1' })).statusCode).toBe(404);
  });

  it('optimize returns a valid OptimizeResponse', async () => {
    const app = await makeApp();
    await app.inject({ method: 'PUT', url: '/api/baskets/b1', ...json(basket) });
    const res = await app.inject({
      method: 'POST',
      url: '/api/baskets/b1/optimize',
      ...json({}),
    });
    expect(res.statusCode).toBe(200);
    const body = api.OptimizeResponse.parse(res.json());
    expect(body.candidates.map((c) => c.itemId)).toEqual(['i1', 'i2']);
    expect(body.split.assignments).toHaveLength(2);
    expect(body.merchants).toHaveLength(7);
    const sum = body.split.perMerchant.reduce((s, m) => s + m.subtotal + m.shipping, 0);
    expect(body.split.total).toBeCloseTo(sum);
  });

  it('optimize honours excluded stores and maxMerchants', async () => {
    const app = await makeApp();
    await app.inject({ method: 'PUT', url: '/api/baskets/b1', ...json(basket) });
    const res = await app.inject({
      method: 'POST',
      url: '/api/baskets/b1/optimize',
      ...json({ options: { excludedMerchants: ['doz'], maxMerchants: 1 } }),
    });
    const body = api.OptimizeResponse.parse(res.json());
    expect(body.split.perMerchant).toHaveLength(1);
    expect(body.split.assignments.every((a) => a.merchantId !== 'doz')).toBe(true);
    expect(body.merchants.some((m) => m.merchantId === 'doz')).toBe(false);
  });

  it('optimize on a missing basket is 404', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/baskets/nope/optimize' });
    expect(res.statusCode).toBe(404);
  });

  it('remembers pinned products as confirmed matches for the query', async () => {
    const app = await makeApp();
    await app.inject({
      method: 'PUT',
      url: '/api/baskets/b2',
      ...json({
        name: 'x',
        items: [{ id: 'i1', query: 'Alvedon', pinned: { apotea: 'apotea-p02' } }],
      }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/search',
      ...json({ query: 'alvedon', merchants: ['apotea'] }),
    });
    const body = api.SearchResponse.parse(res.json());
    expect(body.results[0]).toMatchObject({
      offer: { merchantProductId: 'apotea-p02' },
      kind: 'exact',
      confidence: 1,
    });
  });
});

describe('settings', () => {
  const KEY = 'sk-ant-api03-SECRETSECRETSECRET-wxyz';

  it('masks the API key, keeps it on masked round-trip and never logs it', async () => {
    const lines: string[] = [];
    const app = await makeApp({
      logger: { level: 'trace', stream: { write: (s: string) => lines.push(s) } },
    });

    const initial = api.SettingsResponse.parse(
      (await app.inject({ method: 'GET', url: '/api/settings' })).json(),
    );
    expect(initial.enabledMerchants).toHaveLength(7);

    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      ...json({ ...initial, anthropicApiKey: KEY, postcode: '41101' }),
    });
    expect(put.statusCode).toBe(200);
    expect(put.body).not.toContain('SECRET');
    expect(put.json().anthropicApiKey).toBe('****wxyz');

    const got = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(got.body).not.toContain('SECRET');
    const settings = api.SettingsResponse.parse(got.json());
    expect(settings).toMatchObject({ postcode: '41101', anthropicApiKey: '****wxyz' });

    // Sending the masked value back keeps the stored key.
    await app.inject({ method: 'PUT', url: '/api/settings', ...json(settings) });
    expect((await app.inject({ method: 'GET', url: '/api/settings' })).json().anthropicApiKey).toBe(
      '****wxyz',
    );

    // An empty string clears it.
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      ...json({ ...settings, anthropicApiKey: '' }),
    });
    expect(
      (await app.inject({ method: 'GET', url: '/api/settings' })).json().anthropicApiKey,
    ).toBeUndefined();

    // A bad body is logged with its payload nowhere near the logs.
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      ...json({ enabledMerchants: 'nope', anthropicApiKey: KEY }),
    });

    // Even an accidental log of the settings object is redacted.
    app.log.info({ settings: { anthropicApiKey: KEY } }, 'accidental');
    expect(lines.some((l) => l.includes('accidental') && l.includes('[redacted]'))).toBe(true);

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain('SECRET');
  });

  it('disabled stores are not searched', async () => {
    const app = await makeApp();
    const initial = (await app.inject({ method: 'GET', url: '/api/settings' })).json();
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      ...json({ ...initial, enabledMerchants: ['apotea', 'lyko'] }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/search',
      ...json({ query: 'alvedon' }),
    });
    expect(
      api.SearchResponse.parse(res.json())
        .merchants.map((m) => m.merchantId)
        .sort(),
    ).toEqual(['apotea', 'lyko']);
    const merchants = api.MerchantsResponse.parse(
      (await app.inject({ method: 'GET', url: '/api/merchants' })).json(),
    );
    expect(merchants.merchants.filter((m) => m.enabled)).toHaveLength(2);
  });
});

describe('POST /api/catalog/refresh', () => {
  it('is accepted (stub)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/catalog/refresh',
      ...json({ merchants: ['apotea'] }),
    });
    expect(res.statusCode).toBe(202);
  });
});

describe('CORS', () => {
  it('allows the Vite dev origin and Tauri, not others', async () => {
    const app = await makeApp();
    const ok = await app.inject({
      method: 'GET',
      url: '/api/baskets',
      headers: { origin: 'tauri://localhost' },
    });
    expect(ok.headers['access-control-allow-origin']).toBe('tauri://localhost');
    const vite = await app.inject({
      method: 'GET',
      url: '/api/baskets',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(vite.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const evil = await app.inject({
      method: 'GET',
      url: '/api/baskets',
      headers: { origin: 'https://evil.example' },
    });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows PUT and DELETE in preflight (basket save/delete from the browser)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/baskets/b1',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type',
      },
    });
    const allowed = String(res.headers['access-control-allow-methods']);
    expect(allowed).toContain('PUT');
    expect(allowed).toContain('DELETE');
  });
});
