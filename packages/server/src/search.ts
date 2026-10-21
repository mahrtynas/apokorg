/** Fans a query out to the stores in parallel, with a per-store timeout and the offer cache. */
import type { MerchantAdapter, MerchantId, ProductOffer } from '@apokorg/core';
import type { api } from '@apokorg/core';
import type { Repo } from './repo';

export const DEFAULT_SEARCH_TIMEOUT_MS = 8000;

export interface StoreSearchResult {
  offers: ProductOffer[];
  status: api.MerchantSearchStatus;
}

class TimeoutError extends Error {}

/** Searches one store, serving from the 6 h offer cache when possible. Never throws. */
export async function searchStore(
  merchantId: MerchantId,
  adapter: MerchantAdapter | undefined,
  query: string,
  repo: Repo,
  timeoutMs: number,
): Promise<StoreSearchResult> {
  const started = performance.now();
  const took = () => Math.round(performance.now() - started);
  if (!adapter) {
    return {
      offers: [],
      status: { merchantId, status: 'unavailable', message: 'No adapter', tookMs: 0 },
    };
  }
  const cached = repo.getCachedOffers(merchantId, query);
  if (cached) return { offers: cached, status: { merchantId, status: 'ok', tookMs: took() } };

  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(`No answer within ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    const offers = await Promise.race([
      adapter.search(query, { signal: controller.signal }),
      timeout,
    ]);
    // Adapters should only return their own offers; drop anything else.
    const own = offers.filter((o) => o.merchantId === merchantId);
    repo.cacheOffers(merchantId, query, own);
    return { offers: own, status: { merchantId, status: 'ok', tookMs: took() } };
  } catch (err) {
    const timedOut = err instanceof TimeoutError;
    return {
      offers: [],
      status: {
        merchantId,
        status: timedOut ? 'timeout' : 'error',
        message: err instanceof Error ? err.message : String(err),
        tookMs: took(),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Searches every listed store in parallel. One failing store never fails the whole call. */
export async function searchStores(
  merchantIds: MerchantId[],
  adapters: Map<MerchantId, MerchantAdapter>,
  query: string,
  repo: Repo,
  timeoutMs: number = DEFAULT_SEARCH_TIMEOUT_MS,
): Promise<StoreSearchResult[]> {
  return Promise.all(
    merchantIds.map((id) => searchStore(id, adapters.get(id), query, repo, timeoutMs)),
  );
}

/**
 * Searches for one basket item: its query, plus its EAN when known, so a product the user
 * chose is still found at stores whose search for the query doesn't list it. Per store, the
 * offers are merged (first occurrence wins) and the store counts as ok if either search was.
 */
export async function searchItem(
  merchantIds: MerchantId[],
  adapters: Map<MerchantId, MerchantAdapter>,
  query: string,
  ean: string | undefined,
  repo: Repo,
  timeoutMs: number = DEFAULT_SEARCH_TIMEOUT_MS,
): Promise<StoreSearchResult[]> {
  const queries = ean && ean !== query ? [query, ean] : [query];
  const runs = await Promise.all(
    queries.map((q) => searchStores(merchantIds, adapters, q, repo, timeoutMs)),
  );
  return merchantIds.map((_, i) => {
    const results = runs.map((run) => run[i]!);
    const seen = new Set<string>();
    const offers = results
      .flatMap((r) => r.offers)
      .filter((o) => !seen.has(o.merchantProductId) && seen.add(o.merchantProductId));
    const status = results.find((r) => r.status.status === 'ok')?.status ?? results[0]!.status;
    return { offers, status };
  });
}
