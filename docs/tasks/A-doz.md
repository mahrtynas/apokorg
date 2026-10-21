# A-doz – DOZ Apotek adapter

**Owns:** `packages/adapters/doz`, `docs/stores/doz.md` · **Depends on:** CI-x merged · **Batch:** 3
**Scaffold:** `pnpm new:adapter doz "DOZ Apotek" https://www.dozapotek.se pharmacy catalog-index`

Follow [the common adapter steps](_adapter-common.md).

## Strategy

robots.txt disallows `/catalogsearch/`. Use catalog-index candidates, then product pages. The Magento suggest endpoint `GET /search/ajax/suggest/?q=` is outside the disallowed path but is still search; **don't use it** (decision 9c applies only to the Apoteket and Kronans APIs).

## Known facts (research 2026-10-21, verify them)

- Magento 2 (Hyvä) with Smile ElasticSuite.
- **No GTIN in JSON-LD**: `sku` is the Nordic varunummer. The EAN usually appears in **image filenames**, e.g. `7046264457757_1.jpg`. Take the leading 13 digits and accept them only if `normalizeEan` validates them (decision 10). Otherwise leave `ean` empty, and the matcher falls back to names.
- Free shipping options from 199 kr for non-prescription items. Fees for each delivery method are unknown.
- Voyado loyalty program; no member price field seen.
