# Apotek Hjärtat (`hjartat`)

- Base URL: https://www.apotekhjartat.se
- Category: pharmacy
- Search strategy: search-page
- Checked: 2026-10-21

## Search

- `GET https://www.apotekhjartat.se/search?q=<query>` (plain browser user agent, no cookies or headers needed). Server-rendered by Avensia Scope; the results come from Voyado Elevate, proxied on the server.
- robots.txt only disallows `/kassa`, `/klubb-hjartat/mina-ordrar`, `/klubb-hjartat/externa-kort` and `/order`. Search and product pages are allowed.
- All state is in an inline script:

  ```js
  window.INITIAL_DATA = JSON.parse('{"page":{...},"dynamicData":{...}}' + '...');
  ```

  It is a JSON document inside a single-quoted JS string with `\'` and `\\` escapes, split with `' + '` around `<!--` (embedded tag manager snippets). adapter-kit's `extractWindowJson` expects a bare object literal and cannot read this, so the adapter decodes the string literal itself (`src/initial-data.ts`) and falls back to `extractWindowJson`.

- `page.products[]` holds every hit in one response (no paging seen: `pagination.pageCount` is 1, 92 hits for "la roche posay", 145 for "atorvastatin"). The page is 0.3-1.1 MB; a search takes about 0.6 s.
- `page.pagination.total` is 0 and `products` is `[]` when nothing matches.
- Each hit is an `Excite.ContentApi.ApiModels.ProductPageApiModel`, the same model the product page uses. Fields used:

  | Field                                                   | Use                                                                                     |
  | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
  | `productName`                                           | title; size and pack count parsed from it (`size` field, e.g. "30 ml", is the fallback) |
  | `variant.sku` / `sku`                                   | `merchantProductId` (`productNumber` is a separate internal number)                     |
  | `url`, `metaInfo.canonicalUrl`                          | canonical product URL                                                                   |
  | `price.current.inclVat`                                 | web price (the campaign price when a campaign runs, see below)                          |
  | `price.lowestHistoricPrice.inclVat` + `showRedPrice`    | Omnibus "lowest price last 30 days", shown struck through → `originalPrice`             |
  | `priceSubtitle`, `priceSubtitle2`                       | multi-buy text, e.g. "Styckpris vid köp av 2" / "Utan kampanj: 37 kr"                   |
  | `storePrice`                                            | in-store price; **ignored**                                                             |
  | `gtin` (= `trackingProductInformation.ean`)             | EAN, often GTIN-14 with a leading 0; `normalizeEan` strips it                           |
  | `variant.stockStatus`, `addToCartButtonIsActive`        | stock (see below)                                                                       |
  | `brands[0].title`                                       | brand                                                                                   |
  | `isBuyableWithoutPrescription`                          | `false` for prescription items (0 % VAT); these are dropped                             |
  | `images[0].url`                                         | image (assets.icanet.se)                                                                |
  | `primaryLabels[]`, `secondaryLabels[]`, `campaignLinks` | campaign badges ("Köp 2 få 30%", "25%", "Outlet"); not used                             |

- Stock statuses seen: `inStock`, `lowStock` (in stock), `outOfStock`, `temporarilyOutOfStock`, `soonInStock` (out of stock; the buy button is disabled). An offer is in stock when the status is `inStock`/`lowStock` and `addToCartButtonIsActive` is not `false`.
- `belongsToPrescriptionProductGroup` is `true` for plain OTC drugs such as Alvedon, so it must not be used to detect prescription items. `isBuyableWithoutPrescription` is the right flag.
- `/api/autocomplete?q=` returns the same product model as JSON (17 KB), but only the top 4 products. Not used: too few hits for matching.

## Product page

- Canonical URLs look like `/varumarken/<brand>/<slug>`. The same `window.INITIAL_DATA` script holds the product in `page` (same model as a search hit plus `variants`, `selectedVariant`, `jsonLd`, ingredients, dimensions and so on).
- There is also a JSON-LD `Product` with an `AggregateOffer`. For multi-buy campaigns it lists the single price (37.00) plus a second offer with `eligibleQuantity.minValue: 2` (51.80 for two). The adapter uses `INITIAL_DATA` and does not need it.
- A product that no longer exists returns HTTP 404; `getProduct` returns `null` then.

