/**
 * Lyko adapter. Endpoints and quirks: docs/stores/lyko.md
 *
 * Search, category and product pages are server-rendered (Avensia Scope); the page model is a
 * plain object in `window.CURRENT_PAGE`. Search and category pages: `products.products[]`.
 * Product page: the page itself (a `VariantViewModel`, the same model as a search hit plus
 * `ean`, `linkingData` and so on). Every variant (size or shade) has its own URL.
 */
import type { MerchantAdapter, ProductOffer } from '@apokorg/core';
import {
  HttpError,
  cleanText,
  computeUnitPrice,
  extractWindowJson,
  normalizeEan,
  parsePackCount,
  parseSize,
  politeFetch,
} from '@apokorg/adapter-kit';
import { z } from 'zod';

export const ORIGIN = 'https://lyko.com';
export const BASE_URL = `${ORIGIN}/sv`;

/**
 * Lyko sits behind a Queue-it waiting room. When it is active we get the queue page instead of
 * the store; the adapter gives up at once instead of waiting in the queue.
 */
export class QueueError extends Error {
  override readonly name = 'QueueError';
  constructor(public readonly url: string) {
    super(`Lyko is behind its Queue-it waiting room right now (${url}); try again later`);
  }
}

const QUEUE_HOST = /(^|\.)queue-it\.net$/i;

/** True for a Queue-it waiting-room page. Normal pages load the Queue-it client script too. */
export function isQueuePage(html: string, url?: string): boolean {
  if (url && QUEUE_HOST.test(new URL(url).hostname)) return true;
  if (html.includes('window.CURRENT_PAGE')) return false;
  return /queue-it|queueit/i.test(html);
}

const Comparison = z.object({
  /** recommended ("Rek. pris"), ordinary ("Tid. pris"), withoutCampaign ("Utan Combo Deal"), worth, packageContentSum. */
  type: z.string(),
  value: z.number(),
});

/** The fields we use from Lyko's `VariantViewModel` (search hits and product pages). */
export const LykoVariant = z.object({
  code: z.string(),
  url: z.string(),
  displayName: z.string(),
  brandName: z.string().nullish(),
  price: z.object({
    current: z.number(),
    comparisonPrices: z.array(Comparison).nullish(),
    isMemberPrice: z.boolean().nullish(),
    isComboDealPrice: z.boolean().nullish(),
    campaignPriceValidUntil: z.object({ validUntil: z.string().nullish() }).nullish(),
    memberPrice: z.number().nullish(),
  }),
  size: z.number().nullish(),
  unit: z.string().nullish(),
  images: z.array(z.object({ url: z.string() })).nullish(),
  onlineStatus: z.object({ interactionType: z.string().nullish() }).nullish(),
  isDigital: z.boolean().nullish(),
  isCharity: z.boolean().nullish(),
  /** Product pages only. */
  canonicalUrl: z.string().nullish(),
  ean: z.string().nullish(),
});
export type LykoVariant = z.infer<typeof LykoVariant>;

function absoluteUrl(path: string): string {
  return new URL(path, ORIGIN).toString();
}

