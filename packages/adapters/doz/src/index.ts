/**
 * DOZ Apotek adapter. robots.txt disallows `/catalogsearch/`, so search takes candidate URLs
 * from the shared catalog index (built from the sitemap) and fetches their product pages.
 * Product pages are Magento 2 (Hyvä) with a JSON-LD ItemPage whose mainEntity is the Product.
 * Endpoints and quirks: docs/stores/doz.md
 */
import type { MerchantAdapter, ProductOffer } from '@apokorg/core';
import {
  cleanText,
  computeUnitPrice,
  extractJsonLd,
  fetchText,
  normalizeEan,
  parsePackCount,
  parsePrice,
  parseSize,
} from '@apokorg/adapter-kit';
import {
  searchCandidates,
  slugToTitle,
  type CatalogDb,
  type CatalogSource,
} from '@apokorg/catalog-index';

export const BASE_URL = 'https://dozapotek.se';
export const MERCHANT_ID = 'doz';

/** Product pages fetched per search. At one request per second this keeps a search under 8 s. */
export const MAX_PRODUCT_FETCHES = 5;

/** Product slugs end in the varunummer (`-097610`), a long article number, or e.g. `-l1078`. */
const PRODUCT_ID_SUFFIX = /-(\d{6,}|[a-z]\d{3,})$/i;

/**
 * Sitemap source, verified against the live robots.txt and sitemaps on 2026-10-22.
 * `CATALOG_SOURCES.doz` in catalog-index still points at www.doz.se and should be replaced by
 * this (see the A-doz PR); it lives here until then so tests and test:live use the real shape.
 * robots.txt: `Sitemap: https://dozapotek.se/media/sitemap/sitemap.xml` → sitemap-1-1.xml and
 * sitemap-1-2.xml, which mix categories, brands, CMS pages and ~28 000 products.
 */
export const catalogSource: CatalogSource = {
  sitemapUrl: `${BASE_URL}/media/sitemap/sitemap.xml`,
  productUrlFilter: (url) => {
    const segs = url.pathname.split('/').filter(Boolean);
    return (
      url.host === 'dozapotek.se' &&
      segs.length === 1 &&
      /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(segs[0]!) &&
      PRODUCT_ID_SUFFIX.test(segs[0]!)
    );
  },
  // Drop the trailing product id: "alvedon ... 20 styck 097610" → "alvedon ... 20 styck".
  slugToTitle: (url) => slugToTitle(url).replace(/ (\d{6,}|[a-z]\d{3,})$/i, ''),
};

/**
 * EAN from an image filename such as `7046260976108_1_1.png` or `07046261094726_C1L1.tif_12.png`
 * (GTIN-14 with a leading zero). Accepted only when the check digit validates.
 */
export function eanFromImageUrl(imageUrl: string | undefined): string | undefined {
  if (!imageUrl) return undefined;
  let file: string;
  try {
    file = new URL(imageUrl, BASE_URL).pathname.split('/').pop() ?? '';
  } catch {
    return undefined;
  }
  const digits = file.match(/^\d+/)?.[0];
  if (!digits || digits.length < 13) return undefined;
  if (digits.length >= 14 && digits.startsWith('0')) {
    return normalizeEan(digits.slice(0, 14)) ?? normalizeEan(digits.slice(0, 13));
  }
  return normalizeEan(digits.slice(0, 13));
}

/** The Product node: DOZ nests it as `mainEntity` of an ItemPage. */
function findProductLd(html: string): Record<string, unknown> | undefined {
  for (const node of extractJsonLd(html)) {
    const candidates = [node, node.mainEntity];
    for (const c of candidates) {
      if (isRecord(c) && hasType(c, 'Product')) return c;
    }
  }
  return undefined;
}

