import { describe, expect, it, beforeAll } from 'vitest';
import type { ItemCandidates, MerchantId, ProbeResult, ShippingPolicy } from '@apokorg/core';
import { MERCHANT_IDS } from '@apokorg/core';
import { applyProbe, optimize, shippingFee } from './optimize';
import { loadHighs } from './milp';
import { home, item, pickup, policy } from './test-helpers';

beforeAll(async () => {
  await loadHighs();
});

const byItem = (r: { assignments: { itemId: string; merchantId: MerchantId }[] }) =>
  Object.fromEntries(r.assignments.map((a) => [a.itemId, a.merchantId]));

describe('optimize', () => {
  it('moves a cheap item to a store when that makes its shipping free', async () => {
    // Both stores: 39 kr pickup, free from 300.
    //   item1: apoteket 250, lyko 265     item2: apoteket 60, lyko 50
    // Cheapest per item: 250 + 39 (apoteket) + 50 + 39 (lyko) = 378.
    // Both at apoteket: 310 >= 300, free shipping = 310.   Both at lyko: 315.
    const candidates = [
      item('item1', [
        { merchantId: 'apoteket', price: 250 },
        { merchantId: 'lyko', price: 265 },
      ]),
      item('item2', [
        { merchantId: 'apoteket', price: 60 },
        { merchantId: 'lyko', price: 50 },
      ]),
    ];
    const policies = [policy('apoteket', [pickup(39, 300)]), policy('lyko', [pickup(39, 300)])];
    const r = await optimize(candidates, policies, {});
    expect(byItem(r)).toEqual({ item1: 'apoteket', item2: 'apoteket' });
    expect(r.total).toBe(310);
    expect(r.perMerchant).toEqual([
      expect.objectContaining({ merchantId: 'apoteket', subtotal: 310, shipping: 0 }),
    ]);
    expect(r.bestSingleMerchant).toEqual({ merchantId: 'apoteket', total: 310 });
    expect(r.savingsVsBestSingle).toBe(0);
  });

  it('splits across stores when that is cheaper, and equals the best single store with maxMerchants 1', async () => {
    // Both stores: 9 kr pickup, never free.
    //   item1: apotea 100, hjartat 125     item2: apotea 80, hjartat 60
    // Split: 100 + 9 + 60 + 9 = 178.  apotea only: 180 + 9 = 189.  hjartat only: 185 + 9 = 194.
    const candidates = [
      item('item1', [
        { merchantId: 'apotea', price: 100 },
        { merchantId: 'hjartat', price: 125 },
      ]),
      item('item2', [
        { merchantId: 'apotea', price: 80 },
        { merchantId: 'hjartat', price: 60 },
      ]),
    ];
    const policies = [policy('apotea', [pickup(9)]), policy('hjartat', [pickup(9)])];

    const split = await optimize(candidates, policies, {});
    expect(byItem(split)).toEqual({ item1: 'apotea', item2: 'hjartat' });
    expect(split.total).toBe(178);
    expect(split.bestSingleMerchant).toEqual({ merchantId: 'apotea', total: 189 });
    expect(split.savingsVsBestSingle).toBe(11);

    const single = await optimize(candidates, policies, { maxMerchants: 1 });
    expect(byItem(single)).toEqual({ item1: 'apotea', item2: 'apotea' });
    expect(single.total).toBe(189);
    expect(single.total).toBe(single.bestSingleMerchant?.total);
    expect(single.savingsVsBestSingle).toBe(0);
  });

  it('lists an item no store can supply and still solves the rest', async () => {
    // item2 is only out of stock; item3 has no matches at all.
    // item1 at doz: 120 + 39 (doz pickup 39 free from 199) = 159.
    const candidates = [
      item('item1', [{ merchantId: 'doz', price: 120 }]),
      item('item2', [{ merchantId: 'doz', price: 10, inStock: false }]),
      item('item3', []),
    ];
    const r = await optimize(candidates, [policy('doz', [pickup(39, 199)])], {});
    expect(r.unavailableItemIds).toEqual(['item2', 'item3']);
    expect(byItem(r)).toEqual({ item1: 'doz' });
    expect(r.total).toBe(159);
    expect(r.bestSingleMerchant).toEqual({ merchantId: 'doz', total: 159 });
  });

  it('lists items left out by maxMerchants as unavailable', async () => {
    // item1 only at kronans, item2 only at lyko, fees 0. With one store, the penalty keeps
    // as many items as possible and then the cheaper store: kronans (50) over lyko (70).
    const candidates = [
      item('item1', [{ merchantId: 'kronans', price: 50 }]),
      item('item2', [{ merchantId: 'lyko', price: 70 }]),
    ];
    const policies = [policy('kronans', [pickup(0)]), policy('lyko', [pickup(0)])];
    const r = await optimize(candidates, policies, { maxMerchants: 1 });
    expect(r.unavailableItemIds).toEqual(['item2']);
    expect(r.total).toBe(50);
    expect(r.bestSingleMerchant).toBeUndefined();
  });

  it('home-only changes the chosen delivery option and store', async () => {
    // hjartat: pickup 29 / home 49, both free from 299. apotea: pickup only, free.
    //   item: hjartat 100, apotea 110
    // cheapest:  apotea 110 + 0 = 110 (vs hjartat 100 + 29 = 129).
    // home-only: apotea has no home option, so hjartat 100 + 49 = 149.
    const candidates = [
      item('item1', [
        { merchantId: 'hjartat', price: 100 },
        { merchantId: 'apotea', price: 110 },
      ]),
    ];
    const policies = [
      policy('hjartat', [pickup(29, 299), home(49, 299)]),
      policy('apotea', [pickup(0)]),
    ];
    const cheapest = await optimize(candidates, policies, {});
    expect(cheapest.total).toBe(110);
    expect(cheapest.perMerchant[0]).toMatchObject({ merchantId: 'apotea' });
    expect(cheapest.perMerchant[0]!.delivery.kind).toBe('pickup-point');

    const homeOnly = await optimize(candidates, policies, { delivery: 'home-only' });
    expect(homeOnly.total).toBe(149);
    expect(homeOnly.perMerchant[0]).toMatchObject({ merchantId: 'hjartat', shipping: 49 });
    expect(homeOnly.perMerchant[0]!.delivery.kind).toBe('home');
  });

  it('cheapest leaves out store pickup unless include-store-pickup is chosen', async () => {
    // apoteket: free store pickup, pickup point 39 free from 300.  item: apoteket 100, lyko 110.
    // lyko: pickup point 19.
    // cheapest:             apoteket 100 + 39 = 139 > lyko 110 + 19 = 129, so lyko.
    // include-store-pickup: apoteket 100 + 0 = 100.
    const candidates = [
      item('item1', [
        { merchantId: 'apoteket', price: 100 },
        { merchantId: 'lyko', price: 110 },
      ]),
    ];
    const policies = [
      policy('apoteket', [pickup(0, undefined, { kind: 'store-pickup' }), pickup(39, 300)]),
      policy('lyko', [pickup(19)]),
    ];
    const cheapest = await optimize(candidates, policies, {});
    expect(cheapest.total).toBe(129);
    expect(cheapest.perMerchant[0]).toMatchObject({ merchantId: 'lyko' });

    const withPickup = await optimize(candidates, policies, { delivery: 'include-store-pickup' });
    expect(withPickup.total).toBe(100);
    expect(withPickup.perMerchant[0]!.delivery.kind).toBe('store-pickup');
  });

  it('applies a multi-buy deal to each full set', async () => {
    // 5 items at 40 kr, "3 for 99" (33 each): 3 × 33 + 2 × 40 = 179, plus free pickup.
    const candidates = [
      item('item1', [{ merchantId: 'apotea', price: 40, multiBuy: { qty: 3, unitPrice: 33 } }], {
        qty: 5,
      }),
    ];
    const r = await optimize(candidates, [policy('apotea', [pickup(0)])], {});
    expect(r.assignments[0]!.lineTotal).toBe(179);
    expect(r.total).toBe(179);
  });

  it('picks the cheaper option of one store, by kind', async () => {
    // hjartat item 100: pickup 29 beats home 49 under 'cheapest'.
    const candidates = [item('item1', [{ merchantId: 'hjartat', price: 100 }])];
    const policies = [policy('hjartat', [home(49, 299), pickup(29, 299)])];
    const r = await optimize(candidates, policies, {});
    expect(r.perMerchant[0]).toMatchObject({ shipping: 29, delivery: { kind: 'pickup-point' } });
    expect(r.total).toBe(129);
  });

  it('a probe override with a higher fee moves items elsewhere', async () => {
    // JSON: both stores pickup 29 free from 299.  item: apoteket 100, lyko 110.
    // Without probe: apoteket 129 < lyko 139.
    // Probe of apoteket at order value 100 shows pickup 59 (threshold kept, 100 < 299):
    // apoteket 159 > lyko 139, so the item moves to lyko.
    const candidates = [
      item('item1', [
        { merchantId: 'apoteket', price: 100 },
        { merchantId: 'lyko', price: 110 },
      ]),
    ];
    const policies = [policy('apoteket', [pickup(29, 299)]), policy('lyko', [pickup(29, 299)])];
    const before = await optimize(candidates, policies, {});
    expect(byItem(before)).toEqual({ item1: 'apoteket' });
    expect(before.total).toBe(129);

    const probe: ProbeResult = {
      merchantId: 'apoteket',
      orderValue: 100,
      postcode: '11122',
      options: [pickup(59)],
      probedAt: '2026-10-21T10:00:00Z',
      status: 'ok',
    };
    const after = await optimize(candidates, policies, {}, [probe]);
    expect(byItem(after)).toEqual({ item1: 'lyko' });
    expect(after.total).toBe(139);
    expect(after.perMerchant[0]!.probeVerified).toBe(false);

    // A cheaper probed fee keeps the item at apoteket and marks the total probe-verified.
    const cheaper = await optimize(candidates, policies, {}, [{ ...probe, options: [pickup(19)] }]);
    expect(cheaper.total).toBe(119);
    expect(cheaper.perMerchant[0]).toMatchObject({ merchantId: 'apoteket', probeVerified: true });

    // Failed probes are ignored.
    const failed = await optimize(candidates, policies, {}, [{ ...probe, status: 'failed' }]);
    expect(failed.total).toBe(129);
  });

  it('never chooses out-of-stock offers or disallowed substitutes', async () => {
    // apotea 10 is out of stock; doz 5 is a substitute; kronans 50 exact. Fees 0.
    const offers = [
      { merchantId: 'apotea' as const, price: 10, inStock: false },
      { merchantId: 'doz' as const, price: 5, kind: 'substitute' as const },
      { merchantId: 'kronans' as const, price: 50 },
    ];
    const policies = [
      policy('apotea', [pickup(0)]),
      policy('doz', [pickup(0)]),
      policy('kronans', [pickup(0)]),
    ];
    const strict = await optimize([item('item1', offers)], policies, {});
    expect(strict.assignments[0]).toMatchObject({ merchantId: 'kronans', kind: 'exact' });
    expect(strict.total).toBe(50);

    const loose = await optimize(
      [item('item1', offers, { acceptSubstitutes: true })],
      policies,
      {},
    );
    expect(loose.assignments[0]).toMatchObject({ merchantId: 'doz', kind: 'substitute' });
    expect(loose.total).toBe(5);
  });

  it('uses member prices only for stores the user is a member of, and multiplies by qty', async () => {
    // qty 2. lyko 100 (member 80), apotea 90. Fees 0.
    // Not a member: apotea 180.  Member of lyko: 160.
    const candidates = [
      item(
        'item1',
        [
          { merchantId: 'lyko', price: 100, memberPrice: 80 },
          { merchantId: 'apotea', price: 90 },
        ],
        { qty: 2 },
      ),
    ];
    const policies = [policy('lyko', [pickup(0)]), policy('apotea', [pickup(0)])];
    expect((await optimize(candidates, policies, {})).total).toBe(180);
    const member = await optimize(candidates, policies, { memberOf: ['lyko'] });
    expect(member.total).toBe(160);
    expect(member.assignments[0]).toMatchObject({ merchantId: 'lyko', lineTotal: 160, qty: 2 });
  });

  it('respects excludedMerchants', async () => {
    const candidates = [
      item('item1', [
        { merchantId: 'apotea', price: 10 },
        { merchantId: 'doz', price: 20 },
      ]),
    ];
    const policies = [policy('apotea', [pickup(0)]), policy('doz', [pickup(0)])];
    const r = await optimize(candidates, policies, { excludedMerchants: ['apotea'] });
    expect(byItem(r)).toEqual({ item1: 'doz' });
  });

  it('respects minOrder on a delivery option', async () => {
    // kronans' only option needs an order of 200; the item costs 100 there, 150 at lyko.
    const candidates = [
      item('item1', [
        { merchantId: 'kronans', price: 100 },
        { merchantId: 'lyko', price: 150 },
      ]),
    ];
    const policies = [
      policy('kronans', [pickup(0, undefined, { minOrder: 200 })]),
      policy('lyko', [pickup(0)]),
    ];
    const r = await optimize(candidates, policies, {});
    expect(byItem(r)).toEqual({ item1: 'lyko' });
    expect(r.bestSingleMerchant).toEqual({ merchantId: 'lyko', total: 150 });
  });

  it('may buy a pricier offer to reach a free-shipping threshold', async () => {
    // gymgrossisten pickup 49 free from 499. Two offers for item2 at the same store.
    // item1 400. item2: 90 (small tub) or 99 (substitute, bigger tub, accepted).
    // 400 + 90 = 490 + 49 = 539;  400 + 99 = 499, free = 499.
    const candidates = [
      item('item1', [{ merchantId: 'gymgrossisten', price: 400 }]),
      item(
        'item2',
        [
          { merchantId: 'gymgrossisten', price: 90 },
          { merchantId: 'gymgrossisten', price: 99, kind: 'substitute' },
        ],
        { acceptSubstitutes: true },
      ),
    ];
    const r = await optimize(candidates, [policy('gymgrossisten', [pickup(49, 499)])], {});
    expect(r.total).toBe(499);
    expect(r.perMerchant[0]).toMatchObject({ subtotal: 499, shipping: 0 });
  });

  it('falls back to a conservative fee for a store without a policy', async () => {
    const r = await optimize([item('item1', [{ merchantId: 'mock', price: 10 }])], [], {});
    expect(r.total).toBe(89);
  });

  it('returns an empty result for an empty basket', async () => {
    const r = await optimize([], [], {});
    expect(r).toMatchObject({ assignments: [], perMerchant: [], total: 0, unavailableItemIds: [] });
  });
});

