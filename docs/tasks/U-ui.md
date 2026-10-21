# U – User interface

**Owns:** `apps/ui` · **Depends on:** Phase 0 · **Batch:** 1

## Goal

A React app for building a basket, comparing stores and seeing the recommended split. It runs inside Tauri and later in a browser.

## Scope

- Vite + React + TypeScript + TanStack Query. Types and request validation come from `@apokorg/core` (`api.*` schemas).
- API base URL from `VITE_API_URL` (default `http://127.0.0.1:4517`).
- **Mock mode:** MSW handlers built from the core API schemas and `@apokorg/adapter-mock` data, so the UI runs without the server (`pnpm --filter @apokorg/ui dev:mock`). SV is built in parallel.
- Screens:
  1. **Basket builder:**
     - Type a query, see the results grouped by store, confirm or change the match (this pins it).
     - Quantity, "accept substitutes" switch (off by default), remove item.
     - Prompt to confirm when `needsConfirmation` is true.
     - Saved baskets: list, rename, delete.
  2. **Comparison table:**
     - Items as rows, stores as columns, showing price and unit price.
     - Cheapest cell highlighted; substitutes marked; out-of-stock greyed out.
     - Per-store status (timeout/error) in the column header.
  3. **Recommended split:**
     - Per store: items, subtotal, delivery option and fee, a "verified at checkout" badge when probe-verified, and the amount left to reach free shipping.
     - Grand total, best single store and savings.
     - Controls: max stores, delivery preference, "verify shipping at checkout" (runs optimize with `probe: true`, which is slow and needs a spinner).
  4. **Settings:**
     - Enabled stores, memberships, postcode (default 11738), probe email (suggest a plus-address), probe on/off.
     - Claude API key (password field).
     - Shipping rules: view and edit, with a warning when `lastVerified` is more than 90 days old.
- Swedish number and currency formatting (`Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' })`). Keyboard-friendly. Works from 1024 px wide.
- UI text in English for now, with all strings in one module so Swedish can be added later.

## Acceptance criteria

- Vitest + Testing Library tests against MSW:
  - add an item and confirm a match
  - the comparison table renders the cheapest highlight
  - the split panel totals equal the sum of the store subtotals plus shipping
- `pnpm --filter @apokorg/ui build` succeeds with output in `apps/ui/dist` (the desktop shell loads it).

## Test commands

`pnpm --filter @apokorg/ui test` · `pnpm --filter @apokorg/ui dev:mock`
