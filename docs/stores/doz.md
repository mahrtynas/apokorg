# DOZ Apotek (`doz`)

- Base URL: https://dozapotek.se (`https://www.dozapotek.se` 301-redirects here; product URLs are canonical without `www`)
- Category: pharmacy
- Search strategy: catalog-index
- Checked: 2026-10-22. The TLS certificate on `dozapotek.se` and `www.dozapotek.se` was valid that day. The expired certificate seen on 2026-10-21/22 belongs to the old `www.doz.se` host, which `CATALOG_SOURCES.doz` still points at.

## Search

robots.txt (`https://dozapotek.se/robots.txt`) disallows `/catalogsearch/` and `/checkout/` (also `/customer/`, `/index.php/`, …). It blocks AI training crawlers outright (`GPTBot`, `ClaudeBot`, `anthropic-ai`, `CCBot`, …) and gives user-driven agents a crawl delay (`Claude-User`: 3 s, `ChatGPT-User`: 3 s). The Magento/ElasticSuite suggest endpoint `GET /search/ajax/suggest/?q=` is still search, so it is not used (decision 9c).

Search therefore uses the catalog index:

1. `searchCandidates('doz', q, 5)` from `@apokorg/catalog-index` (shared `catalog.db`, or a `db` passed to `createDozAdapter`).
2. `getProduct` on each candidate **sequentially** through `politeFetch` (1 request/s). At most 5 pages, so a search is ~5–7 s. Prescription pages parse to `null` and are dropped. A failing candidate (for example a 404 for a product removed since the refresh) is skipped.
3. An empty index returns `[]`. `search` never crawls.

### Sitemaps

- `robots.txt`: `Sitemap: https://dozapotek.se/media/sitemap/sitemap.xml`, a sitemap index with two children, `sitemap-1-1.xml` (~10.5 MB, 24 000 URLs) and `sitemap-1-2.xml` (~3.6 MB, 6 200 URLs). They're plain XML, not gzipped, and include `<image:image>` entries.
- The children mix the home page, categories (`/egenvard/allergi`), brands (`/varumarken/alvedon`), advice (`/rad-och-tips/...`), CMS pages (`/kopvillkor-pa-dozapotek`, `/black-week-2026`) and products.
- **Product URLs** are one slug segment ending in the product id: the 6-digit varunummer (`/alvedon-filmdragerad-tablett-500-mg-20-styck-097610`), a longer article number (`/allevyn-adhesive-7-5-x-7-5-cm-10-st-9991012230`) or a letter plus digits (`…-24-st-l1078`). Filter: host `dozapotek.se`, one segment, ending in `-(\d{6,}|[a-z]\d{3,})`. That keeps 28 317 of 30 358 URLs, and none of the 56 one-segment non-product pages leak through.
- Prescription medicines are in the sitemap (for example `/sertralin-teva-…-194617`), so they reach the index. The adapter drops them after fetching the page.
- Slug titles: the default `slugToTitle` with the trailing id removed ("alvedon filmdragerad tablett 500 mg 20 styck").
- A live refresh took 2.9 s (3 requests) and indexed 28 317 products.

The working source is `catalogSource` in `packages/adapters/doz/src/index.ts`. `CATALOG_SOURCES.doz` in catalog-index should be changed to match (see the A-doz PR).

## Product page

A product page is Magento 2 (Hyvä), ~1.8 MB of HTML, mostly menus and related-product cards.

