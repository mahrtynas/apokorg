/**
 * Gymgrossisten adapter. Endpoints and quirks: docs/stores/gymgrossisten.md
 *
 * robots.txt disallows the site search (`/search*`, `/*?q=*`), so search goes through the
 * catalog index built from the product sitemap: `searchCandidates` gives product URLs, and we
 * fetch the top few product pages one at a time.
 *
 * Product pages are server-rendered Salesforce Commerce Cloud. A product with flavours is one
 * master page (`/whey-80-vassleprotein-1-kg/585R.html`) that embeds every variant as schema.org
 * microdata (`itemprop="hasVariant"`: sku, name with the flavour, price, availability and the
 * variant's own URL, `/whey-80-1-kg-cinnamon-bun/58100.html`). Sizes are separate master pages.
 * The EAN is only given for the variant the page shows: visible text "EAN 7350049151014".
 */
import type { MerchantAdapter, ProductOffer } from '@apokorg/core';
import {
  HttpError,
  cleanText,
  computeUnitPrice,
  normalizeEan,
  parsePackCount,
  parsePrice,
  parseSize,
  politeFetch,
} from '@apokorg/adapter-kit';
import { searchCandidates, type CatalogDb } from '@apokorg/catalog-index';
import { normalize } from '@apokorg/matcher';

export const BASE_URL = 'https://www.gymgrossisten.com';
export const MERCHANT_ID = 'gymgrossisten';

/** Product pages fetched per search; at one request per second this keeps a search under 8 s. */
export const SEARCH_PAGES = 5;
/** Stop fetching further candidate pages once a search has run this long. */
const SEARCH_BUDGET_MS = 6000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
  aring: 'å',
  Aring: 'Å',
  auml: 'ä',
  Auml: 'Ä',
  ouml: 'ö',
  Ouml: 'Ö',
  uuml: 'ü',
  Uuml: 'Ü',
  eacute: 'é',
  Eacute: 'É',
  egrave: 'è',
  aacute: 'á',
  oacute: 'ó',
  ntilde: 'ñ',
  oslash: 'ø',
  aelig: 'æ',
  middot: '·',
  ndash: '–',
  mdash: '—',
  reg: '®',
  trade: '™',
};

/** The site HTML-encodes non-ASCII letters in attributes and text ("Pi&ntilde;a Colada"). */
export function decodeHtml(s: string): string {
  const decoded = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e] ?? m;
  });
  return cleanText(decoded);
}

/** Content of the first `<meta itemprop="<prop>" content="...">` in a chunk of HTML. */
function meta(html: string, prop: string): string | undefined {
  const m = new RegExp(`<meta\\s+itemprop="${prop}"\\s+content="([^"]*)"`).exec(html);
  return m ? decodeHtml(m[1]!) : undefined;
}

/** One variant as the page describes it. */
export interface Variant {
  sku: string;
  name: string;
  price?: number;
  /** schema.org availability, e.g. "InStock", "OutOfStock". */
  availability?: string;
  url?: string;
  image?: string;
  brand?: string;
}

/** The `itemprop="hasVariant"` blocks of a master page. Empty for single products and bundles. */
export function parseVariants(html: string): Variant[] {
  const starts: number[] = [];
  const re = /itemprop="hasVariant"/g;
  while (re.exec(html)) starts.push(re.lastIndex);
  const out: Variant[] = [];
  for (let i = 0; i < starts.length; i++) {
    // The last block runs to the end of the page; the first metas after its start are its own.
    const block = html.slice(starts[i], starts[i + 1] ?? starts[i]! + 8000);
    const sku = meta(block, 'sku');
    const name = meta(block, 'name');
    if (!sku || !name) continue;
    out.push({
      sku,
      name,
      price: parsePrice(meta(block, 'price')),
      availability: meta(block, 'availability'),
      url: meta(block, 'url'),
      image: meta(block, 'image'),
      brand: meta(block, 'manufacturer'),
    });
  }
  return out;
}

