/**
 * MSW handlers implementing the routes in packages/core/src/api.ts against in-memory state,
 * so the UI runs (and is tested) without packages/server.
 */
import { delay, http, HttpResponse } from 'msw';
import { api, MerchantId, OptimizeOptions, ShippingPolicy } from '@apokorg/core';
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

function maskKey(key: string | undefined): string | undefined {
  return key ? `••••${key.slice(-4)}` : undefined;
}

function publicSettings(s: Settings): Settings {
  return { ...s, anthropicApiKey: maskKey(s.anthropicApiKey) };
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
      state.baskets.set(basket.id, basket);
      return HttpResponse.json(basket);
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
      // A masked key coming back unchanged means "keep the stored one".
      if (next.anthropicApiKey === maskKey(state.settings.anthropicApiKey)) {
        next.anthropicApiKey = state.settings.anthropicApiKey;
      }
      state.settings = next;
      return HttpResponse.json(publicSettings(state.settings));
    }),

    http.post(url('/api/catalog/refresh'), async () => {
      await wait();
      return new HttpResponse(null, { status: 202 });
    }),
  ];
}
