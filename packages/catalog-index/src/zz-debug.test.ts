// TEMPORARY: split CI timings of searchCandidates. Remove before merge.
import { performance } from 'node:perf_hooks';
import { normalize, tokenize } from '@apokorg/matcher';
import { it } from 'vitest';
import { openCatalogDb } from './db';
import { refreshCatalog } from './refresh';
import { CATALOG_SOURCES } from './stores';
import { fixtureFetch } from './test-helpers';

it('debug timings', async () => {
  const db = openCatalogDb(':memory:');
  await refreshCatalog(
    'apotea',
    { ...CATALOG_SOURCES.apotea, sitemapUrl: 'https://www.apotea.se/sitemap-1000.xml' },
    {
      db,
      fetchBytes: fixtureFetch({ 'https://www.apotea.se/sitemap-1000.xml': 'sitemap-1000.xml' }),
    },
  );
  const t = (label: string, fn: () => unknown) => {
    fn();
    const t0 = performance.now();
    const r = fn();
    console.log(
      `DBG ${label}: ${(performance.now() - t0).toFixed(2)} ms`,
      Array.isArray(r) ? r.length : '',
    );
  };
  t('normalize', () => normalize('alvedon 500 20'));
  const sql = `SELECT p.url, p.search_text, bm25(products_fts) AS rank FROM products_fts JOIN products p ON p.id = products_fts.rowid WHERE products_fts MATCH ? AND p.merchant_id = ? ORDER BY rank LIMIT 200`;
  t('prepare', () => db.prepare(sql));
  const stmt = db.prepare(sql);
  t('and-query', () => stmt.all('"alvedon"* "500"* "20"*', 'apotea'));
  t('or-query', () => stmt.all('"alvedon"* OR "500"* OR "20"*', 'apotea'));
  t('one-term', () => stmt.all('"alvedon"*', 'apotea'));
  t('no-join', () =>
    db
      .prepare(`SELECT rowid FROM products_fts WHERE products_fts MATCH ?`)
      .all('"alvedon"* "500"* "20"*'),
  );
  const rows = stmt.all('"alvedon"* OR "500"* OR "20"*', 'apotea') as { search_text: string }[];
  t('tokenize x200', () => rows.map((r) => tokenize(r.search_text)));
  const cross = db.prepare(
    sql.replace('FROM products_fts JOIN products p', 'FROM products_fts CROSS JOIN products p'),
  );
  t('cross-and', () => cross.all('"alvedon"* "500"* "20"*', 'apotea'));
  t('cross-or', () => cross.all('"alvedon"* OR "500"* OR "20"*', 'apotea'));
  t('plan', () => db.prepare('EXPLAIN QUERY PLAN ' + sql).all('x', 'apotea'));
  console.log(
    'DBG PLAN',
    JSON.stringify(db.prepare('EXPLAIN QUERY PLAN ' + sql).all('x', 'apotea')),
  );
  console.log('DBG VERSION', JSON.stringify(db.prepare('select sqlite_version() v').all()));
  t('count', () => db.prepare('SELECT count(*) AS n FROM products').all());
});
