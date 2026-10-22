/**
 * Kronans Apotek adapter. Search goes through the Voyado Elevate storefront API that
 * kronansapotek.se calls from the browser; product pages are parsed from their JSON-LD plus
 * a few bits of server-rendered HTML (Gatsby, no data payload).
 * Endpoints and quirks: docs/stores/kronans.md
 */
import type { MerchantAdapter, ProductOffer } from '@apokorg/core';
import {
  cleanText,
  computeUnitPrice,
  fetchText,
  findJsonLd,
  normalizeEan,
  parsePackCount,
  parsePrice,
  parseSize,
} from '@apokorg/adapter-kit';
import { z } from 'zod';

export const BASE_URL = 'https://www.kronansapotek.se';
export const SEARCH_URL =
  'https://wbd81f9f3.api.esales.apptus.cloud/api/storefront/v3/queries/search-page';

/** Elevate wants a customer and session key; any stable UUIDs work. */
const CUSTOMER_KEY = '6a1d3c2e-8f47-4b5a-9e0d-4c7b2f1a8e93';
const SESSION_KEY = 'c3e85f0a-2b91-4d6e-a7f4-91d0b6e2c548';

/**
 * Custom attributes Elevate leaves out unless asked for. The site asks for more; these are
 * the ones the adapter reads plus a few kept in fixtures for reference.
 */
export const PRESENT_CUSTOM = [
  'ean',
  'rX',
  'itemType',
  'subTitle',
  'promotionRibbon',
  'promotionPrice',
  'hasPromotion',
  'basePrice',
  'minPriceMonth',
];

/** How many product pages `search` may fetch to fill in missing EANs. */
const EAN_LOOKUPS = 3;

const ElevateValue = z.object({ id: z.string(), label: z.string() });

const ElevateProduct = z.object({
  key: z.string(),
  title: z.string(),
  brand: z.string().optional(),
  link: z.string(),
  sellingPrice: z.object({ min: z.number() }),
  listPrice: z.object({ min: z.number() }).optional(),
  inStock: z.boolean(),
  imageInfo: z.object({ thumbnail: z.string().optional() }).optional(),
  custom: z.record(z.string(), z.array(ElevateValue)).default({}),
});
type ElevateProduct = z.infer<typeof ElevateProduct>;

const ElevateSearchResponse = z.object({
  primaryList: z
    .object({
      totalHits: z.number().optional(),
      productGroups: z.array(z.object({ products: z.array(z.unknown()).default([]) })).default([]),
    })
    .optional(),
});

/** URL for an Elevate search-page query. `limit` is the page size. */
export function searchUrl(query: string, limit: number): string {
  const params = new URLSearchParams({
    market: 'se',
    locale: 'sv-SE',
    touchpoint: 'desktop',
    customerKey: CUSTOMER_KEY,
    sessionKey: SESSION_KEY,
    q: query,
    limit: String(limit),
    presentCustom: PRESENT_CUSTOM.join('|'),
  });
  return `${SEARCH_URL}?${params}`;
}

/** Runs a search against Elevate and returns the raw JSON body. */
export async function searchRaw(query: string, limit: number, signal?: AbortSignal) {
  return fetchText(searchUrl(query, limit), { headers: { accept: 'application/json' }, signal });
}

/** Pure parsing, kept separate from fetching so unit tests can run on fixtures. */
export function parseSearch(body: string, fetchedAt = new Date().toISOString()): ProductOffer[] {
  const parsed = ElevateSearchResponse.safeParse(JSON.parse(body));
  if (!parsed.success) return [];
  const offers: ProductOffer[] = [];
  for (const group of parsed.data.primaryList?.productGroups ?? []) {
    for (const raw of group.products) {
      const product = ElevateProduct.safeParse(raw);
      if (!product.success) continue;
      const offer = productToOffer(product.data, fetchedAt);
      if (offer) offers.push(offer);
    }
  }
  return offers;
}

function custom(product: ElevateProduct, name: string): string | undefined {
  const v = product.custom[name]?.[0]?.label;
  return v && v.trim() !== '' ? v.trim() : undefined;
}

/** True for prescription medicines: custom `rX` "Ja", or `itemType` "RX" (EX = OTC, HR = other). */
export function isPrescriptionProduct(product: ElevateProduct): boolean {
  return custom(product, 'rX') === 'Ja' || custom(product, 'itemType') === 'RX';
}

function productToOffer(product: ElevateProduct, fetchedAt: string): ProductOffer | null {
  if (isPrescriptionProduct(product)) return null;
  const subTitle = custom(product, 'subTitle');
  const price = product.sellingPrice.min;
  const ribbon = custom(product, 'promotionRibbon');
  return buildOffer({
    merchantProductId: product.key,
    name: product.title,
    subTitle,
    brand: product.brand,
    ean: normalizeEan(custom(product, 'ean')),
    price,
    originalPrice: campaignOriginalPrice(
      price,
      product.listPrice?.min,
      parsePrice(custom(product, 'minPriceMonth')),
    ),
    multiBuy: ribbon ? parseMultiBuy(ribbon, price) : undefined,
    inStock: product.inStock,
    url: new URL(product.link, BASE_URL).href,
    imageUrl: product.imageInfo?.thumbnail,
    fetchedAt,
  });
}

