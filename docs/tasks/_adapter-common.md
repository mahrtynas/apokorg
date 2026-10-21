# Common steps for every store adapter task

1. Scaffold: `pnpm new:adapter <id> "<Name>" <baseUrl> <category> <strategy>`, then `pnpm install`.
2. Explore the live site by hand: look at the search endpoint and a product page. Write what you find in `docs/stores/<id>.md`.
3. Implement `parseSearch` and `parseProduct` as **pure functions** over response bodies, and keep fetching thin. Use the adapter-kit helpers:
   - `politeFetch` / `fetchJson` / `fetchText`
   - `findJsonLd`, `extractWindowJson`
   - `parsePrice`, `parseSize`, `parsePackCount`, `normalizeEan`, `computeUnitPrice`
4. Record fixtures (`RECORD_FIXTURES=1 pnpm --filter @apokorg/adapter-<id> test:live`). Commit about 3 searches (a pharmacy item, a cosmetic, an item with no results) and 2 product pages. Trim very large HTML as long as the parsed result stays the same.
5. Unit tests on the fixtures: offers validate against `ProductOffer`, and price, EAN, stock and size are correct for known items. "No results" returns `[]`.
6. **Member prices:** fill in `memberPrice` only when the store exposes it explicitly. `price` is always the public price.
7. **Checkout test (probe feasibility):** in a normal browser, add one cheap item to the cart and go to checkout as a guest. Enter postcode 11738 and see whether delivery options and fees appear **before** any payment or BankID step. Stop there: never place an order. Record the result in the "Checkout test" section of `docs/stores/<id>.md`.
8. Shipping: if your findings differ from `packages/optimizer/shipping/<id>.json`, note it in your PR description. That file belongs to O, so a follow-up PR updates it.
9. Run `pnpm test:live` once at the end and paste the `console.table` output into the PR.

**Acceptance for every adapter:**

- Fixture tests pass offline.
- `search()` returns within 8 s for a typical query.
- `getProduct()` works on a URL returned by `search()`.
- `docs/stores/<id>.md` is complete, including the checkout test.
