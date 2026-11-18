import cors from '@fastify/cors';
import {
  api,
  type ItemCandidates,
  isMaskedApiKey,
  maskApiKey,
  type MatchResult,
  type MerchantAdapter,
  type MerchantId,
  OptimizeOptions,
  type ProbeResult,
  Settings,
  type ShippingPolicy,
} from '@apokorg/core';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { z } from 'zod';
import type { Db } from './db';
import { defaultMatcher, defaultOptimizer, defaultShippingPolicies } from './deps';
import { defaultNeedsConfirmation, type Matcher, type MatchOptions } from './matching';
import type { Optimizer, ShippingPolicySource } from './optimizing';
import { Repo } from './repo';
import { createClaudeJudge, groupProducts, type LlmJudge } from '@apokorg/matcher';
import { defaultCatalog, type CatalogService } from './catalog';
import { defaultCartFill, defaultProbe, type CartFillService, type ProbeService } from './probing';
import {
  DEFAULT_REFRESH_TIMEOUT_MS,
  DEFAULT_SEARCH_TIMEOUT_MS,
  searchItem,
  searchStores,
  type StoreSearchResult,
} from './search';

/** Origins allowed by CORS: the Vite dev server and the Tauri webview. */
export const CORS_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
];

/** Paths pino blanks out, so the API key can never reach a log line. */
export const LOG_REDACT = [
  'anthropicApiKey',
  '*.anthropicApiKey',
  '*.*.anthropicApiKey',
  'req.headers.authorization',
  'req.headers["x-api-key"]',
];

export interface AppOptions {
  db: Db;
  adapters: MerchantAdapter[];
  matcher?: Matcher;
  optimizer?: Optimizer;
  shippingPolicies?: ShippingPolicySource;
  /** Per-store search timeout. Default 8 s. */
  searchTimeoutMs?: number;
  /** Per-store search timeout for a price refresh. Default `searchTimeoutMs`, else 90 s. */
  refreshTimeoutMs?: number;
  /** Fastify logger config. Redaction of the API key is always added. Default: off. */
  logger?: boolean | Record<string, unknown>;
  /** Builds the LLM tie-breaker from the stored API key. Default: Claude via packages/matcher. */
  createJudge?: (settings: Pick<Settings, 'anthropicApiKey'>) => LlmJudge | undefined;
  /** Sitemap catalog refreshes. Default: packages/catalog-index on `catalog.db`. */
  catalog?: CatalogService;
  /** Refresh stale catalogs of enabled stores in the background once the server is ready. */
  refreshStaleCatalogsOnStart?: boolean;
  /** Checkout probes. Default: packages/checkout-probe in headless Edge. */
  probe?: ProbeService;
  /** Cart fills. Default: packages/checkout-probe in a visible Edge window. */
  cartFill?: CartFillService;
  /** Clock for cache TTLs; injectable for tests. */
  now?: () => number;
}

const STATUS_RANK: Record<api.MerchantSearchStatus['status'], number> = {
  ok: 0,
  unavailable: 1,
  timeout: 2,
  error: 3,
};

/** Merges per-item statuses into one per store: the worst status and the slowest time. */
function mergeStatuses(all: api.MerchantSearchStatus[]): api.MerchantSearchStatus[] {
  const out = new Map<MerchantId, api.MerchantSearchStatus>();
  for (const s of all) {
    const prev = out.get(s.merchantId);
    if (!prev) {
      out.set(s.merchantId, { ...s });
      continue;
    }
    const worse = STATUS_RANK[s.status] > STATUS_RANK[prev.status] ? s : prev;
    out.set(s.merchantId, { ...worse, tookMs: Math.max(prev.tookMs, s.tookMs) });
  }
  return [...out.values()];
}

