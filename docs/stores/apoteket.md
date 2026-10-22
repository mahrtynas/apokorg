# Apoteket (`apoteket`)

- Base URL: https://www.apoteket.se
- Category: pharmacy
- Search strategy: api (Loop54)
- Checked: 2026-10-21

## Search

The site's own search box calls Loop54 from the browser. We call the same endpoint.

```http
POST https://apoteket-se.54proxy.com/search
Api-Version: V3
User-Id: <any stable UUID>
content-type: application/json

{"query":"alvedon","resultsOptions":{"skip":0,"take":20}}
```

- No authentication, cookies, Origin or Referer needed.
- Without `resultsOptions` the API returns only **5** items (`results.count` still shows the full hit count). `take` sets the page size. The adapter asks for `max(2 × limit, 20)`, capped at 60, because prescription items are dropped afterwards.
- Responses are large, about 12 KB per item (HTML `Info`, category trees, `SearchTerms`). 30 items is about 350 KB.
- Response shape: `{ makesSense, spellingSuggestions, relatedQueries, results: { count, items[] }, relatedResults, customData }`. Each item is `{ type: "Product", id, attributes: [{ name, type, values: [] }] }`. `relatedResults` holds "you might also like" products and is ignored.
- A query with no hits returns `results: { count: 0, items: [] }` with HTTP 200.
- Searching for an EAN (e.g. `7046260976108`) returns that product. Searching for the product id does not.
- `POST /getEntitiesByAttribute` exists, but `Id` and `Ean` are not indexed for it ("Attribute not found"), so it can't be used for lookups.
- robots.txt disallows `/sok/*` on www.apoteket.se. The Loop54 host is not covered by it. We use the API anyway (decision 9c), at personal-use rates through `politeFetch`.

### Attributes used

| Attribute                                  | Meaning / use                                                                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Id`                                       | Product id, also the numeric suffix of the product URL. Package deals use a `p` prefix (`p11022`). → `merchantProductId`            |
| `Name`, `Brand`                            | Title and brand.                                                                                                                    |
| `ProductURL`, `ImageURL`                   | Relative paths; resolved against `https://www.apoteket.se`. The product URL is canonical (it matches JSON-LD `url`).                |
| `Price`                                    | Regular web price (incl. VAT).                                                                                                      |
| `CampaignPrice`                            | Campaign price, `0` when there is none.                                                                                             |
| `CampaignLabelType`                        | `0` no campaign, `1` **member price** (label like "25% medlem"), `2` general campaign ("20% online", "30% rabatt", "Köp 2 få 20%"). |
| `CampaignLabel`                            | Display text of the campaign badge.                                                                                                 |
| `InStock`                                  | Buyable online. Matches `Availability` (`InStock`/`OnlineOnly` → true; `OutOfStock`/`InStoreOnly` → false).                         |
| `PrescriptionRequired`, `Type`             | `Type` is `Rx` (prescription), `Ex` (OTC medicine) or `Ha` (other goods). Rx items are **filtered out**.                            |
| `Ean`                                      | EAN-13 (sometimes EAN-8). Validated with `normalizeEan`.                                                                            |
| `PackageText`                              | Pack size: "20 st", "250 ml", "100 tablett(er)", "1 X 51 g". Used for size/packCount, falling back to the title.                    |
| `InStorePrice`                             | Price in physical pharmacies. **Ignored.**                                                                                          |
| `LowestPriceLast30Days`, `PercentDiscount` | Kept in fixtures for reference, not used.                                                                                           |

### Price mapping

- No campaign (or campaign price ≥ regular price): `price = Price`.
- `CampaignLabelType = 1` (Klubb Apoteket member campaign): `price = Price`, `memberPrice = CampaignPrice`. These are explicit member prices, so the plan's "member prices only at Lyko and Hjärtat" is not quite right: Apoteket has them too, as campaigns.
- Any other campaign: `price = CampaignPrice`, `originalPrice = Price`. This includes package deals (`IsPackage`, label type 0).
- Multi-buy campaigns ("Köp 2 få 20%") have `CampaignPrice = 0` and are ignored.

## Product page

Next.js App Router, no `__NEXT_DATA__`. `getProduct` fetches the page (about 300 KB) and reads:

- **JSON-LD** `<script type="application/ld+json" id="product-schema">` `Product`: `name`, `gtin` (**present now**, contrary to earlier research), `productID`, `sku` (varunummer), `brand.name`, `image[]`, `url`, `additionalProperty` (`Produkttyp`: "Receptfritt läkemedel" / "Handelsvara" / "Receptbelagt läkemedel", `Förpackningsstorlek`: "20 st").
  - `offers.price` is the **lowest current price, including member campaigns** (119.25 for a "25% medlem" product). `offers.priceSpecification` with `priceType` `StrikethroughPrice` holds the regular price.
  - `offers.availability`: `InStock`, `OnlineOnly`, `OutOfStock`… For prescription items it says `InStock` even when Loop54 says not in stock.
