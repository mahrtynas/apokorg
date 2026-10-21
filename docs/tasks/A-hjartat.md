# A-hjartat – Apotek Hjärtat adapter

**Owns:** `packages/adapters/hjartat`, `docs/stores/hjartat.md` · **Depends on:** Phase 0 · **Batch:** 1
**Scaffold:** `pnpm new:adapter hjartat "Apotek Hjärtat" https://www.apotekhjartat.se pharmacy search-page`

Follow [the common adapter steps](_adapter-common.md).

## Known facts (research 2026-10-21, verify them)

- The platform is Avensia Scope (React, rendered on the server). The search page is `GET /search?q=…`; the full product JSON is in `window.INITIAL_DATA`, so use `extractWindowJson(html, 'INITIAL_DATA')`. Results come from Voyado Elevate, proxied on the server.
- There is also `/api/autocomplete`, which may be lighter. Evaluate it and use it if it carries price and EAN.
- Product data has `ean` and `gtin`. `storePrice` is the in-store price; ignore it and use the web price.
- robots.txt does **not** disallow search.
- Shipping (official page):
  - free over 299 kr; pickup in a pharmacy is always free
  - PostNord ombud/parcel box, Instabox and mailbox 29 kr
  - Airmee home 49 kr
  - Bring same-day 49 kr, free over 399 kr
  - PostNord home in smaller towns 59 kr
- Member prices: "Klubbpriser", with Klubb Hjärtat merging into ICA Stammis. Find out how member prices are encoded per item and fill in `memberPrice` when you can.
