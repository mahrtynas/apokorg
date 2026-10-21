# SV – Local API server, database and cache

**Owns:** `packages/server` · **Depends on:** Phase 0 · **Batch:** 1

## Goal

The local HTTP server that the UI talks to. It runs as a sidecar in the desktop app and as a web backend later.

## Scope

- Fastify with zod validation. Implement every route in `packages/core/src/api.ts` under `/api`:
  - `GET /api/merchants`
  - `POST /api/search`
  - `GET /api/baskets`
  - `GET/PUT/DELETE /api/baskets/:id`
  - `POST /api/baskets/:id/optimize`
  - `GET/PUT /api/settings`
  - `POST /api/catalog/refresh` (a stub that returns 202 until CI-x lands)
- Adapters come from `loadAdapters()` in `@apokorg/registry`. `--mock` / `APOKORG_MOCK=1` uses mock adapters.
  - Search every enabled store in parallel, with an 8 s timeout per store. Report per-store status (`MerchantSearchStatus`); one failing store must not fail the request.
- SQLite (`better-sqlite3`) at `%APPDATA%/apokorg/apokorg.db` (configurable with `APOKORG_DATA_DIR`), with schema migrations. Tables:
  - `baskets`
  - `settings` (the API key stored here, never logged)
  - `confirmed_matches` (query + store → merchantProductId)
  - `offer_cache` (TTL 6 h)
  - `probe_cache` (TTL 24 h)
- Matching and optimizing go through interfaces: `Matcher` (`matchOffers`) and `Optimizer` (`optimize`).
  - Until M and O merge, use simple built-in placeholders: exact = same EAN or the top result; a greedy cheapest-per-item split with shipping summed.
  - Swapping in the real packages later should be a one-line change.
- Listen on `127.0.0.1` only, port from `APOKORG_PORT` (default 4517). Allow CORS from the Vite dev origin and `tauri://localhost`.
- Print `READY <port>` on stdout once listening; the desktop shell waits for it.
- `pnpm --filter @apokorg/server dev` (tsx watch) and `dev:mock`.

## Acceptance criteria

- Route tests use `fastify.inject` with mock adapters:
  - search returns statuses for 7 stores
  - basket CRUD round-trips
  - optimize returns a valid `OptimizeResponse`
  - one store set to fail still gives a 200 with that store `error`
- Offers are served from cache within the TTL (spy on the adapter).
- The API key never appears in logs or in `GET /api/settings` (return it masked).

## Test commands

`pnpm --filter @apokorg/server test` · `pnpm --filter @apokorg/server dev:mock` then `curl -X POST localhost:4517/api/search -H 'content-type: application/json' -d '{"query":"alvedon"}'`
