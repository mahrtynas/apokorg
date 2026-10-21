# Basket price comparator: plan (apokorg)

## Context

You want a Windows app, and later a web app, where you type rough product names and build a basket. The app finds each product, or close substitutes, at Swedish pharmacy, beauty and sport/supplement online stores. It then proposes the cheapest way to split the basket across stores, including delivery fees. The tool is for your personal use only.

The repo is empty (only `README.md` and `.gitignore`). The work is set up so several agents can build it in parallel, each in its own git worktree and branch (`agent/<task-id>`), merging through PRs to `main`.

## Decisions (settled in the grilling review)

| Topic                      | Decision                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack                      | TypeScript everywhere. Tauri v2 desktop shell with a Node sidecar server. The same server and UI become the web app later.                                                                                                                                                                                                                                                                  |
| v1 stores                  | Apotea, Apotek Hjärtat, Apoteket, DOZ, Kronans, Gymgrossisten, Lyko. Phase 2 adds Bangerhead, KICKS, MM Sports and Svensk Kosttillskott.                                                                                                                                                                                                                                                    |
| Product scope              | Non-prescription and non-medicine products only. No prescription items.                                                                                                                                                                                                                                                                                                                     |
| How each store is searched | Apoteket: Loop54 JSON API. Kronans: Voyado Elevate JSON API. Hjärtat and Lyko: the store's own search page (embedded JSON). Apotea, DOZ, Gymgrossisten: a weekly sitemap download into a local full-text index, then fetch the top few product pages.                                                                                                                                       |
| Matching                   | EAN first (DOZ: EAN read from image filename, check digit validated). Then fuzzy match on brand, name and size. Claude (`claude-haiku-5-5`) is called only when the result is ambiguous. Confident matches are picked automatically; uncertain ones are put to you, and your choice is remembered per query and store.                                                                      |
| Pack sizes and substitutes | A different pack size counts as a substitute and is compared by unit price. "Accept substitutes" is off by default for each item.                                                                                                                                                                                                                                                           |
| Prices                     | The public price. Member prices count only for stores you mark yourself a member of. Discount codes are ignored. Out-of-stock offers are left out of the split and shown greyed out.                                                                                                                                                                                                        |
| Shipping                   | Hand-maintained JSON rules per store, each with a "last checked" date and a warning after 90 days. The default is the cheapest standard option, with a "home delivery only" setting.                                                                                                                                                                                                        |
| Checkout probe             | Runs only for the stores in the recommended split and the runner-up. It drives your installed Edge (headless, separate profile) through guest checkout with postcode 11738 and the email from settings (default a plus-address such as `you+apokorg@gmail.com`). If a real fee differs from the rule, the optimizer runs again. Results are cached for 24 h per store and order-value band. |
| Probe safety               | It never fills in payment, personal-number (BankID) or address fields beyond the postcode. Order and pay buttons are on a list of words it refuses to click. It empties the cart afterwards. A store that requires login is marked "probe unsupported".                                                                                                                                     |
| Users and data             | A single local user with no login. SQLite holds the cache, saved baskets, settings and the optional Claude API key.                                                                                                                                                                                                                                                                         |
| Price history              | Not in v1. Comparison runs on demand, with a short-lived cache.                                                                                                                                                                                                                                                                                                                             |
| Legal stance               | Personal use, rate-limited and cached. Review store terms or affiliate feeds (Adtraction, Awin) before any public web launch.                                                                                                                                                                                                                                                               |

## Architecture

```
apps/desktop (Tauri v2) ── spawns ──▶ packages/server (Fastify, Node single-exe sidecar)
apps/ui (React+Vite) ──── HTTP ────▶   ├─ adapters/<store>     search() / getProduct()
                                      ├─ catalog-index        sitemap → SQLite FTS5
                                      ├─ matcher              EAN → fuzzy → Claude fallback
                                      ├─ optimizer            integer program (HiGHS wasm)
                                      ├─ checkout-probe       Playwright + msedge, guarded
                                      └─ cache/db             better-sqlite3
```

