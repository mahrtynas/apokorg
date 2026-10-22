# Apotea (`apotea`)

- Base URL: https://www.apotea.se
- Category: pharmacy
- Search strategy: catalog-index
- Checked: 2026-10-22

## Search

robots.txt (`User-agent: *`) disallows the site search, the cart checkout and sort/filter parameters:

```
Disallow: /account/*
Disallow: /nyakassan*
Disallow: /kassa*
Disallow: /sok/*
Disallow: /sok?
Disallow: *?m=
Disallow: *?*ls=
Disallow: *?*lsc=
Disallow: *?*sort=
Sitemap: https://www.apotea.se/sitemap/sitemaps
```

So the adapter never calls the site search or its suggest endpoint. Instead:

1. `refreshCatalog('apotea', CATALOG_SOURCES.apotea)` (catalog-index, run by the server) reads the sitemap index `https://www.apotea.se/sitemap/sitemaps`. It lists `sitemap-brands`, `sitemap-categories`, `sitemap-images-1/2`, `sitemap-pages` and `sitemap-products-1/2` under `/sitemap/files/`, as plain XML with no extension. Only the two product sitemaps are followed: products-1 holds 50 000 URLs (~6.8 MB) and products-2 about 6 900. A full refresh takes about 3 s (3 requests).
2. `search(q)` calls `searchCandidates('apotea', q, min(limit, 5))` and fetches those product pages **sequentially** through `politeFetch` (1 request per second). Prescription medicines and products that 404 (removed since the last refresh) are skipped, so a search can return fewer than 5 offers. When the index has no Apotea rows, `search` returns `[]` without fetching anything.

Product URLs are a single slug segment, e.g. `/alvedon-filmdragerad-tablett-500-mg-20-st`. The slug usually carries the pack size (`-20-st`), but prescription variants often don't (`/alvedon-filmdragerad-tablett-500-mg`, `/atorvastatin-accord-filmdragerad-tablett-10-mg-1`). Variants are distinct pages with a numeric suffix (`-1`, `-2`).

Measured 2026-10-22: `search('alvedon 500 mg 20 st')` took 2.3 s with 3 candidates.

### Catalog filter gap

`CATALOG_SOURCES.apotea.productUrlFilter` keeps one-segment slugs of dashed words (`/^[a-z0-9]+(?:-[a-z0-9]+)+$/i`). That drops **99 of 56 857** URLs in the product sitemaps (0.17 %):

- no dash at all: `/braunseries3rakapparat3010bt`, `/braunseries9pro96mrakhuvud`
- double or trailing dash: `/buster-designkrage-ben-langdmatt-12--5-cm`, `/efudix-salva-5-`
- underscores or dots: `/medicube-triple-collagen-cream-4-0_50-ml`, `/dotarem-inj-vatska-losning-279.3-mg-ml`

Since only `sitemap-products-N` is followed, every URL there is a product, so the filter could be any one-segment path on `www.apotea.se`. Reported in the PR; catalog-index is not owned by this task.

### Markdown pages

The site's `/llms.txt` says every product, category and brand page is also served as Markdown: append `.md` or send `Accept: text/markdown`. The front matter has `price`, `availability`, `gtin`, `sku`, `brand` and `prescription` ("OTC" / prescription). It lacks the pack size and the "Tidigare pris", so the adapter parses the HTML page instead. The `.md` variant is a good fallback if the HTML changes.

## Product page

Server-rendered ASP.NET MVC 5 behind Cloudflare (`cf-cache-status: DYNAMIC`, no challenge seen with the default `politeFetch` user agent). Pages are about 480 KB. `getProduct` reads:

