/**
 * Sitemap catalog refreshes for stores whose search pages robots.txt disallows (packages/catalog-index).
 * Refreshes run one at a time, so a store is never crawled twice in parallel.
 */
import {
  CATALOG_SOURCES,
  catalogStatus,
  defaultCatalogPath,
  needsRefresh,
  openCatalogDb,
  refreshCatalog,
  type CatalogDb,
  type CatalogStoreId,
  type RefreshResult,
} from '@apokorg/catalog-index';
import type { api, MerchantId } from '@apokorg/core';

export type CatalogState = api.CatalogStatusResponse['catalogs'][number];

export interface CatalogService {
  /** Stores that have a sitemap catalog. */
  merchants: MerchantId[];
  /** Queues a refresh. A store already queued or refreshing returns the pending refresh. */
  refresh(merchantId: MerchantId): Promise<RefreshResult>;
  /** Never refreshed, or the last refresh is older than 7 days. */
  isStale(merchantId: MerchantId): boolean;
  status(): CatalogState[];
  /** Closes the database, if it was opened. */
  close?(): void;
}

/** Opens `catalog.db` in the data dir on first use. */
export function defaultCatalog(dataDir?: string): CatalogService {
  let db: CatalogDb | undefined;
  const open = () => (db ??= openCatalogDb(defaultCatalogPath(dataDir)));
  let queue: Promise<unknown> = Promise.resolve();
  const pending = new Map<MerchantId, Promise<RefreshResult>>();
  const errors = new Map<MerchantId, string>();
  const ids = Object.keys(CATALOG_SOURCES) as CatalogStoreId[];

  return {
    merchants: ids,
    refresh(merchantId) {
      const existing = pending.get(merchantId);
      if (existing) return existing;
      const id = merchantId as CatalogStoreId;
      const run = queue
        .then(() => refreshCatalog(id, CATALOG_SOURCES[id], { db: open() }))
        .then(
          (result) => {
            errors.delete(merchantId);
            return result;
          },
          (err: unknown) => {
            errors.set(merchantId, err instanceof Error ? err.message : String(err));
            throw err;
          },
        )
        .finally(() => pending.delete(merchantId));
      pending.set(merchantId, run);
      queue = run.catch(() => {});
      return run;
    },
    isStale: (merchantId) => needsRefresh(merchantId, { db: open() }),
    status: () =>
      ids.map((merchantId) => {
        const s = catalogStatus(merchantId, { db: open() });
        const lastError = errors.get(merchantId);
        return {
          merchantId,
          productCount: s?.productCount ?? 0,
          ...(s ? { refreshedAt: new Date(s.refreshedAt).toISOString() } : {}),
          refreshing: pending.has(merchantId),
          ...(lastError ? { lastError } : {}),
        };
      }),
    close() {
      db?.close();
      db = undefined;
    },
  };
}
