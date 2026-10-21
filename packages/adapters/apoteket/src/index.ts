/**
 * Apoteket adapter. Search goes through the Loop54 JSON API that apoteket.se calls from the
 * browser; product pages are parsed from their JSON-LD plus the Next.js RSC payload.
 * Endpoints and quirks: docs/stores/apoteket.md
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

export const BASE_URL = 'https://www.apoteket.se';
export const SEARCH_URL = 'https://apoteket-se.54proxy.com/search';

/** Loop54 personalises on User-Id; any stable UUID works. One per install is plenty. */
const LOOP54_USER_ID = '0b7f4a52-6c1e-4d8a-9f3b-a2e5c7d91f60';

export const LOOP54_HEADERS = {
  'Api-Version': 'V3',
  'User-Id': LOOP54_USER_ID,
  'content-type': 'application/json',
  accept: 'application/json',
} as const;

/** Loop54 CampaignLabelType / campaignInfo.labelType for Klubb Apoteket member prices. */
const MEMBER_LABEL_TYPE = 1;

const Loop54Attribute = z.object({
  name: z.string(),
  type: z.string().optional(),
  values: z.array(z.unknown()).default([]),
});

const Loop54Entity = z.object({
  type: z.string(),
  id: z.string(),
  attributes: z.array(Loop54Attribute).default([]),
});
type Loop54Entity = z.infer<typeof Loop54Entity>;

const Loop54SearchResponse = z.object({
  results: z
    .object({
      count: z.number().optional(),
      items: z.array(Loop54Entity).default([]),
    })
    .optional(),
});

/** Request body for a Loop54 V3 search. `take` is the page size (the API defaults to 5). */
export function searchRequestBody(query: string, take: number): string {
  return JSON.stringify({ query, resultsOptions: { skip: 0, take } });
}

/** Posts a search to Loop54 and returns the raw JSON body. */
export async function searchRaw(query: string, take: number, signal?: AbortSignal) {
  return fetchText(SEARCH_URL, {
    method: 'POST',
    headers: LOOP54_HEADERS,
    body: searchRequestBody(query, take),
    signal,
  });
}

/** Pure parsing, kept separate from fetching so unit tests can run on fixtures. */
export function parseSearch(body: string, fetchedAt = new Date().toISOString()): ProductOffer[] {
  const parsed = Loop54SearchResponse.safeParse(JSON.parse(body));
  if (!parsed.success) return [];
  const offers: ProductOffer[] = [];
  for (const entity of parsed.data.results?.items ?? []) {
    const offer = entityToOffer(entity, fetchedAt);
    if (offer) offers.push(offer);
  }
  return offers;
}

function attributeMap(entity: Loop54Entity): Map<string, unknown[]> {
  return new Map(entity.attributes.map((a) => [a.name, a.values]));
}

function first(attrs: Map<string, unknown[]>, name: string): unknown {
  return attrs.get(name)?.[0];
}

function str(attrs: Map<string, unknown[]>, name: string): string | undefined {
  const v = first(attrs, name);
  return typeof v === 'string' && v.trim() !== '' ? cleanText(v) : undefined;
}

