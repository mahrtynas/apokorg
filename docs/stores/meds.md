# MEDS (`meds`)

- Base URL: https://www.meds.se
- Category: pharmacy
- Search strategy: catalog-index
- Checked: 2026-10-22

## Search

robots.txt (`User-agent: *`):

```
Disallow: /sok/
Disallow: /error/
Disallow: /kvitto/
Sitemap: https://www.meds.se/sitemap/
```

The site search lives under `/sok/`, so the adapter never calls it. Instead:

1. `refreshCatalog('meds', CATALOG_SOURCES.meds)` (catalog-index, run by the server) reads the sitemap index `https://www.meds.se/sitemap/`. It lists `/sitemap/1` to `/sitemap/9`: plain XML, no extension, not gzipped, 10 000 URLs (~2–3 MB) each and about 87 000 in all. Every child mixes products with other pages, so all nine are read (no `sitemapFilter`). A full live refresh took 13.2 s (10 requests at 1 per second) and indexed 80 826 products.
2. `search(q)` calls `searchCandidates('meds', q, min(limit, 5))` and fetches those product pages **sequentially** through `politeFetch`. Prescription medicines and products that 404 (removed since the last refresh) are skipped, so a search can return fewer than 5 offers. When the index has no MEDS rows, `search` returns `[]` without fetching anything.

URL shapes in the sitemaps (checked against all 86 955 URLs):

| Shape                          | Example                                                                        | Count  | Indexed?                                     |
| ------------------------------ | ------------------------------------------------------------------------------ | ------ | -------------------------------------------- |
| One segment, no trailing slash | `/alvedon-filmdragerad-tablett-500-mg-20-st`                                   | 81 538 | yes (products)                               |
| Trailing slash                 | `/alvedon/`, `/feber-vark/huvudvark/`, `/kampanjer/…/`, `/apotek/uppsala/`     | 3 549  | no (brand, category, campaign and CMS pages) |
| `/<manufacturer>/<name>-<ean>` | `/orifarm-generics-a-s/diazepam-orifarm-10-mg-100-styck-tablett-5711313001589` | 1 868  | no (prescription medicines, BankID only)     |
| `/frakt-*`                     | `/frakt-budbee-hemleverans`, `/frakt-dhl`                                      | 11     | no (internal shipping items, "OutOfStock")   |

Some one-segment prescription slugs end in the EAN (`/inderal-10-mg-100-styck-filmdragerad-tablett-5056227206560`); `slugToTitle` drops that suffix. They are still indexed and skipped when the page is parsed. A few slugs have capitals (`/BABOR-lip-balm-1-styck`) or are very short (`/1-25`); they are kept.

Product cards on listing pages link through category paths (`/kampanjer/<slug>`), but the canonical URL is always the one-segment form, which is also what the sitemap lists.

Measured 2026-10-22: `search('alvedon 500 mg 20 st')` took 2.1 s for 3 candidates. Pages are ~80 KB and answer in ~0.15 s, so 5 candidates stay around 5 s.

## Product page

Server-rendered ASP.NET Core behind Cloudflare (`cf-cache-status: DYNAMIC`, no challenge seen with the default `politeFetch` user agent). `getProduct` reads:

- **JSON-LD** `Product`: `name`, `sku` (article id, e.g. `97610`) → `merchantProductId`, `identifier` (the EAN, not `gtin13`) → `ean`, `brand.name`, `image[]`, `url` (canonical), `offers.price` (a string like `"36.00"`), `offers.availability`.
- **Price box** `<div class="stock-price">`:
  - `<span>Finns i lager</span>` with `icon-stock-instock`; microdata `<link itemprop="availability" href="https://schema.org/InStock">` → `inStock` (falls back to JSON-LD).
  - `<div class="price">36 kr*</div>` normally, `<div class="active-price">46 kr</div>` during a campaign. Same value as `offers.price`.
  - Campaign: `<div class="inactive-price" …><span>Tid. lägsta pris 57 kr</span>`, the lowest price of the last 30 days before the cut (Omnibus) → `originalPrice`.
  - **Combo deals**: `<div class="combo-price-terms"><em>Gäller vid köp av 2+ varor för minst 699 kr totalt</em>` followed by `<div class="inactive-price"><span>Utan kampanj 26 kr</span>`. Here JSON-LD `offers.price` holds the _combo_ price (23.40), which only applies to a basket of 2+ combo items worth 699 kr or more. `parseProduct` uses the "Utan kampanj" price as `price` and sets no `originalPrice`. The basket condition can't be expressed as `multiBuy`.
  - "Kampanj slutar 2026-10-25" is rendered client-side only, so `priceValidUntil` is not set.
