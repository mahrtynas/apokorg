/**
 * Labelled matching cases: the mock catalog plus invented, realistic store titles.
 * `expect` maps merchantProductId → expected kind, or null when the offer must not be returned.
 */
import type { MatchKind, ProductOffer } from '@apokorg/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { matchOffersSync, needsConfirmation, type MatchOptions } from './match';
import { kinds, mockCatalogOffers, offer } from './test-helpers';

interface Case {
  name: string;
  query: string;
  /** Offers, or 'mock' for the whole mock catalog. */
  offers: ProductOffer[] | 'mock';
  opts?: MatchOptions;
  expect: Record<string, MatchKind | null>;
  needsConfirmation?: boolean;
}

const MOCK_PHARMACIES = ['apotea', 'hjartat', 'apoteket', 'doz', 'kronans'] as const;
const each = (
  product: string,
  kind: MatchKind | null,
  merchants: readonly string[] = MOCK_PHARMACIES,
) => Object.fromEntries(merchants.map((m) => [`${m}-${product}`, kind]));

const subs = { acceptSubstitutes: true } satisfies MatchOptions;

const nivea: ProductOffer[] = [
  offer('apotea', 'nv150', 'Nivea Creme 150 ml', {
    brand: 'Nivea',
    size: { value: 150, unit: 'ml' },
  }),
  offer('apotea', 'nv250', 'NIVEA Creme burk 250ml', { brand: 'Nivea' }),
  offer('hjartat', 'nv150', 'Nivea Creme 150ml'),
  offer('hjartat', 'nv30', 'Nivea Creme 30 ml'),
  offer('apoteket', 'nv150', 'Nivea Crème, 150 ml', { brand: 'NIVEA' }),
  offer('kronans', 'nv150', 'Nivea Creme Burk 150 ml'),
  offer('kronans', 'nv30', 'Nivea Creme 30 ml'),
  offer('lyko', 'soft', 'Nivea Soft Fuktighetskräm 200 ml', { brand: 'Nivea' }),
];

