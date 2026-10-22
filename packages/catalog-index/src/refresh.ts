import { normalize } from '@apokorg/matcher';
import { sharedCatalogDb, type CatalogDb } from './db';
import {
  decodeBody,
  isRobotsUrl,
  parseSitemap,
  politeFetchBytes,
  robotsSitemaps,
  type FetchBytes,
} from './sitemap';
import { slugToTitle as defaultSlugToTitle } from './slug';

/** Where a store's products are listed and how to recognise them. */
export interface CatalogSource {
  /** A sitemap or sitemap index URL, or the store's `/robots.txt` to use its `Sitemap:` lines. */
  sitemapUrl: string;
  /** Keeps product URLs only. */
  productUrlFilter: (url: URL) => boolean;
  /** Which child sitemaps of an index to follow (default: all). Saves requests. */
  sitemapFilter?: (url: URL) => boolean;
  /** Readable title from a product URL (default: {@link defaultSlugToTitle}). */
  slugToTitle?: (url: URL) => string;
}

export interface RefreshOptions {
  db?: CatalogDb;
  /** Defaults to `politeFetch` (one request per second per host, sequential). */
  fetchBytes?: FetchBytes;
  /** Refetch every sitemap even when its `lastmod` is unchanged. */
  full?: boolean;
  now?: number;
}

export interface RefreshResult {
  merchantId: string;
  /** Products in the index for this store after the refresh. */
  products: number;
  sitemapsFetched: number;
  /** Child sitemaps skipped because their `lastmod` matched the previous refresh. */
  sitemapsSkipped: number;
  durationMs: number;
}

interface Row {
  url: string;
  title: string;
  searchText: string;
  lastmod: string | null;
}

interface QueueItem {
  url: string;
  lastmod?: string;
}

/**
 * Downloads a store's sitemaps one at a time and replaces its rows in the catalog index.
 * Incremental: a child sitemap whose index `lastmod` is unchanged since the last refresh is not
 * refetched and its rows are kept. Everything is written in one transaction at the end, so a
 * failed refresh leaves the previous index intact.
 */
export async function refreshCatalog(
  merchantId: string,
  source: CatalogSource,
  opts: RefreshOptions = {},
): Promise<RefreshResult> {
  const started = Date.now();
  const db = opts.db ?? sharedCatalogDb();
  const fetchBytes = opts.fetchBytes ?? politeFetchBytes;
  const toTitle = source.slugToTitle ?? defaultSlugToTitle;

  const previous = new Map<string, string | null>();
  for (const r of db
    .prepare('SELECT url, lastmod FROM sitemaps WHERE merchant_id = ?')
    .all(merchantId) as { url: string; lastmod: string | null }[]) {
    previous.set(r.url, r.lastmod);
  }

  let roots: string[] = [source.sitemapUrl];
  if (isRobotsUrl(source.sitemapUrl)) {
    roots = robotsSitemaps(decodeBody(await fetchBytes(source.sitemapUrl)), source.sitemapUrl);
    if (roots.length === 0) throw new Error(`No Sitemap: lines in ${source.sitemapUrl}`);
  }

  const seen = new Map<string, string | null>();
  const fetched = new Map<string, Row[]>();
  const visited = new Set<string>();
  const queue: QueueItem[] = roots.map((url) => ({ url }));
  let sitemapsFetched = 0;
  let sitemapsSkipped = 0;

  // Depth-first, strictly sequential: never more than one request in flight per store.
  while (queue.length > 0) {
    const item = queue.shift()!;
    if (visited.has(item.url)) continue;
    visited.add(item.url);

    if (
      !opts.full &&
      item.lastmod !== undefined &&
      previous.has(item.url) &&
      previous.get(item.url) === item.lastmod
    ) {
      seen.set(item.url, item.lastmod);
      sitemapsSkipped++;
      continue;
    }

    const doc = parseSitemap(decodeBody(await fetchBytes(item.url)));
    sitemapsFetched++;
    if (doc.kind === 'index') {
      const children: QueueItem[] = [];
      for (const child of doc.sitemaps) {
        const url = safeUrl(child.loc, item.url);
        if (!url || (source.sitemapFilter && !source.sitemapFilter(url))) continue;
        children.push(
          child.lastmod ? { url: url.href, lastmod: child.lastmod } : { url: url.href },
        );
      }
      queue.unshift(...children);
      continue;
    }

    const rows: Row[] = [];
    for (const entry of doc.urls) {
      const url = safeUrl(entry.loc, item.url);
      if (!url || !source.productUrlFilter(url)) continue;
      url.hash = '';
      const title = toTitle(url);
      if (!title) continue;
      rows.push({
        url: url.href,
        title,
        searchText: normalize(title),
        lastmod: entry.lastmod ?? null,
      });
    }
    fetched.set(item.url, rows);
    seen.set(item.url, item.lastmod ?? null);
  }

  const products = writeRefresh(db, merchantId, fetched, seen, opts.now ?? Date.now());
  return {
    merchantId,
    products,
    sitemapsFetched,
    sitemapsSkipped,
    durationMs: Date.now() - started,
  };
}

