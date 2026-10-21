import type { api, BasketItem, MatchResult, MerchantId } from '@apokorg/core';

export interface ComparisonCell {
  merchantId: MerchantId;
  match?: MatchResult;
  /** Lowest price among the offers the optimizer may use for this item. */
  cheapest: boolean;
}

export interface ComparisonRow {
  item: BasketItem;
  cells: ComparisonCell[];
}

/** Can the optimizer use this offer for this item? In stock, and a substitute only if allowed. */
export function isEligible(item: BasketItem, m: MatchResult): boolean {
  return m.offer.inStock && (m.kind !== 'substitute' || item.acceptSubstitutes);
}

/** Items × stores, taking the first (best) candidate per store for each item. */
export function buildComparison(
  items: BasketItem[],
  candidates: api.OptimizeResponse['candidates'],
  merchants: MerchantId[],
): ComparisonRow[] {
  return items.map((item) => {
    const matches = candidates.find((c) => c.itemId === item.id)?.matches ?? [];
    const best = new Map<MerchantId, MatchResult>();
    for (const m of matches) {
      if (!best.has(m.offer.merchantId)) best.set(m.offer.merchantId, m);
    }
    const eligiblePrices = [...best.values()]
      .filter((m) => isEligible(item, m))
      .map((m) => m.offer.price);
    const min = eligiblePrices.length ? Math.min(...eligiblePrices) : undefined;
    return {
      item,
      cells: merchants.map((merchantId) => {
        const match = best.get(merchantId);
        return {
          merchantId,
          match,
          cheapest: !!match && isEligible(item, match) && match.offer.price === min,
        };
      }),
    };
  });
}