function num(attrs: Map<string, unknown[]>, name: string): number | undefined {
  const v = first(attrs, name);
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** True for prescription medicines (Loop54 `PrescriptionRequired`, or product `Type` "Rx"). */
export function isPrescriptionEntity(entity: Loop54Entity): boolean {
  const attrs = attributeMap(entity);
  return first(attrs, 'PrescriptionRequired') === true || str(attrs, 'Type') === 'Rx';
}

function entityToOffer(entity: Loop54Entity, fetchedAt: string): ProductOffer | null {
  if (entity.type !== 'Product') return null;
  if (isPrescriptionEntity(entity)) return null;
  const attrs = attributeMap(entity);

  const title = str(attrs, 'Name');
  const path = str(attrs, 'ProductURL');
  const basePrice = num(attrs, 'Price');
  if (!title || !path || basePrice == null) return null;

  const prices = resolvePrices(
    basePrice,
    num(attrs, 'CampaignPrice'),
    num(attrs, 'CampaignLabelType'),
  );
  const packageText = str(attrs, 'PackageText') ?? '';
  const size = parseSize(packageText) ?? parseSize(title);
  const packCount = parsePackCount(packageText) ?? parsePackCount(title);
  const image = str(attrs, 'ImageURL');

  return {
    merchantId: 'apoteket',
    merchantProductId: str(attrs, 'Id') ?? entity.id,
    title,
    brand: str(attrs, 'Brand'),
    ean: normalizeEan(str(attrs, 'Ean')),
    size,
    packCount,
    ...prices,
    unitPrice: computeUnitPrice(prices.price, size, packCount),
    inStock: first(attrs, 'InStock') === true,
    url: new URL(path, BASE_URL).href,
    imageUrl: image ? new URL(image, BASE_URL).href : undefined,
    fetchedAt,
  };
}

/**
 * Maps Apoteket's regular price plus an optional campaign price onto price/originalPrice/
 * memberPrice. A campaign with label type 1 ("25% medlem") is for Klubb Apoteket members
 * only, so the public price stays the regular one. Other campaigns ("20% online",
 * "30% rabatt", package deals) apply to everyone.
 */
export function resolvePrices(
  regular: number,
  campaign: number | undefined,
  labelType: number | undefined,
): Pick<ProductOffer, 'price' | 'originalPrice' | 'memberPrice'> {
  if (campaign == null || campaign <= 0 || campaign >= regular) return { price: regular };
  if (labelType === MEMBER_LABEL_TYPE) return { price: regular, memberPrice: campaign };
  return { price: campaign, originalPrice: regular };
}

/** The numeric product id at the end of a product URL: /produkt/<slug>-243170/ -> 243170. */
export function productIdFromUrl(url: string): string | undefined {
  const m = new URL(url, BASE_URL).pathname.match(/-([a-z]?\d+)\/?$/i);
  return m?.[1];
}

/**
 * Pulls a field of the product object out of the RSC payload (`self.__next_f.push` strings,
 * so quotes are backslash-escaped). Only the product's own block is searched, not
 * related products further down the page.
 */
function rscProductBlock(html: string, productId: string | undefined): string | undefined {
  const marker = productId
    ? `\\"product\\":{\\"id\\":\\"${productId}\\"`
    : `\\"product\\":{\\"id\\"`;
  const start = html.indexOf(marker);
  if (start < 0) return undefined;
  const end = html.indexOf('\\"breadCrumbs\\"', start);
  return html.slice(start, end > start ? end : start + 20_000);
}

function rscField(block: string | undefined, pattern: string): string | undefined {
  if (!block) return undefined;
  return block.match(new RegExp(pattern))?.[1];
}

const IN_STOCK_AVAILABILITY = /(InStock|OnlineOnly|LimitedAvailability)$/;

export function parseProduct(
  html: string,
  url: string,
  fetchedAt = new Date().toISOString(),
): ProductOffer | null {
  const ld = findJsonLd(html, 'Product');
  if (!ld) return null;

  const props = asArray(ld.additionalProperty).filter(isRecord);
  const prop = (name: string) => {
    const v = props.find((p) => p.name === name)?.value;
    return typeof v === 'string' ? v : undefined;
  };

  const productId = stringOf(ld.productID) ?? productIdFromUrl(url);
  const block = rscProductBlock(html, productId);
  const productType = rscField(block, '\\\\"productType\\\\":(\\d+)');
  if (/receptbelagt/i.test(prop('Produkttyp') ?? '') || productType === '1') return null;

  const offer = asArray(ld.offers).find(isRecord);
  if (!offer) return null;
  const shownPrice = parsePrice(offer.price as string | number | undefined);
  if (shownPrice == null) return null;
  const strike = asArray(offer.priceSpecification)
    .filter(isRecord)
    .find((s) => String(s.priceType ?? '').includes('StrikethroughPrice'));
  const regular = parsePrice(strike?.price as string | number | undefined) ?? shownPrice;

  const campaignLabelType = rscField(
    block,
    '\\\\"campaignInfo\\\\":\\{[^{}]*?\\\\"labelType\\\\":(\\d+)',
  );
  const prices = resolvePrices(
    Math.max(regular, shownPrice),
    shownPrice,
    campaignLabelType == null ? undefined : Number(campaignLabelType),
  );

  const title = stringOf(ld.name);
  if (!title) return null;
  const packageText = prop('Förpackningsstorlek') ?? '';
  const size = parseSize(packageText) ?? parseSize(title);
  const packCount = parsePackCount(packageText) ?? parsePackCount(title);

  const inWebStock = rscField(block, '\\\\"inWebStock\\\\":(true|false)');
  const availability = stringOf(offer.availability) ?? '';
  const inStock =
    inWebStock != null ? inWebStock === 'true' : IN_STOCK_AVAILABILITY.test(availability);

  const brand = isRecord(ld.brand) ? stringOf(ld.brand.name) : stringOf(ld.brand);
  const image = asArray(ld.image).map(stringOf).find(Boolean);
  const canonical = stringOf(offer.url) ?? stringOf(ld.url) ?? url;

  return {
    merchantId: 'apoteket',
    merchantProductId: productId ?? canonical,
    title: cleanText(title),
    brand: brand ? cleanText(brand) : undefined,
    ean:
      normalizeEan(stringOf(ld.gtin) ?? stringOf(ld.gtin13)) ??
      normalizeEan(rscField(block, '\\\\"ean\\\\":\\\\"(\\d+)\\\\"')),
    size,
    packCount,
    ...prices,
    unitPrice: computeUnitPrice(prices.price, size, packCount),
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

const adapter: MerchantAdapter = {
  info: {
    id: 'apoteket',
    name: 'Apoteket',
    baseUrl: BASE_URL,
    category: 'pharmacy',
    searchStrategy: 'api',
  },
  async search(query, opts) {
    const q = query.trim();
    if (!q) return [];
    const limit = opts?.limit ?? 10;
    // Ask for extra rows: prescription items are dropped after the fact.
    const take = Math.min(60, Math.max(limit * 2, 20));
    const body = await searchRaw(q, take, opts?.signal);
    return parseSearch(body).slice(0, limit);
  },
  async getProduct(url, opts) {
    return parseProduct(await fetchText(url, { signal: opts?.signal }), url);
  },
};

export default adapter;
