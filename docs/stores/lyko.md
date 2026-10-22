# Lyko (`lyko`)

- Base URL: https://lyko.com/sv
- Category: beauty
- Search strategy: search-page
- Checked: 2026-10-22

## Search

- `GET https://lyko.com/sv/sok?q=<query>` (plain browser user agent, no cookies or headers needed). Server-rendered by Avensia Scope, like Apotek Hjärtat.
- robots.txt only disallows `/*.htm$` and `/resolvedynamicdata/*`. Search, category and product pages are allowed.
- All state is a plain object literal in an inline script, read with `extractWindowJson(html, 'CURRENT_PAGE')`:

  ```js
  window.CURRENT_PAGE = {"products":{"products":[...],"facets":[...],"totalProductCount":3154,...},...};
  ```

  (`window.APP_SHELL_DATA` holds menus and translations; not used.)

- `products.products[]` holds the first 24 hits (`countPerPage: 24`); `totalProductCount` is the total. We only read the first page. A search takes 0.5-1.1 s, and the page is 0.25-0.6 MB.
- **Keyword redirects:** some queries redirect (302) to a category or brand page, e.g. `parfym` → `/sv/parfym?fromsearch=parfym`. That page (`CategoryViewModel`) has the same `products.products[]` shape, so `fetch` follows the redirect and the same parser works.
- **No results:** the engine fuzzy-matches letters, so a nonsense word like `xyzzyqqnotaproduct` still returns 24 loosely related items (Xlash, XL, Zadig…). Only a query with nothing to match, such as `9999999999`, gives `totalProductCount: 0` and `products: []`. Relevance filtering is left to the matcher.
- Sponsored hits (`isAd: true`, Martailer retail media) come first and are kept in store order.
- Each hit is an `Avensia.Common.Features.Product.Commerce.ViewModels.VariantViewModel`: one variant (size or shade), each with **its own URL**. Fields used:

  | Field                                | Use                                                           |
  | ------------------------------------ | ------------------------------------------------------------- |
  | `code` (e.g. `1737-105-0250`)        | `merchantProductId` (the article number shown on the page)    |
  | `displayName`                        | title; size and pack count parsed from it                     |
  | `size` + `unit` (`250`, `"ml"`)      | size fallback when the title has none (often null for shades) |
  | `brandName`                          | brand                                                         |
  | `url` (product page: `canonicalUrl`) | canonical product URL (relative, `/sv/<brand>/<slug>`)        |
  | `price.*`                            | see "Prices" below                                            |
  | `onlineStatus.interactionType`       | `buy` = in stock; `monitor` = "Bevaka" (out of stock)         |
  | `images[0].url`                      | image (`/globalassets/product-images/...`)                    |
  | `isDigital`, `isCharity`             | gift cards and donations; dropped                             |
  | `offerPlate`                         | badge ("Kampanj 43%", "Combo Deal 25%", "WOW-pris"); not used |

- **Search hits have no EAN.** Only the product page has it.

## Product page

- Canonical URLs look like `/sv/<brand>/<slug>`; every variant has its own slug. `window.CURRENT_PAGE` is the variant itself (same model as a search hit) plus `ean`, `variants[]` (sibling sizes/shades with their URLs), `linkingData` (JSON-LD), `priceDebug`, `campaignExplanationText`, ingredients and so on.
- EAN: `ean` in the page model (e.g. `"810177860303"` for Olaplex No.4, a 12-digit UPC-A; `normalizeEan` accepts it). The JSON-LD `Product` (`linkingData`, also emitted as `application/ld+json`) has `sku`, `offers.price` and `offers.availability` but **no `gtin13`** in the pages checked, contrary to the original research note.
- A product page fetched from a search hit's URL gives the same `code` and price.
- Missing products: a 404/410 makes `getProduct` return `null`; a redirect to a non-product page parses to `null` too.

### Prices

`price` in the page model:

```json
{
  "current": 34.425,
  "comparisonPrices": [{ "type": "withoutCampaign", "typeText": "Utan Combo Deal", "value": 45.9 }],
  "isMemberPrice": false,
  "isComboDealPrice": true,
  "campaignPriceValidUntil": { "validUntil": "2026-11-01T23:00:00Z" },
  "memberPrice": null,
  "memberPriceValidUntil": null,
  "vatRate": 25.0
}
```

- **Plain price:** `current`. Prices are SEK incl. VAT and can have decimals (`201.9`).
- `comparisonPrices[].type` seen:
  - `recommended` ("Rek. pris"): the supplier's list price. It is not a campaign, so it is **ignored** (most items have it).
  - `ordinary` ("Tid. pris"): straight campaign → `price` = `current`, `originalPrice` = this value; `priceValidUntil` comes from `campaignPriceValidUntil.validUntil` when set (often `null` with `isQuantityLimited: true`). Lyko stores the end as the next local midnight in UTC (`2026-11-01T23:00:00Z`), which the adapter turns into the last day `2026-11-01`.
  - `withoutCampaign` ("Utan Combo Deal"): a **Combo Deal** (`isComboDealPrice: true`, badge "Combo Deal 25%"). `current` is the discounted price, valid only together with other products. The product page explains it, e.g. "Priset gäller när du handlar 2 valfria produkter för totalt 490 kr." It is not a per-item price or a simple "N for X" deal, so `price` = the `withoutCampaign` value and `multiBuy` stays unset.
  - `packageContentSum` ("Utan paketpris:"): bundles; the sum of the parts. Ignored.
  - `worth` ("Värde"): gift-with-purchase value. Ignored.
- `priceDebug` (product pages only) exposes internals such as `localCostPrice`; not used.

### Member prices (Club Lyko)

