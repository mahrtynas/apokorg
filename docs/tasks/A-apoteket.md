# A-apoteket – Apoteket adapter

**Owns:** `packages/adapters/apoteket`, `docs/stores/apoteket.md` · **Depends on:** Phase 0 · **Batch:** 1
**Scaffold:** `pnpm new:adapter apoteket "Apoteket" https://www.apoteket.se pharmacy api`

Follow [the common adapter steps](_adapter-common.md).

## Known facts (research 2026-10-21, verify them)

- Search is **Loop54**, called from the browser: `POST https://apoteket-se.54proxy.com/search`.
  - Headers: `Api-Version: V3`, `User-Id: <any stable uuid>`, `content-type: application/json`.
  - Body: `{"query":"…"}`.
  - No authentication needed.
  - The response includes `Ean`, `Price`, `CampaignPrice`, `InStorePrice` and `LowestPriceLast30Days`. Use the web price or campaign price; ignore `InStorePrice`.
- The site is Next.js App Router (no `__NEXT_DATA__`). Product pages carry `ean` in the RSC data payload, and their JSON-LD Product has no gtin. `getProduct` can re-query Loop54 by EAN or name rather than parsing the page.
- robots.txt disallows `/sok/*`. The Loop54 domain is not covered by it; we use the API anyway (decision 9c) at personal-use rates.
- Shipping: free standard delivery over 300 kr, free to an apoteksombud, other fees shown in checkout.
- There is a customer club, but no member price field was seen in the search data.

## Extra acceptance

- Prescription items are filtered out if the API flags them (check the response for a prescription marker).