### Campaign prices

- Straight discount ("25%", "Outlet 30%"): `price.current` is the sale price, `showRedPrice: true`, `lowestHistoricPrice` is the struck-through price → `price` = current, `originalPrice` = lowestHistoricPrice.
- Multi-buy ("Köp 2 få 30%"): `price.current` is the **per-item price when buying 2** (25.90), `priceSubtitle` is "Styckpris vid köp av 2" and `priceSubtitle2` is "Utan kampanj: 37 kr". The adapter sets `price` to the single-item price (37, from `priceSubtitle2`, else `lowestHistoricPrice`) and leaves `originalPrice` unset. `ProductOffer` has no field for multi-buy deals, so that saving is lost.

### Member prices

- Klubb Hjärtat now runs as ICA Stammis. Logged out, the page model shows no per-item member price: no price field besides `current`/`lowestHistoricPrice`, and labels only carry an `isStammisBadge` flag (seen `true` on the "petClub" badge for pet products). Since the price is not explicit, `memberPrice` is never filled. If a Stammis-only campaign appears it would probably show as a label with `isStammisBadge: true` plus a red price; worth re-checking later.

## Shipping

Source: https://www.apotekhjartat.se/kundservice/frakt-leverans (checked 2026-10-21). Options shown in checkout depend on the cart and the postcode. Prescription orders always ship free (out of scope here).

| Option                                         | Fee   | Free from  |
| ---------------------------------------------- | ----- | ---------- |
| Hämta Express på apotek (within 2 h)           | 0 kr  | always     |
| Leverans till apotek (pickup)                  | 0 kr  | always     |
| Instabox paketskåp                             | 29 kr | 299 kr     |
| PostNord ombud or parcel box                   | 29 kr | 299 kr     |
| PostNord varubrev (mailbox/door)               | 29 kr | 299 kr     |
| Early Bird (newspaper courier, 02-07)          | 29 kr | 299 kr     |
| Airmee home delivery (evening, 17-22)          | 49 kr | 299 kr     |
| Bring Express home, same day (Sthlm/Gbg/Malmö) | 49 kr | 399 kr     |
| PostNord home delivery                         | 59 kr | not stated |
| Gordon (refrigerated medicines)                | 29 kr | 299 kr     |

Differences from the plan: Airmee is free over 299 kr; PostNord home costs 59 kr with no free threshold on the page (the page does not say "smaller towns"); Early Bird and Gordon exist; Instabox and PostNord varubrev are 29 kr.

## Checkout test (probe feasibility)

Not yet tested – needs a manual browser check.

Steps for a manual check:

1. Open https://www.apotekhjartat.se in a normal browser, logged out.
2. Add one cheap non-prescription item (for example a 75 ml toothpaste) to the cart.
3. Open the cart and go to checkout (`/kassa`; note that robots.txt disallows `/kassa`).
4. See whether checkout continues as a guest or demands ICA/BankID login.
5. Enter postcode 11738 (and the probe email if asked) and see whether delivery options and their fees appear **before** any payment, personal-number or BankID step.
6. Stop there. Do not place the order. Empty the cart.
7. Record here: guest checkout yes/no, fees visible yes/no, the selectors used, and the verdict (probe supported/unsupported).

## Quirks

- `price.current` can be a multi-buy unit price; always check `priceSubtitle`.
- Prescription items show up in normal search results (with 0 % VAT prices); filter them with `isBuyableWithoutPrescription === false`.
- EANs in `gtin` are often 14 digits with a leading zero.
- Sponsored hits (`isSponsored: true`) are mixed into the results in store order; they are kept.
- Product titles are not uniform about spacing ("40ml" vs "40 ml", "100tabletter"); `parseSize`/`parsePackCount` cope with both.
- Fixtures are trimmed to the product fields by `src/fixtures.ts` and re-wrapped in the same `JSON.parse('...')` form; the recorder checks that parsing the trimmed page gives the same offers as the full page.