/** The product the page shows: on a master URL, its default variant. */
interface Shown {
  pid: string;
  masterUrl: boolean;
  name?: string;
  brand?: string;
  ean?: string;
  price?: number;
  listPrice?: number;
  available?: boolean;
  canonical?: string;
  image?: string;
  /** The page-level offer, for products without variants. */
  offer?: { price?: number; availability?: string; url?: string };
}

function parseShown(html: string): Shown | undefined {
  const detail = /id="product-detail"\s+data-pid="([^"]+)"(?:\s+data-master-url="(\w+)")?/.exec(
    html,
  );
  if (!detail) return undefined;
  const body = html.slice(detail.index);
  const offerAt = body.search(/itemprop="offers"/);
  const offer = offerAt >= 0 ? body.slice(offerAt, offerAt + 2000) : '';
  const name = /<span itemprop="name">([^<]+)<\/span>/.exec(body)?.[1];
  const brand = /<a class="brand-link"[^>]*><meta itemprop="name" content="([^"]*)"/.exec(
    body,
  )?.[1];
  const ean = /class="ean-code">\s*(\d+)\s*</.exec(body)?.[1];
  const sales = /class="price-sales">([\s\S]*?)<\/div>/.exec(body)?.[1];
  // "Ord.pris" is the ordinary price; "Lägsta pris 30 dagar" (the 30-day low) is not used.
  const list = /price-ref__stmt--list">[\s\S]*?class="price__value">([^<]*)</.exec(body)?.[1];
  const available = /class="product-availability"[^>]*data-available="(\w+)"/.exec(body)?.[1];
  return {
    pid: decodeHtml(detail[1]!),
    masterUrl: detail[2] === 'true',
    name: name ? decodeHtml(name) : undefined,
    brand: brand ? decodeHtml(brand) : undefined,
    ean,
    price: sales ? parsePrice(decodeHtml(sales)) : undefined,
    listPrice: list ? parsePrice(decodeHtml(list)) : undefined,
    available: available === undefined ? undefined : available === 'true',
    canonical: /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1],
    image: /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1],
    offer: offer
      ? {
          price: parsePrice(meta(offer, 'price')),
          availability: meta(offer, 'availability'),
          url: meta(offer, 'url'),
        }
      : undefined,
  };
}

function absoluteUrl(path: string): string {
  const u = new URL(decodeHtml(path), BASE_URL);
  u.search = '';
  u.hash = '';
  return u.toString();
}

const IN_STOCK = new Set(['InStock', 'LimitedAvailability', 'OnlineOnly', 'InStoreOnly']);