**Packages** (pnpm workspaces, source-only TypeScript packages, Vitest):

- **`packages/core`**: the shared contracts, frozen after Phase 0.
  - `ProductOffer` (merchantId, title, brand, ean, size{value,unit}, packCount, price, memberPrice, unitPrice, inStock, url, imageUrl, fetchedAt)
  - `MerchantAdapter` (id, name, category, searchStrategy, search, getProduct, probe?)
  - `ShippingPolicy` (tiers by order value, delivery options, lastVerified)
  - `BasketItem`, `MatchResult` (exact | equivalent | substitute, confidence)
  - `SplitResult`
  - zod schemas for the API
- **`packages/adapter-kit`**: shared scraper helpers.
  - Polite fetch: per-host rate limit, retries, browser-like User-Agent.
  - JSON-LD, `window.INITIAL_DATA` and `CURRENT_PAGE` extractors.
  - Swedish price parser ("1 299,00 kr"), size parser (ml/g/st/tabletter), EAN-13 check digit validation.
  - Fixture recorder.
- **`packages/catalog-index`**: reads a store's sitemap, extracts product URLs and the readable product name from each URL into SQLite FTS5, refreshes weekly, and exposes `searchCandidates(merchant, query)`.
- **`packages/adapters/<store>`**: one package per store. Unit tests run offline against recorded fixtures; `test:live` is a manual smoke test against the real site. Each store also has `docs/stores/<store>.md`, recording its endpoints, how it's searched, and the checkout test findings.
- **`packages/matcher`**: normalization (brand aliases, Swedish units, pack counts), scoring, labelling as exact, equivalent or substitute, the Claude fallback, and the memory of your confirmed matches.
- **`packages/optimizer`**: an integer program. Binary `x[item,store]` picks which store supplies each item; binary `y[store,tier]` picks the shipping tier. The objective is item cost plus shipping. Constraints: maximum number of stores, excluded stores, and per-item substitute permission. The result also returns the best single-store total and the savings from splitting. Shipping data lives in `packages/optimizer/shipping/<store>.json`.
- **`packages/checkout-probe`**: `playwright-core` driving Edge (`channel: 'msedge'`), with a guard that blocks the forbidden fields and buttons, and a cache. Each store's probe script sits in its adapter package as `probe.ts`.
- **`packages/server`**: Fastify with these routes:
  - `/search`
  - `/basket` (CRUD)
  - `/basket/optimize`
  - `/merchants`
  - `/settings`
  - `/catalog/refresh`

  Adapters run in parallel with per-store timeouts. The adapter registry is generated from the folder list, so agents don't edit a shared file.

- **`apps/ui`**: React with TanStack Query.
  - Basket builder: search, pick a match, set the substitutes switch, set quantity.
  - Comparison table: items × stores, with substitutes and out-of-stock offers shown.
  - Recommended split: per-store subtotal plus shipping, the probe-verified badge, savings compared with a single store.
  - Settings: stores, memberships, maximum number of stores, delivery preference, email, postcode, Claude API key, shipping-rule editor.
- **`apps/desktop`**: the Tauri v2 shell and sidecar lifecycle. The server is packaged as one exe with Node's single-executable feature, and the installer is NSIS.

## Parallel work plan

**Phase 0 – foundation (1 agent, merges first)**

- Monorepo scaffold, lint and format, Vitest, GitHub Actions CI (lint, typecheck, test).
- `packages/core` contracts.
- `adapter-kit` skeleton and the `pnpm new:adapter <id>` template.
- A mock adapter, a fixture dataset, and a mock server mode.
- `CLAUDE.md` with the rules: own only your paths, contract changes go in their own PR, CI must be green.
- `docs/tasks/<id>.md` briefs, each with goal, owned paths, dependencies, acceptance criteria and test commands.

**Batch 1** (6 agents in parallel)

