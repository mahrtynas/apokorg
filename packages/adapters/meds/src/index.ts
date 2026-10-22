/**
 * MEDS adapter. robots.txt disallows the site search (`/sok/`), so search picks candidate
 * product URLs from the sitemap-based catalog index and fetches the top few product pages.
 * Product pages are server-rendered (ASP.NET Core) and parsed from JSON-LD plus the price box
 * and the "Produktfakta" list. Endpoints and quirks: docs/stores/meds.md
 */
import type { MerchantAdapter, ProductOffer } from '@apokorg/core';
import {
  cleanText,
  computeUnitPrice,
  fetchText,
  findJsonLd,
  HttpError,
  normalizeEan,
  parsePackCount,
  parsePrice,
  parseSize,
} from '@apokorg/adapter-kit';
import { searchCandidates, type CatalogDb } from '@apokorg/catalog-index';

export const BASE_URL = 'https://www.meds.se';

/** Product pages fetched per search. Pages are ~80 KB, so 5 at 1 request/s stay under 8 s. */
export const CANDIDATE_PAGES = 5;

/** The page uses hex entities for å, ä, ö (`&#xE4;`); cleanText handles the named ones. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

const stripTags = (s: string) => cleanText(decodeEntities(s.replace(/<[^>]+>/g, ' ')));

/** Inner HTML of `<div class="text">` after `<div class="title">` in the Produktfakta list. */
function productFact(html: string, key: RegExp): string | undefined {
  const re =
    /<div class="info">\s*<div class="title">([\s\S]*?)<\/div>\s*<div class="text">([\s\S]*?)<\/div>\s*<\/div>/g;
  for (const m of html.matchAll(re)) {
    if (key.test(stripTags(m[1]!))) return m[2]!;
  }
  return undefined;
}

/** The `<div class="stock-price">` box: stock line, prices and campaign notes. */
function priceBox(html: string): string {
  const start = html.indexOf('<div class="stock-price">');
  if (start < 0) return '';
  const end = html.indexOf('<div class="product-buttons', start);
  // Prescription pages have no buy buttons; the box is short anyway.
  return html.slice(start, end > start ? end : start + 4_000);
}

/** `<div class="inactive-price">` text, e.g. "Tid. lägsta pris 57 kr" or "Utan kampanj 26 kr". */
function inactivePrice(box: string): { kind: 'lowest' | 'without'; price: number } | undefined {
  const m = box.match(/<div class="inactive-price"[^>]*>([\s\S]*?)<\/div>/);
  if (!m) return undefined;
  const text = stripTags(m[1]!);
  const price = parsePrice(text.replace(/^[^\d]*/, ''));
  if (price == null) return undefined;
  if (/^Tid\. lägsta pris/i.test(text)) return { kind: 'lowest', price };
  if (/^Utan kampanj/i.test(text)) return { kind: 'without', price };
  return undefined;
}

/**
 * Prescription medicines show a price but need BankID: the Kategori fact links to
 * `/receptbelagt/`, and the buy button is replaced by "Logga in och köp via ditt recept".
 */
function isPrescription(html: string, box: string): boolean {
  if (/href="\/receptbelagt\/"/.test(productFact(html, /^Kategori$/) ?? '')) return true;
  return /class="rx-availability-warning"|href="\/mina-recept\/" class="button/.test(box);
}

const IN_STOCK_AVAILABILITY = /(InStock|OnlineOnly|LimitedAvailability)$/;

/** Pure parsing, kept separate from fetching so unit tests can run on fixtures. */
export function parseProduct(
  html: string,
  url: string,
  fetchedAt = new Date().toISOString(),
): ProductOffer | null {
  const ld = findJsonLd(html, 'Product');
  if (!ld) return null;
  const box = priceBox(html);
  if (isPrescription(html, box)) return null;

  const offer = asArray(ld.offers).find(isRecord);
  if (!offer) return null;
  let price = parsePrice(offer.price as string | number | undefined);
  if (price == null) return null;

  // A "combo" price only applies to baskets of 2+ items over a total ("Gäller vid köp av 2+
  // varor för minst 699 kr totalt"); the single-item price is the "Utan kampanj" one.
  const inactive = inactivePrice(box);
  let originalPrice: number | undefined;
  if (inactive?.kind === 'without' && /class="combo-price-terms"/.test(box)) {
    price = inactive.price;
  } else if (inactive?.kind === 'lowest' && inactive.price > price) {
    originalPrice = inactive.price;
  }

  const title = stringOf(ld.name);
  if (!title) return null;
  const packageText = stripTags(productFact(html, /^Förpackningsstorlek$/) ?? '');
  const size = parseSize(packageText) ?? parseSize(title);
  const packCount = parsePackCount(packageText) ?? parsePackCount(title);

  const boxAvailability = box.match(/<link itemprop="availability" href="([^"]+)"/)?.[1];
  const availability = boxAvailability ?? stringOf(offer.availability) ?? '';
  const inStock = IN_STOCK_AVAILABILITY.test(availability);

  const brand = isRecord(ld.brand) ? stringOf(ld.brand.name) : stringOf(ld.brand);
  const image = asArray(ld.image).map(stringOf).find(Boolean);
  const canonical = stringOf(offer.url) ?? stringOf(ld.url) ?? url;

  return {
    merchantId: 'meds',
    merchantProductId: stringOf(ld.sku) ?? new URL(canonical, BASE_URL).pathname,
    title: cleanText(title),
    brand: brand ? cleanText(brand) : undefined,
    ean:
      normalizeEan(stringOf(ld.gtin13) ?? stringOf(ld.identifier)) ??
      normalizeEan(stripTags(productFact(html, /^EAN$/) ?? '')),
    size,
    packCount,
    price,
    ...(originalPrice != null ? { originalPrice } : {}),
    unitPrice: computeUnitPrice(price, size, packCount),
    inStock,
    url: new URL(canonical, BASE_URL).href,
    imageUrl: image ? new URL(image, BASE_URL).href : undefined,
    fetchedAt,
  };
}

function asArray(v: unknown): unknown[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringOf(v: unknown): string | undefined {
  if (typeof v === 'number') return String(v);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

export interface MedsOptions {
  /** Catalog index to search; defaults to the shared `catalog.db` in the data dir. */
  db?: CatalogDb;
  /** Fetches a product page; defaults to `fetchText` (politeFetch, 1 request/s). */
  fetchPage?: (url: string, signal?: AbortSignal) => Promise<string>;
}

export function createMedsAdapter(opts: MedsOptions = {}): MerchantAdapter {
  const fetchPage = opts.fetchPage ?? ((url, signal) => fetchText(url, { signal }));

  const getProduct: MerchantAdapter['getProduct'] = async (url, o) =>
    parseProduct(await fetchPage(url, o?.signal), url);

  return {
    info: {
      id: 'meds',
      name: 'MEDS',
      baseUrl: BASE_URL,
      category: 'pharmacy',
      searchStrategy: 'catalog-index',
    },
    async search(query, o) {
      const limit = o?.limit ?? 10;
      const candidates = searchCandidates('meds', query, Math.min(limit, CANDIDATE_PAGES), {
        db: opts.db,
      });
      const offers: ProductOffer[] = [];
      // Sequential on purpose: one store, one request at a time.
      for (const c of candidates) {
        try {
          const offer = await getProduct(c.url, { signal: o?.signal });
          if (offer) offers.push(offer);
        } catch (err) {
          // A product dropped since the last sitemap refresh 404s; skip it.
          if (!(err instanceof HttpError)) throw err;
        }
      }
      return offers;
    },
    getProduct,
  };
}

export default createMedsAdapter();