- **RSC payload** (`self.__next_f.push` strings, quotes escaped as `\"`): the block starting `\"product\":{\"id\":\"<id>\"` has `ean`, `campaignInfo` (`{label, labelType, price, validUntil, …}`, or `{belongsToOngoingCampaign:false}`), `price` (regular), `inWebStock`, `productType` (`1` Rx, `2` OTC, `3` other), `comparisonPrice` ("477 kr / l").
- The parser uses JSON-LD for the core fields, and the RSC block for `campaignInfo.labelType` (member vs general campaign), `inWebStock` and `productType`. Prescription pages (`Produkttyp` "Receptbelagt…" or `productType` 1) return `null`.
- For the same product, `parseProduct` and `parseSearch` give identical offers (covered by a test).

## Shipping

Source: https://www.apoteket.se/villkor/leveransalternativ/ and the "Fri frakt" box on product pages, checked 2026-10-21.

- Free standard delivery on orders **over 300 kr**.
- Free delivery to an **apoteksombud** (and pick-up at an Apoteket pharmacy, "Hämta express" after about 2 hours) regardless of order value.
- Prescription medicines ship free whatever the method (not relevant here).
- Other options: Instabox locker, PostNord service point, PostNord mailbox, Early Bird morning delivery, Airmee, PostNord home, local-pharmacy home delivery, Bring same-evening express, Gordon, cold delivery. Fees for these are **not published**; the page says they are shown in checkout after entering the postcode.
- Some options (Early Bird, mailbox for large parcels) are not available when the order contains medicines.
- There is always a free option (apoteksombud), so a store minimum fee of 0 kr is possible if the user accepts pick-up. The shipping JSON models apoteksombud as a free `pickup-point` (it is an agent inside another shop) and pickup at an Apoteket pharmacy as `store-pickup`, which only counts with the `include-store-pickup` delivery choice.

Mirror in `packages/optimizer/shipping/apoteket.json` (owned by task O).

## Checkout test (probe feasibility)

**probe-unsupported: delivery options and their fees are shown only after first name, last name, mobile number, street address and city have been filled in, and the probe may not fill those fields.**

```
Tried on: 2026-10-22 (Orca embedded browser, not logged in, only necessary cookies)
- Guest checkout possible without login/BankID? yes. Login is offered ("Logga in med BankID för medlemserbjudanden") but optional.
- Shipping options and fees visible before payment? no, not with postcode/email alone.
  Delivery options come before payment, but only after the full "Dina uppgifter" form passes validation.
- Steps (selectors) to reach delivery options: see below
- Verdict: probe unsupported
```

Steps taken (item: Alvedon 500 mg 20 st, 34 kr; postcode 11738, probe email):

1. Product page, button "Köp <product name>" (the add-to-cart button's text is "Köp" plus the product title, which the guard allows). The header cart link becomes "1 Varukorg".
2. Cart at `/varukorg/` (robots.txt disallows only the old `/varukorg.aspx*`). Summary says "Frakt 0kr" before any delivery choice. Button "Fortsätt till kassan" goes to `/kassa/` (not in robots.txt).
3. `/kassa/` is one page with three steps: "1. Varukorg", "2. Leverans", "3. Betalning". Button "Fortsätt till leverans" opens step 2. It needed a keyboard activation (focus + Enter) in the embedded browser; a plain click did nothing visible.
4. Step 2 heading "Dina uppgifter" is one form with required fields Förnamn, Efternamn, E-postadress, Mobilnummer, Adress, Postnummer, Ort (plus optional C/O) and a "Fortsätt" button. Below it, "Leveransalternativ" only says "Ange din leveransadress ovan för att se tillgängliga leveransalternativ."
5. Filling only Postnummer (`11738`) and E-postadress, then clicking "Fortsätt", shows the validation errors "Ange förnamn", "Ange efternamn", "Ange mobilnummer", "Ange adress", "Ange ort". No request was sent (only `GET /bff/v1/checkout/customer-details` and the cart reads), Ort is not filled from the postcode, and no delivery options appear.
6. Stopped there. The item was removed with "Ta bort produkt" in the cart; the header then said "Du har 0 produkter i din varukorg." Step 3 (payment) was never opened and no order was placed.

The checkout's data comes from `/bff/v1/checkout/*` JSON endpoints (`cart`, `cart/as-member`, `customer-details`, `checkout-coupon-codes`). A delivery-options endpoint was not seen because the page never asked for one. Calling such an endpoint directly would bypass the guarded page, so it is out of scope for the probe.

Shipping fees therefore stay as published in `packages/optimizer/shipping/apoteket.json` (free over 300 kr, free apoteksombud and pharmacy pickup; the 39 kr and 69 kr fees are unverified guesses).

## Quirks

- Loop54 defaults to 5 results; always send `resultsOptions.take`.
- Loop54 `User-Id` is used for personalisation; the adapter sends one fixed UUID.
- Campaign data changes weekly (campaigns end on Sundays, e.g. `validUntil` 2026-10-25). Fixtures were recorded 2026-10-21.
- Titles sometimes contain double spaces ("IDUN MINERALS Balance & Care"); `cleanText` collapses them.
- Fixtures are trimmed by `src/trim.ts`: search responses keep only the attributes above, product pages keep the JSON-LD and the product's RSC block (without the description HTML).
