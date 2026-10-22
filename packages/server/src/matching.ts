/**
 * Matching goes through the `Matcher` interface so packages/matcher (task M) can replace the
 * placeholder below with a one-line change in deps.ts.
 */
import type { BasketItem, MatchResult, ProductOffer, Size } from '@apokorg/core';
import type { LlmJudge } from '@apokorg/matcher';

export interface MatchOptions {
  acceptSubstitutes: boolean;
  /** User-confirmed merchantProductId per merchant. Always wins. */
  pinned: BasketItem['pinned'];
  /** Tie-breaker for near-equal candidates; set when the user saved an API key. */
  llm?: LlmJudge;
  /** The chosen product's container size and pack count, so smaller packs are scaled up. */
  want?: { size?: Size; packCount?: number };
}

export interface Matcher {
  matchOffers(
    query: string,
    offers: ProductOffer[],
    opts: MatchOptions,
  ): MatchResult[] | Promise<MatchResult[]>;
  /** Optional; defaults to `defaultNeedsConfirmation`. */
  needsConfirmation?(results: MatchResult[]): boolean;
}

/** True when no exact match reaches confidence 0.8 at any store. */
export function defaultNeedsConfirmation(results: MatchResult[]): boolean {
  return !results.some((r) => r.kind === 'exact' && r.confidence >= 0.8);
}

/**
 * Placeholder until packages/matcher lands. Per store: a pinned offer is exact (1.0);
 * otherwise an offer sharing the anchor EAN is exact (0.9), where the anchor is the EAN of a
 * pinned offer or the most common EAN among each store's top result; a store with no anchor
 * EAN offer gets its top result as exact (0.6). Everything else is a substitute (0.3), kept
 * only when substitutes are accepted. Result order: best per store first, then the rest.
 */
export const placeholderMatcher: Matcher = {
  matchOffers(_query, offers, { acceptSubstitutes, pinned }) {
    const byMerchant = new Map<string, ProductOffer[]>();
    for (const o of offers) {
      const list = byMerchant.get(o.merchantId) ?? [];
      list.push(o);
      byMerchant.set(o.merchantId, list);
    }

    const isPinned = (o: ProductOffer) => pinned[o.merchantId] === o.merchantProductId;
    let anchor = offers.find((o) => isPinned(o) && o.ean)?.ean;
    if (!anchor) {
      const counts = new Map<string, number>();
      for (const list of byMerchant.values()) {
        const ean = list[0]?.ean;
        if (ean) counts.set(ean, (counts.get(ean) ?? 0) + 1);
      }
      anchor = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    }

    const best: MatchResult[] = [];
    const rest: MatchResult[] = [];
    for (const list of byMerchant.values()) {
      const top =
        list.find(isPinned) ?? (anchor ? list.find((o) => o.ean === anchor) : undefined) ?? list[0];
      for (const offer of list) {
        let result: MatchResult;
        if (isPinned(offer)) {
          result = { offer, kind: 'exact', confidence: 1, reasons: ['pinned by user'] };
        } else if (anchor && offer.ean === anchor) {
          result = { offer, kind: 'exact', confidence: 0.9, reasons: ['same EAN'] };
        } else if (offer === top) {
          result = { offer, kind: 'exact', confidence: 0.6, reasons: ['top search result'] };
        } else {
          if (!acceptSubstitutes) continue;
          result = { offer, kind: 'substitute', confidence: 0.3, reasons: ['other search result'] };
        }
        (offer === top ? best : rest).push(result);
      }
    }
    return [...best, ...rest];
  },
};
