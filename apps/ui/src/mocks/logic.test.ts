import { describe, expect, it } from 'vitest';
import { OptimizeOptions } from '@apokorg/core';
import { createMockState, mockMerchants } from './data';
import { chooseDelivery, greedySplit, matchSearches, searchMerchants } from './logic';

const merchants = mockMerchants.map((m) => m.id);

async function candidatesFor(queries: string[], acceptSubstitutes = false) {
  return Promise.all(
    queries.map(async (query, i) => {
      const searches = await searchMerchants(query, merchants);
      const { byMerchant } = matchSearches(query, searches);
      return {
        item: { id: `i${i}`, query, qty: 1, acceptSubstitutes, pinned: {} },
        matches: [...byMerchant.values()].flatMap((ms) => ms.slice(0, 1)),
      };
    }),
  );
}

describe('mock matching', () => {
  it('asks for confirmation only when two products fit equally', async () => {
    const clear = matchSearches('alvedon 20 st', await searchMerchants('alvedon 20 st', merchants));
    expect(clear.needsConfirmation).toBe(false);
    const vague = matchSearches('whey', await searchMerchants('whey', merchants));
    expect(vague.needsConfirmation).toBe(true);
  });
});

describe('greedy split stand-in', () => {
  const shipping = createMockState().shipping;

  it('picks the cheapest store per item and adds shipping', async () => {
    const split = greedySplit(
      await candidatesFor(['alvedon 20 st', 'cerave']),
      OptimizeOptions.parse({}),
      shipping,
    );
    expect(split.assignments.map((a) => a.merchantId)).toEqual(['doz', 'lyko']);
    const sum = split.perMerchant.reduce((s, m) => s + m.subtotal + m.shipping, 0);
    expect(split.total).toBeCloseTo(sum);
    expect(split.perMerchant.every((m) => m.delivery.kind !== 'store-pickup')).toBe(true);
  });

  it('counts free store pickup only with include-store-pickup', async () => {
    const candidates = await candidatesFor(['alvedon 20 st', 'cerave']);
    const cheapest = greedySplit(candidates, OptimizeOptions.parse({}), shipping);
    expect(cheapest.bestSingleMerchant?.merchantId).not.toBe('hjartat');
    // Hjärtat's free store pickup beats DOZ's cheaper items plus mailbox fee.
    const withPickup = greedySplit(
      candidates,
      OptimizeOptions.parse({ delivery: 'include-store-pickup' }),
      shipping,
    );
    expect(withPickup.bestSingleMerchant?.merchantId).toBe('hjartat');
  });

  it('respects maxMerchants', async () => {
    const split = greedySplit(
      await candidatesFor(['alvedon 20 st', 'cerave', 'nivea']),
      OptimizeOptions.parse({ maxMerchants: 1 }),
      shipping,
    );
    expect(new Set(split.assignments.map((a) => a.merchantId)).size).toBe(1);
  });

  it('applies free shipping from the threshold', () => {
    const policy = shipping.get('apotea');
    expect(chooseDelivery(policy, 100, 'cheapest').shipping).toBe(29);
    expect(chooseDelivery(policy, 300, 'cheapest').shipping).toBe(0);
    expect(chooseDelivery(policy, 300, 'home-only').delivery.kind).toBe('home');
  });
});
