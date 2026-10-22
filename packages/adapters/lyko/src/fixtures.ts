/**
 * Fixture helpers (used by live.test.ts when recording). Lyko pages are 0.25-1 MB, mostly
 * menus, translations, facets, reviews and tracking data. We keep only the product fields the
 * parser and future matchers care about and re-wrap them the same way the site does
 * (`window.CURRENT_PAGE = {...};`), so parsing results stay identical.
 */
import { extractWindowJson } from '@apokorg/adapter-kit';

const KEEP = [
  'code',
  'url',
  'canonicalUrl',
  'displayName',
  'entryName',
  'productName',
  'brandName',
  'color',
  'price',
  'images',
  'size',
  'unit',
  'sizeAndUnit',
  'variationType',
  'variationDescription',
  'deepestCategoryUrl',
  'categoryName',
  'isSponsored',
  'isAd',
  'isDigital',
  'isCharity',
  'offerPlate',
  'onlineStatus',
  'deliveryInformation',
  'campaignExplanationText',
  'ean',
  'linkingData',
  'componentName',
] as const;

function slimVariant(raw: unknown): Record<string, unknown> {
  const p = (raw ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of KEEP) if (p[k] !== undefined) out[k] = p[k];
  if (Array.isArray(out.images)) {
    out.images = out.images.slice(0, 1).map((i: { url?: string }) => ({ url: i.url }));
  }
  const ld = out.linkingData as Record<string, unknown> | null | undefined;
  if (ld) out.linkingData = { '@type': ld['@type'], sku: ld.sku, offers: ld.offers };
  return out;
}

/** Wraps data like the site does: a plain object literal, safe inside a script tag. */
export function wrapCurrentPage(data: unknown): string {
  const json = JSON.stringify(data).replace(/<\//g, '<\\/').replace(/<!--/g, '\\u003c!--');
  return `<!DOCTYPE html>\n<html lang="sv"><head><title>fixture</title></head><body>\n<script>window.CURRENT_PAGE = ${json};\nwindow.IS_SERVER_SIDE_RENDERED = true;</script>\n</body></html>\n`;
}

export function trimSearchPage(html: string, maxProducts = Infinity): string {
  const page = extractWindowJson<Record<string, unknown>>(html, 'CURRENT_PAGE') ?? {};
  const listing = (page.products ?? {}) as Record<string, unknown>;
  const products = Array.isArray(listing.products) ? listing.products : [];
  return wrapCurrentPage({
    products: {
      products: products.slice(0, maxProducts).map(slimVariant),
      totalProductCount: listing.totalProductCount,
    },
    searchPhrase: page.searchPhrase,
    redirectedSearchPhrase: page.redirectedSearchPhrase,
    url: page.url,
    componentName: page.componentName,
  });
}

export function trimProductPage(html: string): string {
  return wrapCurrentPage(slimVariant(extractWindowJson(html, 'CURRENT_PAGE')));
}
