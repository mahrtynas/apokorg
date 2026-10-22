# Kronans Apotek (`kronans`)

- Base URL: https://www.kronansapotek.se
- Category: pharmacy
- Search strategy: api (Voyado Elevate)
- Checked: 2026-10-22

## Search

The site is a Gatsby build. Its search box calls Voyado Elevate (formerly Apptus eSales) from the browser, and we call the same endpoint.

```http
GET https://wbd81f9f3.api.esales.apptus.cloud/api/storefront/v3/queries/search-page
    ?market=se&locale=sv-SE&touchpoint=desktop
    &customerKey=<uuid>&sessionKey=<uuid>
    &q=alvedon&limit=20
    &presentCustom=ean|rX|itemType|subTitle|promotionRibbon|promotionPrice|hasPromotion|basePrice|minPriceMonth
```

- No authentication, cookies, Origin or Referer are needed. `customerKey` and `sessionKey` can be any UUIDs; the adapter sends two fixed ones.
- `limit` sets the page size. Without it the API returns about 30. The adapter asks for `max(2 × limit, 20)`, capped at 60, because prescription items are dropped afterwards.
- **`presentCustom`** (pipe-separated) is required to get the EAN, prescription flag and subtitle. Without it, `custom` is empty and titles are only "Alvedon 500 mg". The site itself asks for `ean, nplID, itemType, rX, subTitle, descriptiveName, productNumber, promotionRibbon, promotionPrice, hasPromotion, substance, marketingSensitive, sustainabilityBadges, newProduct, basePrice, minPriceMonth, rating, productCategory` (from `app-*.js`, `getSearchResult`).
- The response is fast (about 100 ms) and about 2 KB per product. Shape: `{ q, didYouMean, primaryList: { totalHits, productGroups: [{ key, products: [...] }], facets, sort }, contentLists, secondaryList, relatedSearches }`. Each group has held one product in every response seen.
- A query with no hits returns HTTP 200 with `totalHits: 0, productGroups: []`.
- robots.txt disallows `/hitta-produkter/*` (the search page), `/kassa/`, `/recept` and a few others on www.kronansapotek.se. The Elevate host is not covered by it, so we use the API (decision 9c) at personal-use rates through `politeFetch`.
- Elevate also has `product-page`, `autocomplete` and `landing-page` queries, which the adapter does not use.

### Fields used

| Field                                   | Meaning / use                                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `key`                                   | Varunummer (`097610`, `01301771`, sometimes `I0023882`), also in the product URL `/<slug>/p/<key>/`. → `merchantProductId`                                         |
| `title`, `custom.subTitle`              | Name ("Alvedon 500 mg") and form/pack ("Paracetamol, Filmdragerad tablett, 20 styck"). Joined with a space they equal the product page's JSON-LD `name`. → `title` |
| `brand`                                 | Brand.                                                                                                                                                             |
| `link`                                  | Relative product path, canonical (matches JSON-LD `url`). The slug matters: the wrong slug is a 404.                                                               |
| `imageInfo.thumbnail`                   | Absolute image URL.                                                                                                                                                |
| `sellingPrice.min`                      | Current web price incl. VAT, campaign included. → `price`                                                                                                          |
| `listPrice.min`                         | Regular web price. Below `sellingPrice` it means a campaign is on.                                                                                                 |
| `custom.minPriceMonth`                  | Lowest price of the last 30 days. During a campaign the site shows it as "Tidigare pris". → `originalPrice` (falling back to `listPrice`)                          |
| `custom.basePrice`                      | Price in physical pharmacies ("I apotek: 52 kr"). **Ignored.**                                                                                                     |
| `custom.promotionRibbon`                | Badge text: "25%", "30%", "Bra deal", "2 för 40:-", "Köp 2 få 30%", "3 för 2". Multi-buy ribbons → `multiBuy`.                                                     |
| `custom.promotionPrice`, `hasPromotion` | "Ja"/"Nej" and the campaign price (same as `sellingPrice`). Kept in fixtures, not used.                                                                            |
| `custom.ean`                            | EAN-13 (sometimes 8 digits). Validated with `normalizeEan`.                                                                                                        |
| `custom.rX`, `custom.itemType`          | `rX` "Ja"/"Nej"; `itemType` `RX` (prescription), `EX` (OTC medicine), `HR` (other goods). Prescription items are **filtered out**.                                 |
| `inStock`                               | Buyable online (`variants[].availability[{channel: "ONLINE", stockNumber}]`, 0 = out of stock).                                                                    |