| ID         | Task                                            | Owned paths                                             |
| ---------- | ----------------------------------------------- | ------------------------------------------------------- |
| M          | Matcher                                         | `packages/matcher`                                      |
| O          | Optimizer + shipping JSON for the 7 stores      | `packages/optimizer`                                    |
| SV         | Server, DB and cache (against the mock adapter) | `packages/server`                                       |
| U          | UI (against the mock server)                    | `apps/ui`                                               |
| A-apoteket | Loop54 adapter + checkout test notes            | `packages/adapters/apoteket`, `docs/stores/apoteket.md` |
| A-hjartat  | Search-page adapter + checkout test notes       | `packages/adapters/hjartat`, `docs/stores/hjartat.md`   |

**Batch 2**

| ID        | Task                                        |
| --------- | ------------------------------------------- |
| CI-x      | `catalog-index`                             |
| A-kronans | Elevate adapter                             |
| A-lyko    | Lyko adapter                                |
| CP        | `checkout-probe` framework and guard        |
| D         | Desktop shell, sidecar packaging, installer |

**Batch 3**

| ID                               | Task                                                                   | Depends on       |
| -------------------------------- | ---------------------------------------------------------------------- | ---------------- |
| A-apotea, A-doz, A-gymgrossisten | Adapters                                                               | `catalog-index`  |
| P-*                              | One `probe.ts` per store, where the checkout test showed it's possible | `checkout-probe` |

**Phase 2**

- Integration end to end.
- Tune the matcher on about 50 labelled real queries.
- The 4 remaining stores.
- Installer polish.

**Phase 3**

- Web deployment (Docker), with terms review first.
- Optional price history and alerts.

## Status

Phase 0 is done: scaffold, contracts, adapter template, mock adapter, CLAUDE.md, task briefs and CI. The work packages are in [docs/tasks/](tasks/README.md).

Two changes from the original plan:

- Packages export their TypeScript source directly (`exports: ./src/index.ts`) instead of using project references. There is no build step inside the monorepo; the desktop task bundles the server with esbuild.
- The adapter registry lives in its own `packages/registry` and is generated from the adapter folders.
- The UI mocks the API with MSW, so it doesn't need a server mock mode during Batch 1.

## Research findings (2026-10-21)

- No bot challenges on any site.
- EAN is available at most stores; DOZ only through image filenames.
- Free-shipping thresholds:

  | Store          | Free from                                     |
  | -------------- | --------------------------------------------- |
  | Apotea         | always free                                   |
  | DOZ            | 199                                           |
  | Hjärtat        | 299 (29 kr pickup point, 49 kr home)          |
  | Apoteket, Lyko | 300                                           |
  | Gymgrossisten  | 499                                           |
  | Kronans        | unknown (to be checked in the A-kronans task) |

- Member prices are explicit only at Lyko (`memberPrice`) and Hjärtat (ICA Stammis).
- Lyko loads a Queue-it waiting room. Under heavy traffic its adapter should give up quickly and report the store as unavailable.

## Verification

- `pnpm -r typecheck && pnpm -r test` stays green in CI. All adapter tests run offline against fixtures.
- Optimizer tests are hand-computed cases: a free-shipping threshold that tips the split, maximum stores = 1, an item missing from one store, and a probe fee that differs from the rule and triggers a re-run.
- Probe guard tests: a fixture checkout page with "Slutför köp" or "Betala" buttons must never be clicked, and the payment fields must never be filled in.
- Manual smoke test: `pnpm test:live --merchant apoteket "Alvedon 500 mg 20 st"`.
- End to end:
  1. `pnpm dev`, then build a basket of 5 items (a pharmacy item, a beauty item, a protein powder).
  2. Check the comparison table, and check that the split total equals the per-store subtotals plus shipping.
  3. Run the probe for one store and confirm the cart is empty afterwards.
  4. `pnpm tauri dev` to confirm the desktop shell starts the sidecar.
