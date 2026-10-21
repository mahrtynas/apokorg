import cors from '@fastify/cors';
import {
  api,
  type ItemCandidates,
  type MatchResult,
  type MerchantAdapter,
  type MerchantId,
  OptimizeOptions,
  type ProbeResult,
  Settings,
} from '@apokorg/core';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { z } from 'zod';
import type { Db } from './db';
import { defaultMatcher, defaultOptimizer, defaultShippingPolicies } from './deps';
import { defaultNeedsConfirmation, type Matcher } from './matching';
import type { Optimizer, ShippingPolicySource } from './optimizing';
import { Repo } from './repo';
import { DEFAULT_SEARCH_TIMEOUT_MS, searchStores, type StoreSearchResult } from './search';

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
  /** Fastify logger config. Redaction of the API key is always added. Default: off. */
  logger?: boolean | Record<string, unknown>;
  /** Clock for cache TTLs; injectable for tests. */
  now?: () => number;
}

const MASK_PREFIX = '****';

/** "sk-ant-abc…wxyz" → "****wxyz". Short keys are fully masked. */
export function maskApiKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  return key.length >= 12 ? `${MASK_PREFIX}${key.slice(-4)}` : MASK_PREFIX;
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
  const shippingPolicies = opts.shippingPolicies ?? defaultShippingPolicies;
  const timeoutMs = opts.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
  const repo = new Repo(opts.db, { now: opts.now });
  const adapters = new Map<MerchantId, MerchantAdapter>(opts.adapters.map((a) => [a.info.id, a]));

  const logger: FastifyServerOptions['logger'] =
    opts.logger === undefined || opts.logger === false
      ? false
      : ({
          ...(opts.logger === true ? {} : opts.logger),
          redact: { paths: LOG_REDACT, censor: '[redacted]' },
        } as FastifyServerOptions['logger']);

  const app = Fastify({ logger });
  await app.register(cors, { origin: CORS_ORIGINS });

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
    anthropicApiKey: maskApiKey(s.anthropicApiKey),
  });

  const matchForQuery = async (
    query: string,
    stores: StoreSearchResult[],
    acceptSubstitutes: boolean,
    pinned: Partial<Record<MerchantId, string>>,
  ): Promise<MatchResult[]> => {
    const offers = stores.flatMap((s) => s.offers);
    return matcher.matchOffers(query, offers, {
      acceptSubstitutes,
      pinned: { ...repo.getConfirmedMatches(query), ...pinned },
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
      })),
    };
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

  app.put('/api/baskets/:id', async (req) => {
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
        const stores = await searchStores(merchantIds, adapters, item.query, repo, timeoutMs);
        const matches = await matchForQuery(
          item.query,
          stores,
          item.acceptSubstitutes,
          item.pinned,
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
      // Running probes is packages/checkout-probe's job; until then reuse cached results.
      const overrides: ProbeResult[] = split.perMerchant
        .map((m) => repo.getCachedProbe(m.merchantId, settings.postcode, m.subtotal))
        .filter((r): r is ProbeResult => r !== null);
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
    if (key === undefined || key.startsWith(MASK_PREFIX)) key = existingKey;
    else if (key.trim() === '') key = undefined;
    else key = key.trim();
    const next: Settings = { ...incoming, anthropicApiKey: key };
    repo.saveSettings(next);
    return publicSettings(next);
  });

  app.post('/api/catalog/refresh', async (req, reply) => {
    const body = api.CatalogRefreshRequest.parse(req.body ?? {});
    // Stub until the catalog-index task (CI-x) lands.
    return reply.code(202).send({ accepted: true, merchants: body.merchants ?? [] });
  });

  return app;
}
