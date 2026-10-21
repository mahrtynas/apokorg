# A-apotea – Apotea adapter

**Owns:** `packages/adapters/apotea`, `docs/stores/apotea.md` · **Depends on:** CI-x merged · **Batch:** 3
**Scaffold:** `pnpm new:adapter apotea "Apotea" https://www.apotea.se pharmacy catalog-index`

Follow [the common adapter steps](_adapter-common.md).

## Strategy

robots.txt disallows `/sok/*`, `/sok?` and sort parameters, so **don't use site search**:

- `search(q)` gets candidates from `searchCandidates('apotea', q)` (catalog-index), then calls `getProduct` on the top 5 for live data.
- Provide the sitemap config: the sitemap URL from robots.txt and a product URL filter.

## Known facts (research 2026-10-21, verify them)

- Server-rendered ASP.NET MVC. Product pages have JSON-LD Product with `gtin13`, and show "EAN:" on the page.
- JSON-LD `offers.shippingDetails.shippingRate` = 0 SEK. Apotea advertises "always free shipping"; check whether there is a minimum order and whether home delivery costs extra.
- Behind Cloudflare, but no challenge was seen.
- No member prices seen.