- **JSON-LD** `Product` (`@type` is `["Product","Drug"]` for medicines): `name`, `sku` (article id, e.g. `5212`) → `merchantProductId`, `gtin13` → `ean`, `brand.name`, `image[]`, `url` (canonical), `prescriptionStatus` (`https://schema.org/OTC` or `https://schema.org/PrescriptionOnly`), `offers.price` (current public price, a number), `offers.availability`, `offers.priceValidUntil` (campaign end date), and `offers.shippingDetails.shippingRate` = 0 SEK.
- **Price box** `#stock-price-box`:
  - `<div id="stock-info" data-in-stock="true|false">` → `inStock` (falls back to JSON-LD `availability`). The text shows the stock count ("Fler än 100 st i lager", "6 st i lager") and "Gratis fraktalternativ".
  - `<span class="price">34 kr</span>` (`class="price campaign"` during a campaign); the same value as `offers.price`.
  - During a campaign: `<div class="lowest-price unit-price"> Tidigare pris 55 kr …`. The tooltip says it is the lowest price of the last 30 days before the reduction (Omnibus). → `originalPrice` when higher than `price`.
  - "Jämförpris 1,70 kr/st" (not read; `computeUnitPrice` gives the same).
- **Facts list** `<dl id="product-facts-list">` (`dt.product-fact-key` / `dd.product-fact-value`, with numeric entities like `F&#246;rpackningsstorlek`): `EAN:` (fallback for `ean`), `Klassificering:` ("Receptfritt läkemedel", "Receptbelagt läkemedel", …), `Förpackningsstorlek:` ("20 st", "175 ml") → `size`/`packCount`, falling back to the title. Also `Varumärke`, `Kategori`, `Bäst före-datum`, `Varunummer`.
- A `dataLayer.push({event: "view_item", …})` GA4 block repeats the id, name and price.

Prescription medicines (`prescriptionStatus` PrescriptionOnly, or Klassificering "Receptbelagt") are shown with a price but can only be ordered after BankID login, so `parseProduct` returns `null` for them, like the Apoteket adapter.

**Member prices:** none. Apotea has no member club or member price markup. Multi-buy badges ("3 för 2", `data-badge-key="kampanj_3for2"`) on listing pages don't change the unit price and are ignored.

## Shipping

Sources, checked 2026-10-22: https://www.apotea.se/frakt-och-leverans, https://www.apotea.se/kopvillkor, product pages.

- Apotea advertises "Fri frakt & snabba leveranser" site-wide, and every product page says "Gratis fraktalternativ". JSON-LD `shippingRate` is 0 SEK.
- **No minimum order** is mentioned anywhere (frakt-och-leverans, köpvillkor, product pages).
- **Home delivery cost: not confirmed.** The shipping page lists carriers but no fees except "Postnord Företagsfrakt | Bud … Endast för företag. Fraktkostnad 39 kronor". The köpvillkor say "Eventuell fraktkostnad tillkommer baserat på valt fraktalternativ och redovisas tydligt i kassan", and the product page wording is "Gratis frakt*alternativ*" (a free option exists), so some options may cost extra. This can only be checked in the checkout, which robots.txt disallows (below).
- Options listed: Budbee (home, 16.30–22.30), Airmee (home), Instabox Express (parcel box), PostNord (pickup point, home or business; small orders go as varubrev to the mailbox), Gordon (temperature-controlled home delivery, 16–22), DSV (pickup point), Early Bird (morning mailbox delivery before 07:00), DHL (pickup point), Bussgods (pickup point, mainly northern Sweden), PostNord Företagsfrakt (business addresses, 39 kr).
- The options offered depend on the postcode and cart (prescription medicines, high order value, temperature-sensitive goods).
- Uncollected parcels can be charged up to 200 kr.

`packages/optimizer/shipping/apotea.json` (owned by task O) models PostNord ombud, Instabox, PostNord brevlåda and Budbee home, all at 0 kr with no threshold. That matches what can be verified without the checkout. It could add Airmee, Early Bird, DHL and DSV, and should note that home delivery fees are unverified.

## Checkout test (probe feasibility)

```
Tried on: 2026-10-22
- robots.txt disallows /kassa* and /nyakassan* (the checkout), so the checkout was not opened
  and no item was added to a cart.
- Guest checkout possible without login/BankID? not tested
- Shipping options and fees visible before payment? not tested
- Verdict: probe-unsupported (robots.txt disallows /kassa* and /nyakassan*)
```

## Quirks

- Product sitemaps have no extension and are not gzipped.
- The `ASP.NET_SessionId` and `shopper` cookies are set on every response; none are needed.
- `-1`, `-2` suffixed slugs are separate products (other pack sizes or manufacturers), not duplicates.
