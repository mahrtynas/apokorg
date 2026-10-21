/**
 * Apotek Hjärtat adapter. Endpoints and quirks: docs/stores/hjartat.md
 *
 * Search and product pages are server-rendered (Avensia Scope); the product model is in
 * `window.INITIAL_DATA`. Search: `page.products[]`. Product page: `page` itself.
 */
import type { MerchantAdapter, ProductOffer } from '@apokorg/core';
import {
  HttpError,
  cleanText,
  computeUnitPrice,
  fetchText,
  normalizeEan,
  parsePackCount,
  parsePrice,
  parseSize,
} from '@apokorg/adapter-kit';
import { z } from 'zod';
import { extractInitialData } from './initial-data';

export { extractInitialData, readJsStringConcat } from './initial-data';

export const BASE_URL = 'https://www.apotekhjartat.se';

const Money = z.object({ inclVat: z.number() });

/** The fields we use from Hjärtat's `ProductPageApiModel` (search hits and product pages). */
export const HjartatProduct = z.object({
  url: z.string(),
  productName: z.string(),
  productNumber: z.string().optional(),
  sku: z.string().optional(),
  price: z.object({
    current: Money,
    /** Omnibus "lowest price last 30 days"; shown struck through when showRedPrice. */
    lowestHistoricPrice: Money.optional(),
    showRedPrice: z.boolean().optional(),
  }),
  /** E.g. "Styckpris vid köp av 2" for multi-buy campaigns. */
  priceSubtitle: z.string().optional(),
  /** E.g. "Utan kampanj: 37 kr". */
  priceSubtitle2: z.string().optional(),
  size: z.string().optional(),
  images: z.array(z.object({ url: z.string() })).optional(),
  metaInfo: z.object({ canonicalUrl: z.string().optional() }).optional(),
  variant: z.object({ sku: z.string().optional(), stockStatus: z.string().optional() }).optional(),
  isBuyableWithoutPrescription: z.boolean().optional(),
  addToCartButtonIsActive: z.boolean().optional(),
  brands: z.array(z.object({ title: z.string() })).optional(),
  gtin: z.string().nullish(),
  trackingProductInformation: z
    .object({ ean: z.string().nullish(), brand: z.string().nullish() })
    .optional(),
});
export type HjartatProduct = z.infer<typeof HjartatProduct>;

const IN_STOCK = new Set(['inStock', 'lowStock']);

function absoluteUrl(path: string): string {
  return new URL(path, BASE_URL).toString();
}

function canonicalUrl(p: HjartatProduct): string {
  const canonical = p.metaInfo?.canonicalUrl;
  const raw = canonical && canonical.startsWith(BASE_URL) ? canonical : absoluteUrl(p.url);
  const u = new URL(raw);
  u.search = '';
  u.hash = '';
  return u.toString();
}

/**
 * Hjärtat's `price.current` is the campaign price. For multi-buy campaigns ("Köp 2 få 30%")
 * it is the per-item price when buying several, so the single-item price is taken from
 * "Utan kampanj: X kr" (falling back to `lowestHistoricPrice`).
 */
function pickPrices(p: HjartatProduct): { price: number; originalPrice?: number } {
  const current = p.price.current.inclVat;
  const reference = p.price.lowestHistoricPrice?.inclVat;
  if (p.priceSubtitle && /vid köp av\s*\d+/i.test(p.priceSubtitle)) {
    const withoutCampaign = p.priceSubtitle2?.match(/utan kampanj:?\s*(.+)/i)?.[1];
    const single = parsePrice(withoutCampaign) ?? reference;
    if (single !== undefined && single >= current) return { price: single };
  }
  if (p.price.showRedPrice && reference !== undefined && reference > current) {
    return { price: current, originalPrice: reference };
  }
  return { price: current };
}

/** Maps one Hjärtat product to an offer. Returns null for prescription-only items. */
export function toOffer(raw: unknown, fetchedAt = new Date().toISOString()): ProductOffer | null {
  const parsed = HjartatProduct.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;
  // Prescription items (Rx, 0% VAT) are out of scope.
  if (p.isBuyableWithoutPrescription === false) return null;

  const title = cleanText(p.productName);
  const { price, originalPrice } = pickPrices(p);
  const size = parseSize(title) ?? (p.size ? parseSize(p.size) : undefined);
  const packCount = parsePackCount(title);
  const status = p.variant?.stockStatus;
  const inStock =
    (status ? IN_STOCK.has(status) : true) && p.addToCartButtonIsActive !== false && price > 0;
  const image = p.images?.[0]?.url;
  const brand = p.brands?.[0]?.title ?? p.trackingProductInformation?.brand ?? undefined;
  const merchantProductId = p.variant?.sku ?? p.sku ?? p.productNumber;
  if (!merchantProductId) return null;

  return {
    merchantId: 'hjartat',
    merchantProductId,
    title,
    brand: brand ? cleanText(brand) : undefined,
    ean: normalizeEan(p.gtin) ?? normalizeEan(p.trackingProductInformation?.ean),
    size,
    packCount,
    price,
    originalPrice,
    unitPrice: computeUnitPrice(price, size, packCount),
    inStock,
    url: canonicalUrl(p),
    imageUrl: image ? absoluteUrl(image) : undefined,
    fetchedAt,
  };
}

interface SearchData {
  page?: { products?: unknown[] };
}

/** Pure parsing of a `/search?q=` HTML page. */
export function parseSearch(html: string, fetchedAt = new Date().toISOString()): ProductOffer[] {
  const data = extractInitialData<SearchData>(html);
  const products = data?.page?.products;
  if (!Array.isArray(products)) return [];
  const out: ProductOffer[] = [];
  for (const raw of products) {
    const offer = toOffer(raw, fetchedAt);
    if (offer) out.push(offer);
  }
  return out;
}

/** Pure parsing of a product page. */
export function parseProduct(
  html: string,
  _url: string,
  fetchedAt = new Date().toISOString(),
): ProductOffer | null {
  const data = extractInitialData<{ page?: unknown }>(html);
  return data?.page ? toOffer(data.page, fetchedAt) : null;
}

export function searchUrl(query: string): string {
  return `${BASE_URL}/search?q=${encodeURIComponent(query)}`;
}

const adapter: MerchantAdapter = {
  info: {
    id: 'hjartat',
    name: 'Apotek Hjärtat',
    baseUrl: BASE_URL,
    category: 'pharmacy',
    searchStrategy: 'search-page',
  },
  async search(query, opts) {
    const body = await fetchText(searchUrl(query), { signal: opts?.signal });
    return parseSearch(body).slice(0, opts?.limit ?? 10);
  },
  async getProduct(url, opts) {
    try {
      return parseProduct(await fetchText(url, { signal: opts?.signal }), url);
    } catch (err) {
      if (err instanceof HttpError && (err.status === 404 || err.status === 410)) return null;
      throw err;
    }
  },
};

export default adapter;
