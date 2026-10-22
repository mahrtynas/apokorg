# Gymgrossisten (`gymgrossisten`)

- Base URL: https://www.gymgrossisten.com
- Category: sport
- Search strategy: catalog-index
- Platform: Salesforce Commerce Cloud (SFCC, "demandware"), server-rendered, behind Cloudflare. No challenge seen with the browser User-Agent `politeFetch` sends.
- Researched: 2026-10-22

## robots.txt

`User-agent: *` disallows, among others:

- `/search*` and `/*?q=*`: the site search and its suggest endpoint. **Never used.**
- `/*cart`, `/*checkout*`, `/*onepage-checkout*`, `/*billing*`, `/*revieworder*`: the cart and checkout.
- `/*on/demandware.store/*`: every SFCC controller, including `Product-Variation` (the AJAX endpoint the flavour picker calls) and `Cart-AddProduct`. So variant data must come from the product page HTML.
- `/*prefn*=*`, `/*prefv*=*`, `/*pmin*`, `/*pmax*`, `/*srule=*`: filtered and sorted listings.

The file lists the sitemap indexes of four sister stores (.com, .no, bodystore.dk, fitnesstukku.fi), so discovery starts from `https://www.gymgrossisten.com/sitemap_index.xml` directly.

## Search

The adapter never calls the site search. `search(q)`:

1. `searchCandidates('gymgrossisten', q, 5)` from `@apokorg/catalog-index` returns product URLs from the shared `catalog.db` (or an injected `db`).
2. It fetches those product pages **one at a time** with `politeFetch` (1 request per second). It stops early when the search has run for 6 s and has at least one result, so a search stays under 8 s.
3. It takes every variant offer from each page (see below), drops duplicates, puts the offers that match more query words first (`rankByQuery`, so "whey 80 vanilj" puts the Vanilj flavour first), and returns `limit` (default 10).

If the index has no rows for the store, `search` returns `[]` without fetching anything. It never crawls. Candidates that return 404 or 410 are skipped.

Catalog source (`CATALOG_SOURCES.gymgrossisten` in `packages/catalog-index/src/stores.ts`), verified 2026-10-22:

- `sitemap_index.xml` → `sitemap_0.xml` (products, about 3,400 URLs, about 128 KB), `sitemap_1.xml` (brands and landing pages, no `.html`), `sitemap_2.xml` (articles, `/<slug>.html`, one segment). The filter keeps the two-segment `/<slug>/<id>.html` URLs, so only sitemap_0 contributes. A live refresh made 4 requests in 13 s and indexed 6,373 rows. The config is correct as is.
- The sitemap lists **master** products only (`/whey-80-vassleprotein-1-kg/585R.html`), plus single products (`/kreatin-monohydrat-500-g/609.html`) and bundles (`SET…`, `BUNDLE…`). Variant URLs are not in the sitemap.

## Product page

Each product page has three sources of data:

| Data                     | Where                                                                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product shown and its id | `<div class="product-detail" id="product-detail" data-pid="585-1" data-master-url="true">`. `data-pid` is the variant on screen; `data-master-url` is `true` on a master URL.                                  |
| Name                     | `<h1><span itemprop="name">`: the master name on a master URL ("Whey-80 Vassleprotein 1 kg"), the variant name on a variant URL ("Whey-80, 1 kg, Cinnamon bun").                                               |
| Brand                    | `<a class="brand-link" …><meta itemprop="name" content="Star Nutrition" />`, and `manufacturer` in the variant microdata.                                                                                      |
| Price                    | `<div class="price-sales">199 kr</div>`; also `<meta itemprop="price" content="199.0">` in the offer microdata.                                                                                                |
| Ordinary price           | `price-ref__stmt--list` "Ord.pris 249 kr" → `originalPrice` when it is higher than the price. `price-ref__stmt--lowest` "Lägsta pris 30 dagar" (the 30-day low, required by the Omnibus directive) is ignored. |
| Stock                    | `class="product-availability" data-available="true"` for the product shown; `itemprop="availability"` (`InStock` / `OutOfStock`) for every variant.                                                            |
| EAN                      | Visible text `                                                                                                                                                                                                 | EAN <span class="ean-code">7350049151014</span>`, validated with `normalizeEan`. A `gtin13`meta holds the same number. Bundles have an empty`ean-code`. |
| Canonical URL            | `<link rel="canonical">`. On a variant URL it points to the **master** URL.                                                                                                                                    |
| Image                    | `og:image` (product shown) or `itemprop="image"` in the variant microdata (site-relative).                                                                                                                     |
| Variants                 | One `<div itemprop="hasVariant" itemscope itemtype="https://schema.org/Product">` block per variant, with `sku`, `name`, `price`, `availability`, `url`, `image` and `manufacturer`.                           |