- **Produktfakta** (`<details>` → `<div class="info"><div class="title">…</div><div class="text">…</div>`, hex entities like `F&#xF6;rpackningsstorlek`): `EAN` (fallback for `ean`), `Förpackningsstorlek` ("20 styck", "40 ml", "55 g") → `size`/`packCount`, falling back to the title, `Varumärke`, `Kategori`, `Bäst före`.
- `window.EasyfyEventLayer` (analytics) repeats id, EAN, price incl./excl. VAT, `CampaignCode` and `Categories`. It is not used.

Prescription medicines show a price (excl. VAT) but can only be bought after BankID login. They are detected by the Kategori fact linking to `/receptbelagt/`, the `rx-availability-warning` note, or the "Logga in och köp via ditt recept" button (`href="/mina-recept/"`), and `parseProduct` returns `null` for them.

**Member prices:** none. MEDS shows no member price. Badges like "Deal!", "Bra Köp!", "3 för 2" and "Combo Deal 10%" appear on cards; "3 för 2" is not modelled (the page shows no per-item multi-buy price).

## Shipping

Sources, checked 2026-10-22: https://www.meds.se/leverans/, https://www.meds.se/faq/frakt-leverans/, https://www.meds.se/kopvillkor/, the checkout.

- **No fees or free-shipping threshold are published.** FAQ "Vad kostar frakten?": "Fraktkostnaden avgörs av vilket leveranssätt du väljer och hur mycket du handlar för … Du kan även se i kassan hur mycket du behöver handla för för att uppnå fraktfritt." The köpvillkor say "Vissa alternativ kan innebära en fraktavgift som i sådant fall anges tydligt vid beställning". The site footer says "Smidigt, säkert och fraktfritt".
- Prescription orders: "Alltid Fri Frakt när du hämtar ut receptbelagda läkemedel" (checkout dialog).
- Options listed on /leverans/: Budbee home (16.00–22.30), CityMail mailbox (daytime), Early Bird morning mailbox (02.00–07.00), PostNord mailbox (varubrev), PostNord home, PostNord ombud, DHL ombud, Instabox, Gordon Delivery (chilled medicines only, Stockholm-area evenings), and Airmee (in the FAQ). Which options appear depends on the postcode and the cart.
- Internal `/frakt-*` item pages carry prices in JSON-LD (Budbee 39.00, the others 0.00, all OutOfStock). That is weak evidence about real fees.
- Uncollected or returned parcels cost 49 kr; returns cost 49 kr.

`packages/optimizer/shipping/meds.json` (new in this task) models PostNord ombud, DHL ombud, Instabox and PostNord brevlåda at 39 kr, free from 299 kr, and Budbee home at 39 kr. **All fees and the threshold are guesses**, explained in its `notes`. The real numbers need a checkout run with a phone number, which the probe rules forbid (below).

## Checkout test (probe feasibility)

```
Tried on: 2026-10-22 (Orca's embedded browser)
- robots.txt does not disallow /kassa/.
- Added one non-prescription item (Decubal Restoring Lips & Dry Spots Balm 30 ml, 46 kr) with the
  product page "Köp" button (data-action="add-to-cart-with-disclaimer"; it adds to the cart, it
  doesn't order). Cookie banner: "Endast nödvändiga".
- /kassa/ opened as a guest with no login. A dialog "Behöver du hämta ut recept?" → "Vidare till
  kassan" closes it.
- Step 1 "Din varukorg" (cart, coupon, Summa) → button "Fortsätt till Leverans & Betalning"
  (data-action="continue-payment-details").
- Step 2 "Leverans & Betalning" is a Walley Checkout iframe (checkout.walleypay.com). Text: "Fyll i
  E-post och telefonnummer nedan samt tryck på 'Fortsätt' för att i nästa steg välja
  leveransalternativ." Fields: E-postadress [required], Mobiltelefonnummer [required], button
  "Fortsätt till leverans".
- Delivery options and fees only appear after email AND mobile number are entered inside the
  payment provider's iframe. The phone field is forbidden, and so is using the payment iframe, so I
  stopped there: nothing typed, no postcode field was reached.
- Cart emptied afterwards (row remove button, data-action="basketrow-remove"); header basket
  went back to "Varukorg" with no count.
- Guest checkout possible without login/BankID? yes, up to the Walley step
- Shipping options and fees visible before payment? no: they need a phone number in the Walley
  payment iframe
- Verdict: probe-unsupported
```

## Quirks

- Every response sets `ab_meds`, `_v`, `_vr` cookies; none are needed for product pages.
- The index stamps all nine children with the same generation time as `lastmod` (14:43 and then 15:13 on 2026-10-22), so incremental refreshes usually refetch all nine files.
- `/frakt-*` items exist as product pages; the catalog filter drops them.
- Listing pages are ~1 MB (server-rendered carousels); product pages are ~80 KB.
