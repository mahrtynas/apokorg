/**
 * Fixture helpers (used by live.test.ts when recording). Hjärtat pages are 0.4-1 MB, mostly
 * menus, footer and tracking data. We keep only the product fields the parser and future
 * matchers care about and re-wrap them the same way the site does
 * (`window.INITIAL_DATA = JSON.parse('...')`), so parsing results stay identical.
 */
import { extractInitialData } from './initial-data';

const KEEP = [
  'url',
  'productName',
  'productNumber',
  'sku',
  'price',
  'priceSubtitle',
  'priceSubtitle2',
  'pricePerUnit',
  'storePrice',
  'size',
  'images',
  'metaInfo',
  'variant',
  'isBuyableWithoutPrescription',
  'isOtcMedicine',
  'belongsToPrescriptionProductGroup',
  'addToCartButtonIsActive',
  'hasVariants',
  'brands',
  'gtin',
  'trackingProductInformation',
  'primaryLabels',
  'secondaryLabels',
  'campaignLinks',
  'isSponsored',
  'componentName',
] as const;

function slimProduct(raw: unknown): Record<string, unknown> {
  const p = (raw ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of KEEP) if (p[k] !== undefined) out[k] = p[k];
  if (Array.isArray(out.images)) out.images = out.images.slice(0, 1);
  const meta = out.metaInfo as { canonicalUrl?: string } | undefined;
  if (meta) out.metaInfo = { canonicalUrl: meta.canonicalUrl };
  const variant = out.variant as Record<string, unknown> | undefined;
  if (variant)
    out.variant = { name: variant.name, sku: variant.sku, stockStatus: variant.stockStatus };
  const tracking = out.trackingProductInformation as Record<string, unknown> | undefined;
  if (tracking) {
    out.trackingProductInformation = {
      id: tracking.id,
      brand: tracking.brand,
      category: tracking.category,
      ean: tracking.ean,
      stockStatus: tracking.stockStatus,
    };
  }
  return out;
}

/** Wraps data like the site does, including the `' + '` split around `<!--`. */
export function wrapInitialData(data: unknown): string {
  const literal = JSON.stringify(data)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/<\//g, '<\\/')
    .replace(/<!--/g, "<' + '!--");
  return `<!DOCTYPE html>\n<html lang="sv"><head><title>fixture</title></head><body>\n<script>window.INITIAL_DATA = JSON.parse('${literal}');\nwindow.IS_SERVER_SIDE_RENDERED = true;</script>\n</body></html>\n`;
}

export function trimSearchPage(html: string, maxProducts = Infinity): string {
  const data = extractInitialData<{ page?: Record<string, unknown> }>(html);
  const page = data?.page ?? {};
  const products = Array.isArray(page.products) ? page.products : [];
  return wrapInitialData({
    page: {
      searchPhrase: page.searchPhrase,
      pagination: page.pagination,
      products: products.slice(0, maxProducts).map(slimProduct),
      componentName: page.componentName,
    },
  });
}

export function trimProductPage(html: string): string {
  const data = extractInitialData<{ page?: unknown }>(html);
  return wrapInitialData({ page: slimProduct(data?.page) });
}
