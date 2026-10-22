/**
 * MSW handlers implementing the routes in packages/core/src/api.ts against in-memory state,
 * so the UI runs (and is tested) without packages/server.
 */
import { delay, http, HttpResponse } from 'msw';
import {
  api,
  isMaskedApiKey,
  maskApiKey,
  MerchantId,
  OptimizeOptions,
  ShippingPolicy,
} from '@apokorg/core';
import type { Basket, BasketItem, Settings } from '@apokorg/core';
import { groupProducts } from '@apokorg/matcher';
import type { z } from 'zod';
import { API_URL } from '../api/client';
import { createMockState, mockMerchants, type MockState } from './data';
import { flattenMatches, greedySplit, matchSearches, searchMerchants } from './logic';

export interface HandlerOptions {
  /** Artificial latency for every request, ms. */
  latencyMs?: number;
  /** Latency for optimize with probe: true, ms. */
  probeLatencyMs?: number;
  /** Stores whose searches fail, to exercise per-store error states. */
  failing?: MerchantId[];
}

const url = (path: string) => `${API_URL}${path}`;

function badRequest(error: z.ZodError) {
  return HttpResponse.json(
    { error: 'Invalid request', details: error.issues } satisfies api.ApiError,
    { status: 400 },
  );
}

const notFound = () =>
  HttpResponse.json({ error: 'Not found' } satisfies api.ApiError, { status: 404 });

function publicSettings(s: Settings): Settings {
  return { ...s, anthropicApiKey: s.anthropicApiKey ? maskApiKey(s.anthropicApiKey) : undefined };
}

