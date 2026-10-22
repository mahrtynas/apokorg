import { normalize, tokenize } from '@apokorg/matcher';
import { sharedCatalogDb, type CatalogDb } from './db';

export interface Candidate {
  url: string;
  /** Readable title derived from the URL slug. */
  title: string;
  lastmod?: string;
  /** Higher is better. Only meaningful relative to the other candidates of one search. */
  score: number;
}

/** FTS hits re-ranked in JS; plenty for picking the top few product pages to fetch. */
const POOL = 200;

interface Hit {
  url: string;
  title: string;
  search_text: string;
  lastmod: string | null;
  rank: number;
}

const MEASURE_RE = /^(\d+(?:\.\d+)?)[a-z]+$/;

/**
 * Product URLs from the store's catalog index that best match a free-text query.
 * The query is normalized like the matcher does ("500 mg" → "500mg", "20 tabletter" → "20st"),
 * every term is prefix-matched, and a bare number matches a measure ("500" ~ "500mg").
 * Requires all terms first and falls back to any term when nothing matches all of them.
 */
export function searchCandidates(
  merchantId: string,
  query: string,
  limit = 10,
  opts: { db?: CatalogDb } = {},
): Candidate[] {
  const db = opts.db ?? sharedCatalogDb();
  const terms = [...new Set(normalize(query).split(' ').filter(Boolean))];
  if (terms.length === 0 || limit <= 0) return [];

  const stmt = db.prepare(
    `SELECT p.url, p.title, p.search_text, p.lastmod, bm25(products_fts) AS rank
     FROM products_fts JOIN products p ON p.id = products_fts.rowid
     WHERE products_fts MATCH ? AND p.merchant_id = ?
     ORDER BY rank LIMIT ${POOL}`,
  );
  const phrases = terms.map((t) => `"${t}"*`);
  let hits = stmt.all(phrases.join(' '), merchantId) as unknown as Hit[];
  if (hits.length === 0 && terms.length > 1) {
    hits = stmt.all(phrases.join(' OR '), merchantId) as unknown as Hit[];
  }

  return hits
    .map((h) => ({
      url: h.url,
      title: h.title,
      ...(h.lastmod ? { lastmod: h.lastmod } : {}),
      score: score(terms, h),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * +3 per term matching a token exactly (or a bare number matching a measure's number),
 * +1 per term only prefix-matching, -1 per identity word in the title the query doesn't mention
 * ("alvedon novum" for "alvedon"), and bm25 as a tie-breaker.
 */
function score(terms: string[], hit: Hit): number {
  const tokens = hit.search_text.split(' ');
  let s = 0;
  for (const term of terms) {
    if (tokens.some((t) => t === term || MEASURE_RE.exec(t)?.[1] === term)) s += 3;
    else if (tokens.some((t) => t.startsWith(term))) s += 1;
  }
  for (const word of tokenize(hit.search_text)) {
    if (!terms.some((t) => word.startsWith(t))) s -= 1;
  }
  return s - hit.rank * 0.01;
}
