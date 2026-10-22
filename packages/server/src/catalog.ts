/**
 * Sitemap catalog refreshes for stores whose search pages robots.txt disallows (packages/catalog-index).
 * Refreshes run one at a time, so a store is never crawled twice in parallel.
 */
import {
  CATALOG_SOURCES,
  defaultCatalogPath,
  openCatalogDb,
  refreshCatalog,
  type CatalogDb,
  type CatalogStoreId,
  type RefreshResult,
} from '@apokorg/catalog-index';
import type { MerchantId } from '@apokorg/core';

export interface CatalogService {
  /** Stores that have a sitemap catalog. */
  merchants: MerchantId[];
  refresh(merchantId: MerchantId): Promise<RefreshResult>;
}

/** Opens `catalog.db` in the data dir on first use. */
export function defaultCatalog(dataDir?: string): CatalogService {
  let db: CatalogDb | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const ids = Object.keys(CATALOG_SOURCES) as CatalogStoreId[];
  return {
    merchants: ids,
    refresh(merchantId) {
      const id = merchantId as CatalogStoreId;
      const run = queue.then(() => {
        db ??= openCatalogDb(defaultCatalogPath(dataDir));
        return refreshCatalog(id, CATALOG_SOURCES[id], { db });
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}
