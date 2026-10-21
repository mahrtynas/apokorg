# apokorg

This is a personal tool that compares a basket of products across Swedish online pharmacies, beauty stores and sport stores, then proposes the cheapest way to split the basket, delivery fees included. It is a Windows app (Tauri) today and may become a web app later.

- Full plan and decisions: [docs/plan.md](docs/plan.md)
- Work packages: [docs/tasks/](docs/tasks/README.md)

## Commands

```sh
pnpm install
pnpm check          # lint + typecheck + test (what CI runs, plus format:check)
pnpm test           # all packages, offline
pnpm --filter @apokorg/<pkg> test
pnpm --filter @apokorg/adapter-<id> test:live   # hits the real site, never in CI
pnpm new:adapter <id> "<Name>" <baseUrl> <pharmacy|beauty|sport> <api|search-page|catalog-index>
pnpm format
```

If `pnpm` isn't on PATH, run `corepack enable` once, or use `corepack pnpm …`.

## Layout

| Path                                                               | Contents                                                                                                                               |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`                                                    | Shared contracts: zod schemas and types. **Frozen.** See "Contract changes".                                                           |
| `packages/adapter-kit`                                             | Scraper helpers: polite fetch, price/size/EAN parsing, JSON-LD and window-global extraction, fixtures.                                 |
| `packages/adapters/<id>`                                           | One store each, with `default export` a `MerchantAdapter`. `_template` is the generator template; `mock` is fake data for development. |
| `packages/registry`                                                | Picks real or mock adapters. `src/generated.ts` is generated from the adapter folders; never edit it by hand.                          |
| `packages/{matcher,optimizer,catalog-index,checkout-probe,server}` | Created by their tasks.                                                                                                                |
| `apps/ui`, `apps/desktop`                                          | Created by their tasks.                                                                                                                |
| `docs/stores/<id>.md`                                              | Per-store notes: endpoints, data locations, shipping, checkout test.                                                                   |

## Rules for agents working in parallel

1. **Do one task from `docs/tasks/`.** Work in your own worktree on branch `agent/<task-id>`, and open a PR to `main`.
2. **Touch only the paths your task owns.** You may also add dependencies to your own `package.json`, which updates `pnpm-lock.yaml`. If the lockfile conflicts, regenerate it with `pnpm install` after rebasing; never resolve it by hand.
3. **Contract changes:** if you need a change in `packages/core`, open a separate small PR titled `contract: …` that changes only core. Explain why, keep it backwards-compatible where you can, then rebase onto it. Never fold core changes into a feature PR.
4. **Don't wait on other tasks.** Build against `packages/core` types and the mock adapter (`@apokorg/adapter-mock`, or `loadAdapters({ mock: true })`).
5. **CI must be green:** `pnpm check` and `pnpm format:check`. Tests run offline: adapters test against recorded fixtures in `fixtures/`, and never call live sites in unit tests.
6. **Match the code around you.** TypeScript is strict, ESM throughout, and packages export `./src/index.ts` directly (no build step). Use zod for anything crossing a process or HTTP boundary.

## Scraping etiquette

This is a personal-use tool. Use `politeFetch` from adapter-kit: one request per second per host by default, with retries on 429/5xx. Cache results, and never run crawls in parallel against one store. Product URLs must be canonical. Prices are SEK including VAT. EANs must pass `normalizeEan`.

## Checkout probe safety (hard rules)

The probe may only add items to a cart, open guest checkout, and enter the postcode and the probe email from settings. It must **never**:

- fill in payment, personal-number (personnummer/BankID), name, phone or address fields;
- click anything whose text matches the denylist (Slutför, Betala, Lägg order, Bekräfta köp, Köp nu, Place order, Pay, …).

It must empty the cart afterwards. These rules are enforced in `packages/checkout-probe`, and probe scripts only get the guarded page (`GuardedPage` in core). If a store requires login or BankID to show delivery options, mark it probe-unsupported.