function safeUrl(loc: string, base: string): URL | undefined {
  try {
    return new URL(loc, base);
  } catch {
    return undefined;
  }
}

function writeRefresh(
  db: CatalogDb,
  merchantId: string,
  fetched: Map<string, Row[]>,
  seen: Map<string, string | null>,
  now: number,
): number {
  const deleteSitemapRows = db.prepare(
    'DELETE FROM products WHERE merchant_id = ? AND sitemap = ?',
  );
  const upsert = db.prepare(
    `INSERT INTO products (merchant_id, url, title, search_text, lastmod, sitemap)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (merchant_id, url) DO UPDATE SET
       title = excluded.title, search_text = excluded.search_text,
       lastmod = excluded.lastmod, sitemap = excluded.sitemap`,
  );
  const insertSitemap = db.prepare(
    'INSERT INTO sitemaps (merchant_id, url, lastmod) VALUES (?, ?, ?)',
  );

  db.exec('BEGIN');
  try {
    // Rows from sitemaps that are gone from the index.
    const stored = db
      .prepare('SELECT DISTINCT sitemap FROM products WHERE merchant_id = ?')
      .all(merchantId) as { sitemap: string }[];
    for (const { sitemap } of stored) {
      if (!seen.has(sitemap)) deleteSitemapRows.run(merchantId, sitemap);
    }
    for (const [sitemap, rows] of fetched) {
      deleteSitemapRows.run(merchantId, sitemap);
      for (const r of rows)
        upsert.run(merchantId, r.url, r.title, r.searchText, r.lastmod, sitemap);
    }
    db.prepare('DELETE FROM sitemaps WHERE merchant_id = ?').run(merchantId);
    for (const [url, lastmod] of seen) insertSitemap.run(merchantId, url, lastmod);

    const { n } = db
      .prepare('SELECT COUNT(*) AS n FROM products WHERE merchant_id = ?')
      .get(merchantId) as { n: number };
    db.prepare(
      `INSERT INTO refreshes (merchant_id, refreshed_at, product_count) VALUES (?, ?, ?)
       ON CONFLICT (merchant_id) DO UPDATE SET
         refreshed_at = excluded.refreshed_at, product_count = excluded.product_count`,
    ).run(merchantId, now, n);
    db.exec('COMMIT');
    return n;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CatalogStatus {
  merchantId: string;
  refreshedAt: number;
  productCount: number;
}

/** When the store was last refreshed, or undefined if never. */
export function catalogStatus(
  merchantId: string,
  opts: { db?: CatalogDb } = {},
): CatalogStatus | undefined {
  const db = opts.db ?? sharedCatalogDb();
  const row = db
    .prepare('SELECT refreshed_at, product_count FROM refreshes WHERE merchant_id = ?')
    .get(merchantId) as { refreshed_at: number; product_count: number } | undefined;
  return row
    ? { merchantId, refreshedAt: row.refreshed_at, productCount: row.product_count }
    : undefined;
}

/** True when the store was never refreshed or the last refresh is older than 7 days. */
export function needsRefresh(
  merchantId: string,
  opts: { db?: CatalogDb; now?: number; maxAgeMs?: number } = {},
): boolean {
  const status = catalogStatus(merchantId, opts);
  if (!status) return true;
  return (opts.now ?? Date.now()) - status.refreshedAt > (opts.maxAgeMs ?? REFRESH_MAX_AGE_MS);
}
