import { describe, expect, it } from 'vitest';
import { matchOffersSync } from './match';
import { parseQuery } from './query';
import { kinds, offer } from './test-helpers';

const can = { value: 330, unit: 'ml' } as const;
const nocco = { brand: 'NOCCO', size: can };

// Real listings for "nocco arancia" (2026-10-22).
const offers = [
  offer('apotea', 'single', 'NOCCO BCAA Arancia 330 ml', { ...nocco, price: 22 }),
  offer('apotea', 'flak', 'NOCCO BCAA Arancia 330 ml x 24 st', {
    ...nocco,
    packCount: 24,
    price: 429,
    ean: '27340131605680',
  }),
  offer('meds', 'single', 'NOCCO BCAA Arancia 330 ml', { ...nocco, price: 22 }),
  offer('gymgrossisten', 'flak', '24 x NOCCO BCAA, 330 ml, Arancia', {
    ...nocco,
    packCount: 24,
    price: 499,
  }),
  offer('gymgrossisten', 'six', '6 x NOCCO BCAA, 330 ml, Arancia', {
    ...nocco,
    packCount: 6,
    price: 129,
  }),
];

const byStore = (results: ReturnType<typeof matchOffersSync>) =>
  Object.fromEntries(results.map((r) => [`${r.offer.merchantId}-${r.offer.merchantProductId}`, r]));

describe('pack scaling', () => {
  it('scales a single can to the chosen 24-pack', () => {
    const results = byStore(
      matchOffersSync('NOCCO BCAA Arancia 330 ml x 24 st', offers, { acceptSubstitutes: true }),
    );
    expect(results['meds-single']).toMatchObject({ kind: 'equivalent', packs: 24 });
    expect(results['meds-single']!.reasons).toContain('sold singly: 24 make a pack of 24');
    expect(results['gymgrossisten-six']).toMatchObject({ packs: 4 });
    // The real 24-pack wins where a store has one; it needs no scaling.
    expect(results['apotea-flak']).toMatchObject({ kind: 'exact' });
    expect(results['apotea-flak']!.packs).toBeUndefined();
    expect(results['apotea-single']).toMatchObject({ kind: 'substitute', packs: 24 });
  });

  it('takes size and pack count from `want` when the query leaves them out', () => {
    const results = byStore(
      matchOffersSync('nocco arancia', offers, {
        acceptSubstitutes: true,
        want: { size: can, packCount: 24 },
        pinned: { meds: 'single', apotea: 'flak' },
      }),
    );
    // Pinned listings keep the scaling, so the optimizer prices 24 cans.
    expect(results['meds-single']).toMatchObject({ kind: 'exact', packs: 24 });
    expect(results['apotea-flak']!.packs).toBeUndefined();
  });

  it('does not scale without a chosen multipack', () => {
    const results = matchOffersSync('NOCCO BCAA Arancia 330 ml', offers, {
      acceptSubstitutes: true,
    });
    expect(results.every((r) => r.packs === undefined)).toBe(true);
  });

  it('does not scale packs that do not divide the chosen one, or tablets', () => {
    const odd = [
      offer('apotea', 'ten', 'Nocco BCAA Arancia 330 ml x 10 st', { ...nocco, packCount: 10 }),
    ];
    expect(
      matchOffersSync('NOCCO BCAA Arancia 330 ml x 24 st', odd, { acceptSubstitutes: true })[0]!
        .packs,
    ).toBeUndefined();

    const tablets = [offer('apotea', 'a10', 'Alvedon 500 mg 10 st', { packCount: 10 })];
    const results = matchOffersSync('alvedon 500 mg 20 st', tablets, { acceptSubstitutes: true });
    expect(kinds(results)).toEqual({ a10: 'substitute' });
    expect(results[0]!.packs).toBeUndefined();
  });
});

describe('bundle titles', () => {
  it('reads "24 x NOCCO BCAA, 330 ml, Arancia" as a 24-pack, not a word "24"', () => {
    const q = parseQuery('24 x NOCCO BCAA, 330 ml, Arancia');
    expect(q).toMatchObject({ packCount: 24, tokens: ['bcaa', 'arancia'] });
    const results = byStore(matchOffersSync('24 x NOCCO BCAA, 330 ml, Arancia', offers));
    expect(results['meds-single']).toMatchObject({ kind: 'equivalent', packs: 24 });
    expect(results['gymgrossisten-flak']).toMatchObject({ kind: 'exact' });
  });
});