function canonicalUrl(p: LykoVariant): string {
  const u = new URL(absoluteUrl(p.canonicalUrl || p.url));
  u.search = '';
  u.hash = '';
  return u.toString();
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Last day of a campaign in Swedish time. Lyko stores the end as the next local midnight in UTC. */
function lastCampaignDay(validUntil: string | null | undefined): string | undefined {
  if (!validUntil) return undefined;
  const end = new Date(validUntil).getTime();
  if (!Number.isFinite(end)) return undefined;
  return new Date(end - 1000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
}

/**
 * Lyko's `price.current` is what the page shows in large type:
 * - Combo Deals ("Combo Deal 25%", e.g. "2 valfria produkter för totalt 490 kr") show the
 *   conditional discounted price; the single-item price is the `withoutCampaign` comparison.
 * - Straight campaigns show the sale price, with the previous price as `ordinary` ("Tid. pris").
 * - `recommended` ("Rek. pris") is the supplier's list price, not a campaign; it is ignored.
 * - Club Lyko: `memberPrice` is shown next to the public price. When `isMemberPrice` is set the
 *   current price itself is a member price, so the public price is the comparison price.
 */
export function pickPrices(price: LykoVariant['price']): {
  price: number;
  originalPrice?: number;
  memberPrice?: number;
  priceValidUntil?: string;
} {
  const comparison = (type: string) =>
    price.comparisonPrices?.find((c) => c.type === type && c.value > 0)?.value;
  const current = round(price.current);
  const withoutCampaign = comparison('withoutCampaign');
  const ordinary = comparison('ordinary');

  if (price.isComboDealPrice && withoutCampaign !== undefined && withoutCampaign >= current) {
    return { price: round(withoutCampaign), ...member(price.memberPrice, withoutCampaign) };
  }
  if (price.isMemberPrice) {
    const publicPrice = withoutCampaign ?? ordinary;
    if (publicPrice !== undefined && publicPrice > current) {
      return { price: round(publicPrice), memberPrice: current };
    }
  }
  const out: ReturnType<typeof pickPrices> = {
    price: current,
    ...member(price.memberPrice, current),
  };
  if (ordinary !== undefined && ordinary > current) {
    out.originalPrice = round(ordinary);
    out.priceValidUntil = lastCampaignDay(price.campaignPriceValidUntil?.validUntil);
  }
  return out;
}

function member(memberPrice: number | null | undefined, publicPrice: number) {
  return memberPrice != null && memberPrice > 0 && memberPrice < publicPrice
    ? { memberPrice: round(memberPrice) }
    : {};
}

/** Maps one Lyko variant to an offer. Returns null for gift cards, donations and broken items. */
export function toOffer(raw: unknown, fetchedAt = new Date().toISOString()): ProductOffer | null {
  const parsed = LykoVariant.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;
  if (p.isDigital || p.isCharity) return null;

  const title = cleanText(p.displayName);
  const { price, originalPrice, memberPrice, priceValidUntil } = pickPrices(p.price);
  const size =
    parseSize(title) ?? (p.size && p.unit ? parseSize(`${p.size} ${p.unit}`) : undefined);
  const packCount = parsePackCount(title);
  const image = p.images?.[0]?.url;

  return {
    merchantId: 'lyko',
    merchantProductId: p.code,
    title,
    brand: p.brandName ? cleanText(p.brandName) : undefined,
    ean: normalizeEan(p.ean),
    size,
    packCount,
    price,
    originalPrice,
    memberPrice,
    priceValidUntil,
    unitPrice: computeUnitPrice(price, size, packCount),
    // "buy" shows the buy button; "monitor" is "Bevaka" (out of stock).
    inStock: p.onlineStatus?.interactionType === 'buy' && price > 0,
    url: canonicalUrl(p),
    imageUrl: image ? absoluteUrl(image) : undefined,
    fetchedAt,
  };
}

interface ListingPage {
  products?: { products?: unknown[] };
}

function readPage<T>(html: string): T | undefined {
  if (isQueuePage(html)) throw new QueueError(BASE_URL);
  return extractWindowJson<T>(html, 'CURRENT_PAGE');
}

/** Pure parsing of a `/sv/sok?q=` page, or the category/brand page a search redirects to. */
export function parseSearch(html: string, fetchedAt = new Date().toISOString()): ProductOffer[] {
  const products = readPage<ListingPage>(html)?.products?.products;
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
  const page = readPage<unknown>(html);
  return page ? toOffer(page, fetchedAt) : null;
}

export function searchUrl(query: string): string {
  return `${BASE_URL}/sok?q=${encodeURIComponent(query)}`;
}

/** Fetches a page, failing fast with a QueueError if we land in the waiting room. */
export async function fetchPage(url: string, signal?: AbortSignal): Promise<string> {
  const res = await politeFetch(url, { signal });
  if (res.url && isQueuePage('', res.url)) throw new QueueError(res.url);
  const html = await res.text();
  if (isQueuePage(html)) throw new QueueError(res.url || url);
  return html;
}

const adapter: MerchantAdapter = {
  info: {
    id: 'lyko',
    name: 'Lyko',
    baseUrl: BASE_URL,
    category: 'beauty',
    searchStrategy: 'search-page',
  },
  async search(query, opts) {
    return parseSearch(await fetchPage(searchUrl(query), opts?.signal)).slice(0, opts?.limit ?? 10);
  },
  async getProduct(url, opts) {
    try {
      return parseProduct(await fetchPage(url, opts?.signal), url);
    } catch (err) {
      if (err instanceof HttpError && (err.status === 404 || err.status === 410)) return null;
      throw err;
    }
  },
};

export default adapter;
