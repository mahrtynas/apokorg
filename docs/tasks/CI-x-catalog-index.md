# CI-x – Sitemap catalog index

**Owns:** `packages/catalog-index` · **Depends on:** Batch 1 merged · **Batch:** 2

## Goal

For stores whose search pages are disallowed in robots.txt (Apotea, DOZ, Gymgrossisten), build a local product index from their sitemaps so adapters can find candidate product URLs without calling the store's search.

## Scope

- `refreshCatalog(merchantId, { sitemapUrl, productUrlFilter, slugToTitle? })`:
  - Read the robots.txt `Sitemap:` entries or the given URL. Follow sitemap indexes and handle `.xml.gz`.
  - Keep product URLs only, using a filter per store.
  - Derive a searchable title from each URL slug: `/alvedon-500-mg-filmdragerad-tablett-20-st` → "alvedon 500 mg filmdragerad tablett 20 st".
  - Store the rows in SQLite FTS5 (`better-sqlite3`): merchantId, url, title tokens, lastmod.
  - Store the database in the same data dir as the server (`APOKORG_DATA_DIR`), as its own file `catalog.db`.
- `searchCandidates(merchantId, query, limit=10)`: FTS5 query with prefix matching and unit normalization (reuse matcher-style normalization; import from `@apokorg/matcher` if it's merged, otherwise a local copy marked TODO).
- `needsRefresh(merchantId)`: older than 7 days. Refreshes are incremental where `lastmod` allows.
- Politeness: fetch sitemaps one at a time with `politeFetch`. A full refresh should take minutes, not hammer the store.
- Wire `POST /api/catalog/refresh`. That route lives in the server, so ask SV or do a follow-up PR: export a function the server can call.

## Acceptance criteria

- Fixture sitemaps (index, a gzipped child, a non-product child) are parsed correctly.
- Slug-to-title works on real-looking URLs from all 3 stores.
- Search ranks "alvedon 500 20" → the right URL first in a fixture index of 1,000 rows, in under 20 ms.

## Test commands

`pnpm --filter @apokorg/catalog-index test`