/**
 * The "Tidigare pris" the site shows next to a campaign price. A campaign is on when the
 * selling price is below the list price; the site then shows the lowest price of the last
 * 30 days (`minPriceMonth`, the same as the product page's strikethrough price), falling
 * back to the list price. `minPriceMonth` is ignored without a campaign.
 */
export function campaignOriginalPrice(
  price: number,
  list: number | undefined,
  minPriceMonth: number | undefined,
): number | undefined {
  if (list == null || list <= price) return undefined;
  return minPriceMonth != null && minPriceMonth > price ? minPriceMonth : list;
}

interface OfferParts {
  merchantProductId: string;
  /** Product name, e.g. "Alvedon 500 mg". */
  name: string;
  /** Form and pack, e.g. "Paracetamol, Filmdragerad tablett, 20 styck". */
  subTitle: string | undefined;
  brand: string | undefined;
  ean: string | undefined;
  price: number;
  originalPrice: number | undefined;
  multiBuy: ProductOffer['multiBuy'];
  priceValidUntil?: string;
  inStock: boolean;
  url: string;
  imageUrl: string | undefined;
  fetchedAt: string;
}

/** Shared by search and product parsing so both give the same offer for the same product. */
function buildOffer(p: OfferParts): ProductOffer {
  const packText = normalizeUnits(p.subTitle ?? '');
  const name = normalizeUnits(p.name);
  const size = parseSize(packText) ?? parseSize(name);
  const packCount = parseKronansPackCount(packText) ?? parseKronansPackCount(name);
  return {
    merchantId: 'kronans',
    merchantProductId: p.merchantProductId,
    // The site's own full name (JSON-LD `name`) is title and subtitle joined by a space.
    title: cleanText([p.name, p.subTitle].filter(Boolean).join(' ')),
    brand: p.brand ? cleanText(p.brand) : undefined,
    ean: p.ean,
    size,
    packCount,
    price: p.price,
    originalPrice: p.originalPrice,
    multiBuy: p.multiBuy,
    priceValidUntil: p.priceValidUntil,
    unitPrice: computeUnitPrice(p.price, size, packCount),
    inStock: p.inStock,
    url: p.url,
    imageUrl: p.imageUrl,
    fetchedAt: p.fetchedAt,
  };
}

/**
 * Subtitles spell units out ("100 milliliter", "1 000 milliliter", "1 x 51 gram"); turns
 * them into the short forms parseSize knows and drops thousands separators.
 */
export function normalizeUnits(text: string): string {
  return text
    .replace(/(\d)\s(?=\d{3}\b)/g, '$1')
    .replace(/\bmilliliter\b/gi, 'ml')
    .replace(/\bcentiliter\b/gi, 'cl')
    .replace(/\bkilogram\b/gi, 'kg');
}

/** Like parsePackCount, but "3 x 30 styck" is 90 rather than 30. */
export function parseKronansPackCount(text: string): number | undefined {
  const multi = text.match(/(\d+)\s*x\s*(\d+)\s*(?:st\b|styck)/i);
  if (multi) return Number(multi[1]) * Number(multi[2]);
  return parsePackCount(text);
}

/**
 * Reads multi-buy campaign ribbons: "2 för 40:-" -> { qty: 2, unitPrice: 20 },
 * "Köp 2 få 30%" -> { qty: 2, unitPrice: 70 % of price }. Other ribbons ("25%" discounts,
 * "Bra deal") are already in the selling price and give undefined.
 */
export function parseMultiBuy(ribbon: string, price: number): ProductOffer['multiBuy'] {
  const round = (n: number) => Math.round(n * 100) / 100;
  const forTotal = ribbon.match(/(\d+)\s*för\s*(\d+(?:[.,]\d+)?)\s*(?::-|kr)/i);
  if (forTotal) {
    const qty = Number(forTotal[1]);
    const total = parsePrice(forTotal[2]);
    if (qty >= 2 && total != null && total / qty < price) {
      return { qty, unitPrice: round(total / qty) };
    }
    return undefined;
  }
  const percent = ribbon.match(/köp\s*(\d+)\s*få\s*(\d+)\s*%/i);
  if (percent) {
    const qty = Number(percent[1]);
    const off = Number(percent[2]);
    if (qty >= 2 && off > 0 && off < 100) return { qty, unitPrice: round(price * (1 - off / 100)) };
  }
  return undefined;
}

