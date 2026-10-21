import type { MatchKind, MatchResult, MerchantId, ProductOffer } from '@apokorg/core';
import { createMockAdapters } from '@apokorg/adapter-mock';

/** Builds an offer with sensible defaults; only the title is required. */
export function offer(
  merchantId: MerchantId,
  merchantProductId: string,
  title: string,
  extra: Partial<ProductOffer> = {},
): ProductOffer {
  return {
    merchantId,
    merchantProductId,
    title,
    price: 100,
    inStock: true,
    url: `https://example.com/${merchantId}/${merchantProductId}`,
    fetchedAt: '2026-10-21T00:00:00.000Z',
    ...extra,
  };
}

/** Every offer in the mock catalog, for every mock merchant (ids like "apotea-p01"). */
export function mockCatalogOffers(): Promise<ProductOffer[]> {
  catalogOffers ??= Promise.all(
    createMockAdapters().flatMap((adapter) =>
      Array.from({ length: 10 }, (_, i) =>
        adapter.getProduct(
          `https://example.com/${adapter.info.id}/p${String(i + 1).padStart(2, '0')}`,
        ),
      ),
    ),
  ).then((offers) => offers.filter((o): o is ProductOffer => o !== null));
  return catalogOffers;
}

let catalogOffers: Promise<ProductOffer[]> | undefined;

/** merchantProductId → kind, for compact assertions. */
export function kinds(results: MatchResult[]): Record<string, MatchKind> {
  return Object.fromEntries(results.map((r) => [r.offer.merchantProductId, r.kind]));
}