const cases: Case[] = [
  // --- Mock catalog ---------------------------------------------------------------------------
  {
    name: 'alvedon 20 st is exact, the 10 st pack is a substitute',
    query: 'alvedon 500 20st',
    offers: 'mock',
    opts: subs,
    expect: { ...each('p01', 'exact'), ...each('p02', 'substitute'), ...each('p03', null) },
    needsConfirmation: false,
  },
  {
    name: 'substitutes off drops the 10 st pack',
    query: 'alvedon 500 20st',
    offers: 'mock',
    expect: { ...each('p01', 'exact'), ...each('p02', null) },
  },
  {
    name: 'alvedon 10 tabletter',
    query: 'Alvedon 500 mg 10 tabletter',
    offers: 'mock',
    opts: subs,
    expect: { ...each('p02', 'exact'), ...each('p01', 'substitute') },
  },
  {
    name: 'ipren with pack word "tabl"',
    query: 'ipren 200mg 30 tabl',
    offers: 'mock',
    opts: subs,
    expect: { ...each('p03', 'exact'), ...each('p01', null) },
  },
  {
    name: 'LRP alias',
    query: 'LRP anthelios spf 50 50ml',
    offers: 'mock',
    expect: each('p04', 'exact', [...MOCK_PHARMACIES, 'lyko']),
  },
  {
    name: 'cerave moisturizing (US spelling) 340 g',
    query: 'cerave moisturizing cream 340g',
    offers: 'mock',
    expect: each('p05', 'exact', [...MOCK_PHARMACIES, 'lyko']),
  },
  {
    name: 'nivea creme without size in the mock catalog',
    query: 'nivea creme',
    offers: 'mock',
    expect: each('p06', 'equivalent', ['apotea', 'hjartat', 'apoteket', 'kronans', 'lyko']),
    needsConfirmation: true,
  },
  {
    name: 'branded whey ignores the other brand',
    query: 'star nutrition whey 80 chocolate 1kg',
    offers: 'mock',
    opts: subs,
    expect: { 'gymgrossisten-p07': 'exact', 'gymgrossisten-p08': null, 'apotea-p08': null },
  },
  {
    name: 'unbranded whey: the brand most stores carry wins, the other is a substitute',
    query: 'whey chocolate 1 kg',
    offers: 'mock',
    opts: subs,
    expect: {
      'apotea-p08': 'equivalent',
      'gymgrossisten-p08': 'equivalent',
      'gymgrossisten-p07': 'substitute',
    },
    needsConfirmation: true,
  },
  {
    name: 'nocco in centilitres',
    query: 'nocco bcaa caribbean 33cl',
    offers: 'mock',
    expect: { 'apotea-p09': 'exact', 'gymgrossisten-p09': 'exact' },
  },
  {
    name: 'diacritics and apostrophes: mollers',
    query: 'mollers omega-3 dobbel 112 kapslar',
    offers: 'mock',
    expect: each('p10', 'exact', [...MOCK_PHARMACIES, 'gymgrossisten']),
  },
  {
    name: 'EAN as the query',
    query: '2000000000060',
    offers: 'mock',
    opts: subs,
    expect: {
      ...each('p06', 'exact', ['apotea', 'hjartat', 'apoteket', 'kronans', 'lyko']),
      'apotea-p05': null,
    },
  },

  // --- Invented titles ------------------------------------------------------------------------
  {
    name: 'alvedon 20 vs 10 st parsed from titles only',
    query: 'alvedon 500 20st',
    offers: [
      offer('apotea', 'a20', 'Alvedon 500 mg filmdragerad tablett 20 st'),
      offer('apotea', 'a10', 'Alvedon 500mg 10st'),
      offer('doz', 'a10', 'Alvedon 500 mg Filmdragerad tablett 10 tablett(er)'),
    ],
    opts: subs,
    expect: { a20: 'exact', a10: 'substitute' },
  },
  {
    name: 'alvedon novum is a substitute for plain alvedon',
    query: 'Alvedon 500 mg tabletter 20 st',
    offers: [
      offer('apoteket', 'plain', 'Alvedon 500 mg filmdragerad tablett 20 st'),
      offer('apoteket', 'novum', 'Alvedon Novum 500 mg tablett 20 st'),
      offer('hjartat', 'plain', 'Alvedon 500mg 20st'),
      offer('hjartat', 'novum', 'Alvedon Novum 500 mg 20 st'),
    ],
    opts: subs,
    expect: { plain: 'exact', novum: 'substitute' },
  },
  {
    name: 'alvedon novum query matches novum, not plain',
    query: 'alvedon novum 500 20 st',
    offers: [
      offer('apoteket', 'plain', 'Alvedon 500 mg filmdragerad tablett 20 st'),
      offer('apoteket', 'novum', 'Alvedon Novum 500 mg tablett 20 st'),
    ],
    opts: subs,
    expect: { novum: 'exact', plain: 'substitute' },
  },
  {
    name: 'alvedon novum is left out when substitutes are off',
    query: 'Alvedon 500 mg 20 st',
    offers: [
      offer('apoteket', 'plain', 'Alvedon 500 mg filmdragerad tablett 20 st'),
      offer('apoteket', 'novum', 'Alvedon Novum 500 mg tablett 20 st'),
    ],
    expect: { plain: 'exact', novum: null },
  },
  {
    name: 'SPF50 50 ml vs 30 ml',
    query: 'la roche posay anthelios uvmune spf50 50 ml',
    offers: [
      offer('apotea', 'lrp50', 'La Roche-Posay Anthelios UVMune 400 Invisible Fluid SPF50+ 50 ml'),
      offer('lyko', 'lrp30', 'La Roche-Posay Anthelios UVMune 400 Invisible Fluid SPF50+ 30 ml'),
    ],
    opts: subs,
    expect: { lrp50: 'exact', lrp30: 'substitute' },
  },
  {
    name: 'SPF50 vs 30 ml with substitutes off',
    query: 'la roche posay anthelios uvmune spf50 50 ml',
    offers: [
      offer('apotea', 'lrp50', 'La Roche-Posay Anthelios UVMune 400 Invisible Fluid SPF50+ 50 ml'),
      offer('lyko', 'lrp30', 'La Roche-Posay Anthelios UVMune 400 Invisible Fluid SPF50+ 30 ml'),
    ],
    expect: { lrp50: 'exact', lrp30: null },
  },
  {
    name: 'same whey in other flavours is a substitute',
    query: 'star nutrition whey-80 chocolate 1kg',
    offers: [
      offer('gymgrossisten', 'choc', 'Star Nutrition Whey-80, 1 kg, Chocolate', {
        brand: 'Star Nutrition',
      }),
      offer('gymgrossisten', 'van', 'Star Nutrition Whey-80, 1 kg, Vanilla', {
        brand: 'Star Nutrition',
      }),
      offer('gymgrossisten', 'str', 'Star Nutrition Whey-80, 1 kg, Strawberry', {
        brand: 'Star Nutrition',
      }),
      offer('gymgrossisten', 'choc4', 'Star Nutrition Whey-80, 4 kg, Chocolate', {
        brand: 'Star Nutrition',
      }),
      offer('gymgrossisten', 'bar', 'Star Nutrition Protein Bar Chocolate 55 g', {
        brand: 'Star Nutrition',
      }),
    ],
    opts: subs,
    expect: { choc: 'exact', van: 'substitute', str: 'substitute', choc4: 'substitute', bar: null },
  },
  {
    name: 'nivea creme with no size picks the 150 ml',
    query: 'Nivea creme',
    offers: nivea,
    opts: subs,
    expect: { nv150: 'equivalent', nv250: 'substitute', nv30: 'substitute', soft: null },
  },
  {
    name: 'nivea creme with substitutes off returns only the 150 ml',
    query: 'nivea creme',
    offers: nivea,
    expect: { nv150: 'equivalent', nv250: null, nv30: null },
  },
  {
    name: 'nivea creme 30 ml when the size is given',
    query: 'nivea creme 30ml',
    offers: nivea,
    opts: subs,
    expect: { nv30: 'exact', nv150: 'substitute', nv250: 'substitute' },
  },
  {
    name: 'branded query never returns another brand, even as substitute',
    query: 'alvedon 500 20st',
    offers: [
      offer('apotea', 'alv', 'Alvedon 500 mg 20 st', { brand: 'Alvedon' }),
      offer('apotea', 'pan', 'Panodil 500 mg 20 st', { brand: 'Panodil' }),
    ],
    opts: subs,
    expect: { alv: 'exact', pan: null },
  },
  {
    name: 'unbranded generic: other brands are substitutes',
    query: 'paracetamol 500 mg 20 st',
    offers: [
      offer('apotea', 'pan', 'Panodil paracetamol 500 mg 20 tabletter', { brand: 'Panodil' }),
      offer('hjartat', 'pan', 'Panodil Paracetamol 500mg 20st', { brand: 'Panodil' }),
      offer('doz', 'pan', 'Panodil paracetamol 500 mg 20 st', { brand: 'Panodil' }),
      offer('apotea', 'alv', 'Alvedon paracetamol 500 mg 20 st', { brand: 'Alvedon' }),
    ],
    opts: subs,
    expect: { pan: 'equivalent', alv: 'substitute' },
    needsConfirmation: true,
  },
  {
    name: 'different strength is a substitute',
    query: 'alvedon 500 20st',
    offers: [
      offer('apotea', 'a500', 'Alvedon 500 mg 20 st'),
      offer('apotea', 'a665', 'Alvedon 665 mg modifierad frisättning 20 st'),
    ],
    opts: subs,
    expect: { a500: 'exact', a665: 'substitute' },
  },
  {
    name: 'unrelated products are not returned',
    query: 'cerave moisturising cream 340 g',
    offers: [
      offer('lyko', 'cream', 'CeraVe Moisturising Cream 340g'),
      offer('lyko', 'lotion', 'CeraVe Moisturising Lotion 236 ml'),
      offer('lyko', 'cleanser', 'CeraVe Hydrating Cleanser 236 ml'),
    ],
    opts: subs,
    expect: { cream: 'exact', lotion: 'substitute', cleanser: null },
  },
  {
    name: 'weight units: 1000 g equals 1 kg',
    query: 'body science whey 100% chocolate 1000g',
    offers: [
      offer('apotea', 'bs', 'Body Science Whey 100% 1 kg Chocolate', {
        size: { value: 1, unit: 'kg' },
      }),
    ],
    expect: { bs: 'exact' },
  },
  {
    name: 'pinned listing wins even with a worse title',
    query: 'alvedon 500 20st',
    offers: [
      offer('hjartat', 'good', 'Alvedon 500 mg 20 st'),
      offer('hjartat', 'pi', 'Alvedon (parallellimporterad) tabletter'),
    ],
    opts: { pinned: { hjartat: 'pi' }, acceptSubstitutes: true },
    expect: { pi: 'exact', good: 'substitute' },
  },
  {
    name: 'pinned exact spreads by EAN to other stores',
    query: 'cerave cream',
    offers: [
      offer('apotea', 'cv', 'CeraVe Moisturising Cream 340 g', { ean: '3337875597197' }),
      offer('lyko', 'cv', 'CeraVe Fuktkräm för torr hud', { ean: '3337875597197' }),
    ],
    opts: { pinned: { apotea: 'cv' } },
    expect: { cv: 'exact' },
  },
  {
    name: 'scored exact spreads by EAN to a vague title',
    query: 'alvedon 500 20st',
    offers: [
      offer('apotea', 'a', 'Alvedon 500 mg 20 st', { ean: '7046260000005' }),
      offer('doz', 'd', 'Alvedon filmdrag. tabl.', { ean: '7046260000005' }),
    ],
    expect: { a: 'exact', d: 'exact' },
  },
  {
    name: 'near-identical listings at one store without an LLM: ask the user',
    query: 'nocco bcaa caribbean',
    offers: [
      offer('gymgrossisten', 'n1', 'Nocco BCAA Caribbean 330 ml'),
      offer('gymgrossisten', 'n2', 'NOCCO BCAA Caribbean 330ml burk'),
    ],
    opts: subs,
    expect: { n1: 'equivalent', n2: 'substitute' },
    needsConfirmation: true,
  },
];

describe('labelled cases', () => {
  let mock: ProductOffer[];
  beforeAll(async () => {
    mock = await mockCatalogOffers();
  });

  it('has at least 25 cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(25);
  });

  it.each(cases)('$name', (c) => {
    const offers = c.offers === 'mock' ? mock : c.offers;
    const results = matchOffersSync(c.query, offers, c.opts);
    // Ids can repeat across merchants in invented cases; check every result per id.
    for (const [id, kind] of Object.entries(c.expect)) {
      const got = results.filter((r) => r.offer.merchantProductId === id).map((r) => r.kind);
      if (kind === null) expect(got, `${id} should be absent`).toEqual([]);
      else {
        expect(got.length, `${id} should be present`).toBeGreaterThan(0);
        expect(new Set(got), `${id} kinds ${JSON.stringify(kinds(results))}`).toEqual(
          new Set([kind]),
        );
      }
    }
    if (c.opts?.acceptSubstitutes !== true) {
      expect(results.some((r) => r.kind === 'substitute')).toBe(false);
    }
    if (c.needsConfirmation !== undefined) {
      expect(needsConfirmation(results)).toBe(c.needsConfirmation);
    }
    for (const r of results) {
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });
});