/** The varunummer in a product URL: /Alvedon/p/097610/ -> 097610. */
export function productIdFromUrl(url: string): string | undefined {
  return new URL(url, BASE_URL).pathname.match(/\/p\/([^/]+)\/?$/)?.[1];
}

const PRESCRIPTION_PAGE = /Du behöver ett recept för att kunna köpa|>Pris med recept</;

export function parseProduct(
  html: string,
  url: string,
  fetchedAt = new Date().toISOString(),
): ProductOffer | null {
  const ld = findJsonLd(html, 'Product');
  if (!ld) return null;
  if (PRESCRIPTION_PAGE.test(html)) return null;

  const offer = asArray(ld.offers).find(isRecord);
  if (!offer) return null;
  const price = parsePrice(offer.price as string | number | undefined);
  if (price == null) return null;
  const strike = asArray(offer.priceSpecification)
    .filter(isRecord)
    .find((s) => String(s.priceType ?? '').includes('StrikethroughPrice'));
  const regular = parsePrice(strike?.price as string | number | undefined);
  const originalPrice = regular != null && regular > price ? regular : undefined;

  const fullName = stringOf(ld.name);
  if (!fullName) return null;
  const heading = pageHeading(html);
  const canonical = stringOf(ld.url) ?? stringOf(offer.url) ?? url;
  const brand = isRecord(ld.brand) ? stringOf(ld.brand.name) : stringOf(ld.brand);
  const image = asArray(ld.image).map(stringOf).find(Boolean);
  const ribbon = campaignRibbon(html, fullName);
  const validUntil = stringOf(offer.priceValidUntil)?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];

  return buildOffer({
    merchantProductId: stringOf(ld.sku) ?? productIdFromUrl(canonical) ?? canonical,
    name: heading?.name ?? fullName,
    subTitle: heading?.subTitle,
    brand,
    ean: normalizeEan(stringOf(ld.gtin14) ?? stringOf(ld.gtin13) ?? stringOf(ld.gtin)),
    price,
    originalPrice,
    multiBuy: ribbon ? parseMultiBuy(ribbon, price) : undefined,
    priceValidUntil: originalPrice != null ? validUntil : undefined,
    inStock: /\/InStock$/.test(stringOf(offer.availability) ?? ''),
    url: new URL(canonical, BASE_URL).href,
    imageUrl: image ? new URL(image, BASE_URL).href : undefined,
    fetchedAt,
  });
}

/** The page's `<h1>` (name) and the `<h2>` under it (subtitle), as search returns them. */
function pageHeading(html: string): { name: string; subTitle: string | undefined } | undefined {
  const m = html.match(/id="product-content-title"[^>]*>([^<]*)<\/h1>(?:<h2[^>]*>([^<]*)<\/h2>)?/);
  const name = m?.[1] ? cleanText(m[1]) : '';
  if (!name) return undefined;
  const subTitle = m?.[2] ? cleanText(m[2]) : '';
  return { name, subTitle: subTitle || undefined };
}

/**
 * The campaign badge of the product itself: `aria-label="2 för 40:- Rabatt på <name>"`.
 * Related products further down have badges too, so the name must match.
 */
function campaignRibbon(html: string, fullName: string): string | undefined {
  const want = cleanText(fullName);
  for (const m of html.matchAll(/aria-label="([^"]+?) Rabatt på ([^"]+)"/g)) {
    if (cleanText(m[2]!) === want) return cleanText(m[1]!);
  }
  return undefined;
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

/**
 * Elevate usually returns the EAN. When it doesn't, the product page has it (JSON-LD
 * `gtin14`); fetch it for the first few offers only, to keep search fast.
 */
async function fillMissingEans(offers: ProductOffer[], signal?: AbortSignal) {
  const missing = offers.filter((o) => !o.ean).slice(0, EAN_LOOKUPS);
  for (const offer of missing) {
    try {
      const page = parseProduct(await fetchText(offer.url, { signal }), offer.url);
      if (page?.ean) offer.ean = page.ean;
    } catch {
      // The search result is still useful without an EAN.
    }
  }
}

const adapter: MerchantAdapter = {
  info: {
    id: 'kronans',
    name: 'Kronans Apotek',
    baseUrl: BASE_URL,
    category: 'pharmacy',
    searchStrategy: 'api',
  },
  async search(query, opts) {
    const q = query.trim();
    if (!q) return [];
    const limit = opts?.limit ?? 10;
    // Ask for extra rows: prescription items are dropped after the fact.
    const pageSize = Math.min(60, Math.max(limit * 2, 20));
    const body = await searchRaw(q, pageSize, opts?.signal);
    const offers = parseSearch(body).slice(0, limit);
    await fillMissingEans(offers, opts?.signal);
    return offers;
  },
  async getProduct(url, opts) {
    return parseProduct(await fetchText(url, { signal: opts?.signal }), url);
  },
};

export default adapter;