/** The page's `<h1>` (full title with pack size) and the package line right below it. */
function headerTexts(html: string): { title?: string; packageText?: string } {
  const m = html.match(
    /<h1[^>]*>([\s\S]*?)<\/h1>(?:\s*<div[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>)?/,
  );
  const text = (s: string | undefined) => {
    const t = s ? cleanText(s.replace(/<[^>]+>/g, ' ')) : '';
    return t || undefined;
  };
  return { title: text(m?.[1]), packageText: text(m?.[2]) };
}

const IN_STOCK_AVAILABILITY = /(InStock|OnlineOnly|LimitedAvailability)$/;

/**
 * Pure parsing of a product page. Returns null for prescription medicines (category
 * "Receptbelagda läkemedel", price 0) and for pages without product data.
 */
export function parseProduct(
  html: string,
  url: string,
  fetchedAt = new Date().toISOString(),
): ProductOffer | null {
  const ld = findProductLd(html);
  if (!ld) return null;
  if (/receptbelagd/i.test(stringOf(ld.category) ?? '')) return null;

  const offer = asArray(ld.offers).find(isRecord);
  if (!offer) return null;
  const price = parsePrice(offer.price as string | number | undefined);
  if (price == null || price <= 0) return null;
  const strike = asArray(offer.priceSpecification)
    .filter(isRecord)
    .find((s) => String(s.priceType ?? '').includes('StrikethroughPrice'));
  const regular = parsePrice(strike?.price as string | number | undefined);

  const header = headerTexts(html);
  const title = header.title ?? stringOf(ld.name);
  if (!title) return null;
  const packageText = header.packageText ?? '';
  const size = parseSize(packageText) ?? parseSize(title);
  const packCount = parsePackCount(packageText) ?? parsePackCount(title);

  const brand = isRecord(ld.brand) ? stringOf(ld.brand.name) : stringOf(ld.brand);
  const rawImage = asArray(ld.image).map(stringOf).find(Boolean);
  const image = rawImage && !rawImage.includes('/placeholder/') ? cleanText(rawImage) : undefined;
  const canonical = stringOf(offer.url) ?? stringOf(ld.url) ?? url;

  return {
    merchantId: MERCHANT_ID,
    merchantProductId: stringOf(ld.sku) ?? canonical,
    title: cleanText(title),
    brand: brand ? cleanText(brand) : undefined,
    ean: eanFromImageUrl(image),
    size,
    packCount,
    price,
    ...(regular != null && regular > price ? { originalPrice: regular } : {}),
    unitPrice: computeUnitPrice(price, size, packCount),
    inStock: IN_STOCK_AVAILABILITY.test(stringOf(offer.availability) ?? ''),
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

function hasType(node: Record<string, unknown>, type: string): boolean {
  const t = node['@type'];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

function stringOf(v: unknown): string | undefined {
  if (typeof v === 'number') return String(v);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

export interface DozAdapterOptions {
  /** Catalog index to search. Defaults to the shared `catalog.db` in the data dir. */
  db?: CatalogDb;
  /** Fetches a product page. Defaults to `fetchText` (politeFetch, 1 request/s per host). */
  fetchPage?: (url: string, signal?: AbortSignal) => Promise<string>;
}

export function createDozAdapter(opts: DozAdapterOptions = {}): MerchantAdapter {
  const fetchPage = opts.fetchPage ?? ((url, signal) => fetchText(url, { signal }));
  const getProduct: MerchantAdapter['getProduct'] = async (url, o) =>
    parseProduct(await fetchPage(url, o?.signal), url);

  return {
    info: {
      id: MERCHANT_ID,
      name: 'DOZ Apotek',
      baseUrl: BASE_URL,
      category: 'pharmacy',
      searchStrategy: 'catalog-index',
    },
    async search(query, so) {
      const q = query.trim();
      if (!q) return [];
      const limit = so?.limit ?? 10;
      const candidates = searchCandidates(
        MERCHANT_ID,
        q,
        Math.min(limit, MAX_PRODUCT_FETCHES),
        opts.db ? { db: opts.db } : {},
      );
      // Sequential on purpose: one store, one request at a time.
      const offers: ProductOffer[] = [];
      for (const c of candidates) {
        so?.signal?.throwIfAborted();
        try {
          const offer = await getProduct(c.url, { signal: so?.signal });
          if (offer) offers.push(offer);
        } catch (err) {
          // A product gone since the last catalog refresh shouldn't fail the whole search.
          if (so?.signal?.aborted) throw err;
        }
      }
      return offers.slice(0, limit);
    },
    getProduct,
  };
}

const adapter: MerchantAdapter = createDozAdapter();

export default adapter;
