import { api, type MerchantAdapter } from '@apokorg/core';
import { loadAdapters } from '@apokorg/registry';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type AppOptions } from './app';
import type { CatalogService } from './catalog';
import type { MatchOptions } from './matching';
import { openDb } from './db';
import { OFFER_TTL_MS } from './repo';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

/** Never crawls: records which stores a refresh was started for. */
function fakeCatalog(refreshed: string[] = [], stale: string[] = []): CatalogService {
  return {
    merchants: ['apotea', 'doz', 'gymgrossisten'],
    refresh: async (merchantId) => {
      refreshed.push(merchantId);
      return { merchantId, products: 1, sitemapsFetched: 1, sitemapsSkipped: 0, durationMs: 1 };
    },
    isStale: (merchantId) => stale.includes(merchantId),
    status: () => [
      {
        merchantId: 'apotea',
        productCount: 56857,
        refreshedAt: '2026-10-22T10:00:00.000Z',
        refreshing: false,
      },
      { merchantId: 'doz', productCount: 0, refreshing: true },
      { merchantId: 'gymgrossisten', productCount: 0, refreshing: false, lastError: 'HTTP 503' },
    ],
  };
}

async function makeApp(overrides: Partial<AppOptions> = {}) {
  const app = await buildApp({
    db: openDb(':memory:'),
    adapters: loadAdapters({ mock: true }),
    catalog: fakeCatalog(),
    probe: async () => {
      throw new Error('no probes in tests');
    },
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
  it('starts a background refresh for catalog stores only', async () => {
    const refreshed: string[] = [];
    const app = await makeApp({ catalog: fakeCatalog(refreshed) });
    const res = await app.inject({
      method: 'POST',
      url: '/api/catalog/refresh',
      ...json({ merchants: ['apotea', 'hjartat'] }),
    });
    expect(res.statusCode).toBe(202);
    expect(api.CatalogRefreshResponse.parse(res.json())).toEqual({
      accepted: true,
      merchants: ['apotea'],
    });
    expect(refreshed).toEqual(['apotea']);
  });

  it('refreshes every catalog store when none are named', async () => {
    const refreshed: string[] = [];
    const app = await makeApp({ catalog: fakeCatalog(refreshed) });
    const res = await app.inject({ method: 'POST', url: '/api/catalog/refresh', ...json({}) });
    expect(res.json().merchants).toEqual(['apotea', 'doz', 'gymgrossisten']);
    expect(refreshed).toEqual(['apotea', 'doz', 'gymgrossisten']);
  });
});

describe('product-first search', () => {
  it('groups offers from all stores into distinct products', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/products/search',
      ...json({ query: 'alvedon' }),
    });
    expect(res.statusCode).toBe(200);
    const body = api.ProductSearchResponse.parse(res.json());
    // Mock catalog: Alvedon 20 st and 10 st, each at the 5 pharmacies.
    expect(body.products.map((p) => p.packCount)).toEqual([20, 10]);
    expect(body.products[0]!.merchantIds).toHaveLength(5);
    expect(body.products[0]!.minPrice).toBe(38);
  });

  it('locates the chosen product at every store, pinned by EAN', async () => {
    const app = await makeApp();
    const search = api.ProductSearchResponse.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/products/search',
          ...json({ query: 'alvedon' }),
        })
      ).json(),
    );
    const product = search.products[1]!; // the 10 st pack
    const res = await app.inject({
      method: 'POST',
      url: '/api/products/locate',
      ...json({ query: 'alvedon', product: { title: product.title, ean: product.ean } }),
    });
    expect(res.statusCode).toBe(200);
    const body = api.SearchResponse.parse(res.json());
    const exact = body.results.filter((r) => r.kind === 'exact');
    expect(exact.map((r) => r.offer.merchantId).sort()).toEqual([
      'apotea',
      'apoteket',
      'doz',
      'hjartat',
      'kronans',
    ]);
    expect(exact.every((r) => r.offer.ean === product.ean && r.confidence === 1)).toBe(true);
    expect(body.needsConfirmation).toBe(false);
  });

  it('finds an item by EAN when its query alone does not list it', async () => {
    // A store whose search only finds CeraVe when asked for its EAN.
    const real = loadAdapters({ mock: true }).find((a) => a.info.id === 'doz')!;
    const [cerave] = await real.search('cerave');
    const eanOnly: MerchantAdapter = {
      ...real,
      search: async (q) => (q === cerave!.ean ? [cerave!] : []),
    };
    const app = await makeApp({ adapters: [eanOnly] });
    const res = await app.inject({
      method: 'POST',
      url: '/api/products/locate',
      ...json({ query: 'cerave', product: { title: cerave!.title, ean: cerave!.ean } }),
    });
    const body = api.SearchResponse.parse(res.json());
    expect(body.results).toEqual([
      expect.objectContaining({
        kind: 'exact',
        offer: expect.objectContaining({ ean: cerave!.ean }),
      }),
    ]);
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

describe('POST /api/matches/confirm', () => {
  it('pins the confirmed product for later searches of the query', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/matches/confirm',
      ...json({ query: 'Alvedon', merchantId: 'apotea', merchantProductId: 'apotea-p02' }),
    });
    expect(api.ConfirmMatchResponse.parse(res.json())).toEqual({ ok: true });

    const search = await app.inject({
      method: 'POST',
      url: '/api/search',
      ...json({ query: 'alvedon', merchants: ['apotea'] }),
    });
    expect(api.SearchResponse.parse(search.json()).results[0]).toMatchObject({
      offer: { merchantProductId: 'apotea-p02' },
      confidence: 1,
    });
  });
});

