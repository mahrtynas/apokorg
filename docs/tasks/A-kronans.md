# A-kronans – Kronans Apotek adapter

**Owns:** `packages/adapters/kronans`, `docs/stores/kronans.md` · **Depends on:** Batch 1 merged · **Batch:** 2
**Scaffold:** `pnpm new:adapter kronans "Kronans Apotek" https://www.kronansapotek.se pharmacy api`

Follow [the common adapter steps](_adapter-common.md).

## Known facts (research 2026-10-21, verify them)

- The site is built with Gatsby and searches from the browser through **Voyado Elevate**:
  - Request: `GET https://wbd81f9f3.api.esales.apptus.cloud/api/storefront/v3/queries/search-page`
  - Query parameters: `market=se`, `locale=sv-SE`, `touchpoint=desktop`, `customerKey=<uuid>`, `sessionKey=<uuid>`, `q=…`
  - No authentication needed.
  - Returns `sellingPrice` and `listPrice`. Product keys are varunummer.
- EAN: `gtin14` in product-page JSON-LD, shown as "EAN:" on the page. Normalize it with `normalizeEan`, which drops the leading 0 of a GTIN-14. If Elevate doesn't return an EAN, fetch the product page for the top results only.
- robots.txt disallows `/hitta-produkter/*` (the search page). The Elevate domain is not covered (decision 9c).
- **Shipping threshold unknown.** Find it, put it in `docs/stores/kronans.md`, and mention it in the PR so O's JSON can be updated.
- Elevate variant data includes a `prices[]` array; check whether it holds member prices.