class NotFound extends Error {}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const matcher = opts.matcher ?? defaultMatcher;
  const optimizer = opts.optimizer ?? defaultOptimizer;
  const baseShippingPolicies = opts.shippingPolicies ?? defaultShippingPolicies;
  const createJudge = opts.createJudge ?? createClaudeJudge;
  const catalog = opts.catalog ?? defaultCatalog();
  const probe = opts.probe ?? defaultProbe;
  const cartFill = opts.cartFill ?? defaultCartFill();
  const timeoutMs = opts.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
  const refreshTimeoutMs =
    opts.refreshTimeoutMs ?? opts.searchTimeoutMs ?? DEFAULT_REFRESH_TIMEOUT_MS;
  const repo = new Repo(opts.db, { now: opts.now });
  const adapters = new Map<MerchantId, MerchantAdapter>(opts.adapters.map((a) => [a.info.id, a]));
  /** JSON rules, with the user's edits from settings on top. */
  const shippingPolicies: ShippingPolicySource = (ids) => {
    const overrides = repo.getShippingOverrides();
    return baseShippingPolicies(ids).map((p) => overrides.get(p.merchantId) ?? p);
  };

  const logger: FastifyServerOptions['logger'] =
    opts.logger === undefined || opts.logger === false
      ? false
      : ({
          ...(opts.logger === true ? {} : opts.logger),
          redact: { paths: LOG_REDACT, censor: '[redacted]' },
        } as FastifyServerOptions['logger']);

  const app = Fastify({ logger });
  // @fastify/cors only allows GET/HEAD/POST by default; baskets and settings use PUT/DELETE.
  await app.register(cors, {
    origin: CORS_ORIGINS,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'],
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.code(400).send({ error: 'Invalid request', details: err.issues });
    }
    if (err instanceof NotFound) return reply.code(404).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: (err as Error).message });
    }
    req.log.error({ err }, 'request failed');
    return reply.code(500).send({ error: 'Internal error' });
  });

  /** Stored settings, or defaults with every known store enabled. Contains the raw key. */
  const currentSettings = (): Settings =>
    repo.getSettings() ?? Settings.parse({ enabledMerchants: [...adapters.keys()] });

  const publicSettings = (s: Settings): api.SettingsResponse => ({
    ...s,
    anthropicApiKey: s.anthropicApiKey ? maskApiKey(s.anthropicApiKey) : undefined,
  });

  // One judge per key, so the client isn't rebuilt on every search.
  let judge: { key: string | undefined; llm: LlmJudge | undefined } | undefined;
  const currentJudge = (): LlmJudge | undefined => {
    const key = currentSettings().anthropicApiKey;
    if (!judge || judge.key !== key) judge = { key, llm: createJudge({ anthropicApiKey: key }) };
    return judge.llm;
  };

  const matchForQuery = async (
    query: string,
    stores: StoreSearchResult[],
    acceptSubstitutes: boolean,
    pinned: Partial<Record<MerchantId, string>>,
    want?: MatchOptions['want'],
  ): Promise<MatchResult[]> => {
    const offers = stores.flatMap((s) => s.offers);
    return matcher.matchOffers(query, offers, {
      acceptSubstitutes,
      pinned: { ...repo.getConfirmedMatches(query), ...pinned },
      llm: currentJudge(),
      want,
    });
  };

  app.get('/api/merchants', async (): Promise<api.MerchantsResponse> => {
    const enabled = new Set(currentSettings().enabledMerchants);
    const ids = [...adapters.keys()];
    const policies = new Map(shippingPolicies(ids).map((p) => [p.merchantId, p]));
    return {
      merchants: opts.adapters.map((a) => ({
        ...a.info,
        enabled: enabled.has(a.info.id),
        shipping: policies.get(a.info.id),
        probeSupported: typeof a.probe === 'function',
        cartFillSupported: typeof a.fillCart === 'function',
      })),
    };
  });

  app.put('/api/merchants/:id/shipping', async (req): Promise<api.PutShippingResponse> => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const policy: ShippingPolicy = api.PutShippingRequest.parse(req.body);
    if (!adapters.has(id as MerchantId)) throw new NotFound(`Unknown store ${id}`);
    if (policy.merchantId !== id) {
      throw Object.assign(new Error('merchantId does not match the URL'), { statusCode: 400 });
    }
    return repo.putShippingOverride(policy);
  });

  app.post('/api/search', async (req): Promise<api.SearchResponse> => {
    const body = api.SearchRequest.parse(req.body);
    const merchantIds = body.merchants ?? currentSettings().enabledMerchants;
    const stores = await searchStores(merchantIds, adapters, body.query, repo, timeoutMs);
    const results = await matchForQuery(body.query, stores, body.acceptSubstitutes, {});
    return {
      query: body.query,
      results,
      needsConfirmation: (matcher.needsConfirmation ?? defaultNeedsConfirmation)(results),
      merchants: stores.map((s) => s.status),
    };
  });

  app.post('/api/products/search', async (req): Promise<api.ProductSearchResponse> => {
    const body = api.ProductSearchRequest.parse(req.body);
    const merchantIds = body.merchants ?? currentSettings().enabledMerchants;
    const stores = await searchStores(merchantIds, adapters, body.query, repo, timeoutMs);
    return {
      query: body.query,
      products: groupProducts(stores.flatMap((s) => s.offers)),
      merchants: stores.map((s) => s.status),
    };
  });

  app.post('/api/products/locate', async (req): Promise<api.SearchResponse> => {
    const body = api.LocateRequest.parse(req.body);
    const merchantIds = body.merchants ?? currentSettings().enabledMerchants;
    const { ean, title, size, packCount } = body.product;
    const stores = await searchItem(merchantIds, adapters, body.query, ean, repo, timeoutMs);
    // The chosen product's EAN identifies it exactly: pin it wherever a store lists it.
    const pinned: Partial<Record<MerchantId, string>> = {};
    if (ean) {
      for (const s of stores) {
        const hit = s.offers.find((o) => o.ean === ean);
        if (hit) pinned[s.status.merchantId] = hit.merchantProductId;
      }
    }
    // Match against the product's title, not the loose query, so near-misses become substitutes.
    // A store selling the product only in smaller packs is scaled up to the chosen pack.
    const results = await matchForQuery(title, stores, body.acceptSubstitutes, pinned, {
      size,
      packCount,
    });
    return {
      query: body.query,
      results,
      needsConfirmation: (matcher.needsConfirmation ?? defaultNeedsConfirmation)(results),
      merchants: stores.map((s) => s.status),
    };
  });

  // Puts the items in one store's cart in a visible browser and opens its checkout. The user
  // finishes the order there; nothing here pays or places it.
  app.post('/api/cart/fill', async (req): Promise<api.FillCartResponse> => {
    const body = api.FillCartRequest.parse(req.body);
    const adapter = adapters.get(body.merchantId);
    if (!adapter) throw new NotFound(`Unknown store ${body.merchantId}`);
    if (!adapter.fillCart) {
      return {
        merchantId: body.merchantId,
        status: 'unsupported',
        message: 'no cart script for this store',
        skipped: [],
      };
    }
    try {
      return { merchantId: body.merchantId, ...(await cartFill(adapter, { items: body.items })) };
    } catch (err) {
      req.log.warn({ err, merchantId: body.merchantId }, 'cart fill failed');
      const message = err instanceof Error ? err.message : String(err);
      return { merchantId: body.merchantId, status: 'failed', message, skipped: [] };
    }
  });

  app.get('/api/baskets', async (): Promise<api.BasketsResponse> => ({
    baskets: repo.listBaskets(),
  }));

  const IdParams = z.object({ id: z.string().min(1) });

  app.get('/api/baskets/:id', async (req) => {
    const { id } = IdParams.parse(req.params);
    const basket = repo.getBasket(id);
    if (!basket) throw new NotFound(`Basket ${id} not found`);
    return basket;
  });

  app.get('/api/matches/history', async (req): Promise<api.MatchHistoryResponse> => {
    const { query } = z.object({ query: z.string().min(1).optional() }).parse(req.query);
    return { entries: repo.getMatchHistory(query) };
  });

  app.post('/api/matches/confirm', async (req): Promise<api.ConfirmMatchResponse> => {
    const body = api.ConfirmMatchRequest.parse(req.body);
    repo.confirmMatch(body.query, body.merchantId, body.merchantProductId);
    return { ok: true };
  });

  app.put('/api/baskets/:id', async (req): Promise<api.PutBasketResponse> => {
    const { id } = IdParams.parse(req.params);
    const body = api.PutBasketRequest.parse(req.body);
    const basket = repo.putBasket(id, body.name, body.items);
    // A pinned product is the user's confirmed choice: remember it for the query.
    for (const item of basket.items) {
      for (const [merchantId, productId] of Object.entries(item.pinned)) {
        if (productId) repo.confirmMatch(item.query, merchantId as MerchantId, productId);
      }
    }
    return basket;
  });

  app.delete('/api/baskets/:id', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    if (!repo.deleteBasket(id)) throw new NotFound(`Basket ${id} not found`);
    return reply.code(204).send();
  });

  app.post('/api/baskets/:id/optimize', async (req): Promise<api.OptimizeResponse> => {
    const { id } = IdParams.parse(req.params);
    const body = api.OptimizeRequest.parse(req.body ?? {});
    const basket = repo.getBasket(id);
    if (!basket) throw new NotFound(`Basket ${id} not found`);

    // Options from the request win over settings; settings fill in what the request leaves out.
    const settings = currentSettings();
    const rawOptions = z
      .object({ options: z.record(z.string(), z.unknown()).optional() })
      .parse(req.body ?? {}).options;
    const options = OptimizeOptions.parse({
      memberOf: settings.memberOf,
      maxMerchants: settings.maxMerchants,
      delivery: settings.delivery,
      ...rawOptions,
    });

    const excluded = new Set(options.excludedMerchants);
    const merchantIds = settings.enabledMerchants.filter((m) => !excluded.has(m));
    const perItem = await Promise.all(
      basket.items.map(async (item) => {
        const stores = await searchItem(
          merchantIds,
          adapters,
          item.query,
          item.ean,
          repo,
          body.refresh ? refreshTimeoutMs : timeoutMs,
          { refresh: body.refresh },
        );
        const matches = await matchForQuery(
          item.query,
          stores,
          item.acceptSubstitutes,
          item.pinned,
          { size: item.size, packCount: item.packCount },
        );
        return { item, stores, matches };
      }),
    );

    const candidates: ItemCandidates[] = perItem.map(({ item, matches }) => ({
      itemId: item.id,
      qty: item.qty,
      acceptSubstitutes: item.acceptSubstitutes,
      matches,
    }));
    const policies = shippingPolicies(merchantIds);
    let split = await optimizer.optimize(candidates, policies, options);

    if (body.probe && settings.probeEnabled) {
      const cache = {
        get: (id: MerchantId, postcode: string, value: number) =>
          repo.getCachedProbe(id, postcode, value),
        set: (r: ProbeResult) => repo.cacheProbe(r),
      };
      // Stores in parallel; checkout-probe runs one probe at a time per store.
      const results = await Promise.all(
        split.perMerchant.map(async (m): Promise<ProbeResult | null> => {
          const adapter = adapters.get(m.merchantId);
          // Without a probe script (or a probe email) only an earlier cached result can help.
          if (!adapter?.probe || !settings.probeEmail) {
            return cache.get(m.merchantId, settings.postcode, m.subtotal);
          }
          const items = split.assignments
            .filter((a) => a.merchantId === m.merchantId)
            .map((a) => ({ url: a.offer.url, qty: a.qty }));
          try {
            return await probe(
              adapter,
              { items, postcode: settings.postcode, email: settings.probeEmail },
              { cache, orderValue: m.subtotal },
            );
          } catch (err) {
            req.log.warn({ err, merchantId: m.merchantId }, 'checkout probe failed');
            return null;
          }
        }),
      );
      const overrides = results.filter((r): r is ProbeResult => r?.status === 'ok');
      if (overrides.length > 0) {
        split = await optimizer.optimize(candidates, policies, options, overrides);
      }
    }

    return {
      split,
      candidates: candidates.map((c) => ({ itemId: c.itemId, matches: c.matches })),
      merchants: mergeStatuses(perItem.flatMap((p) => p.stores.map((s) => s.status))),
    };
  });

  app.get('/api/settings', async (): Promise<api.SettingsResponse> =>
    publicSettings(currentSettings()),
  );

  app.put('/api/settings', async (req): Promise<api.SettingsResponse> => {
    const incoming = Settings.parse(req.body);
    const existingKey = currentSettings().anthropicApiKey;
    // Absent or still masked: keep the stored key. Empty string: remove it.
    let key = incoming.anthropicApiKey;
    if (key === undefined || isMaskedApiKey(key)) key = existingKey;
    else if (key.trim() === '') key = undefined;
    else key = key.trim();
    const next: Settings = { ...incoming, anthropicApiKey: key };
    repo.saveSettings(next);
    return publicSettings(next);
  });

  app.get('/api/catalog/status', async (): Promise<api.CatalogStatusResponse> => ({
    catalogs: catalog.status(),
  }));

  app.post('/api/catalog/refresh', async (req, reply) => {
    const body = api.CatalogRefreshRequest.parse(req.body ?? {});
    // Only stores indexed from sitemaps; the refresh runs in the background, one store at a time.
    const merchants = (body.merchants ?? catalog.merchants).filter((m) =>
      catalog.merchants.includes(m),
    );
    for (const id of merchants) {
      catalog.refresh(id).then(
        (r) => app.log.info({ catalog: r }, 'catalog refreshed'),
        (err: unknown) => app.log.error({ err, merchantId: id }, 'catalog refresh failed'),
      );
    }
    const res: api.CatalogRefreshResponse = { accepted: true, merchants };
    return reply.code(202).send(res);
  });

  if (opts.refreshStaleCatalogsOnStart) {
    app.addHook('onReady', async () => {
      const enabled = new Set(currentSettings().enabledMerchants);
      for (const id of catalog.merchants.filter((m) => enabled.has(m) && catalog.isStale(m))) {
        catalog.refresh(id).then(
          (r) => app.log.info({ catalog: r }, 'stale catalog refreshed at startup'),
          (err: unknown) => app.log.error({ err, merchantId: id }, 'catalog refresh failed'),
        );
      }
    });
  }

  return app;
}