### Price mapping

- No campaign (`sellingPrice ≥ listPrice`): `price = sellingPrice`. `minPriceMonth` is ignored, even when it is higher than the price.
- Campaign: `price = sellingPrice`, `originalPrice = minPriceMonth` when it is above the price, else `listPrice`. Example: Sensodyne Repair and Protect has selling 34.93, list 49.9 and minPriceMonth 50; both the search card and the product page show "Tidigare pris: 50 kr".
- Multi-buy ribbons: "2 för 40:-" → `multiBuy { qty: 2, unitPrice: 20 }`; "Köp 2 få 30%" → `{ qty: 2, unitPrice: 0.7 × price }`. "3 för 2" is not parsed yet (it is a mix-and-match deal across products). The selling price is the single-item price for these.
- **Member prices: none.** `variants[].prices[]` was empty for every product in every query tried (alvedon, tandkräm, la roche-posay, idun minerals, solskydd, schampo, vitaminer). The customer club ("Klubb Kronans Apotek") gives bonus points (1 point per krona, 20 kr per 1000 points) and personal offers, not shelf member prices. A site-wide club code ("Klubbdagar! Kod: KLUBBOKT26") shows in the header at times; it is a discount code, not a price, and is ignored.
- The search response has no campaign end date. Product pages do (see below).

## Product page

Gatsby static HTML, about 220 KB. There is no `page-data.json` for product pages (404) and no data global, so `getProduct` reads JSON-LD plus a few HTML fragments.

- **JSON-LD** (`<script type="application/ld+json" data-gatsby-head="true">`, an array of `Product` and `BreadcrumbList`): `name`, `sku` (varunummer), `gtin14` (e.g. `07046260976108`; `normalizeEan` drops the leading 0), `brand.name`, `image[]`, `url` (canonical), `offers`:
  - `price` is the current web price, campaign included.
  - During a campaign, `priceValidUntil` ("2026-10-25T00:00:00.000Z") and `priceSpecification[]` with `SalePrice` and `StrikethroughPrice` (the 30-day lowest price, same as `minPriceMonth`). → `priceValidUntil`, `originalPrice`
  - `availability`: `https://schema.org/InStock` or `OutOfStock` ("Tillfälligt slut online").
- **Title**: `<h1 id="product-content-title">` (name) and the `<h2>` right after it (subtitle), the same split as search.
- **Multi-buy badge**: `<div aria-label="2 för 40:- Rabatt på <full name>">`. Related products further down have badges too, so the parser only takes the one whose name matches JSON-LD `name`.
- **Prescription pages** are public and show a price, but say "Du behöver ett recept för att kunna köpa denna vara…" and "Pris med recept". The parser returns `null` for them.
- Also on the page but not used: "EAN: 07046260976108" text, "Jämförpris 1,70 kr/styck", "I apotek: 52 kr" (`data-testid="in-store-price"`), "Köp båda för" bundles (`data-testid="bundle-price"`).
- For the same product without a campaign, `parseProduct` and `parseSearch` give identical offers (covered by a test). With a campaign, the page adds `priceValidUntil`.

### EAN

Elevate returns the EAN for nearly everything when `presentCustom` includes `ean`. If an offer still has none, `search` fetches the product page for at most the first 3 such offers (1 s apart per `politeFetch`) and takes `gtin14` from JSON-LD.

## Shipping

Sources: the checkout test below (2026-10-22), https://www.kronansapotek.se/kundservice/leveranssatt/ and https://www.kronansapotek.se/kundservice/vanliga-fragor/.

- **Free shipping from 299 kr** on every paid option ("Fri frakt från 299 kr eller vid receptköp" under each option in checkout; the cart drawer said "Handla för 275 kr till för att få fri frakt" with 24 kr in the cart). The FAQ says "vid köp över 299 kr finns flera leveransalternativ som är fraktfria i stora delar av Sverige".
- Fees for postcode 11738 with a 24 kr order:

