import { describe, expect, it } from 'vitest';
import { groupProducts } from './group';
import { offer } from './test-helpers';

describe('groupProducts', () => {
  it('merges the same EAN across stores and keeps the price range', () => {
    const groups = groupProducts([
      offer('apoteket', 'a1', 'Alvedon, filmdragerad tablett 500 mg, 20 st', {
        ean: '4006381333931',
        price: 34,
        imageUrl: 'https://example.com/a1.jpg',
      }),
      offer('hjartat', 'h1', 'Alvedon 500 mg 20 tabletter', { ean: '04006381333931', price: 39 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: 'ean:4006381333931',
      merchantIds: ['apoteket', 'hjartat'],
      minPrice: 34,
      maxPrice: 39,
      imageUrl: 'https://example.com/a1.jpg',
    });
  });

  it('merges by name, strength and pack when a store has no EAN', () => {
    const groups = groupProducts([
      offer('apoteket', 'a1', 'Ipren 200 mg 30 tabletter', { ean: '4006381333931' }),
      offer('doz', 'd1', 'Ipren tablett 200 mg 30 st'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.merchantIds).toEqual(['apoteket', 'doz']);
  });

  it('keeps different variants and pack sizes apart', () => {
    const groups = groupProducts([
      offer('apoteket', 'a1', 'Alvedon filmdragerad tablett 500 mg 20 st'),
      offer('hjartat', 'h1', 'Alvedon Novum filmdragerad tablett 500 mg 20 st'),
      offer('hjartat', 'h2', 'Alvedon filmdragerad tablett 500 mg 10 st'),
    ]);
    expect(groups).toHaveLength(3);
  });

  it('never merges two different EANs even when titles match', () => {
    const groups = groupProducts([
      offer('apoteket', 'a1', 'Nivea Creme 150 ml', { ean: '4006381333931' }),
      offer('hjartat', 'h1', 'Nivea Creme 150 ml', { ean: '73513537' }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('orders by best position in any store, then by number of stores', () => {
    const groups = groupProducts([
      offer('apoteket', 'a1', 'Product A 50 ml'),
      offer('apoteket', 'a2', 'Product B 50 ml'),
      offer('hjartat', 'h1', 'Product B 50 ml'),
      offer('hjartat', 'h2', 'Product C 50 ml'),
    ]);
    expect(groups.map((g) => g.title)).toEqual([
      'Product B 50 ml',
      'Product A 50 ml',
      'Product C 50 ml',
    ]);
  });
});