- The model has explicit `memberPrice`, `isMemberPrice` and `memberPriceValidUntil`. The site's JS shows `price.memberPrice` as a separate "Medlemspris" next to the public price, and labels `current` itself as "Medlemspris" when `isMemberPrice` is true.
- The adapter sets `memberPrice` from `price.memberPrice` when it is lower than the public price. If `isMemberPrice` is true, `current` is taken as the member price and the public price comes from the `withoutCampaign`/`ordinary` comparison.
- **No live example was found** on 2026-10-22: `memberPrice` was `null` and `isMemberPrice` `false` on every hit for schampo, mascara, foundation, tandkräm and "club lyko" while logged out. The mapping is unit-tested on synthetic hits; re-check it when a Club Lyko campaign runs.

## Queue-it

- Every page loads the Queue-it client (`static.queue-it.net/script/queueclient.min.js`), so seeing "queue-it" in a page does not mean you are queued.
- When the waiting room is on, requests can be redirected to `*.queue-it.net` or get a queue page instead of the store. The adapter throws `QueueError` as soon as it sees the queue (it never waits in it) when the final response URL is on `queue-it.net`, or when the body has no `window.CURRENT_PAGE` and mentions Queue-it. The server then reports the store as failed for that search.
- The queue was not active during exploration, so `fixtures/queue-it.html` is a **hand-written** stand-in modelled on Queue-it's standard queue page. Replace it with a real recording if the queue is ever hit (don't wait in it).

## Shipping

Source: https://lyko.com/sv/info/kopvillkor ("Senast uppdaterad: 2025-02-04", checked 2026-10-22). The terms say "FRI FRAKT när du handlar för minst 300 kr", and you must actively pick a fee-free method in checkout. **"Avgift för respektive fraktsätt visas i kassan"**: no fees are published. Which options appear depends on the postcode, stock and order value.

| Option                    | Notes from the terms                                                                                                       | Fee        | Free from  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------- |
| Ekonomifrakt              | Lyko picks the carrier (mailbox via Early Bird/CityMail/PostNord, or nearest Instabox); "alltid gratis vid köp över 300kr" | not public | 300 kr     |
| Instabox                  | Parcel box at a chosen agent; all items must be in stock                                                                   | not public | not stated |
| Budbee                    | Home delivery 16-22                                                                                                        | not public | not stated |
| Budbee Box                | Parcel box; all items must be in stock                                                                                     | not public | not stated |
| PostNord                  | Chosen agent or parcel box                                                                                                 | not public | not stated |
| Hämtas i butik            | Instabox locker in a Lyko store, if one is near the postcode                                                               | not public | not stated |
| Expresshantering (add-on) | Faster warehouse handling, on top of the shipping fee; free for "Powerful Platinum" members                                | not public | -          |

- Product pages and the cart say "Fri frakt vid köp från 300 kr" / "Gratis fraktalternativ finns vid köp från 300 kr", and checkout shows "👋 280 kr kvar till fri frakt!" for a 20 kr cart.
- Before a delivery method is chosen, the checkout summary shows "Frakt 0 kr" and "Fakturaavgift 0 kr". That is not a real fee.

## Checkout test (probe feasibility)

Tried on: 2026-10-22, in Orca's embedded browser, logged out, cookie dialog answered with "Endast nödvändiga cookies".

1. Product page `/sv/aquafresh/aquafresh-triple-protection-100ml` (20 kr). The add-to-cart button is labelled "KÖP" (aria-label "Köp <product name>"). It only adds to the cart and opens no checkout, but a probe denylist that matches a bare "Köp" would block it.
2. The cart is a drawer: header button "Kundkorg" → dialog "KUNDKORG" with "TILL KASSAN".
3. "TILL KASSAN" opens `/sv/kassa` as a guest, with no login or BankID wall. The page shows the cart, a summary (Frakt 0 kr, Fakturaavgift 0 kr, Totalt), an opt-in "Bli medlem i Club Lyko" checkbox (left unchecked), and a **Qliro Checkout iframe**.
4. Inside the Qliro iframe, "Dina kontaktuppgifter" asks for **"Mejl eller mobil"** and **"Postnummer"**, then shows a "Fortsätt" button (plus an optional "Lägg till personnummer"). Delivery options and fees are **not visible** at this point.
5. I entered postcode 11738 alone and clicked "Fortsätt" once; nothing advanced without the email/mobile field. I stopped there: no email, phone, name or personnummer was entered (no probe email is configured, and an address entered here goes to Qliro). The postcode was cleared and the item removed with "Ta bort …", leaving "Din kundkorg är tom!".

- Guest checkout possible without login/BankID? **Yes**, up to Qliro's contact step.
- Shipping options and fees visible before payment? **Not before** an email or mobile number plus postcode are submitted with "Fortsätt" **inside the Qliro payment iframe**. They are probably shown after that step, but this was not confirmed.
- Verdict: **likely probe-unsupported** under the current guard, which should refuse submitting a payment-provider iframe. Shipping fees come from the public terms (free over 300 kr) until someone checks manually with a real email.

## Quirks

- `price.current` can be a conditional Combo Deal price; always check `isComboDealPrice`.
- `recommended` ("Rek. pris") is on most items and is not a discount.
- Titles occasionally carry Lyko data errors, e.g. "Nõberu … Shampoo … 250 st" for a 250 ml bottle (`unit: "st"`), which yields a per-piece unit price. We keep what the store shows.
- Prices like `34.425` (Combo Deal) and `96.75` show up; the adapter rounds to öre.
- Fixtures are trimmed to the product fields by `src/fixtures.ts` and re-wrapped as `window.CURRENT_PAGE = {...};`. The recorder checks that parsing the trimmed page gives the same offers as the full page.