export function createHandlers(state: MockState = createMockState(), opts: HandlerOptions = {}) {
  const failing = new Set(opts.failing ?? []);
  const wait = () => delay(opts.latencyMs ?? 0);
  const enabled = () =>
    mockMerchants.map((m) => m.id).filter((id) => state.settings.enabledMerchants.includes(id));

  return [
    http.get(url('/api/merchants'), async () => {
      await wait();
      return HttpResponse.json<api.MerchantsResponse>({
        merchants: mockMerchants.map(({ probeSupported, ...info }) => ({
          ...info,
          probeSupported,
          enabled: state.settings.enabledMerchants.includes(info.id),
          shipping: state.shipping.get(info.id),
        })),
      });
    }),

    http.put(url('/api/merchants/:id/shipping'), async ({ params, request }) => {
      await wait();
      const id = MerchantId.safeParse(params.id);
      if (!id.success) return notFound();
      const body = ShippingPolicy.safeParse(await request.json());
      if (!body.success) return badRequest(body.error);
      const policy = { ...body.data, merchantId: id.data };
      state.shipping.set(id.data, policy);
      return HttpResponse.json(policy);
    }),

    http.post(url('/api/search'), async ({ request }) => {
      await wait();
      const body = api.SearchRequest.safeParse(await request.json());
      if (!body.success) return badRequest(body.error);
      const merchants = body.data.merchants ?? enabled();
      const searches = await searchMerchants(body.data.query, merchants, failing);
      const matched = matchSearches(body.data.query, searches);
      return HttpResponse.json<api.SearchResponse>({
        query: body.data.query,
        results: flattenMatches(matched.byMerchant),
        needsConfirmation: matched.needsConfirmation,
        merchants: searches.map((s) => s.status),
      });
    }),

    http.post(url('/api/products/search'), async ({ request }) => {
      await wait();
      const body = api.ProductSearchRequest.safeParse(await request.json());
      if (!body.success) return badRequest(body.error);
      const searches = await searchMerchants(
        body.data.query,
        body.data.merchants ?? enabled(),
        failing,
      );
      return HttpResponse.json<api.ProductSearchResponse>({
        query: body.data.query,
        products: groupProducts(searches.flatMap((s) => s.offers)),
        merchants: searches.map((s) => s.status),
      });
    }),

    http.post(url('/api/products/locate'), async ({ request }) => {
      await wait();
      const body = api.LocateRequest.safeParse(await request.json());
      if (!body.success) return badRequest(body.error);
      const { query, product } = body.data;
      const searches = await searchMerchants(query, body.data.merchants ?? enabled(), failing);
      const pinned: BasketItem['pinned'] = {};
      for (const s of searches) {
        const hit = product.ean && s.offers.find((o) => o.ean === product.ean);
        if (hit) pinned[s.merchantId] = hit.merchantProductId;
      }
      const matched = matchSearches(product.title, searches, pinned);
      return HttpResponse.json<api.SearchResponse>({
        query,
        results: flattenMatches(matched.byMerchant),
        needsConfirmation: matched.needsConfirmation,
        merchants: searches.map((s) => s.status),
      });
    }),

    http.get(url('/api/baskets'), async () => {
      await wait();
      return HttpResponse.json<api.BasketsResponse>({ baskets: [...state.baskets.values()] });
    }),

    http.get(url('/api/baskets/:id'), async ({ params }) => {
      await wait();
      const basket = state.baskets.get(String(params.id));
      return basket ? HttpResponse.json(basket) : notFound();
    }),

    http.put(url('/api/baskets/:id'), async ({ params, request }) => {
      await wait();
      const body = api.PutBasketRequest.safeParse(await request.json());
      if (!body.success) return badRequest(body.error);
      const basket: Basket = {
        id: String(params.id),
        ...body.data,
        updatedAt: new Date().toISOString(),
      };
      // Like the server: every new or changed pin is an accepted match.
      const before = state.baskets.get(basket.id);
      for (const item of basket.items) {
        const old = before?.items.find((i) => i.query === item.query)?.pinned ?? {};
        for (const [merchantId, productId] of Object.entries(item.pinned)) {
          if (!productId || old[merchantId as MerchantId] === productId) continue;
          state.history.unshift({
            query: item.query,
            merchantId: merchantId as MerchantId,
            merchantProductId: productId,
            ...(item.title ? { title: item.title } : {}),
            acceptedAt: new Date().toISOString(),
          });
        }
      }
      state.baskets.set(basket.id, basket);
      return HttpResponse.json(basket);
    }),

    http.get(url('/api/matches/history'), async () => {
      await wait();
      return HttpResponse.json({ entries: state.history } satisfies api.MatchHistoryResponse);
    }),

    http.delete(url('/api/baskets/:id'), async ({ params }) => {
      await wait();
      if (!state.baskets.delete(String(params.id))) return notFound();
      return new HttpResponse(null, { status: 204 });
    }),

    http.post(url('/api/baskets/:id/optimize'), async ({ params, request }) => {
      await wait();
      const basket = state.baskets.get(String(params.id));
      if (!basket) return notFound();
      const body = api.OptimizeRequest.safeParse(await request.json());
      if (!body.success) return badRequest(body.error);
      const options = OptimizeOptions.parse({
        memberOf: state.settings.memberOf,
        delivery: state.settings.delivery,
        maxMerchants: state.settings.maxMerchants,
        ...body.data.options,
      });
      const merchants = enabled();
      const candidates = await Promise.all(
        basket.items.map(async (item) => {
          const searches = await searchMerchants(item.query, merchants, failing);
          const { byMerchant } = matchSearches(item.query, searches, item.pinned);
          // One candidate per store: the confirmed or best match.
          const matches = [...byMerchant.values()].flatMap((ms) => ms.slice(0, 1));
          return { item, matches, statuses: searches.map((s) => s.status) };
        }),
      );
      const split = greedySplit(candidates, options, state.shipping);
      if (body.data.probe) {
        await delay(opts.probeLatencyMs ?? 1500);
        const supported = new Set(mockMerchants.filter((m) => m.probeSupported).map((m) => m.id));
        for (const t of split.perMerchant) {
          t.probeVerified = state.settings.probeEnabled && supported.has(t.merchantId);
        }
      }
      return HttpResponse.json<api.OptimizeResponse>({
        split,
        candidates: candidates.map((c) => ({ itemId: c.item.id, matches: c.matches })),
        merchants:
          candidates[0]?.statuses ??
          merchants.map((merchantId) => ({ merchantId, status: 'ok', tookMs: 0 })),
      });
    }),

    http.get(url('/api/settings'), async () => {
      await wait();
      return HttpResponse.json(publicSettings(state.settings));
    }),

    http.put(url('/api/settings'), async ({ request }) => {
      await wait();
      const body = api.SettingsResponse.safeParse(await request.json());
      if (!body.success) return badRequest(body.error);
      const next = { ...body.data };
      // Absent or still masked: keep the stored key. Empty string: remove it.
      const key = next.anthropicApiKey;
      if (key === undefined || isMaskedApiKey(key)) {
        next.anthropicApiKey = state.settings.anthropicApiKey;
      } else if (key.trim() === '') {
        next.anthropicApiKey = undefined;
      }
      state.settings = next;
      return HttpResponse.json(publicSettings(state.settings));
    }),

    http.get(url('/api/catalog/status'), async () => {
      await wait();
      return HttpResponse.json({
        catalogs: [...state.catalogs.values()],
      } satisfies api.CatalogStatusResponse);
    }),

    http.post(url('/api/catalog/refresh'), async ({ request }) => {
      await wait();
      const body = api.CatalogRefreshRequest.safeParse(await request.json().catch(() => ({})));
      const requested = body.success ? body.data.merchants : undefined;
      const merchants = [...state.catalogs.keys()].filter(
        (m) => !requested || requested.includes(m),
      );
      // Refreshing now; done (with a made-up product count) shortly after.
      for (const m of merchants) {
        const c = state.catalogs.get(m)!;
        state.catalogs.set(m, { ...c, refreshing: true });
        setTimeout(() => {
          state.catalogs.set(m, {
            merchantId: m,
            productCount: 1000 + m.length * 100,
            refreshedAt: new Date().toISOString(),
            refreshing: false,
          });
        }, 50);
      }
      const res: api.CatalogRefreshResponse = { accepted: true, merchants };
      return HttpResponse.json(res, { status: 202 });
    }),

    http.post(url('/api/matches/confirm'), async ({ request }) => {
      await wait();
      const body = api.ConfirmMatchRequest.safeParse(await request.json());
      if (!body.success) return badRequest(body.error);
      return HttpResponse.json({ ok: true } satisfies api.ConfirmMatchResponse);
    }),
  ];
}