describe('PUT /api/merchants/:id/shipping', () => {
  const policy = {
    merchantId: 'apotea',
    options: [{ id: 'home', name: 'Hem', kind: 'home', fee: 19, freeFrom: 199 }],
    lastVerified: '2026-10-22',
  };

  it('stores the edited rule and uses it in merchants and optimize', async () => {
    const app = await makeApp();
    const put = await app.inject({
      method: 'PUT',
      url: '/api/merchants/apotea/shipping',
      ...json(policy),
    });
    expect(api.PutShippingResponse.parse(put.json())).toEqual(policy);

    const merchants = api.MerchantsResponse.parse(
      (await app.inject({ method: 'GET', url: '/api/merchants' })).json(),
    );
    expect(merchants.merchants.find((m) => m.id === 'apotea')?.shipping).toEqual(policy);
  });

  it('rejects a body for another store, or an unknown store, with 400', async () => {
    const app = await makeApp();
    const mismatch = await app.inject({
      method: 'PUT',
      url: '/api/merchants/doz/shipping',
      ...json(policy),
    });
    expect(mismatch.statusCode).toBe(400);
    const unknown = await app.inject({
      method: 'PUT',
      url: '/api/merchants/nope/shipping',
      ...json({ ...policy, merchantId: 'nope' }),
    });
    expect(unknown.statusCode).toBe(400);
  });
});

describe('LLM judge', () => {
  it('is built from the stored API key and passed to the matcher', async () => {
    const createJudge = vi.fn((s: { anthropicApiKey?: string }) =>
      s.anthropicApiKey ? { pick: vi.fn() } : undefined,
    );
    const matchOffers = vi.fn((_q: string, _o: unknown[], _opts: MatchOptions) => []);
    const app = await makeApp({ createJudge, matcher: { matchOffers } });
    const search = () =>
      app.inject({ method: 'POST', url: '/api/search', ...json({ query: 'alvedon' }) });

    await search();
    expect(matchOffers.mock.calls[0]![2]).toMatchObject({ llm: undefined });

    const settings = (await app.inject({ method: 'GET', url: '/api/settings' })).json();
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      ...json({ ...settings, anthropicApiKey: 'sk-ant-api03-test-key-wxyz' }),
    });
    await search();
    await search();
    expect(createJudge).toHaveBeenLastCalledWith({ anthropicApiKey: 'sk-ant-api03-test-key-wxyz' });
    expect(createJudge).toHaveBeenCalledTimes(2);
    expect(matchOffers.mock.calls[2]![2]).toMatchObject({ llm: { pick: expect.any(Function) } });
  });
});