- **JSON-LD**: one `<script type="application/ld+json" id="structured-data">` of `@type: ItemPage`, with the Product in `mainEntity` (so `findJsonLd(html, 'Product')` does not find it). Fields: `url` (canonical), `name` (without pack size), `sku` = varunummer, `image`, `brand.name`, `category`, and `offers` = `{ price, priceCurrency: SEK, availability, url }`.
- **No GTIN** in JSON-LD. The EAN is taken from the image filename: leading digits of `7046260976108_1_1.png`, or GTIN-14 with a leading zero as in `07046261094726_C1L1.tif_12.png` and `03337872414145_C1N0.tif_11.png`. It is accepted only if `normalizeEan` validates it. Products without an image get `/placeholder/default/Bild-kommer-snart-….jpg`, so no EAN and no `imageUrl`.
- **Title**: the `<h1 class="… title-font">` has the full name with the pack size ("Alvedon, filmdragerad tablett 500 mg, 20 styck"), and is preferred over JSON-LD `name`. The `<div><span class="text-gray-400">` right after it is the package line ("Blister, 20 tabletter", "Burk, 100 tabletter"), used first for size and pack count. It is empty for cosmetics.
- **Price**: `offers.price` (SEK incl. VAT, "Onlinepris"). In a campaign, `offers.priceSpecification` is a `UnitPriceSpecification` with `priceType: https://schema.org/StrikethroughPrice` holding the regular price, which becomes `originalPrice` (Daxxin: 95.20 now, 119 before). The Hyvä price script also has `isDiscount: '1'` and `initialFinalPrice`. Campaign prices are shown to anonymous visitors, so they are public prices.
- **Member price**: none exposed. Voyado membership ("Bli medlem") exists, but there is no member price field on the page, so `memberPrice` is never set.
- **Stock**: `offers.availability` (`http://schema.org/InStock` / `OutOfStock`). The visible text is "Finns i lager online" or "Tillfälligt slut i webblager".
- **Prescription**: `category: "Receptbelagda läkemedel"`, `price: "0"`, `OutOfStock`, and "Se mina recept" instead of a Köp button, so `parseProduct` returns `null`. Large OTC packs such as Omeprazol 20 mg 28 st have a normal price and a Köp button.
- Fixtures are trimmed to the JSON-LD and the `<h1>` + package line (`src/trim.ts`), about 2 KB each.

## Shipping

Source: https://dozapotek.se/leveransalternativ (checked 2026-10-22) and `/kopvillkor-pa-dozapotek` § 6.

| Option                                                          | Fee              | Notes                                                                       |
| --------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------- |
| Pickup at a DOZ Apotek pharmacy (within 2 h)                    | free             | Must be in stock at that pharmacy.                                          |
| Wolt (30–60 min, from the nearest DOZ pharmacy)                 | not published    | Only selected products, and all items must be in stock at the local store.  |
| PostNord: Varubrev (mailbox), Ombud (service point) or Paketbox | free over 199 kr | 1–3 working days. Fee under 199 kr is not published. Paketbox needs BankID. |
| Instabox                                                        | free over 199 kr | BankID needed. Fee under 199 kr is not published.                           |
| Budbee hemleverans (home delivery)                              | **29 kr**        | No free threshold mentioned.                                                |
| Budbee paketskåp (parcel locker)                                | free over 199 kr | BankID needed. Fee under 199 kr is not published.                           |

The fees under 199 kr are only shown in the checkout, and robots.txt disallows `/checkout/`, so they could not be checked (see below). The header banner says "Fria fraktalternativ för receptbelagda läkemedel", which doesn't matter here because prescription items are excluded.

Compared with `packages/optimizer/shipping/doz.json` (2026-10-21, "conservative guesses"): home delivery is Budbee at **29 kr**, not 69 kr. The 199 kr threshold for service-point delivery is confirmed. The 39 kr below-threshold fee for PostNord ombud is still unverified.

## Checkout test (probe feasibility)

Tried on: 2026-10-22

- **probe-unsupported (robots.txt disallows `/checkout/`)**. The Magento cart (`/checkout/cart/`) and checkout (`/checkout/`) both sit under the disallowed path, so the cart and checkout were not opened in a browser, and nothing was added to a cart.
- Guest checkout without login/BankID: not tested, for the same reason. The delivery page says Paketbox, Instabox and Budbee paketskåp need BankID identification on pickup, which is not a checkout step.
- Shipping options and fees before payment: not tested. Fees under the 199 kr threshold stay unknown.
- Verdict: probe unsupported. Shipping comes from the static table above.

## Quirks

- The host moved from `doz.se` to `dozapotek.se`. `www.doz.se` serves an expired certificate. Never disable TLS verification to reach it.
- Product slugs say "styck" and "tablett(er)" where other stores say "st" and "tabletter".
- Product pages are large (~1.8 MB), so a 5-page search transfers ~9 MB.
- robots.txt gives `Claude-User` a 3 s crawl delay. Manual exploration for this doc kept at least 3 s between requests. The app itself uses the project-wide `politeFetch` default of 1 request/s with a browser user agent.
