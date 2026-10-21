import {
  type ItemCandidates,
  type MatchResult,
  type MerchantId,
  OptimizeOptions,
  type ShippingPolicy,
  SplitResult,
} from '@apokorg/core';
import { describe, expect, it } from 'vitest';
import { placeholderMatcher } from './matching';
import { placeholderOptimizer } from './optimizing';

const offer = (merchantId: MerchantId, id: string, price: number, ean?: string) => ({
  merchantId,
  merchantProductId: `${merchantId}-${id}`,
  title: id,
  ean,
  price,
  inStock: true,
  url: `https://example.com/${merchantId}/${id}`,
  fetchedAt: '2026-10-21T00:00:00.000Z',
});

const exact = (merchantId: MerchantId, id: string, price: number): MatchResult => ({
  offer: offer(merchantId, id, price),
  kind: 'exact',
  confidence: 0.9,
  reasons: [],
});

const policy = (merchantId: MerchantId, fee: number, freeFrom?: number): ShippingPolicy => ({
  merchantId,
  options: [{ id: 'home', name: 'Hem', kind: 'home', fee, freeFrom }],
  lastVerified: '2026-10-21',
});

const item = (itemId: string, matches: MatchResult[]): ItemCandidates => ({
  itemId,
  qty: 1,
  acceptSubstitutes: false,
  matches,
});

describe('placeholderOptimizer', () => {
  it('assigns each item to its cheapest store and adds shipping per store', async () => {
    // i1: apotea 100 < doz 110; i2: doz 50 < apotea 60.
    // Split: apotea 100 + 29 shipping, doz 50 + 39 shipping = 218.
    // Single apotea: 160 + 29 = 189; single doz: 160 + 39 = 199. Savings vs best single: -29.
    const split = SplitResult.parse(
      await placeholderOptimizer.optimize(
        [
          item('i1', [exact('apotea', 'a', 100), exact('doz', 'a', 110)]),
          item('i2', [exact('apotea', 'b', 60), exact('doz', 'b', 50)]),
          item('i3', []),
        ],
        [policy('apotea', 29), policy('doz', 39)],
        OptimizeOptions.parse({}),
      ),
    );
    expect(split.total).toBe(218);
    expect(split.unavailableItemIds).toEqual(['i3']);
    expect(split.bestSingleMerchant).toEqual({ merchantId: 'apotea', total: 189 });
    expect(split.savingsVsBestSingle).toBe(-29);
  });

  it('applies free shipping thresholds and maxMerchants', async () => {
    const split = await placeholderOptimizer.optimize(
      [
        item('i1', [exact('apotea', 'a', 300), exact('doz', 'a', 310)]),
        item('i2', [exact('apotea', 'b', 60), exact('doz', 'b', 50)]),
      ],
      [policy('apotea', 49, 299), policy('doz', 39)],
      OptimizeOptions.parse({ maxMerchants: 1 }),
    );
    expect(split.perMerchant).toEqual([
      expect.objectContaining({ merchantId: 'apotea', subtotal: 360, shipping: 0 }),
    ]);
    expect(split.total).toBe(360);
  });
});

describe('placeholderMatcher', () => {
  it('marks same-EAN offers exact and drops substitutes unless accepted', async () => {
    const offers = [
      offer('apotea', 'x20', 39, '2000000000015'),
      offer('apotea', 'x10', 25, '2000000000022'),
      offer('doz', 'x20', 38, '2000000000015'),
    ];
    const strict = await placeholderMatcher.matchOffers('x', offers, {
      acceptSubstitutes: false,
      pinned: {},
    });
    expect(strict.map((r) => [r.offer.merchantProductId, r.kind])).toEqual([
      ['apotea-x20', 'exact'],
      ['doz-x20', 'exact'],
    ]);
    const loose = await placeholderMatcher.matchOffers('x', offers, {
      acceptSubstitutes: true,
      pinned: {},
    });
    expect(loose.at(-1)).toMatchObject({ kind: 'substitute' });
  });
});