describe('applyProbe / shippingFee', () => {
  it('keeps the JSON threshold when the probed value was below it, drops it otherwise', () => {
    const json = [pickup(29, 299)];
    const base = {
      merchantId: 'hjartat' as const,
      postcode: '11122',
      probedAt: '2026-10-21T10:00:00Z',
      status: 'ok' as const,
    };
    expect(applyProbe(json, { ...base, orderValue: 100, options: [pickup(39)] })).toEqual([
      pickup(39, 299),
    ]);
    expect(applyProbe(json, { ...base, orderValue: 350, options: [pickup(39)] })).toEqual([
      pickup(39),
    ]);
  });

  it('charges the fee only below freeFrom', () => {
    expect(shippingFee(pickup(29, 299), 298.99)).toBe(29);
    expect(shippingFee(pickup(29, 299), 299)).toBe(0);
    expect(shippingFee(pickup(29), 1000)).toBe(29);
  });
});

/** Deterministic pseudo-random numbers (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInstance(seed: number, nItems: number, merchants: MerchantId[]) {
  const rand = rng(seed);
  const candidates: ItemCandidates[] = [];
  for (let i = 0; i < nItems; i++) {
    const offers = merchants
      .filter(() => rand() < 0.8)
      .map((merchantId) => ({ merchantId, price: Math.round(20 + rand() * 300) }));
    candidates.push(item(`item${i}`, offers));
  }
  const policies: ShippingPolicy[] = merchants.map((m) =>
    policy(m, [
      pickup(Math.round(19 + rand() * 40), Math.round(150 + rand() * 400)),
      home(Math.round(49 + rand() * 40)),
    ]),
  );
  return { candidates, policies };
}

/** Exhaustive search over every store assignment, for cross-checking small instances. */
function bruteForce(candidates: ItemCandidates[], policies: ShippingPolicy[]): number {
  const items = candidates.filter((c) => c.matches.length > 0);
  let best = Infinity;
  const pick = (i: number, subtotals: Map<MerchantId, number>) => {
    if (i === items.length) {
      let total = 0;
      for (const [m, sub] of subtotals) {
        const opts = policies.find((p) => p.merchantId === m)!.options;
        total += sub + Math.min(...opts.map((o) => shippingFee(o, sub)));
      }
      best = Math.min(best, total);
      return;
    }
    for (const match of items[i]!.matches) {
      const m = match.offer.merchantId;
      const next = new Map(subtotals);
      next.set(m, (next.get(m) ?? 0) + match.offer.price);
      pick(i + 1, next);
    }
  };
  pick(0, new Map());
  return Math.round(best * 100) / 100;
}

