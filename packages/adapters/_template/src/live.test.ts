/**
 * Hits the real site. Never run in CI. Usage:
 *   pnpm --filter @apokorg/adapter-__ID__ test:live
 *   RECORD_FIXTURES=1 pnpm --filter @apokorg/adapter-__ID__ test:live   (also saves fixtures)
 */
import { ProductOffer } from '@apokorg/core';
import { describe, expect, it } from 'vitest';
import adapter from './index';

const query = process.env.LIVE_QUERY ?? 'alvedon 500 mg 20 st';

describe('__ID__ live', () => {
  it(`searches "${query}"`, { timeout: 60_000 }, async () => {
    const offers = await adapter.search(query);
    console.table(
      offers.map((o) => ({ title: o.title, price: o.price, ean: o.ean, inStock: o.inStock })),
    );
    expect(offers.length).toBeGreaterThan(0);
    for (const o of offers) ProductOffer.parse(o);
  });
});
