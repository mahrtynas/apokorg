# O – Optimizer and shipping rules

**Owns:** `packages/optimizer` (including `packages/optimizer/shipping/*.json`) · **Depends on:** Phase 0 · **Batch:** 1

## Goal

Find the cheapest assignment of basket items to stores, including each store's delivery fee and free-shipping threshold.

## Scope

- `optimize(candidates: ItemCandidates[], policies: ShippingPolicy[], options: OptimizeOptions, overrides?: ProbeResult[])` → `SplitResult`.
- An integer program solved with HiGHS (`highs` npm package, wasm). Variables:
  - binary `x[item,offer]`: which offer supplies each item
  - binary `use[store]`
  - binary `opt[store,deliveryOption]`
  - fee linearization for `freeFrom` thresholds: the fee is paid unless the store's subtotal ≥ freeFrom (big-M)
  - `minOrder` constraints for options that require a minimum order
- Each item is assigned exactly once, or listed in `unavailableItemIds` if it has no allowed offer.
- Offers: out of stock → excluded. `substitute` → only when the item's `acceptSubstitutes` is true. `memberPrice` is used when the store is in `options.memberOf`.
- `delivery: 'home-only'` restricts the options to `kind: 'home'`.
- `maxMerchants` and `excludedMerchants` constraints.
- Also compute the best single-store total (cheapest store that can supply every item) and `savingsVsBestSingle`.
- `overrides` (probe results) replace a store's JSON options for the probed order value.
- **Shipping JSON files** for the 7 v1 stores (`apotea, hjartat, apoteket, doz, kronans, gymgrossisten, lyko`), validated by `ShippingPolicy` in a test. Start from the research in [docs/plan.md](../plan.md) ("Research findings"). Mark unknown fees with a `notes` field and a conservative guess, and set `lastVerified` to the date you checked. Add `loadShippingPolicies()` and `isStale(policy, today)` (older than 90 days).

## Acceptance criteria

Hand-computed tests, each one documented in a comment:

- A threshold tips the split: moving a cheap item to store A makes A's shipping free, so the total drops.
- With `maxMerchants: 1`, the result equals the best single-store total.
- An item missing from all stores is listed in `unavailableItemIds`, and the rest still solve.
- `home-only` changes the chosen options.
- A probe override with a higher fee moves items elsewhere.
- Out-of-stock and disallowed substitutes are never chosen.

Performance: 30 items × 11 stores solves in under 200 ms.

## Test commands

`pnpm --filter @apokorg/optimizer test`