There is no product JSON-LD; the only JSON-LD on the page is a `BreadcrumbList`. Text in attributes is HTML-encoded (`Pi&ntilde;a Colada`, `Jordgubbar &amp; Mj&ouml;lk`), so the adapter decodes entities.

### Variants, URLs and ids

- **Flavours** are variants of one master page. Example: Whey-80 1 kg (`585R`) has 31 flavours. Each has its own SKU, which becomes the `merchantProductId` (`587` Vanilj, `58100` Cinnamon bun, `585-1` Double Rich Chocolate), and its own URL in the microdata (`/whey-80-1-kg-vanilj/587.html`). Variant names already contain the size and flavour ("Whey-80, 1 kg, Vanilj"), and the adapter uses them as titles.
- **Sizes** are separate master products with their own sitemap URL (`585R` 1 kg, `5854R` 4 kg). So flavour × size equals one master per size times its flavours. When a variant name lacks the size, the size comes from the master name.
- `parseProductPage` returns one `ProductOffer` per variant, with the variant shown first. Only that first variant has an EAN, and only it has an `originalPrice`, because the page shows the ordinary price only for the variant on screen. The others get price, stock, title and URL from their microdata.
- `getProduct(url)` returns the variant shown on the page. For a variant URL that is that variant, with its EAN (`/whey-80-1-kg-cinnamon-bun/58100.html` → `58100`, EAN 7350049153384). For a master URL it is the default flavour. Offer URLs are the variant URLs from the microdata (with the query and hash removed), not the `<link rel="canonical">`, because the canonical link would lose the flavour.
- Bundles (`SET2W80` "2 x Whey-80 Vassleprotein 1 kg") have one variant and no EAN. A leading "N x" becomes `packCount`, so the unit price is per kg of the whole bundle.
- Single products (`609`) have no `hasVariant` blocks; the page-level offer is used.

## Club GG (member offers)

Checked on `/medlemspris-se.html` and the member terms, 2026-10-22. Club GG is a points programme: 1 kr = 1 point, paid out as monthly bonus cheques; levels are Rookie, Pro, Master and Legend. Members also get monthly "Klubberbjudanden" or "Club Deals" (personal, and only visible when logged in), early access to sales, and promotion codes ("Medlemsdagar! Få 200 kr rabatt vid köp över 999 kr", "Spara 200 kr med kod"). Anonymous product pages show **no member price**: there is no member price element in the markup and only one price per variant. So the adapter **never sets `memberPrice`**. Basket-level codes and points are out of scope.

## Shipping

Source: https://www.gymgrossisten.com/leveransvillkor.html and product-page microdata, checked 2026-10-22.

- Site banner, also on the terms page: **"Fri frakt över 499 kr"**. No page showed 599 on 2026-10-22.
- Options in the delivery terms: PostNord Varubrev (mailbox), PostNord ombud (pickup point), PostNord Hemleverans (home; parcels over 20 kg always go this way), Instabox Express (parcel locker, 1–3 working days), Budbee Hemleverans (home, weekday evenings 17–22, in larger cities), and a BankID-opened parcel box. The terms list **no fees**; they are shown in checkout.
- Every product page's offer microdata has `OfferShippingDetails` with `shippingRate` **59 SEK** to SE, 0 days handling and 1–3 days transit. This is the standard (cheapest) rate the store reports to Google.
- Uncollected parcels: up to 250 kr fee.

Compared with `packages/optimizer/shipping/gymgrossisten.json` (owned by O, not changed here): the free-shipping threshold of 499 matches. The guessed 49 kr for PostNord ombud and Instabox should probably be **59 kr**, the store's own published rate. Home-delivery fees are still unknown, because checkout can't be reached (see below).

## Checkout test (probe feasibility)

Tried on: 2026-10-22

- **Verdict: probe-unsupported (robots.txt disallows `/*cart` and `/*checkout*`).** Following the task rules, the cart and checkout were **not** opened, and nothing was added to a cart. Adding to the cart also goes through `/on/demandware.store/…/Cart-AddProduct`, which is disallowed too.
- Guest checkout possible without login or BankID: not tested.
- Shipping options and fees visible before payment: not tested. The 59 kr rate in the product microdata is the best available signal without checkout.

## Quirks

- The `hasVariant` blocks are long: each repeats the shipping and return-policy microdata. Recorded fixtures drop those, and also scripts, styles, SVG, nav, footer, comments and inline base64 images. One description held a 185 KB `data:` image. The trim never changes what the parser returns; `live.test.ts` checks this when recording.
- Master pages are 390–430 KB; one search downloads about 2 MB.
- `robots.txt` has empty `Disallow:` groups for AI user agents (`Claude-User`, `GPTBot`, …). The adapter sends a browser User-Agent and follows the `*` group.
