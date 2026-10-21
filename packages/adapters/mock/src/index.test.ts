import { ProductOffer } from '@apokorg/core';
import { describe, expect, it } from 'vitest';
import { createMockAdapter, MOCK_MERCHANTS } from './index';

describe('mock adapter', () => {
  it('covers the v1 merchants', () => {
    expect(MOCK_MERCHANTS).toEqual(
      expect.arrayContaining([
        'apotea',
        'hjartat',
        'apoteket',
        'doz',
        'kronans',
        'gymgrossisten',
        'lyko',
      ]),
    );
  });

  it('returns schema-valid offers for a fuzzy query', async () => {
    const offers = await createMockAdapter('apotea').search('alvedon 500 20');
    expect(offers[0]?.title).toContain('20 st');
    for (const o of offers) expect(() => ProductOffer.parse(o)).not.toThrow();
  });

  it('only returns products the merchant sells', async () => {
    expect(await createMockAdapter('lyko').search('alvedon')).toEqual([]);
  });

  it('round-trips getProduct', async () => {
    const adapter = createMockAdapter('doz');
    const [first] = await adapter.search('cerave');
    expect(await adapter.getProduct(first!.url)).toMatchObject({
      merchantProductId: first!.merchantProductId,
    });
  });
});