describe('store waiting room', () => {
  it('reports a QueueError as unavailable, not error', async () => {
    class QueueError extends Error {
      override readonly name = 'QueueError';
    }
    const adapters = loadAdapters({ mock: true }).map((a): MerchantAdapter =>
      a.info.id === 'lyko'
        ? {
            ...a,
            search: async () => {
              throw new QueueError('queued');
            },
          }
        : a,
    );
    const app = await makeApp({ adapters });
    const res = await app.inject({ method: 'POST', url: '/api/search', ...json({ query: 'x' }) });
    const lyko = api.SearchResponse.parse(res.json()).merchants.find(
      (m) => m.merchantId === 'lyko',
    );
    expect(lyko).toMatchObject({ status: 'unavailable', message: 'queued' });
  });
});

describe('checkout probes in optimize', () => {
  it('probes the stores in the split and uses ok results as verified shipping', async () => {
    const adapters = loadAdapters({ mock: true }).map((a): MerchantAdapter => ({
      ...a,
      probe: async () => Promise.reject(new Error('unused')),
    }));
    const calls: { merchantId: string; items: unknown[]; orderValue: number }[] = [];
    const app = await makeApp({
      adapters,
      probe: async (adapter, request, { orderValue }) => {
        calls.push({ merchantId: adapter.info.id, items: request.items, orderValue });
        return {
          merchantId: adapter.info.id,
          orderValue,
          postcode: request.postcode,
          options: [{ id: 'probed', name: 'Probed', kind: 'pickup-point', fee: 0 }],
          probedAt: new Date().toISOString(),
          status: 'ok',
        };
      },
    });
    const settings = (await app.inject({ method: 'GET', url: '/api/settings' })).json();
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      ...json({ ...settings, probeEmail: 'probe+apokorg@example.com' }),
    });
    await app.inject({
      method: 'PUT',
      url: '/api/baskets/p1',
      ...json({ name: 'p', items: [{ id: 'i1', query: 'alvedon' }] }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/baskets/p1/optimize',
      ...json({ probe: true }),
    });
    const body = api.OptimizeResponse.parse(res.json());
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]!.items).toEqual([{ url: expect.stringMatching(/^https?:\/\//), qty: 1 }]);
    expect(body.split.perMerchant.every((m) => m.probeVerified && m.shipping === 0)).toBe(true);
  });

  it('skips probing without a probe email', async () => {
    const adapters = loadAdapters({ mock: true }).map((a): MerchantAdapter => ({
      ...a,
      probe: async () => Promise.reject(new Error('unused')),
    }));
    let called = false;
    const app = await makeApp({
      adapters,
      probe: async () => {
        called = true;
        throw new Error('should not run');
      },
    });
    await app.inject({
      method: 'PUT',
      url: '/api/baskets/p2',
      ...json({ name: 'p', items: [{ id: 'i1', query: 'alvedon' }] }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/baskets/p2/optimize',
      ...json({ probe: true }),
    });
    expect(res.statusCode).toBe(200);
    expect(called).toBe(false);
  });
});

describe('catalog status and startup refresh', () => {
  it('GET /api/catalog/status returns each catalog store', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/catalog/status' });
    const body = api.CatalogStatusResponse.parse(res.json());
    expect(body.catalogs.map((c) => c.merchantId)).toEqual(['apotea', 'doz', 'gymgrossisten']);
    expect(body.catalogs[2]).toMatchObject({ lastError: 'HTTP 503' });
  });

  it('refreshes stale catalogs of enabled stores once ready', async () => {
    const refreshed: string[] = [];
    const db = openDb(':memory:');
    const app = await makeApp({
      db,
      catalog: fakeCatalog(refreshed, ['apotea', 'doz']),
      refreshStaleCatalogsOnStart: true,
    });
    // DOZ disabled in settings: only Apotea (stale and enabled) is refreshed.
    const settings = (await app.inject({ method: 'GET', url: '/api/settings' })).json();
    expect(refreshed).toEqual(['apotea', 'doz']);
    refreshed.length = 0;
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      ...json({ ...settings, enabledMerchants: ['apotea', 'gymgrossisten'] }),
    });
    const second = await makeApp({
      db,
      catalog: fakeCatalog(refreshed, ['apotea', 'doz']),
      refreshStaleCatalogsOnStart: true,
    });
    await second.ready();
    expect(refreshed).toEqual(['apotea']);
  });

  it('does nothing at startup unless asked', async () => {
    const refreshed: string[] = [];
    const app = await makeApp({ catalog: fakeCatalog(refreshed, ['apotea']) });
    await app.ready();
    expect(refreshed).toEqual([]);
  });
});