| Option                  | Fee   | Kind         | Notes                                                   |
| ----------------------- | ----- | ------------ | ------------------------------------------------------- |
| Hämta Express på apotek | 0 kr  | store pickup | Ready about 2 h after ordering, at a Kronans pharmacy   |
| Leverans till apotek    | 0 kr  | store pickup | Shipped from the warehouse to a chosen Kronans pharmacy |
| Instabox paketskåp      | 19 kr | locker       | Default choice; free from 299 kr                        |
| PostNord brevlåda       | 19 kr | mailbox      | Free from 299 kr                                        |
| PostNord paketbox       | 19 kr | locker       | Free from 299 kr                                        |
| PostNord ombud          | 19 kr | pickup point | Free from 299 kr                                        |
| Budbee hemleverans      | 39 kr | home         | Evenings 16–22.30; free from 299 kr                     |

- Prescription orders ship free with every method.
- The cart drawer shows "Frakt: 19 kr" before checkout, so 19 kr is the cheapest paid fee.
- Gordon (chilled home delivery) exists for cold medicines only.
- Options can be restricted by the cart contents and postcode ("det kommer alltid att finnas ett tillgängligt leveransalternativ").

This differs from `packages/optimizer/shipping/kronans.json` (owned by task O), which has guessed fees of PostNord ombud 49 kr and home 79 kr with no threshold. See the PR description.

## Checkout test (probe feasibility)

```
Tried on: 2026-10-22, Orca's embedded browser
- Guest checkout possible without login/BankID? yes. /kassa/ shows "Logga in med BankID" as optional;
  the delivery section works without it.
- Shipping options and fees visible before payment? yes, right after entering the postcode
  (step 2 of 3). Payment (Klarna/Kustom, step 3) is a separate iframe below; no email needed.
- Steps (selectors) to reach delivery options:
  1. Product page: click the add-to-cart button `[data-testid="<varunummer>-buy-button"]`
     (accessible name "Köp <product>, <price> kronor"). This is add-to-cart, not a purchase.
  2. Go to /kassa/ (or cart drawer → "Till kassan").
  3. Inside the iframe titled "Kassasektion med postnummerinmatning och leveransalternativ"
     (Ingrid delivery widget): textbox "Postnummer" → type 11738, then button "Fortsätt"
     (or Enter). A plain `fill` did not register; focus + typing did.
  4. Options appear in radiogroup "Leveransalternativ" in the same iframe, each radio named
     "Leveransalternativ <name>" with "<fee>kr med <carrier>". Three show at first; button
     "Visa alla" reveals the rest.
  5. Empty the cart: button "Ta bort <product>" on /kassa/. A synthetic click on the
     accessibility ref did not work; a DOM `button.click()` did. Afterwards /kassa/ says
     "Din varukorg är tom".
- Never touched: the Klarna/Kustom iframe ("Mejladress", "Postnummer", "Betala köp"),
  BankID login.
- Verdict: probe supported
```

## Checkout probe

`src/probe.ts`, exposed as `adapter.probe` (task P-kronans, 2026-10-22). It uses only the `GuardedPage`, and all selectors are in `SELECTORS` at the top of the file.

**robots.txt disallows `/kassa/`** (and `/order/`). The user approved probing `/kassa/` for personal use under these terms: one probe at a time, only when checkout-verified shipping is requested, and results cached for 24 h (`probeWithCache`). The probe never goes to `/order/`.

Steps:

1. For each item: open the product page, read the price from JSON-LD (for `orderValue`), and wait for the page's load event plus 2 s. A click on the server-rendered button before Gatsby hydrates the page does nothing.
2. If the Cookiebot dialog ("Samtycke") is open, decline it by button id (`#CybotCookiebotDialogBodyButtonDecline`). While it is open, it covers the buy button and the click times out. Then wait for the page to settle again.
3. Click `[data-testid="<varunummer>-buy-button"]` once per unit, 2 s apart. No cart drawer opens; only the header count ("1 Varukorg") changes. An add that didn't land shows up as an empty cart on `/kassa/`, and the failure message says so (`cartEmpty: true`).
4. Go to `/kassa/` and wait for the Ingrid iframe (`iframe[title*="leveransalternativ" i]`). Selectors step into it with `internal:control=enter-frame`.
5. Fill the textbox "Postnummer" with the request's postcode and click "Fortsätt". A Playwright `fill` registers here. No email is asked for, because the email field belongs to the payment iframe, which the probe never touches.
6. Wait for the radiogroup "Leveransalternativ", and click "Visa alla" if it is there.
7. For each radio, take its row (the nearest ancestor containing "kr") and read the row's text elements one by one (`parseOptionParts`). The row's text content runs together: a hidden screen-reader prefix ("Leveransalternativ", or "Vald leveransalternativ" on the selected option), the name, the delivery time and the fee, e.g. `Vald leveransalternativInstabox paketskåpLevereras imorgon runt 20:0019kr med Instabox`. Read as one string, "20:00" and "19kr" merge. So the name is the first visible text without the prefix, and the fee comes only from a text that starts with an amount ("19kr med Instabox", "0kr", "Gratis"). `kind` comes from the name (`deliveryKind`: apotek → store-pickup, brevlåda → mailbox, skåp/box → parcel-box, hem/Budbee → home, otherwise pickup-point).
8. "Fri frakt från 299 kr eller vid receptköp" is stated once in the widget, not per row. It becomes `freeFrom` on every option with a fee.
9. In `finally`, empty the cart: reload `/kassa/`, click "Ta bort …" until no row is left, and require "Din varukorg är tom". A Playwright click on "Ta bort" works here (the earlier embedded-browser test needed a DOM click). If the cart can't be emptied, the probe fails with `layout-changed`.

Failure messages for a missing widget, a missing or covered buy button, and an unreadable row include the page's path, title, heading, iframes, visible consent buttons and the start of its text.

### Live run (2026-10-22)

`pnpm --filter @apokorg/adapter-kronans probe:live`: one Kronans Apotek Tandkräm Frisk Mint (24 kr), postcode 11738, headless Edge, about 26 s. Status `ok`, and the cart was emptied ("Din varukorg är tom"). No order was placed: the probe never reached the payment iframe or `/order/`.

| Option                  | Kind         | Fee   | freeFrom |
| ----------------------- | ------------ | ----- | -------- |
| Hämta Express på apotek | store-pickup | 0 kr  |          |
| Instabox paketskåp      | parcel-box   | 19 kr | 299      |
| Postnord brevlåda       | mailbox      | 19 kr | 299      |
| Budbee hemleverans      | home         | 39 kr | 299      |
| Postnord paketbox       | parcel-box   | 19 kr | 299      |
| Postnord ombud          | pickup-point | 19 kr | 299      |
| Leverans till apotek    | store-pickup | 0 kr  |          |

This matches the fees in "Shipping" above. The widget now spells it "Postnord", and it lists Hämta Express first.

Limitations:

- The guard's denylist matches the start of words, so an add-to-cart button named "Köp Nu…" (e.g. Nurofen, Nutrilett) or a product URL with "pay…" is refused. The probe then fails as `forbidden-action`. Use another item for those stores' probes; the guard is deliberately not weakened.
- The offline fixtures (`fixtures/probe/`) are rebuilt by hand, not saved from the live DOM. They follow what the live runs showed: the texts and order of the options, the hidden prefix, the delivery time before the fee, the threshold once per widget and the Cookiebot dialog. The exact markup inside the Ingrid iframe is still an approximation.

## Quirks

- `presentCustom` must be sent, or there is no EAN, prescription flag or subtitle.
- Subtitles spell units out ("100 milliliter", "1 000 milliliter" with a no-break space, "1 x 51 gram"). The adapter rewrites them to short units before `parseSize`, and reads "3 x 30 styck" as 90.
- Titles sometimes contain double spaces ("Parodontax Complete Protection…") or repeat words ("…Tandkräm Tandkräm 75 ml"); `cleanText` collapses spaces, and repeats are left as the site has them.
- Campaign prices change often (the campaign seen ends Sunday 2026-10-25, `priceValidUntil`). Fixtures were recorded 2026-10-22.
- Fixtures are trimmed by `src/trim.ts`: search responses lose tickets, facets and image lists; product pages keep the JSON-LD, the title headings, campaign badges and the prescription notice.