function isInStock(availability: string | undefined): boolean | undefined {
  if (!availability) return undefined;
  return IN_STOCK.has(availability.replace(/^https?:\/\/schema\.org\//, ''));
}

function bundleCount(title: string): number | undefined {
  const n = Number(/^(\d+)\s*x\s/i.exec(title)?.[1]);
  return n >= 2 ? n : undefined;
}

/**
 * Every offer on a product page: one per variant (flavour) on a master page, else one.
 * The variant the page shows comes first and is the only one with an EAN and campaign price.
 */
export function parseProductPage(
  html: string,
  fetchedAt = new Date().toISOString(),
): ProductOffer[] {
  const shown = parseShown(html);
  if (!shown) return [];
  const variants = parseVariants(html);
  if (variants.length === 0) {
    variants.push({
      sku: shown.pid,
      name: shown.name ?? '',
      price: shown.offer?.price ?? shown.price,
      availability: shown.offer?.availability,
      url: shown.offer?.url ?? shown.canonical,
      image: shown.image,
      brand: shown.brand,
    });
  }
  const shownIndex = variants.findIndex((v) => v.sku === shown.pid);
  if (shownIndex > 0) variants.unshift(...variants.splice(shownIndex, 1));
  // The master's name ("Whey-80 Vassleprotein 1 kg") has the size when a variant name lacks it.
  const masterName = shown.masterUrl || shownIndex < 0 ? shown.name : undefined;

  const out: ProductOffer[] = [];
  for (const v of variants) {
    const isShown = v.sku === shown.pid;
    const title = v.name || shown.name;
    const price = (isShown ? shown.price : undefined) ?? v.price;
    if (!title || price === undefined || !v.url) continue;
    const size = parseSize(title) ?? (masterName ? parseSize(masterName) : undefined);
    // Bundles: "2 x Whey-80 Vassleprotein 1 kg" is two 1 kg tubs.
    const packCount = parsePackCount(title) ?? bundleCount(title);
    const originalPrice =
      isShown && shown.listPrice !== undefined && shown.listPrice > price
        ? shown.listPrice
        : undefined;
    const inStock = (isShown ? shown.available : undefined) ?? isInStock(v.availability) ?? false;
    const brand = v.brand ?? shown.brand;
    const image = v.image ?? (isShown ? shown.image : undefined);
    out.push({
      merchantId: MERCHANT_ID,
      merchantProductId: v.sku,
      title,
      brand,
      ean: isShown ? normalizeEan(shown.ean) : undefined,
      size,
      packCount,
      price,
      originalPrice,
      unitPrice: computeUnitPrice(price, size, packCount),
      inStock: inStock && price > 0,
      url: absoluteUrl(v.url),
      imageUrl: image ? new URL(image, BASE_URL).toString() : undefined,
      fetchedAt,
    });
  }
  return out;
}

/** The offer for the variant a URL points to (a master URL shows its default variant). */
export function parseProduct(
  html: string,
  _url: string,
  fetchedAt = new Date().toISOString(),
): ProductOffer | null {
  return parseProductPage(html, fetchedAt)[0] ?? null;
}

/**
 * Puts the variants that match more query words first ("whey 80 vanilj" → the Vanilj variant),
 * keeping the page order otherwise.
 */
export function rankByQuery(offers: ProductOffer[], query: string): ProductOffer[] {
  const terms = [...new Set(normalize(query).split(' ').filter(Boolean))];
  const score = (o: ProductOffer) => {
    const tokens = normalize(o.title).split(' ');
    return terms.filter((t) => tokens.some((tok) => tok.startsWith(t))).length;
  };
  return offers
    .map((o, i) => ({ o, i, s: score(o) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.o);
}

export type FetchPage = (url: string, signal?: AbortSignal) => Promise<string>;

export const fetchPage: FetchPage = async (url, signal) =>
  (await politeFetch(url, { signal })).text();

export interface GymgrossistenOptions {
  /** Catalog index to search (default: the shared `catalog.db` in the data dir). */
  db?: CatalogDb;
  fetchPage?: FetchPage;
}

/** Builds the adapter; tests inject an in-memory catalog and a fixture fetcher. */
export function createAdapter(opts: GymgrossistenOptions = {}): MerchantAdapter {
  const fetchHtml = opts.fetchPage ?? fetchPage;

  async function getProduct(url: string, o?: { signal?: AbortSignal }) {
    try {
      return parseProductPage(await fetchHtml(url, o?.signal));
    } catch (err) {
      if (err instanceof HttpError && (err.status === 404 || err.status === 410)) return [];
      throw err;
    }
  }

  return {
    info: {
      id: MERCHANT_ID,
      name: 'Gymgrossisten',
      baseUrl: BASE_URL,
      category: 'sport',
      searchStrategy: 'catalog-index',
    },
    async search(query, o) {
      const started = Date.now();
      const candidates = searchCandidates(MERCHANT_ID, query, SEARCH_PAGES, { db: opts.db });
      const offers: ProductOffer[] = [];
      // Sequential on purpose: one request per second to the store.
      for (const c of candidates) {
        if (offers.length > 0 && Date.now() - started > SEARCH_BUDGET_MS) break;
        offers.push(...(await getProduct(c.url, o)));
      }
      const seen = new Set<string>();
      const unique = offers.filter(
        (x) => !seen.has(x.merchantProductId) && seen.add(x.merchantProductId),
      );
      return rankByQuery(unique, query).slice(0, o?.limit ?? 10);
    },
    async getProduct(url, o) {
      return (await getProduct(url, o))[0] ?? null;
    },
  };
}

export default createAdapter();