describe('optimize, randomised', () => {
  it('matches exhaustive search on small instances', async () => {
    const merchants: MerchantId[] = ['apotea', 'hjartat', 'apoteket', 'doz'];
    for (let seed = 1; seed <= 15; seed++) {
      const { candidates, policies } = randomInstance(seed, 6, merchants);
      const r = await optimize(candidates, policies, {});
      expect(r.total, `seed ${seed}`).toBeCloseTo(bruteForce(candidates, policies), 2);
      // The split total is the per-store subtotals plus shipping.
      const sum = r.perMerchant.reduce((s, m) => s + m.subtotal + m.shipping, 0);
      expect(r.total).toBeCloseTo(sum, 2);
    }
  });

  it('solves 30 items x 11 stores in under 200 ms', async () => {
    const merchants = MERCHANT_IDS.filter((m) => m !== 'mock').slice(0, 11);
    expect(merchants).toHaveLength(11);
    const { candidates, policies } = randomInstance(42, 30, merchants);
    await optimize(candidates, policies, {}); // warm-up (JIT)
    const start = performance.now();
    const r = await optimize(candidates, policies, {});
    const ms = performance.now() - start;
    expect(r.unavailableItemIds).toEqual([]);
    expect(ms).toBeLessThan(200);
  });
});
