/**
 * Apotea adapter. robots.txt disallows the site search (`/sok/*`), so search picks candidate
 * product URLs from the sitemap-based catalog index and fetches the top few product pages.
 * Product pages are server-rendered (ASP.NET MVC) and parsed from JSON-LD plus a few
 * elements of the price box. Endpoints and quirks: docs/stores/apotea.md
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

export const BASE_URL = 'https://www.apotea.se';

/** Product pages fetched per search. At 1 request per second this keeps a search under 8 s. */
export const CANDIDATE_PAGES = 5;

/** Text of the `<dd>` after a `<dt>` in the product facts list, e.g. "Förpackningsstorlek:". */
function productFact(html: string, key: RegExp): string | undefined {
  const re =
    /<dt class="product-fact-key">([\s\S]*?)<\/dt>\s*<dd class="product-fact-value">([\s\S]*?)<\/dd>/g;
  for (const m of html.matchAll(re)) {
    if (key.test(decodeEntities(m[1]!))) {
      const text = cleanText(decodeEntities(m[2]!.replace(/<[^>]+>/g, ' ')));
      return text || undefined;
    }
  }
  return undefined;
}

/** The page uses numeric entities for å, ä, ö (`&#228;`); cleanText handles the named ones. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

/**
 * "Tidigare pris 55 kr" under a campaign price: the lowest price of the last 30 days before
 * the reduction (the Omnibus rule), shown only while a campaign runs.
 */
function previousPrice(html: string): number | undefined {
  const m = html.match(/class="lowest-price[^"]*">\s*Tidigare pris\s*([\d\s.,]+)\s*kr/);
  return m ? parsePrice(m[1]) : undefined;
}

/** `<div id="stock-info" data-in-stock="true">` in the price box. */
function stockFlag(html: string): boolean | undefined {
  const m = html.match(/id="stock-info"[^>]*data-in-stock="(true|false)"/);
  return m ? m[1] === 'true' : undefined;
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

  // Prescription medicines are listed with prices but need BankID to order: skip them.
  const classification = productFact(html, /^Klassificering/) ?? '';
  if (/PrescriptionOnly/.test(stringOf(ld.prescriptionStatus) ?? '')) return null;
  if (/^receptbelagt/i.test(classification)) return null;

  const offer = asArray(ld.offers).find(isRecord);
  if (!offer) return null;
  const price = parsePrice(offer.price as string | number | undefined);
  if (price == null) return null;
  const previous = previousPrice(html);

  const title = stringOf(ld.name);
  if (!title) return null;
  const packageText = productFact(html, /^Förpackningsstorlek/) ?? '';
  const size = parseSize(packageText) ?? parseSize(title);
  const packCount = parsePackCount(packageText) ?? parsePackCount(title);

  const availability = stringOf(offer.availability) ?? '';
  const inStock = stockFlag(html) ?? IN_STOCK_AVAILABILITY.test(availability);

  const brand = isRecord(ld.brand) ? stringOf(ld.brand.name) : stringOf(ld.brand);
  const image = asArray(ld.image).map(stringOf).find(Boolean);
  const canonical = stringOf(offer.url) ?? stringOf(ld.url) ?? url;

  return {
    merchantId: 'apotea',
    merchantProductId: stringOf(ld.sku) ?? new URL(canonical, BASE_URL).pathname,
    title: cleanText(title),
    brand: brand ? cleanText(brand) : undefined,
    ean:
      normalizeEan(stringOf(ld.gtin13) ?? stringOf(ld.gtin)) ??
      normalizeEan(productFact(html, /^EAN/)),
    size,
    packCount,
    price,
    ...(previous != null && previous > price ? { originalPrice: previous } : {}),
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

export interface ApoteaOptions {
  /** Catalog index to search; defaults to the shared `catalog.db` in the data dir. */
  db?: CatalogDb;
  /** Fetches a product page; defaults to `fetchText` (politeFetch, 1 request/s). */
  fetchPage?: (url: string, signal?: AbortSignal) => Promise<string>;
}

export function createApoteaAdapter(opts: ApoteaOptions = {}): MerchantAdapter {
  const fetchPage = opts.fetchPage ?? ((url, signal) => fetchText(url, { signal }));

  const getProduct: MerchantAdapter['getProduct'] = async (url, o) =>
    parseProduct(await fetchPage(url, o?.signal), url);

  return {
    info: {
      id: 'apotea',
      name: 'Apotea',
      baseUrl: BASE_URL,
      category: 'pharmacy',
      searchStrategy: 'catalog-index',
    },
    async search(query, o) {
      const limit = o?.limit ?? 10;
      const candidates = searchCandidates('apotea', query, Math.min(limit, CANDIDATE_PAGES), {
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

export default createApoteaAdapter();
